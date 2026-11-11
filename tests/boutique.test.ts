// Site de la société : articles mis en avant (« Nos produits ») et vendus (boutique), choisis dans le catalogue.
// Le catalogue public ne dévoile ni prix d'achat ni stock ; une commande devient un prospect et un devis en brouillon.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../src/main/db'
import { call } from '../src/main/router'
import type { Ctx, SessionUser } from '../src/main/services/context'
import { shopCatalogue, shopImage, shopOrder } from '../src/main/services/shop'

let db: Db
let admin: Ctx
const ok = async <T = any>(ctx: Ctx, name: string, args?: unknown): Promise<T> => {
  const r = await call(ctx, name, args)
  if (!r.ok) throw new Error(r.error)
  return r.data as T
}
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
let licence: { id: number }
let routeur: { id: number }
let prive: { id: number }

beforeAll(async () => {
  db = await openDb({ mode: 'local' })
  const user = await ok<SessionUser>({ db, user: null }, 'auth.setup', { company: { name: 'IAM Technology' }, username: 'admin', full_name: 'Admin', password: 'secret123' })
  admin = { db, user }
  licence = await ok(admin, 'products.save', { kind: 'prestation', name: 'Licence antivirus 1 an', category: 'Licences', unit: 'licence', sale_price: 10000, purchase_price: 6000, tva_rate: 18, shop: true, showcase: true, shop_image: PNG })
  routeur = await ok(admin, 'products.save', { kind: 'produit', name: 'Routeur Wi-Fi', category: 'Réseau', sale_price: 25000, purchase_price: 18000, tva_rate: 18, showcase: true })
  prive = await ok(admin, 'products.save', { kind: 'produit', name: 'Article interne', sale_price: 5000, purchase_price: 4000, tva_rate: 18 })
})
afterAll(async () => {
  await db.close()
})

describe('Produits et boutique du site', () => {
  it('boutique fermée : seuls les articles mis en avant sont publics, et aucun n’est commandable', async () => {
    const c = await shopCatalogue(db)
    expect(c.open).toBe(false)
    expect(c.items.map((i) => i.name).sort()).toEqual(['Licence antivirus 1 an', 'Routeur Wi-Fi'])
    expect(c.items.every((i) => !i.shop)).toBe(true)
    await expect(shopOrder(db, { name: 'Awa Traoré', phone: '70 00 00 00', items: [{ id: licence.id, qty: 1 }] })).rejects.toThrow(/fermée/)
  })

  it('boutique ouverte : prix TTC, moyens de paiement, rien de confidentiel', async () => {
    await ok(admin, 'settings.save', { shop_enabled: true, shop_payments: 'Orange Money : 07 00 00 00\nEspèces à la livraison' })
    const c = await shopCatalogue(db)
    expect(c.open).toBe(true)
    expect(c.payments).toEqual(['Orange Money : 07 00 00 00', 'Espèces à la livraison'])
    const l = c.items.find((i) => i.id === licence.id)!
    expect(l).toMatchObject({ price: 11800, taxed: true, shop: true, showcase: true, image: true, available: true })
    const r = c.items.find((i) => i.id === routeur.id)!
    expect(r).toMatchObject({ shop: false, showcase: true, available: false })
    expect(c.items.some((i) => i.id === prive.id)).toBe(false)
    const text = JSON.stringify(c)
    expect(text).not.toMatch(/purchase_price|avg_cost|stock_qty|6000|18000/)
    expect((await shopImage(db, licence.id))?.type).toBe('image/png')
    expect(await shopImage(db, prive.id)).toBeNull()
    // La liste des articles de l'application reste légère : la photo est lue à part
    const list = await ok<any[]>(admin, 'products.list', {})
    expect(JSON.stringify(list)).not.toContain('base64')
    expect(await ok<string>(admin, 'products.image', { id: licence.id })).toBe(PNG)
  })

  it('une commande crée un prospect et un devis en brouillon, sans toucher aux clients existants', async () => {
    const client = await ok(admin, 'parties.save', { kind: 'client', name: 'Client fidèle', phone: '70 00 00 00' })
    const r = await shopOrder(db, { name: 'Awa Traoré', phone: '70 00 00 00', email: 'awa@exemple.test', payment: 'Espèces à la livraison', note: 'Livrer le matin', items: [{ id: licence.id, qty: 2 }] })
    expect(r.total).toBe(23600)
    expect(r.order).toMatch(/^B-\d{5}$/)
    const doc = await db.one<any>("SELECT d.type, d.status, d.number, d.party_id, d.notes, p.is_prospect, p.source FROM documents d JOIN parties p ON p.id = d.party_id WHERE d.reference = 'Boutique en ligne'")
    expect(doc).toMatchObject({ type: 'DEV', status: 'brouillon', number: null, is_prospect: true, source: 'Boutique en ligne' })
    expect(doc.party_id).not.toBe(client.id)
    expect(doc.notes).toContain('Espèces à la livraison')
    // Deuxième commande du même numéro, écrit autrement : même prospect
    await shopOrder(db, { name: 'Awa T.', phone: '70000000', items: [{ id: licence.id, qty: 1 }] })
    expect((await db.one<{ n: number }>("SELECT count(*)::int AS n FROM parties WHERE source = 'Boutique en ligne'"))!.n).toBe(1)
  })

  it('refuse les paniers trafiqués', async () => {
    const base = { name: 'Issa', phone: '76 11 22 33' }
    await expect(shopOrder(db, { ...base, items: [{ id: prive.id, qty: 1 }] })).rejects.toThrow(/plus proposé/)
    await expect(shopOrder(db, { ...base, items: [{ id: routeur.id, qty: 1 }] })).rejects.toThrow(/plus proposé/)
    await expect(shopOrder(db, { ...base, items: [{ id: licence.id, qty: 0 }] })).rejects.toThrow(/Panier invalide/)
    await expect(shopOrder(db, { ...base, items: [] })).rejects.toThrow(/vide/)
    await expect(shopOrder(db, { ...base, payment: 'Bitcoin', items: [{ id: licence.id, qty: 1 }] })).rejects.toThrow(/paiement/)
    await expect(shopOrder(db, { name: 'Issa', phone: 'abc', items: [{ id: licence.id, qty: 1 }] })).rejects.toThrow(/téléphone/)
    await expect(ok(admin, 'products.save', { id: licence.id, kind: 'prestation', name: 'Licence antivirus 1 an', shop: true, shop_image: 'data:text/html;base64,PHNjcmlwdD4=' })).rejects.toThrow(/Image invalide/)
  })
})
