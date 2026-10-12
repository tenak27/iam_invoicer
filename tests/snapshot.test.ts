import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../src/main/db'
import { call } from '../src/main/router'
import type { Ctx, SessionUser } from '../src/main/services/context'
import { createToken, resolveToken } from '../src/main/services/tokens'
import { exportSnapshot, importSnapshot } from '../src/main/snapshot'

let source: Db
let target: Db
let admin: Ctx
const ok = async <T = any>(ctx: Ctx, name: string, args?: unknown): Promise<T> => {
  const r = await call(ctx, name, args)
  if (!r.ok) throw new Error(r.error)
  return r.data as T
}

beforeAll(async () => {
  source = await openDb({ mode: 'local' })
  target = await openDb({ mode: 'local' })
  const user = await ok<SessionUser>({ db: source, user: null }, 'auth.setup', { company: { name: 'Faso Services SARL', country_code: 'BF' }, username: 'admin', full_name: 'Admin', password: 'secret123' })
  admin = { db: source, user }
})
afterAll(async () => {
  await source?.close()
  await target?.close()
})

describe('Instantané d’une base (copie vers le cloud)', () => {
  it('toutes les données sont recopiées : documents liés, règlements, écritures, paramètres', async () => {
    const client = await ok(admin, 'parties.save', { kind: 'client', name: 'Vista Énergie' })
    const produit = await ok(admin, 'products.save', { kind: 'produit', name: 'Routeur', sale_price: 55000, purchase_price: 40000, tva_rate: 18 })
    await ok(admin, 'stock.adjust', { productId: produit.id, quantity: 10, unitCost: 40000, note: 'Stock de départ' })
    const lines = [{ product_id: produit.id, description: 'Routeur', quantity: 2, unit_price: 55000, tva_rate: 18 }]
    const devis = await ok(admin, 'documents.save', { type: 'DEV', party_id: client.id, lines, validate: true })
    // Facture issue du devis : référence d'un document vers un autre document
    const fac = await ok(admin, 'documents.convert', { id: devis.id, to: 'FAC' })
    await ok(admin, 'documents.validate', { id: fac.id })
    await ok(admin, 'payments.add', { document_id: fac.id, amount: 50000, method: 'Virement' })
    await ok(admin, 'taxes.list', { seed: true })

    const snap = await exportSnapshot(source)
    expect(snap.tables.documents).toHaveLength(2)
    expect(snap.tables.auth_sessions).toBeUndefined()
    const r = await importSnapshot(target, snap)
    expect(r.rows).toBeGreaterThan(50)

    // Mêmes données, table par table
    const again = await exportSnapshot(target)
    expect(Object.keys(again.tables)).toEqual(Object.keys(snap.tables))
    for (const t of Object.keys(snap.tables)) expect(again.tables[t], t).toEqual(snap.tables[t])

    // La copie est utilisable telle quelle : connexion, lecture, lien devis → facture
    const mirror: Ctx = { db: target, user: admin.user }
    const doc = await ok(mirror, 'documents.get', { id: fac.id })
    expect(doc).toMatchObject({ status: 'valide', total_ttc: 129800, paid: 50000, source_number: expect.stringMatching(/^DEV-/) })
    expect(doc.taxes).toEqual([])
    expect((await ok<any[]>(mirror, 'taxes.list')).length).toBe(8)
  })

  it('les identifiants continuent après le plus grand importé', async () => {
    const mirror: Ctx = { db: target, user: admin.user }
    const p = await ok(mirror, 'parties.save', { kind: 'client', name: 'Nouveau client' })
    expect(p.id).toBeGreaterThan(1)
    expect((await target.query('SELECT 1 FROM parties')).length).toBe(2)
  })

  it('nouvel import : tout est remplacé, les sessions ouvertes sur la copie sont conservées', async () => {
    const token = await createToken(target, admin.user!.id, 'Téléphone du gérant')
    await ok(admin, 'parties.save', { kind: 'client', name: 'Davycas International' })
    await importSnapshot(target, await exportSnapshot(source))
    expect((await target.query<{ name: string }>('SELECT name FROM parties ORDER BY id')).map((p) => p.name)).toEqual(['Vista Énergie', 'Davycas International'])
    expect((await resolveToken(target, token))?.username).toBe('admin')
  })

  it('versions différentes ou instantané étranger : refusés sans toucher à la base', async () => {
    const snap = await exportSnapshot(source)
    await expect(importSnapshot(target, { ...snap, schema: snap.schema - 1 })).rejects.toThrow(/plus ancienne/)
    await expect(importSnapshot(target, { ...snap, tables: { ...snap.tables, intruse: [] } })).rejects.toThrow(/table inconnue/)
    // Ligne invalide : la transaction est annulée, la copie garde son contenu
    const broken = { ...snap, tables: { ...snap.tables, parties: [{ ...snap.tables.parties[0], kind: 'inconnu' }] } }
    await expect(importSnapshot(target, broken)).rejects.toThrow()
    expect((await target.query('SELECT 1 FROM parties')).length).toBe(2)
  })
})
