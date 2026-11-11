// Saisies refusées avant d'atteindre la base : dates qui n'existent pas, montants démesurés, requêtes sans objet.
// Les dates sont du texte en base : une date fausse y resterait et fausserait échéances, journaux et rapports.
import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../src/main/db'
import { call } from '../src/main/router'
import type { Ctx, SessionUser } from '../src/main/services/context'
import { createHandler } from '../src/server/app'

let db: Db
let admin: Ctx
let server: Server
let base: string
let client: { id: number }
const ok = async <T = any>(ctx: Ctx, name: string, args?: unknown): Promise<T> => {
  const r = await call(ctx, name, args)
  if (!r.ok) throw new Error(r.error)
  return r.data as T
}
const line = { description: 'Installation', quantity: 1, unit_price: 10000, tva_rate: 18 }

beforeAll(async () => {
  db = await openDb({ mode: 'local' })
  const user = await ok<SessionUser>({ db, user: null }, 'auth.setup', { company: { name: 'IAM Technology' }, username: 'admin', full_name: 'Admin', password: 'secret123' })
  admin = { db, user }
  client = await ok(admin, 'parties.save', { kind: 'client', name: 'Client' })
  server = createServer(createHandler({ db, version: 'test' }))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterAll(async () => {
  await new Promise((r) => server.close(r))
  await db.close()
})

describe('Saisies invalides', () => {
  it('un document refuse une date ou une échéance qui n’existe pas', async () => {
    for (const date of ['2026-13-45', '2026-02-31', '11/11/2026', 'demain']) {
      await expect(ok(admin, 'documents.save', { type: 'FAC', party_id: client.id, date, lines: [line] })).rejects.toThrow(/Date invalide/)
    }
    await expect(ok(admin, 'documents.save', { type: 'FAC', party_id: client.id, due_date: '2026-02-30', lines: [line] })).rejects.toThrow(/Date invalide/)
    expect((await db.one<{ n: number }>('SELECT count(*)::int AS n FROM documents'))!.n).toBe(0)
    // Une vraie date passe, et l'échéance en découle
    const { id } = await ok(admin, 'documents.save', { type: 'FAC', party_id: client.id, date: '2028-02-29', lines: [line] })
    expect(await db.one('SELECT date, due_date FROM documents WHERE id = $1', [id])).toMatchObject({ date: '2028-02-29' })
  })

  it('une ligne au montant démesuré est refusée avec un message clair', async () => {
    await expect(ok(admin, 'documents.save', { type: 'DEV', party_id: client.id, lines: [{ ...line, quantity: 70112233, unit_price: 25000000 }] })).rejects.toThrow(/Montant trop élevé pour « Installation »/)
    await expect(ok(admin, 'documents.save', { type: 'DEV', party_id: client.id, lines: [{ ...line, quantity: 1e308, unit_price: 1e308 }] })).rejects.toThrow(/Montant trop élevé/)
  })

  it('un règlement et un mouvement de stock refusent une date fausse', async () => {
    const f = await ok(admin, 'documents.save', { type: 'FAC', party_id: client.id, validate: true, lines: [line] })
    expect(f.validated).toBe(true)
    await expect(ok(admin, 'payments.add', { document_id: f.id, amount: 5000, method: 'Espèces', date: 'demain' })).rejects.toThrow(/Date invalide/)
    await expect(ok(admin, 'payments.add', { document_id: f.id, amount: 5000, method: 'Espèces', date: '2026-04-31' })).rejects.toThrow(/Date invalide/)
    expect((await db.one<{ n: number }>('SELECT count(*)::int AS n FROM payments'))!.n).toBe(0)
    await ok(admin, 'payments.add', { document_id: f.id, amount: 5000, method: 'Espèces' })
    const p = await ok(admin, 'products.save', { kind: 'produit', name: 'Routeur', sale_price: 25000, purchase_price: 18000 })
    await expect(ok(admin, 'stock.adjust', { productId: p.id, quantity: 5, note: 'Stock initial', date: '31/12/2026' })).rejects.toThrow(/Date invalide/)
    await expect(ok(admin, 'stock.inventory', { date: '2026-00-10', counts: [{ productId: p.id, counted: 3 }] })).rejects.toThrow(/Date invalide/)
    expect((await db.one<{ n: number }>('SELECT count(*)::int AS n FROM stock_movements'))!.n).toBe(0)
  })

  it('une requête dont le corps n’est pas un objet reçoit une erreur 400, pas une panne', async () => {
    for (const path of ['/api/public/shop/order', '/api/login', '/api/call']) {
      for (const body of ['null', '"texte"', '[1,2]', '42']) {
        const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
        expect([path, body, r.status]).toEqual([path, body, 400])
        expect(await r.json()).toEqual({ ok: false, error: 'JSON invalide.' })
      }
    }
  })
})
