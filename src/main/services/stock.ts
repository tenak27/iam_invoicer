// Mouvements de stock, inventaire et valorisation au coût moyen pondéré (CMUP).

import { weightedCost } from '@shared/domain'
import { formatQty, todayISO } from '@shared/format'
import type { Db } from '../db'
import { audit, fail, num, str, type Ctx } from './context'

export interface MovementInput {
  productId: number
  quantity: number // positif = entrée, négatif = sortie
  unitCost: number | null // coût d'achat pour une entrée ; null = coût moyen actuel
  date: string
  kind: 'document' | 'inventaire' | 'ajustement' | 'annulation'
  documentId?: number | null
  allowNegative?: boolean
  note?: string
}

export async function applyStockMovement(db: Db, ctx: Ctx, m: MovementInput): Promise<void> {
  const p = await db.one('SELECT id, kind, name, stock_qty, avg_cost FROM products WHERE id = $1 FOR UPDATE', [m.productId])
  if (!p) fail('Article introuvable.')
  if (p.kind !== 'produit' || m.quantity === 0) return // les prestations ne sont pas stockées
  const newQty = p.stock_qty + m.quantity
  if (newQty < -1e-9 && !m.allowNegative)
    fail(`Stock insuffisant pour « ${p.name} » : disponible ${formatQty(p.stock_qty)}, demandé ${formatQty(-m.quantity)}.`)
  let cost = p.avg_cost
  let unitCost = p.avg_cost
  if (m.quantity > 0 && m.unitCost != null) {
    cost = weightedCost(p.stock_qty, p.avg_cost, m.quantity, m.unitCost)
    unitCost = m.unitCost
  }
  await db.query(
    `UPDATE products SET stock_qty = $1, avg_cost = $2${m.quantity > 0 && m.unitCost != null && m.kind === 'document' ? ', purchase_price = $4' : ''} WHERE id = $3`,
    m.quantity > 0 && m.unitCost != null && m.kind === 'document' ? [newQty, cost, p.id, m.unitCost] : [newQty, cost, p.id]
  )
  await db.query(
    `INSERT INTO stock_movements (product_id, date, quantity, unit_cost, kind, document_id, note, user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [p.id, m.date, m.quantity, unitCost, m.kind, m.documentId ?? null, m.note ?? '', ctx.user?.id ?? null]
  )
}

export async function listMovements(ctx: Ctx, args: { productId?: number; from?: string; to?: string } = {}) {
  return ctx.db.query(
    `SELECT m.*, p.ref, p.name AS product_name, p.unit, d.number AS document_number, d.type AS document_type, u.full_name AS user_name
     FROM stock_movements m
     JOIN products p ON p.id = m.product_id
     LEFT JOIN documents d ON d.id = m.document_id
     LEFT JOIN users u ON u.id = m.user_id
     WHERE ($1::int IS NULL OR m.product_id = $1)
       AND ($2 = '' OR m.date >= $2) AND ($3 = '' OR m.date <= $3)
     ORDER BY m.date DESC, m.id DESC LIMIT 2000`,
    [args.productId ?? null, str(args.from), str(args.to)]
  )
}

/** Inventaire : on saisit les quantités comptées, l'écart est enregistré en mouvement. */
export async function recordInventory(ctx: Ctx, args: { date?: string; note?: string; counts: { productId: number; counted: number }[] }) {
  const date = str(args.date) || todayISO()
  let adjusted = 0
  await ctx.db.tx(async (db) => {
    for (const c of args.counts ?? []) {
      const counted = num(c.counted)
      if (counted < 0) fail('Une quantité comptée ne peut pas être négative.')
      const p = await db.one('SELECT stock_qty FROM products WHERE id = $1', [c.productId])
      if (!p) continue
      const diff = counted - p.stock_qty
      if (Math.abs(diff) < 1e-9) continue
      await applyStockMovement(db, ctx, {
        productId: c.productId,
        quantity: diff,
        unitCost: null,
        date,
        kind: 'inventaire',
        allowNegative: true,
        note: str(args.note) || 'Inventaire'
      })
      adjusted++
    }
    await audit(db, ctx, 'inventaire', 'stock', null, `${adjusted} article(s) ajusté(s)`)
  })
  return { adjusted }
}

/** Entrée ou sortie manuelle (casse, perte, échantillon, stock initial...). */
export async function adjustStock(ctx: Ctx, args: { productId: number; quantity: number; unitCost?: number; date?: string; note: string }) {
  const qty = num(args.quantity)
  if (qty === 0) fail('Quantité nulle.')
  if (!str(args.note)) fail('Indiquez le motif du mouvement.')
  await ctx.db.tx(async (db) => {
    await applyStockMovement(db, ctx, {
      productId: args.productId,
      quantity: qty,
      unitCost: qty > 0 && args.unitCost != null && str(args.unitCost) !== '' ? num(args.unitCost) : null,
      date: str(args.date) || todayISO(),
      kind: 'ajustement',
      allowNegative: false,
      note: str(args.note)
    })
    await audit(db, ctx, 'ajustement', 'stock', args.productId, `${qty} — ${str(args.note)}`)
  })
  return true
}
