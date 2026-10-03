import { generateKeyPairSync, sign } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isReadAction, TIERS, type LicencePayload } from '../src/shared/licence'
import { openDb, type Db } from '../src/main/db'
import { call } from '../src/main/router'
import { decodeLicence, forgetLicenceStatus, useTestLicenceKey } from '../src/main/services/licence'
import type { Ctx, SessionUser } from '../src/main/services/context'

// Clé de test : les vraies licences sont signées par la clé privée de l'éditeur.
const { publicKey, privateKey } = generateKeyPairSync('ed25519')
useTestLicenceKey(publicKey.export({ type: 'spki', format: 'pem' }) as string)

function issue(p: Partial<LicencePayload>): string {
  const payload: LicencePayload = { v: 1, id: 'LIC-T-1', company: 'Faso Services SARL', tier: 'essentiel', modules: TIERS.essentiel.modules, users: 2, issued: '2026-01-01', expires: '2099-12-31', whiteLabel: false, ...p }
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${data}.${sign(null, Buffer.from(data), privateKey).toString('base64url')}`
}

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
const setTrialStart = async (date: string) => {
  await db.query("UPDATE settings SET value = $1 WHERE key = 'trial_start'", [JSON.stringify(date)])
  forgetLicenceStatus(db)
}

describe('Licences', () => {
  beforeAll(async () => {
    db = await openDb({ mode: 'local' })
    const user = await ok<SessionUser>({ db, user: null }, 'auth.setup', { company: { name: 'Faso Services SARL' }, username: 'admin', full_name: 'Admin', password: 'secret123' })
    admin = { db, user }
  })
  afterAll(() => db?.close())

  it('signature : une licence modifiée est refusée', () => {
    const key = issue({})
    expect(decodeLicence(key)?.company).toBe('Faso Services SARL')
    const [data, sig] = key.split('.')
    const forged = Buffer.from(Buffer.from(data, 'base64url').toString().replace('"essentiel"', '"entreprise"')).toString('base64url')
    expect(decodeLicence(`${forged}.${sig}`)).toBeNull()
    expect(decodeLicence('nimporte-quoi')).toBeNull()
  })

  it('évaluation : tout est ouvert pendant 30 jours', async () => {
    const st = await ok(admin, 'licence.status')
    expect(st).toMatchObject({ state: 'trial', canWrite: true, daysLeft: 30 })
    expect(st.modules).toContain('hr')
  })

  it('évaluation terminée : lecture seule, paramètres et licence toujours accessibles', async () => {
    await setTrialStart('2020-01-01')
    expect(await ok(admin, 'licence.status')).toMatchObject({ state: 'trial_over', canWrite: false })
    expect(await err(admin, 'parties.save', { kind: 'client', name: 'X' })).toMatch(/évaluation terminée/i)
    expect(Array.isArray(await ok(admin, 'parties.list', { kind: 'client' }))).toBe(true) // consultation
    await ok(admin, 'settings.save', { name: 'Faso Services SARL' }) // se mettre en règle
  })

  it('activation : raison sociale contrôlée, modules du palier, quota d’utilisateurs', async () => {
    expect(await err(admin, 'licence.activate', { key: issue({ company: 'Autre Société' }) })).toMatch(/établie pour « Autre Société »/)
    // Différences de forme juridique, d'accents et de casse tolérées
    const st = await ok(admin, 'licence.activate', { key: issue({ company: 'faso services' }) })
    expect(st).toMatchObject({ state: 'active', label: 'Essentiel', canWrite: true, users: 2 })
    await ok(admin, 'parties.save', { kind: 'client', name: 'Client autorisé' })
    expect(await err(admin, 'hr.employees', {})).toMatch(/RH et paie.*n'est pas inclus.*Essentiel/)
    expect(await err(admin, 'accounting.balanceSheet', {})).toMatch(/n'est pas inclus/)
    await ok(admin, 'users.save', { username: 'awa', full_name: 'Awa', role: 'commercial', password: 'secret123' })
    expect(await err(admin, 'users.save', { username: 'ali', full_name: 'Ali', role: 'commercial', password: 'secret123' })).toMatch(/limitée à 2 utilisateur/)
    // Un compte désactivé peut être créé
    await ok(admin, 'users.save', { username: 'ali', full_name: 'Ali', role: 'commercial', password: 'secret123', active: false })
  })

  it('la licence ne se modifie pas par les paramètres', async () => {
    await ok(admin, 'settings.save', { licence_key: 'falsifiee', trial_start: '2099-01-01' } as any)
    expect(await ok(admin, 'licence.status')).toMatchObject({ state: 'active', label: 'Essentiel' })
  })

  it('licence expirée : lecture seule', async () => {
    await ok(admin, 'licence.activate', { key: issue({ tier: 'entreprise', modules: TIERS.entreprise.modules, users: 0, expires: '2021-01-01' }) })
    const st = await ok(admin, 'licence.status')
    expect(st).toMatchObject({ state: 'expired', canWrite: false })
    expect(await err(admin, 'parties.save', { kind: 'client', name: 'Y' })).toMatch(/expirée/)
    expect(Array.isArray(await ok(admin, 'hr.employees', {}))).toBe(true)
  })

  it('actions de consultation reconnues', () => {
    for (const n of ['documents.list', 'documents.get', 'accounting.balanceSheet', 'declarations.month', 'hr.payslipsHtml', 'licence.status']) expect(isReadAction(n)).toBe(true)
    for (const n of ['documents.save', 'documents.validate', 'payments.add', 'cash.sale', 'imports.run', 'taxes.save']) expect(isReadAction(n)).toBe(false)
  })
})
