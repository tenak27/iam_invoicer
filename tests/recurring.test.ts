import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { nextDate } from '../src/main/services/recurring'
import { openDb, type Db } from '../src/main/db'
import { call } from '../src/main/router'
import type { Ctx, SessionUser } from '../src/main/services/context'
import { checkIntegrity } from './integrity'

let db: Db
let admin: Ctx
const ok = async <T = any>(ctx: Ctx, name: string, args?: unknown): Promise<T> => {
  const r = await call(ctx, name, args)
  if (!r.ok) throw new Error(r.error)
  return r.data as T
}

describe('Factures récurrentes', () => {
  let client: number
  beforeAll(async () => {
    db = await openDb({ mode: 'local' })
    const user = await ok<SessionUser>({ db, user: null }, 'auth.setup', { company: { name: 'Test' }, username: 'admin', full_name: 'Admin', password: 'secret123' })
    admin = { db, user }
    client = (await ok(admin, 'parties.save', { kind: 'client', name: 'Banque Atlantique' })).id
  })
  afterAll(() => db?.close())

  it('échéances : fin de mois, trimestres, années', () => {
    expect(nextDate('2026-01-31', 'mensuel')).toBe('2026-02-28')
    expect(nextDate('2024-01-31', 'mensuel')).toBe('2024-02-29')
    expect(nextDate('2026-11-15', 'trimestriel')).toBe('2027-02-15')
    expect(nextDate('2026-03-31', 'semestriel')).toBe('2026-09-30')
    expect(nextDate('2026-02-28', 'annuel')).toBe('2027-02-28')
  })

  it('rattrape les échéances manquées et s’arrête à la date de fin', async () => {
    const { id } = await ok(admin, 'recurring.save', {
      party_id: client, label: 'Maintenance informatique', frequency: 'mensuel', next_date: '2026-01-15', end_date: '2026-03-31', auto_validate: true,
      lines: [{ description: 'Forfait maintenance mensuel', quantity: 1, unit_price: 100000, tva_rate: 18 }]
    })
    const r = await ok(admin, 'recurring.runDue', { today: '2026-05-01' })
    expect(r.created.map((c: any) => c.id)).toEqual([id, id, id]) // janvier, février, mars
    const docs = await ok<any[]>(admin, 'documents.list', { types: ['FAC'] })
    expect(docs).toHaveLength(3)
    expect(docs.every((d) => d.status === 'valide' && d.total_ttc === 118000)).toBe(true)
    const list = await ok<any[]>(admin, 'recurring.list')
    expect(list[0]).toMatchObject({ generated: 3, active: false, next_date: '2026-04-15', amount_ht: 100000 })
    // Rien de plus au passage suivant
    expect((await ok(admin, 'recurring.runDue', { today: '2026-06-01' })).created).toEqual([])
  })

  it('contrat créé depuis une facture : brouillons à vérifier', async () => {
    const fac = await ok(admin, 'documents.save', { type: 'FAC', party_id: client, date: '2026-04-10', reference: 'Hébergement serveur', lines: [{ product_id: null, description: 'Hébergement', quantity: 1, unit_price: 50000, discount: 0, tva_rate: 18 }] })
    const { id } = await ok(admin, 'recurring.fromDocument', { id: fac.id, frequency: 'trimestriel' })
    const rec = (await ok<any[]>(admin, 'recurring.list')).find((x) => x.id === id)
    expect(rec).toMatchObject({ label: 'Hébergement serveur', frequency: 'trimestriel', next_date: '2026-07-10', auto_validate: false })
    const r = await ok(admin, 'recurring.runDue', { today: '2026-07-10' })
    expect(r.created).toHaveLength(1)
    expect((await ok(admin, 'documents.get', { id: r.created[0].documentId })).status).toBe('brouillon')
    expect(await checkIntegrity(db)).toEqual([])
  })
})
