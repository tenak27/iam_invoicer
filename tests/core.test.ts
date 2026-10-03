import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../src/main/db'
import { call } from '../src/main/router'
import type { Ctx, SessionUser } from '../src/main/services/context'

let db: Db
let admin: Ctx
let commercial: Ctx

async function ok<T = any>(ctx: Ctx, name: string, args?: unknown): Promise<T> {
  const r = await call(ctx, name, args)
  if (!r.ok) throw new Error(r.error)
  return r.data as T
}
async function err(ctx: Ctx, name: string, args?: unknown): Promise<string> {
  const r = await call(ctx, name, args)
  if (r.ok) throw new Error(`${name} aurait dû échouer`)
  return r.error
}

beforeAll(async () => {
  db = await openDb({ mode: 'local' })
  const anon: Ctx = { db, user: null }
  expect(await ok(anon, 'auth.needsSetup')).toBe(true)
  const user = await ok<SessionUser>(anon, 'auth.setup', {
    company: { name: 'IAM Technology', city: 'Bamako' },
    username: 'Admin',
    full_name: 'Administrateur',
    password: 'secret123'
  })
  admin = { db, user }
  await ok(admin, 'users.save', { username: 'awa', full_name: 'Awa', role: 'commercial', password: 'motdepasse' })
  const { login } = await import('../src/main/services/auth')
  commercial = { db, user: await login(db, 'awa', 'motdepasse') }
})

afterAll(async () => {
  await db?.close()
})

describe('ERP — cycle complet', () => {
  let clientId: number
  let supplierId: number
  let routerId: number
  let installId: number

  it('crée tiers et articles avec codes automatiques', async () => {
    clientId = (await ok(admin, 'parties.save', { kind: 'client', name: 'Banque Atlantique', payment_terms: 30 })).id
    supplierId = (await ok(admin, 'parties.save', { kind: 'supplier', name: 'TechDistrib' })).id
    routerId = (await ok(admin, 'products.save', { kind: 'produit', name: 'Routeur Cisco', sale_price: 150000, purchase_price: 100000, tva_rate: 18, min_stock: 2 })).id
    installId = (await ok(admin, 'products.save', { kind: 'prestation', name: 'Installation réseau', sale_price: 50000, tva_rate: 18 })).id
    const clients = await ok<any[]>(admin, 'parties.list', { kind: 'client' })
    expect(clients[0].code).toBe('CLI-0001')
    const prods = await ok<any[]>(admin, 'products.list', {})
    expect(prods.map((p) => p.ref).sort()).toEqual(['ART-0001', 'PRE-0001'])
  })

  it('achat : commande → réception met à jour le stock et le CMUP', async () => {
    const bc = await ok(admin, 'documents.save', {
      type: 'BC', party_id: supplierId,
      lines: [{ product_id: routerId, description: 'Routeur Cisco', quantity: 10, unit_price: 90000, tva_rate: 18 }]
    })
    await ok(admin, 'documents.validate', { id: bc.id })
    const br = await ok(admin, 'documents.convert', { id: bc.id, to: 'BR' })
    const brDoc = await ok(admin, 'documents.validate', { id: br.id })
    expect(brDoc.number).toMatch(/^BR-\d{4}-0001$/)
    const [p] = await ok<any[]>(admin, 'products.list', { search: 'cisco' })
    expect(p.stock_qty).toBe(10)
    // Pas de stock initial : le coût moyen devient le prix d'achat
    expect(p.avg_cost).toBe(90000)

    // La facture fournisseur issue de la réception ne redouble pas l'entrée en stock
    const ff = await ok(admin, 'documents.convert', { id: br.id, to: 'FF' })
    await ok(admin, 'documents.validate', { id: ff.id })
    const [p2] = await ok<any[]>(admin, 'products.list', { search: 'cisco' })
    expect(p2.stock_qty).toBe(10)
  })

  it('vente : devis → facture, totaux TVA, stock, paiements partiels', async () => {
    const dev = await ok(commercial, 'documents.save', {
      type: 'DEV', party_id: clientId,
      lines: [
        { product_id: routerId, description: 'Routeur Cisco', quantity: 3, unit_price: 150000, discount: 10, tva_rate: 18 },
        { product_id: installId, description: 'Installation réseau', quantity: 1, unit_price: 50000, tva_rate: 18 }
      ]
    })
    await ok(commercial, 'documents.validate', { id: dev.id })
    const fac = await ok(commercial, 'documents.convert', { id: dev.id, to: 'FAC' })
    const doc = await ok(commercial, 'documents.validate', { id: fac.id })
    // 3 × 150 000 − 10 % = 405 000 ; + 50 000 = 455 000 HT ; TVA 18 % = 81 900
    expect(doc.total_ht).toBe(455000)
    expect(doc.total_tva).toBe(81900)
    expect(doc.total_ttc).toBe(536900)
    expect(doc.due_date).toBeTruthy()
    const [p] = await ok<any[]>(admin, 'products.list', { search: 'cisco' })
    expect(p.stock_qty).toBe(7)

    await ok(commercial, 'payments.add', { document_id: fac.id, amount: 300000, method: 'Orange Money' })
    expect(await err(commercial, 'payments.add', { document_id: fac.id, amount: 300000, method: 'Espèces' })).toMatch(/dépasse/)
    await ok(commercial, 'payments.add', { document_id: fac.id, amount: 236900, method: 'Espèces' })
    const paid = await ok(commercial, 'documents.get', { id: fac.id })
    expect(paid.paid).toBe(536900)

    const [client] = await ok<any[]>(admin, 'parties.list', { kind: 'client' })
    expect(client.balance).toBe(0)
  })

  it('refuse de vendre au-delà du stock disponible', async () => {
    const fac = await ok(admin, 'documents.save', {
      type: 'FAC', party_id: clientId,
      lines: [{ product_id: routerId, description: 'Routeur Cisco', quantity: 50, unit_price: 150000, tva_rate: 18 }]
    })
    expect(await err(admin, 'documents.validate', { id: fac.id })).toMatch(/Stock insuffisant/)
    // La transaction est annulée : toujours brouillon, sans numéro
    const d = await ok(admin, 'documents.get', { id: fac.id })
    expect(d.status).toBe('brouillon')
    expect(d.number).toBeNull()
    await ok(admin, 'documents.delete', { id: fac.id })
  })

  it('avoir : retour en stock et solde client négatif', async () => {
    const [fac] = await ok<any[]>(admin, 'documents.list', { types: ['FAC'], status: 'valide' })
    expect(await err(admin, 'documents.cancel', { id: fac.id })).toMatch(/avoir/)
    const av = await ok(admin, 'documents.convert', { id: fac.id, to: 'AV' })
    await ok(admin, 'documents.save', {
      id: av.id, party_id: clientId,
      lines: [{ product_id: routerId, description: 'Routeur Cisco', quantity: 1, unit_price: 135000, tva_rate: 18 }]
    })
    const avDoc = await ok(admin, 'documents.validate', { id: av.id })
    expect(avDoc.number).toMatch(/^AV-/)
    const [p] = await ok<any[]>(admin, 'products.list', { search: 'cisco' })
    expect(p.stock_qty).toBe(8)
    const [client] = await ok<any[]>(admin, 'parties.list', { kind: 'client' })
    expect(client.balance).toBe(-159300) // 135 000 + 18 %
  })

  it('bon de livraison puis facture : un seul mouvement de stock, annulation du BL bloquée', async () => {
    const bl = await ok(admin, 'documents.save', {
      type: 'BL', party_id: clientId,
      lines: [{ product_id: routerId, description: 'Routeur Cisco', quantity: 2, unit_price: 150000, tva_rate: 18 }]
    })
    await ok(admin, 'documents.validate', { id: bl.id })
    const fac = await ok(admin, 'documents.convert', { id: bl.id, to: 'FAC' })
    await ok(admin, 'documents.validate', { id: fac.id })
    const [p] = await ok<any[]>(admin, 'products.list', { search: 'cisco' })
    expect(p.stock_qty).toBe(6)
    expect(await err(admin, 'documents.cancel', { id: bl.id })).toMatch(/transformé/)
  })

  it('inventaire et ajustement', async () => {
    await ok(admin, 'stock.inventory', { counts: [{ productId: routerId, counted: 5 }] })
    const [p] = await ok<any[]>(admin, 'products.list', { search: 'cisco' })
    expect(p.stock_qty).toBe(5)
    expect(await err(admin, 'stock.adjust', { productId: routerId, quantity: -10, note: 'casse' })).toMatch(/insuffisant/)
    const mv = await ok<any[]>(admin, 'stock.movements', { productId: routerId })
    expect(mv[0].kind).toBe('inventaire')
  })

  it('droits : un commercial ne voit ni les achats ni les utilisateurs', async () => {
    expect(await err(commercial, 'documents.list', { types: ['BC'] })).toMatch(/droits/)
    expect(await err(commercial, 'users.list')).toMatch(/droits/)
    expect(await err(commercial, 'parties.list', { kind: 'supplier' })).toMatch(/droits/)
    expect(await err({ db, user: null }, 'reports.dashboard')).toMatch(/Session/)
  })

  it('tableau de bord et rapports', async () => {
    const d = await ok(admin, 'reports.dashboard')
    // 455 000 (devis→facture) + 300 000 (BL→facture) − 135 000 (avoir)
    expect(d.salesYear).toBe(620000)
    expect(d.lowStock).toHaveLength(0)
    const year = new Date().getFullYear()
    const r = await ok(admin, 'reports.sales', { from: `${year}-01-01`, to: `${year}-12-31` })
    expect(r.byClient[0].ht).toBe(620000)
    expect(r.tva[0].deductible).toBe(162000) // 10 × 90 000 × 18 %
  })

  it('numérotation continue par type et par année', async () => {
    const facs = await ok<any[]>(admin, 'documents.list', { types: ['FAC'] })
    const nums = facs.map((f) => f.number).filter(Boolean).sort()
    const year = new Date().getFullYear()
    expect(nums).toEqual([`FAC-${year}-0001`, `FAC-${year}-0002`])
  })
})
