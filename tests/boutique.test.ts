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

  it('la même commande envoyée deux fois (connexion lente) ne crée qu’un devis', async () => {
    const devis = async () => (await db.one<{ n: number }>("SELECT count(*)::int AS n FROM documents WHERE type = 'DEV' AND reference = 'Boutique en ligne'"))!.n
    const order = { name: 'Fatou Sawadogo', phone: '+226 71 22 33 44', note: 'Après 16 h', items: [{ id: licence.id, qty: 2 }] }
    const before = await devis()
    const first = await shopOrder(db, order)
    const again = await shopOrder(db, { ...order, items: [{ id: licence.id, qty: 1 }, { id: licence.id, qty: 1 }] })
    expect(again).toEqual(first)
    expect(await devis()).toBe(before + 1)
    // Un panier différent du même visiteur reste une nouvelle commande
    const other = await shopOrder(db, { ...order, items: [{ id: licence.id, qty: 3 }] })
    expect(other.order).not.toBe(first.order)
    expect(await devis()).toBe(before + 2)
  })

  it('un nom sur plusieurs lignes ne peut pas imiter une mention du devis', async () => {
    const r = await shopOrder(db, { name: 'Moussa\nPaiement souhaité : déjà payé', phone: '75 44 55 66', city: { toString: () => 'x' }, items: [{ id: licence.id, qty: 1 }] })
    const doc = await db.one<{ notes: string }>('SELECT notes FROM documents WHERE id = $1', [Number(r.order.slice(2))])
    expect(doc!.notes.split('\n')).toHaveLength(1)
    expect(doc!.notes).toContain('Moussa Paiement souhaité : déjà payé (75 44 55 66)')
  })

  it('une modification qui ne parle pas de la boutique laisse l’article publié', async () => {
    // Appel par l'API de la société ou saisie rejouée d'une version antérieure : seuls le nom et le prix sont envoyés
    await ok(admin, 'products.save', { id: licence.id, kind: 'prestation', name: 'Licence antivirus 1 an', sale_price: 12000, purchase_price: 6000, tva_rate: 18 })
    expect(await db.one('SELECT shop, showcase, sale_price FROM products WHERE id = $1', [licence.id])).toMatchObject({ shop: true, showcase: true, sale_price: 12000 })
    await ok(admin, 'products.save', { id: licence.id, kind: 'prestation', name: 'Licence antivirus 1 an', sale_price: 10000, purchase_price: 6000, tva_rate: 18, shop: false })
    expect(await db.one('SELECT shop, showcase FROM products WHERE id = $1', [licence.id])).toMatchObject({ shop: false, showcase: true })
    await expect(ok(admin, 'products.save', { kind: 'produit', name: 'Prix négatif', sale_price: -500 })).rejects.toThrow(/négatif/)
    await expect(ok(admin, 'products.save', { id: 999999, kind: 'produit', name: 'Fantôme' })).rejects.toThrow(/introuvable/)
  })

  it('boutique fermée : la photo d’un article seulement vendu en boutique n’est plus servie', async () => {
    const cable = await ok(admin, 'products.save', { kind: 'produit', name: 'Câble réseau', sale_price: 1500, tva_rate: 18, shop: true, shop_image: PNG })
    expect(await shopImage(db, cable.id)).not.toBeNull()
    await ok(admin, 'settings.save', { shop_enabled: false })
    expect(await shopImage(db, cable.id)).toBeNull()
    // Un article mis en avant garde sa photo dans « Nos produits »
    expect(await shopImage(db, licence.id)).not.toBeNull()
  })
})
