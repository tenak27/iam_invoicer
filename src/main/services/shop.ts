// Site de la société : chaque article peut être mis en avant dans la section « Nos produits » (showcase)
// et vendu dans la boutique en ligne (shop). Ces articles sont visibles sans compte, avec leur prix TTC
// et les moyens de paiement proposés. Une commande passée dans la boutique crée un prospect
// (source « Boutique en ligne ») et un devis en brouillon : rien n'est validé, ni stock ni comptabilité.
// Tout ce qui sort d'ici est public : ni prix d'achat, ni quantités en stock, ni fiche client existante.

import type { Db } from '../db'
import { fail, num, str } from './context'
import { saveDocument } from './documents'
import { sendEmail } from './messaging'
import { saveParty } from './parties'
import { getSettings } from './settings'

const IMAGE = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/
/** Image d'un article : 400 Ko au plus une fois encodée (l'application la réduit avant l'envoi). */
export const SHOP_IMAGE_MAX = 400_000
export const SHOP_SOURCE = 'Boutique en ligne'
const DEFAULT_PAYMENTS = ['Orange Money', 'Moov Money', 'Virement bancaire', 'Espèces à la livraison']

export function checkShopImage(raw: unknown): string {
  const image = str(raw)
  if (!image) return ''
  if (image.length > SHOP_IMAGE_MAX || !IMAGE.test(image)) fail('Image invalide : choisissez une photo PNG, JPG ou WebP.')
  return image
}

/** Moyens de paiement proposés : un par ligne dans les paramètres (« Orange Money : 07 00 00 00 »). */
export function shopPayments(raw: string): string[] {
  const list = str(raw).split(/\r?\n/).map((l) => l.trim().slice(0, 160)).filter(Boolean).slice(0, 8)
  return list.length ? list : DEFAULT_PAYMENTS
}

const ttc = (price: number, tva: number) => Math.round(price * (1 + tva / 100))

export async function shopCatalogue(db: Db) {
  const c = await getSettings(db)
  const open = !!c.shop_enabled
  // Boutique fermée : seuls les articles mis en avant restent visibles
  const rows = await db.query<any>(
    `SELECT p.id, p.kind, p.name, p.description, p.category, p.unit, p.sale_price, p.tva_rate, p.stock_qty, p.shop, p.showcase,
            (i.product_id IS NOT NULL) AS has_image
     FROM products p LEFT JOIN shop_images i ON i.product_id = p.id
     WHERE p.active AND (p.showcase OR (p.shop AND $1)) ORDER BY p.category, p.name`,
    [open]
  )
  return {
    open,
    company: { name: c.name, phone: c.phone, email: c.email, city: c.city, currency: c.currency },
    intro: c.shop_intro,
    payments: shopPayments(c.shop_payments),
    items: rows.map((p) => ({
      id: p.id as number,
      kind: p.kind as string,
      name: p.name as string,
      description: p.description as string,
      category: p.category as string,
      unit: p.unit as string,
      price: ttc(p.sale_price, p.tva_rate),
      taxed: p.tva_rate > 0,
      // Disponibilité sans dévoiler les quantités
      available: p.kind === 'prestation' || p.stock_qty > 0,
      image: !!p.has_image,
      /** Commandable dans la boutique. */
      shop: open && !!p.shop,
      /** Mis en avant dans « Nos produits ». */
      showcase: !!p.showcase
    }))
  }
}

/** Image d'un article publié, prête à être servie (type et contenu). */
export async function shopImage(db: Db, id: number): Promise<{ type: string; body: Buffer } | null> {
  const row = await db.one<{ image: string }>(
    'SELECT i.image FROM shop_images i JOIN products p ON p.id = i.product_id WHERE i.product_id = $1 AND (p.shop OR p.showcase) AND p.active',
    [id]
  )
  const m = row && IMAGE.exec(row.image)
  if (!m) return null
  return { type: `image/${m[1] === 'jpg' ? 'jpeg' : m[1]}`, body: Buffer.from(m[2], 'base64') }
}

/** Image d'un article pour le formulaire de l'application. */
export async function productImage(db: Db, id: number): Promise<string> {
  return (await db.one<{ image: string }>('SELECT image FROM shop_images WHERE product_id = $1', [id]))?.image ?? ''
}

export async function saveProductImage(db: Db, id: number, image: string) {
  if (!image) return db.query('DELETE FROM shop_images WHERE product_id = $1', [id])
  return db.query('INSERT INTO shop_images (product_id, image) VALUES ($1, $2) ON CONFLICT (product_id) DO UPDATE SET image = EXCLUDED.image', [id, image])
}

export interface ShopOrderInput {
  name?: unknown
  phone?: unknown
  email?: unknown
  city?: unknown
  note?: unknown
  payment?: unknown
  items?: unknown
}

/** Commande passée sur le site : prospect + devis en brouillon. Renvoie de quoi confirmer au visiteur. */
export async function shopOrder(db: Db, input: ShopOrderInput) {
  const c = await getSettings(db)
  if (!c.shop_enabled) fail('La boutique en ligne est fermée.')
  const name = str(input.name).slice(0, 120)
  if (name.length < 2) fail('Indiquez votre nom.')
  const phone = str(input.phone).slice(0, 30)
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 8 || digits.length > 15 || !/^[+\d][\d\s().-]*$/.test(phone)) fail('Indiquez un numéro de téléphone valide.')
  const email = str(input.email).slice(0, 160)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) fail('Adresse e-mail invalide.')
  const city = str(input.city).slice(0, 80)
  const note = str(input.note).slice(0, 600)
  const payments = shopPayments(c.shop_payments)
  const payment = str(input.payment)
  if (payment && !payments.includes(payment)) fail('Moyen de paiement inconnu.')

  const asked = Array.isArray(input.items) ? input.items.slice(0, 20) : []
  const wanted = new Map<number, number>()
  for (const it of asked) {
    const id = Number((it as any)?.id)
    const qty = Math.floor(num((it as any)?.qty))
    if (!Number.isInteger(id) || id <= 0 || qty < 1 || qty > 999) fail('Panier invalide.')
    wanted.set(id, Math.min(999, (wanted.get(id) ?? 0) + qty))
  }
  if (!wanted.size) fail('Votre panier est vide.')
  const products = await db.query<any>('SELECT id, name, sale_price, tva_rate FROM products WHERE shop AND active AND id = ANY($1::int[])', [[...wanted.keys()]])
  if (products.length !== wanted.size) fail("Un article du panier n'est plus proposé. Actualisez la page.")

  // Garde-fou : la boutique ne peut pas remplir la base (300 commandes par jour au plus)
  const today = await db.one<{ n: number }>("SELECT count(*)::int AS n FROM documents WHERE reference = $1 AND created_at > now() - interval '1 day'", [SHOP_SOURCE])
  if ((today?.n ?? 0) >= 300) fail('Trop de commandes aujourd’hui. Appelez-nous pour commander.')

  const ctx = { db, user: null }
  // Jamais rattachée à une fiche client existante : seulement à un prospect déjà venu de la boutique avec ce numéro
  const known = await db.one<{ id: number }>(
    "SELECT id FROM parties WHERE kind = 'client' AND is_prospect AND source = $1 AND regexp_replace(phone, '\\D', '', 'g') = $2 ORDER BY id LIMIT 1",
    [SHOP_SOURCE, digits]
  )
  const party = known ?? (await saveParty(ctx, { kind: 'client', name, phone, email, city, is_prospect: true, source: SHOP_SOURCE, payment_terms: 0 }))
  const lines = products.map((p) => ({ product_id: p.id, description: p.name, quantity: wanted.get(p.id)!, unit_price: p.sale_price, tva_rate: p.tva_rate }))
  const notes = [`Commande passée sur la boutique en ligne par ${name} (${phone}${email ? `, ${email}` : ''}${city ? `, ${city}` : ''}).`, payment && `Paiement souhaité : ${payment}`, note && `Message : ${note}`].filter(Boolean).join('\n')
  const { id } = await saveDocument(ctx, { type: 'DEV', party_id: party.id, reference: SHOP_SOURCE, notes, lines })
  const doc = await db.one<{ total_ttc: number }>('SELECT total_ttc FROM documents WHERE id = $1', [id])
  const total = Math.round(doc?.total_ttc ?? 0)

  // Prévenir la société par e-mail quand la messagerie est réglée ; la commande reste enregistrée sinon
  if (c.email && c.smtp_host) {
    const body = [`Nouvelle commande sur la boutique en ligne : ${total} ${c.currency}.`, '', ...lines.map((l) => `- ${l.quantity} x ${l.description}`), '', notes, '', 'Le devis en brouillon est dans IAM INVOICER, Ventes, Devis.'].join('\n')
    void sendEmail(ctx, { to: c.email, subject: 'Nouvelle commande de la boutique en ligne', body, documentId: id, kind: 'boutique' }).catch(() => {})
  }
  return { order: `B-${String(id).padStart(5, '0')}`, total, currency: c.currency, payment, phone: c.phone }
}
