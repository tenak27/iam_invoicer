// CRM étape 1 — prospect : création, filtre, et conversion automatique en client à la 1re facture.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../src/main/db'
import { call } from '../src/main/router'
import type { Ctx, SessionUser } from '../src/main/services/context'

let db: Db
let admin: Ctx

async function ok<T = any>(ctx: Ctx, name: string, args?: unknown): Promise<T> {
  const r = await call(ctx, name, args)
  if (!r.ok) throw new Error(r.error)
  return r.data as T
}

beforeAll(async () => {
  db = await openDb({ mode: 'local' })
  const user = await ok<SessionUser>({ db, user: null }, 'auth.setup', { company: { name: 'IAM Technology' }, username: 'admin', full_name: 'Admin', password: 'secret123' })
  admin = { db, user }
})
afterAll(() => db?.close())

describe('Prospect → client', () => {
  it('crée un prospect, le filtre, puis le convertit à la première facture validée', async () => {
    const p = await ok<{ id: number; is_prospect: boolean }>(admin, 'parties.save', { kind: 'client', name: 'SONABEL', is_prospect: true, source: 'Salon FICA' })
    expect(p.is_prospect).toBe(true)

    // Filtres de la liste
    expect((await ok<any[]>(admin, 'parties.list', { kind: 'client', prospect: 'prospect' })).map((r) => r.id)).toContain(p.id)
    expect((await ok<any[]>(admin, 'parties.list', { kind: 'client', prospect: 'client' })).map((r) => r.id)).not.toContain(p.id)
    const got = await ok<any>(admin, 'parties.get', { id: p.id })
    expect(got.party.is_prospect).toBe(true)
    expect(got.party.source).toBe('Salon FICA')

    // Une facture validée convertit le prospect en client
    const prod = await ok<{ id: number }>(admin, 'products.save', { kind: 'prestation', name: 'Installation', sale_price: 85000, tva_rate: 18 })
    const fac = await ok<{ id: number }>(admin, 'documents.save', { type: 'FAC', party_id: p.id, lines: [{ product_id: prod.id, description: 'Installation', quantity: 1, unit_price: 85000, tva_rate: 18 }] })
    await ok(admin, 'documents.validate', { id: fac.id })

    const after = await ok<any>(admin, 'parties.get', { id: p.id })
    expect(after.party.is_prospect).toBe(false)
    expect(after.party.converted_at).toBeTruthy()
    expect((await ok<any[]>(admin, 'parties.list', { kind: 'client', prospect: 'client' })).map((r) => r.id)).toContain(p.id)

    // Trace au journal d'activité
    const log = await db.query("SELECT 1 FROM audit_log WHERE action = 'conversion' AND entity = 'client' AND entity_id = $1", [p.id])
    expect(log.length).toBe(1)
  })
})
