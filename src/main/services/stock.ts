// Mouvements de stock, inventaire et valorisation au coût moyen pondéré (CMUP).
// Le stock est suivi par dépôt (product_stock) ; products.stock_qty reste le total
// tous dépôts, et le coût moyen est commun à tous les dépôts.

import { weightedCost } from '@shared/domain'
import { formatQty, todayISO } from '@shared/format'
import type { Db } from '../db'
import { audit, fail, num, str, type Ctx } from './context'

export interface MovementInput {
  productId: number
  quantity: number // positif = entrée, négatif = sortie
  unitCost: number | null // coût d'achat pour une entrée ; null = coût moyen actuel
  date: string
  kind: 'document' | 'inventaire' | 'ajustement' | 'annulation' | 'transfert'
  /** Dépôt concerné (1 = dépôt principal). */
  warehouseId?: number
  documentId?: number | null
  allowNegative?: boolean
  note?: string
}

export async function applyStockMovement(db: Db, ctx: Ctx, m: MovementInput): Promise<void> {
  const p = await db.one('SELECT id, kind, name, stock_qty, avg_cost FROM products WHERE id = $1 FOR UPDATE', [m.productId])
  if (!p) fail('Article introuvable.')
  if (p.kind !== 'produit' || m.quantity === 0) return // les prestations ne sont pas stockées
  const wh = m.warehouseId ?? 1
  const ws = await db.one<{ qty: number }>('SELECT qty FROM product_stock WHERE product_id = $1 AND warehouse_id = $2 FOR UPDATE', [p.id, wh])
  const whQty = ws?.qty ?? 0
  if (whQty + m.quantity < -1e-9 && !m.allowNegative) {
    const w = await db.one<{ name: string }>('SELECT name FROM warehouses WHERE id = $1', [wh])
    fail(`Stock insuffisant pour « ${p.name} » (${w?.name ?? 'dépôt'}) : disponible ${formatQty(whQty)}, demandé ${formatQty(-m.quantity)}.`)
  }
  await db.query(
    `INSERT INTO product_stock (product_id, warehouse_id, qty) VALUES ($1, $2, $3)
     ON CONFLICT (product_id, warehouse_id) DO UPDATE SET qty = product_stock.qty + EXCLUDED.qty`,
    [p.id, wh, m.quantity]
  )
  const newQty = p.stock_qty + m.quantity
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
    `INSERT INTO stock_movements (product_id, date, quantity, unit_cost, kind, document_id, note, user_id, warehouse_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [p.id, m.date, m.quantity, unitCost, m.kind, m.documentId ?? null, m.note ?? '', ctx.user?.id ?? null, wh]
  )
}

export async function listMovements(ctx: Ctx, args: { productId?: number; from?: string; to?: string; warehouseId?: number } = {}) {
  return ctx.db.query(
    `SELECT m.*, p.ref, p.name AS product_name, p.unit, d.number AS document_number, d.type AS document_type, u.full_name AS user_name,
            w.name AS warehouse_name
     FROM stock_movements m
     JOIN products p ON p.id = m.product_id
     JOIN warehouses w ON w.id = m.warehouse_id
     LEFT JOIN documents d ON d.id = m.document_id
     LEFT JOIN users u ON u.id = m.user_id
     WHERE ($1::int IS NULL OR m.product_id = $1)
       AND ($2 = '' OR m.date >= $2) AND ($3 = '' OR m.date <= $3)
       AND ($4::int IS NULL OR m.warehouse_id = $4)
     ORDER BY m.date DESC, m.id DESC LIMIT 2000`,
    [args.productId ?? null, str(args.from), str(args.to), args.warehouseId ?? null]
  )
}

/** Inventaire : on saisit les quantités comptées, l'écart est enregistré en mouvement. */
export async function recordInventory(ctx: Ctx, args: { date?: string; note?: string; warehouseId?: number; counts: { productId: number; counted: number }[] }) {
  const date = str(args.date) || todayISO()
  const wh = Number(args.warehouseId) || 1
  let adjusted = 0
  await ctx.db.tx(async (db) => {
    for (const c of args.counts ?? []) {
      const counted = num(c.counted)
      if (counted < 0) fail('Une quantité comptée ne peut pas être négative.')
      const p = await db.one('SELECT qty FROM product_stock WHERE product_id = $1 AND warehouse_id = $2', [c.productId, wh])
      const diff = counted - (p?.qty ?? 0)
      if (Math.abs(diff) < 1e-9) continue
      await applyStockMovement(db, ctx, {
        productId: c.productId,
        quantity: diff,
        unitCost: null,
        date,
        kind: 'inventaire',
        warehouseId: wh,
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
export async function adjustStock(ctx: Ctx, args: { productId: number; quantity: number; unitCost?: number; date?: string; note: string; warehouseId?: number; lots?: { lot: string; qty: number; expiry?: string }[] }) {
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
      warehouseId: Number(args.warehouseId) || 1,
      allowNegative: false,
      note: str(args.note)
    })
    if (args.lots?.length) await moveLots(db, args.productId, Number(args.warehouseId) || 1, args.lots, qty > 0 ? 1 : -1)
    await audit(db, ctx, 'ajustement', 'stock', args.productId, `${qty} — ${str(args.note)}`)
  })
  return true
}

// ---------- Dépôts ----------

export async function listWarehouses(ctx: Ctx) {
  return ctx.db.query(
    `SELECT w.*, COALESCE(SUM(ps.qty * p.avg_cost), 0) AS stock_value, COUNT(ps.product_id) FILTER (WHERE ps.qty <> 0)::int AS products
     FROM warehouses w
     LEFT JOIN product_stock ps ON ps.warehouse_id = w.id
     LEFT JOIN products p ON p.id = ps.product_id
     GROUP BY w.id ORDER BY w.id`
  )
}

export async function saveWarehouse(ctx: Ctx, input: { id?: number; code: string; name: string; address?: string; active?: boolean }) {
  const code = str(input.code).toUpperCase().replace(/\s+/g, '-')
  const name = str(input.name)
  if (!code || !name) fail('Code et nom du dépôt obligatoires.')
  if (input.id) {
    if (input.id === 1 && input.active === false) fail('Le dépôt principal ne peut pas être désactivé.')
    await ctx.db.query('UPDATE warehouses SET code = $1, name = $2, address = $3, active = $4 WHERE id = $5', [code, name, str(input.address), input.active ?? true, input.id])
    await audit(ctx.db, ctx, 'modification', 'depot', input.id, name)
    return { id: input.id }
  }
  if (await ctx.db.one('SELECT 1 FROM warehouses WHERE code = $1', [code])) fail('Ce code de dépôt existe déjà.')
  const row = await ctx.db.one<{ id: number }>('INSERT INTO warehouses (code, name, address) VALUES ($1, $2, $3) RETURNING id', [code, name, str(input.address)])
  await audit(ctx.db, ctx, 'creation', 'depot', row!.id, name)
  return row!
}

/** Stock de chaque article par dépôt. */
export async function stockByWarehouse(ctx: Ctx, args: { search?: string } = {}) {
  const search = `%${str(args.search).toLowerCase()}%`
  const [warehouses, rows] = await Promise.all([
    ctx.db.query('SELECT id, code, name FROM warehouses WHERE active ORDER BY id'),
    ctx.db.query(
      `SELECT p.id, p.ref, p.name, p.unit, p.tracking, p.avg_cost, p.stock_qty, p.min_stock,
              COALESCE(json_object_agg(ps.warehouse_id, ps.qty) FILTER (WHERE ps.warehouse_id IS NOT NULL), '{}') AS by_wh
       FROM products p LEFT JOIN product_stock ps ON ps.product_id = p.id
       WHERE p.kind = 'produit' AND p.active AND (lower(p.name) LIKE $1 OR lower(p.ref) LIKE $1)
       GROUP BY p.id ORDER BY p.name`,
      [search]
    )
  ])
  return { warehouses, rows: rows.map((r) => ({ ...r, by_wh: typeof r.by_wh === 'string' ? JSON.parse(r.by_wh) : r.by_wh })) }
}

async function nextTransferNumber(db: Db, date: string) {
  const year = date.slice(0, 4)
  const row = await db.one<{ value: number }>(
    `INSERT INTO sequences (key, value) VALUES ($1, 1) ON CONFLICT (key) DO UPDATE SET value = sequences.value + 1 RETURNING value`,
    [`TRF-${year}`]
  )
  return `TRF-${year}-${String(row!.value).padStart(4, '0')}`
}

/** Transfert entre dépôts : sortie du dépôt d'origine, entrée dans le dépôt de destination. */
export async function transfer(ctx: Ctx, input: { from: number; to: number; date?: string; note?: string; lines: { productId: number; quantity: number; lot?: string }[] }) {
  const from = Number(input.from)
  const to = Number(input.to)
  if (!from || !to || from === to) fail('Choisissez deux dépôts différents.')
  const lines = (input.lines ?? []).map((l) => ({ productId: Number(l.productId), quantity: num(l.quantity), lot: str(l.lot) })).filter((l) => l.productId && l.quantity > 0)
  if (lines.length === 0) fail('Ajoutez au moins un article à transférer.')
  const date = str(input.date) || todayISO()
  return ctx.db.tx(async (db) => {
    const number = await nextTransferNumber(db, date)
    const row = await db.one<{ id: number }>(
      'INSERT INTO stock_transfers (number, date, from_warehouse, to_warehouse, note, user_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [number, date, from, to, str(input.note), ctx.user?.id ?? null]
    )
    for (const l of lines) {
      await db.query('INSERT INTO stock_transfer_lines (transfer_id, product_id, quantity, lot) VALUES ($1,$2,$3,$4)', [row!.id, l.productId, l.quantity, l.lot])
      const note = `Transfert ${number}`
      await applyStockMovement(db, ctx, { productId: l.productId, quantity: -l.quantity, unitCost: null, date, kind: 'transfert', warehouseId: from, note })
      await applyStockMovement(db, ctx, { productId: l.productId, quantity: l.quantity, unitCost: null, date, kind: 'transfert', warehouseId: to, note })
      if (l.lot) {
        await moveLots(db, l.productId, from, [{ lot: l.lot, qty: l.quantity }], -1)
        await moveLots(db, l.productId, to, [{ lot: l.lot, qty: l.quantity }], 1)
      }
    }
    await audit(db, ctx, 'transfert', 'stock', row!.id, number)
    return { id: row!.id, number }
  })
}

export async function listTransfers(ctx: Ctx) {
  return ctx.db.query(
    `SELECT t.*, wf.name AS from_name, wt.name AS to_name, u.full_name AS user_name,
            (SELECT json_agg(json_build_object('product', p.name, 'ref', p.ref, 'quantity', l.quantity, 'lot', l.lot))
             FROM stock_transfer_lines l JOIN products p ON p.id = l.product_id WHERE l.transfer_id = t.id) AS lines
     FROM stock_transfers t JOIN warehouses wf ON wf.id = t.from_warehouse JOIN warehouses wt ON wt.id = t.to_warehouse
     LEFT JOIN users u ON u.id = t.user_id ORDER BY t.id DESC LIMIT 300`
  )
}

// ---------- Lots et numéros de série ----------

/** Références saisies sur une ligne : « LOT-A, LOT-B » ou une liste de numéros de série. */
export function parseRefs(refs: string): string[] {
  return String(refs ?? '').split(/[,;\n]+/).map((r) => r.trim()).filter(Boolean)
}

/**
 * Entrée (sign = 1) ou sortie (sign = -1) de lots/séries dans un dépôt.
 * Pour un article suivi par numéro de série, chaque numéro vaut exactement 1.
 */
export async function moveLots(db: Db, productId: number, warehouseId: number, lots: { lot: string; qty: number; expiry?: string }[], sign: 1 | -1) {
  const p = await db.one<{ tracking: string; name: string }>('SELECT tracking, name FROM products WHERE id = $1', [productId])
  if (!p || p.tracking === 'aucun') return
  for (const l of lots) {
    const lot = str(l.lot)
    if (!lot) continue
    const qty = p.tracking === 'serie' ? 1 : num(l.qty)
    if (qty <= 0) fail(`Quantité invalide pour le lot ${lot}.`)
    if (sign > 0) {
      if (p.tracking === 'serie' && (await db.one("SELECT 1 FROM stock_lots WHERE product_id = $1 AND lot = $2 AND qty > 0", [productId, lot])))
        fail(`Le numéro de série ${lot} est déjà en stock pour « ${p.name} ».`)
      await db.query(
        `INSERT INTO stock_lots (product_id, warehouse_id, lot, expiry, qty) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (product_id, warehouse_id, lot) DO UPDATE SET qty = stock_lots.qty + EXCLUDED.qty, expiry = COALESCE(EXCLUDED.expiry, stock_lots.expiry)`,
        [productId, warehouseId, lot, str(l.expiry) || null, qty]
      )
    } else {
      const row = await db.one<{ qty: number }>('SELECT qty FROM stock_lots WHERE product_id = $1 AND warehouse_id = $2 AND lot = $3 FOR UPDATE', [productId, warehouseId, lot])
      if (!row || row.qty < qty - 1e-9) fail(`${p.tracking === 'serie' ? 'Numéro de série' : 'Lot'} ${lot} introuvable ou insuffisant pour « ${p.name} » dans ce dépôt.`)
      await db.query('UPDATE stock_lots SET qty = qty - $1 WHERE product_id = $2 AND warehouse_id = $3 AND lot = $4', [qty, productId, warehouseId, lot])
    }
  }
}

/** Lots d'une ligne de document : séries une par une, lots avec la quantité de la ligne. */
export function lineLots(tracking: string, refs: string, quantity: number) {
  const list = parseRefs(refs)
  if (tracking === 'serie') {
    if (list.length && list.length !== quantity) fail(`${quantity} numéro(s) de série attendu(s), ${list.length} saisi(s).`)
    return list.map((lot) => ({ lot, qty: 1 }))
  }
  if (tracking === 'lot') {
    if (list.length > 1) fail('Une ligne ne peut porter qu\'un seul lot : créez une ligne par lot.')
    return list.map((lot) => ({ lot, qty: quantity }))
  }
  return []
}

export async function listLots(ctx: Ctx, args: { productId?: number; warehouseId?: number; search?: string; withEmpty?: boolean } = {}) {
  const search = `%${str(args.search).toLowerCase()}%`
  return ctx.db.query(
    `SELECT l.*, p.ref, p.name AS product_name, p.tracking, w.name AS warehouse_name
     FROM stock_lots l JOIN products p ON p.id = l.product_id JOIN warehouses w ON w.id = l.warehouse_id
     WHERE ($1::int IS NULL OR l.product_id = $1) AND ($2::int IS NULL OR l.warehouse_id = $2)
       AND (lower(l.lot) LIKE $3 OR lower(p.name) LIKE $3) AND ($4 OR l.qty > 0)
     ORDER BY l.expiry NULLS LAST, l.lot LIMIT 2000`,
    [args.productId ?? null, args.warehouseId ?? null, search, !!args.withEmpty]
  )
}

/** Traçabilité d'un numéro de série ou d'un lot : où il est entré, où il est sorti. */
export async function traceLot(ctx: Ctx, args: { lot: string }) {
  const lot = str(args.lot)
  if (!lot) fail('Saisissez un numéro de lot ou de série.')
  const [stock, docs] = await Promise.all([
    ctx.db.query(
      `SELECT l.*, p.name AS product_name, w.name AS warehouse_name FROM stock_lots l
       JOIN products p ON p.id = l.product_id JOIN warehouses w ON w.id = l.warehouse_id WHERE l.lot = $1`,
      [lot]
    ),
    ctx.db.query(
      `SELECT d.id, d.type, d.number, d.date, d.status, pa.name AS party_name, dl.description
       FROM document_lines dl JOIN documents d ON d.id = dl.document_id JOIN parties pa ON pa.id = d.party_id
       WHERE dl.lot_refs <> '' AND $1 = ANY(string_to_array(regexp_replace(dl.lot_refs, '\\s*[,;\\n]\\s*', ',', 'g'), ','))
       ORDER BY d.date`,
      [lot]
    )
  ])
  return { stock, documents: docs }
}
