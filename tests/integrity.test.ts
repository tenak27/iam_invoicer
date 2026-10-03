import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../src/main/db'
import { call } from '../src/main/router'
import type { Ctx, SessionUser } from '../src/main/services/context'
import { checkIntegrity } from './integrity'

// Audit : un parcours complet (ventes avec taxes, avoir, achats, caisse, transferts,
// annulations) ne doit laisser aucune incohérence entre pièces, stock et comptabilité.

let db: Db
let admin: Ctx
const ok = async <T = any>(ctx: Ctx, name: string, args?: unknown): Promise<T> => {
  const r = await call(ctx, name, args)
  if (!r.ok) throw new Error(`${name} : ${r.error}`)
  return r.data as T
}

describe('Audit de cohérence des données', () => {
  beforeAll(async () => {
    db = await openDb({ mode: 'local' })
    const user = await ok<SessionUser>({ db, user: null }, 'auth.setup', { company: { name: 'Audit SARL' }, username: 'admin', full_name: 'Admin', password: 'secret123' })
    admin = { db, user }
  })
  afterAll(() => db?.close())

  it('parcours complet sans incohérence', async () => {
    const client = (await ok(admin, 'parties.save', { kind: 'client', name: 'Client A' })).id
    const supplier = (await ok(admin, 'parties.save', { kind: 'supplier', name: 'Fournisseur B' })).id
    const prod = (await ok(admin, 'products.save', { kind: 'produit', name: 'Routeur', sale_price: 50000, purchase_price: 30000, tva_rate: 18 })).id
    const serv = (await ok(admin, 'products.save', { kind: 'prestation', name: 'Pose', sale_price: 20000, tva_rate: 18 })).id
    const wh2 = (await ok(admin, 'stock.saveWarehouse', { code: 'BOBO', name: 'Bobo' })).id
    await ok(admin, 'taxes.importPresets')
    const taxes = await ok<any[]>(admin, 'taxes.list')
    await ok(admin, 'taxes.save', { ...taxes.find((t) => t.code === 'TIMBRE'), amount: 200, active: true })
    await ok(admin, 'taxes.save', { ...taxes.find((t) => t.code === 'RAS-PS'), active: true })
    const L = (product_id: number, quantity: number, unit_price: number) => ({ product_id, description: 'x', quantity, unit_price, discount: 0, tva_rate: 18 })

    // Achat : commande → réception → facture fournisseur réglée en partie
    const bc = await ok(admin, 'documents.save', { type: 'BC', party_id: supplier, lines: [L(prod, 20, 30000)] })
    await ok(admin, 'documents.validate', { id: bc.id })
    const br = await ok(admin, 'documents.convert', { id: bc.id, to: 'BR' })
    await ok(admin, 'documents.validate', { id: br.id })
    const ff = await ok(admin, 'documents.convert', { id: br.id, to: 'FF' })
    await ok(admin, 'documents.validate', { id: ff.id })
    await ok(admin, 'payments.add', { document_id: ff.id, amount: 300000, method: 'Virement' })

    // Vente avec timbre et retenue, réglée pour le reste
    const fac = await ok(admin, 'documents.save', { type: 'FAC', party_id: client, lines: [L(prod, 3, 50000), L(serv, 2, 20000)], taxes: ['TIMBRE', 'RAS-PS'] })
    const v = await ok(admin, 'documents.validate', { id: fac.id })
    await ok(admin, 'payments.add', { document_id: fac.id, amount: v.total_ttc - v.paid, method: 'Orange Money' })

    // Avoir partiel avec retour en stock
    const av = await ok(admin, 'documents.convert', { id: fac.id, to: 'AV' })
    await ok(admin, 'documents.save', { id: av.id, type: 'AV', party_id: client, lines: [L(prod, 1, 50000)] })
    await ok(admin, 'documents.validate', { id: av.id, applyStock: true })

    // Bon de livraison validé puis annulé
    const bl = await ok(admin, 'documents.save', { type: 'BL', party_id: client, lines: [L(prod, 2, 50000)] })
    await ok(admin, 'documents.validate', { id: bl.id })
    await ok(admin, 'documents.cancel', { id: bl.id })

    // Facture fournisseur avec retenue, annulée
    const ff2 = await ok(admin, 'documents.save', { type: 'FF', party_id: supplier, lines: [L(serv, 1, 100000)], taxes: ['RAS-PS'] })
    await ok(admin, 'documents.validate', { id: ff2.id })
    await ok(admin, 'documents.cancel', { id: ff2.id })

    // Transfert entre dépôts, caisse : ouverture, vente, sortie, clôture
    await ok(admin, 'stock.transfer', { from: 1, to: wh2, lines: [{ productId: prod, quantity: 4 }] })
    await ok(admin, 'cash.open', { opening_amount: 10000 })
    const s = await ok(admin, 'cash.sale', { lines: [L(prod, 1, 50000)], payments: [{ method: 'Espèces', amount: 59000 }] })
    expect(s).toBeTruthy()
    await ok(admin, 'cash.movement', { kind: 'sortie', amount: 2000, account: '618', label: 'Taxi' })
    const st = await ok(admin, 'cash.current')
    expect(st.expected).toBe(10000 + 59000 - 2000)
    await ok(admin, 'cash.close', { counted_amount: st.expected, note: 'Clôture' })

    const findings = await checkIntegrity(db)
    expect(findings).toEqual([])
    // Stock final : 20 reçus − 3 vendus + 1 repris − 1 en caisse = 17
    expect((await db.one('SELECT stock_qty FROM products WHERE id = $1', [prod])).stock_qty).toBe(17)
  })
})

// Audit d'une base existante (copie) : IAM_AUDIT_DATA=chemin npx vitest run tests/integrity.test.ts
describe.runIf(!!process.env.IAM_AUDIT_DATA)('Audit d’une base existante', () => {
  it('aucune incohérence', async () => {
    const real = await openDb({ mode: 'local', dataDir: process.env.IAM_AUDIT_DATA })
    try {
      const findings = await checkIntegrity(real)
      for (const f of findings) console.log(`[${f.check}] ${f.detail}`)
      expect(findings).toEqual([])
    } finally {
      await real.close()
    }
  })
})
