import { generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TRIAL_LIMITS, TIERS } from '../src/shared/licence'
import { openDb, type Db } from '../src/main/db'
import { call } from '../src/main/router'
import { decodeLicence, forgetLicenceStatus, trialDemand, useTestLicenceKey } from '../src/main/services/licence'
import { configureVendorKey, useTestVendorPublicKey } from '../src/main/services/licensing'
import type { Ctx, SessionUser } from '../src/main/services/context'

// Clés de test : la paire de l'éditeur est simulée dans un dossier temporaire.
const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const pubPem = publicKey.export({ type: 'spki', format: 'pem' }) as string
useTestLicenceKey(pubPem)
useTestVendorPublicKey(pubPem)
const keyDir = mkdtempSync(join(tmpdir(), 'iam-vendor-'))
const keyFile = join(keyDir, 'licence-private.pem')
writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }) as string)

let db: Db
let admin: Ctx
const ok = async <T = any>(ctx: Ctx, name: string, args?: unknown): Promise<T> => {
  const r = await call(ctx, name, args)
  if (!r.ok) throw new Error(r.error)
  return r.data as T
}
const err = async (ctx: Ctx, name: string, args?: unknown) => {
  const r = await call(ctx, name, args)
  if (r.ok) throw new Error(`${name} aurait dû échouer`)
  return r.error
}

beforeAll(async () => {
  db = await openDb({ mode: 'local' })
  const user = await ok<SessionUser>({ db, user: null }, 'auth.setup', { company: { name: 'Faso Services SARL' }, username: 'admin', full_name: 'Admin', password: 'secret123' })
  admin = { db, user }
})
afterAll(() => db?.close())

describe('Version d’évaluation limitée', () => {
  it('demandes de création reconnues', () => {
    expect(trialDemand('parties.save', { kind: 'supplier' })).toEqual({ quota: 'suppliers', add: 1 })
    expect(trialDemand('parties.save', { id: 3, kind: 'client' })).toBeNull() // modification : rien de créé
    expect(trialDemand('imports.run', { kind: 'products', rows: [{}, {}, {}] })).toEqual({ quota: 'products', add: 3 })
    expect(trialDemand('cash.sale', {})).toEqual({ quota: 'documents', add: 1 })
    expect(trialDemand('clients.list', {})).toBeNull()
  })

  it('quotas affichés dans l’état de licence', async () => {
    const st = await ok(admin, 'licence.status')
    expect(st.state).toBe('trial')
    expect(st.users).toBe(TRIAL_LIMITS.users)
    expect(st.usage.find((u: any) => u.key === 'clients')).toMatchObject({ used: 0, limit: TRIAL_LIMITS.clients })
  })

  it('au-delà du quota de clients : création refusée, modification toujours possible', async () => {
    let last = 0
    for (let i = 0; i < TRIAL_LIMITS.clients; i++) last = (await ok<{ id: number }>(admin, 'parties.save', { kind: 'client', name: `Client ${i}` })).id
    expect(await err(admin, 'parties.save', { kind: 'client', name: 'Un de trop' })).toMatch(/évaluation limitée à 25 clients/)
    await ok(admin, 'parties.save', { id: last, kind: 'client', name: 'Client renommé' })
    // Un import qui dépasserait le quota est refusé en entier
    expect(await err(admin, 'imports.run', { kind: 'clients', rows: [{ name: 'X' }] })).toMatch(/limitée/)
    // Les fournisseurs ont leur propre quota
    await ok(admin, 'parties.save', { kind: 'supplier', name: 'Fournisseur 1' })
  })

  it('utilisateurs limités pendant l’évaluation', async () => {
    await ok(admin, 'users.save', { username: 'vendeur', full_name: 'Vendeur', role: 'commercial', password: 'secret123', active: true })
    expect(await err(admin, 'users.save', { username: 'compta', full_name: 'Compta', role: 'comptable', password: 'secret123', active: true })).toMatch(/limitée à 2 utilisateur/)
  })

  it('une licence lève les limites', async () => {
    const r = await ok(admin, 'licence.status')
    expect(r.vendor).toBe(false)
  })
})

describe('Profil « Gestionnaire de licences »', () => {
  let manager: Ctx
  beforeAll(async () => {
    // Le poste de l'éditeur a une licence (sinon le quota d'utilisateurs de l'évaluation s'applique)
    await db.query("DELETE FROM users WHERE username = 'vendeur'")
    forgetLicenceStatus(db)
  })

  it('sans clé privée : module masqué et émission refusée', async () => {
    configureVendorKey(join(keyDir, 'absente.pem'))
    const st = await ok(admin, 'licence.status')
    expect(st.vendor).toBe(false)
    expect(await err(admin, 'licensing.issue', { company: 'X', tier: 'pro' })).toMatch(/éditeur/)
  })

  it('clé privée qui ne correspond pas au logiciel : refusée', async () => {
    const other = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
    const wrong = join(keyDir, 'autre.pem')
    writeFileSync(wrong, other)
    configureVendorKey(wrong)
    const st = await ok(admin, 'licensing.status')
    expect(st.available).toBe(false)
    expect(st.reason).toMatch(/ne correspond pas/)
  })

  it('le gestionnaire émet une licence valide, inscrite aux registres', async () => {
    configureVendorKey(keyFile)
    expect((await ok(admin, 'licence.status')).vendor).toBe(true)
    await ok(admin, 'users.save', { username: 'licences', full_name: 'Awa Licences', role: 'licences', password: 'secret123', active: true })
    const u = await db.one("SELECT id, username, full_name, role FROM users WHERE username = 'licences'")
    manager = { db, user: { ...u } as SessionUser }

    // Le profil ne voit que l'émission de licences
    expect(await err(manager, 'parties.list', { kind: 'client' })).toMatch(/droits/)

    const lic = await ok(manager, 'licensing.issue', { company: 'Pharmacie du Progrès SARL', tax_id: '00012345A', tier: 'pro', expires: '2099-06-30', contact: '70 00 00 00' })
    expect(lic.number).toMatch(/^LIC-\d{4}-0001$/)
    const payload = decodeLicence(lic.licence_key)
    expect(payload).toMatchObject({ company: 'Pharmacie du Progrès SARL', taxId: '00012345A', tier: 'pro', users: TIERS.pro.users, expires: '2099-06-30' })
    expect(payload!.modules).toEqual(TIERS.pro.modules)
    // Registre CSV partagé avec l'outil en ligne de commande
    const csv = readFileSync(join(keyDir, 'licences.csv'), 'utf8')
    expect(csv).toContain(lic.number)
    expect(csv).toContain(lic.licence_key)

    const sur = await ok(manager, 'licensing.issue', { company: 'Boutique X', tier: 'sur-mesure', modules: ['sales', 'cash', 'licensing', 'inconnu'], users: 1, expires: null })
    expect(sur.number).toMatch(/0002$/)
    expect(decodeLicence(sur.licence_key)).toMatchObject({ modules: ['sales', 'cash'], users: 1, expires: null })

    expect(await err(manager, 'licensing.issue', { company: 'YY', tier: 'sur-mesure', modules: [] })).toMatch(/au moins un module/)
    expect(await err(manager, 'licensing.issue', { company: 'YY', tier: 'pro', expires: '2001-01-01' })).toMatch(/futur/)

    const list = await ok<any[]>(manager, 'licensing.list')
    expect(list.map((l) => l.number)).toEqual([sur.number, lic.number])
    expect(list[1].issued_by_name).toBe('Awa Licences')
  })

  it('révocation, puis reprise du registre CSV sans doublon', async () => {
    const [last] = await ok<any[]>(manager, 'licensing.list')
    expect((await ok(manager, 'licensing.revoke', { id: last.id })).revoked).toBe(true)
    // Licence émise par l'outil en ligne de commande, absente de la base
    const csvPath = join(keyDir, 'licences.csv')
    writeFileSync(csvPath, readFileSync(csvPath, 'utf8') + 'LIC-2026-0099;2026-05-01;"Garage ""Le Bon"" SARL";;essentiel;2;2027-05-01;non;abc.def\r\n')
    const r = await ok(manager, 'licensing.importRegistry')
    expect(r).toEqual({ added: 1, total: 3 })
    const g = (await ok<any[]>(manager, 'licensing.list')).find((l) => l.number === 'LIC-2026-0099')
    expect(g).toMatchObject({ company: 'Garage "Le Bon" SARL', users: 2, expires: '2027-05-01' })
    // La numérotation continue après le registre
    const next = await ok(manager, 'licensing.issue', { company: 'Après', tier: 'essentiel' })
    expect(next.number.endsWith(new Date().getFullYear() === 2026 ? '0100' : '0001')).toBe(true)
    expect(existsSync(csvPath)).toBe(true)
  })

  it('la licence émise s’active chez le client', async () => {
    const client = await openDb({ mode: 'local' })
    const u = await ok<SessionUser>({ db: client, user: null }, 'auth.setup', { company: { name: 'PHARMACIE DU PROGRES', tax_id: '00012345A' }, username: 'admin', full_name: 'Admin', password: 'secret123' })
    const lic = (await ok<any[]>(manager, 'licensing.list')).find((l) => l.company === 'Pharmacie du Progrès SARL')
    const st = await ok({ db: client, user: u }, 'licence.activate', { key: lic.licence_key })
    expect(st).toMatchObject({ state: 'active', label: 'Pro' })
    expect(st.usage).toBeUndefined()
    await client.close()
  })
})
