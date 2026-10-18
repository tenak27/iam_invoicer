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

describe('Tâches client', () => {
  it('rattache une tâche au client sans opportunité, la remonte dans l’agenda et la chronologie', async () => {
    const c = await ok<{ id: number }>(admin, 'parties.save', { kind: 'client', name: 'ONEA' })
    await ok(admin, 'crm.saveActivity', { party_id: c.id, kind: 'appel', subject: 'Relancer le devis', due_date: '2020-01-01' })
    const agenda = await ok<any[]>(admin, 'crm.agenda', { mine: true })
    const t = agenda.find((a) => a.subject === 'Relancer le devis')
    expect(t?.who_id).toBe(c.id)
    const tl = await ok<any>(admin, 'crm.partyTimeline', { party_id: c.id })
    expect(tl.activities.map((a: any) => a.id)).toContain(t.id)
    await ok(admin, 'crm.toggleActivity', { id: t.id })
    expect((await ok<any[]>(admin, 'crm.agenda', { mine: true })).find((a) => a.id === t.id)).toBeUndefined()
  })
})

describe('Administrateur : annulation et suppression', () => {
  it('annule une facture validée sans règlement puis la supprime définitivement', async () => {
    const c = await ok<{ id: number }>(admin, 'parties.save', { kind: 'client', name: 'SOFITEX' })
    const prod = await ok<{ id: number }>(admin, 'products.save', { kind: 'prestation', name: 'Audit', sale_price: 50000, tva_rate: 18 })
    const fac = await ok<{ id: number }>(admin, 'documents.save', { type: 'FAC', party_id: c.id, lines: [{ product_id: prod.id, description: 'Audit', quantity: 1, unit_price: 50000, tva_rate: 18 }] })
    await ok(admin, 'documents.validate', { id: fac.id })
    expect((await call(admin, 'documents.purge', { id: fac.id })).ok).toBe(false)
    const cancelled = await ok<any>(admin, 'documents.cancel', { id: fac.id })
    expect(cancelled.status).toBe('annule')
    await ok(admin, 'documents.purge', { id: fac.id })
    expect((await call(admin, 'documents.get', { id: fac.id })).ok).toBe(false)
  })
})
