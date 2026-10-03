// Documents commerciaux : devis, livraisons, factures, avoirs (ventes) et
// commandes, réceptions, factures fournisseurs (achats).
//
// Cycle de vie : brouillon (modifiable, sans numéro) → validé (numéroté, figé,
// stock mis à jour) → éventuellement annulé. Les factures et avoirs validés ne
// s'annulent pas : on corrige une facture par un avoir.

import { DOC_TYPES, lineHT, type DocType, type LineInput } from '@shared/domain'
import { computeFullTotals, WITHHOLDING_METHOD, type AppliedTax, type TaxDef } from '@shared/taxes'
import { resolveTaxes } from './taxes'
import { addDays, todayISO } from '@shared/format'
import type { Db } from '../db'
import { audit, fail, num, str, type Ctx } from './context'
import { getSettings } from './settings'
import { applyStockMovement, lineLots, moveLots } from './stock'
import { postDocument, postPayment, removeSourceEntry } from './accounting'
import { certify } from './secef'

function checkType(type: string): asserts type is DocType {
  if (!(type in DOC_TYPES)) fail('Type de document inconnu.')
}

const PAID_SQL = 'COALESCE((SELECT SUM(amount) FROM payments WHERE document_id = d.id), 0)'

export async function listDocuments(
  ctx: Ctx,
  args: { types: DocType[]; search?: string; status?: string; from?: string; to?: string; partyId?: number; unpaidOnly?: boolean }
) {
  const search = `%${str(args.search).toLowerCase()}%`
  return ctx.db.query(
    `SELECT d.id, d.type, d.number, d.status, d.date, d.due_date, d.reference, d.total_ht, d.total_tva, d.total_ttc,
            d.party_id, p.name AS party_name, p.code AS party_code, ${PAID_SQL} AS paid
     FROM documents d JOIN parties p ON p.id = d.party_id
     WHERE d.type = ANY($1)
       AND (lower(COALESCE(d.number, '')) LIKE $2 OR lower(p.name) LIKE $2 OR lower(d.reference) LIKE $2)
       AND ($3 = '' OR d.status = $3)
       AND ($4 = '' OR d.date >= $4)
       AND ($5 = '' OR d.date <= $5)
       AND ($6::int IS NULL OR d.party_id = $6)
       AND (NOT $7 OR (d.status = 'valide' AND d.total_ttc > ${PAID_SQL}))
     ORDER BY d.date DESC, d.id DESC
     LIMIT 1000`,
    [args.types, search, str(args.status), str(args.from), str(args.to), args.partyId ?? null, !!args.unpaidOnly]
  )
}

export async function getDocument(ctx: Ctx, args: { id: number }) {
  return loadDocument(ctx.db, args.id)
}

export async function loadDocument(db: Db, id: number) {
  const doc = await db.one(
    `SELECT d.*, ${PAID_SQL} AS paid, u.full_name AS created_by_name, s.number AS source_number, s.type AS source_type
     FROM documents d
     LEFT JOIN users u ON u.id = d.created_by
     LEFT JOIN documents s ON s.id = d.source_id
     WHERE d.id = $1`,
    [id]
  )
  if (!doc) fail('Document introuvable.')
  const [party, lines, payments, children] = await Promise.all([
    db.one('SELECT * FROM parties WHERE id = $1', [doc.party_id]),
    db.query(
      `SELECT l.*, p.ref AS product_ref, p.unit AS product_unit, p.kind AS product_kind
       FROM document_lines l LEFT JOIN products p ON p.id = l.product_id
       WHERE l.document_id = $1 ORDER BY l.position`,
      [id]
    ),
    db.query('SELECT * FROM payments WHERE document_id = $1 ORDER BY date, id', [id]),
    db.query('SELECT id, type, number, status, date, total_ttc FROM documents WHERE source_id = $1 ORDER BY id', [id])
  ])
  return { ...doc, party, lines, payments, children }
}

function cleanLines(raw: any[]): (LineInput & { lot_refs: string })[] {
  const lines = (raw ?? [])
    .map((l) => ({
      product_id: l.product_id ? Number(l.product_id) : null,
      description: str(l.description),
      quantity: num(l.quantity),
      unit_price: num(l.unit_price),
      discount: Math.min(100, Math.max(0, num(l.discount))),
      tva_rate: Math.max(0, num(l.tva_rate)),
      lot_refs: str(l.lot_refs)
    }))
    .filter((l) => l.description || l.product_id)
  for (const l of lines) {
    if (!l.description) fail('Chaque ligne doit avoir une désignation.')
    if (l.quantity <= 0) fail(`Quantité invalide pour « ${l.description} ».`)
    if (l.unit_price < 0) fail(`Prix invalide pour « ${l.description} ».`)
  }
  return lines
}

async function writeLines(db: Db, docId: number, lines: (LineInput & { lot_refs?: string })[], taxes: Omit<TaxDef, 'auto' | 'active' | 'applies_to'>[]) {
  await db.query('DELETE FROM document_lines WHERE document_id = $1', [docId])
  let pos = 0
  for (const l of lines) {
    await db.query(
      `INSERT INTO document_lines (document_id, position, product_id, description, quantity, unit_price, discount, tva_rate, total_ht, lot_refs)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [docId, pos++, l.product_id, l.description, l.quantity, l.unit_price, l.discount, l.tva_rate, lineHT(l), l.lot_refs ?? '']
    )
  }
  const t = computeFullTotals(lines, taxes)
  await db.query(
    'UPDATE documents SET total_ht=$1, total_tva=$2, total_ttc=$3, total_taxes=$4, total_withheld=$5, taxes=$6, updated_at=now() WHERE id=$7',
    [t.ht, t.tva, t.ttc, t.additions, t.withheld, JSON.stringify(t.taxes), docId]
  )
}

/** Taxes d'un document : retenues à la source seulement sur les pièces réglées par un tiers (pas sur un avoir). */
async function documentTaxes(db: Db, type: DocType, requested: unknown, existingId?: number) {
  const side = DOC_TYPES[type].side === 'purchase' ? 'purchase' : 'sale'
  let codes = requested
  if (codes === undefined && existingId) {
    // Modification sans changer les taxes : on garde celles du brouillon.
    const row = await db.one<{ taxes: AppliedTax[] }>('SELECT taxes FROM documents WHERE id = $1', [existingId])
    codes = (row?.taxes ?? []).map((t) => t.code)
  }
  const defs = await resolveTaxes(db, side, codes)
  return type === 'AV' ? defs.filter((t) => t.kind !== 'withholding') : defs
}

/** Création ou modification d'un brouillon. */
export async function saveDocument(ctx: Ctx, input: any): Promise<{ id: number }> {
  return ctx.db.tx(async (db) => {
    let type: string = input.type
    if (input.id) {
      const existing = await db.one('SELECT type, status FROM documents WHERE id = $1 FOR UPDATE', [input.id])
      if (!existing) fail('Document introuvable.')
      if (existing.status !== 'brouillon') fail('Seul un brouillon peut être modifié.')
      type = existing.type
    }
    checkType(type)
    const info = DOC_TYPES[type]
    const party = await db.one('SELECT id, kind, payment_terms FROM parties WHERE id = $1', [input.party_id])
    if (!party) fail(info.side === 'sale' ? 'Choisissez un client.' : 'Choisissez un fournisseur.')
    if ((info.side === 'sale') !== (party.kind === 'client')) fail('Le tiers ne correspond pas au type de document.')
    const date = str(input.date) || todayISO()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('Date invalide.')
    let due: string | null = str(input.due_date) || null
    if (!due && info.payable) due = addDays(date, party.payment_terms)
    const lines = cleanLines(input.lines)
    const warehouse = Number(input.warehouse_id) || 1
    if (!(await db.one('SELECT 1 FROM warehouses WHERE id = $1 AND active', [warehouse]))) fail('Dépôt inconnu ou inactif.')
    const project = input.project_id ? Number(input.project_id) : null

    let id: number = input.id
    if (id) {
      await db.query('UPDATE documents SET party_id=$1, date=$2, due_date=$3, reference=$4, notes=$5, warehouse_id=$6, project_id=$7 WHERE id=$8', [
        party.id, date, due, str(input.reference), str(input.notes), warehouse, project, id
      ])
    } else {
      const row = await db.one<{ id: number }>(
        `INSERT INTO documents (type, party_id, date, due_date, reference, notes, source_id, created_by, warehouse_id, project_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [type, party.id, date, due, str(input.reference), str(input.notes), input.source_id ?? null, ctx.user?.id ?? null, warehouse, project]
      )
      id = row!.id
      await audit(db, ctx, 'creation', type, id)
    }
    await writeLines(db, id, lines, await documentTaxes(db, type as DocType, input.taxes, input.id ? id : undefined))
    return { id }
  })
}

export async function deleteDraft(ctx: Ctx, args: { id: number }) {
  return ctx.db.tx(async (db) => {
    const doc = await db.one('SELECT status, type FROM documents WHERE id = $1 FOR UPDATE', [args.id])
    if (!doc) fail('Document introuvable.')
    if (doc.status !== 'brouillon') fail('Seul un brouillon peut être supprimé.')
    await db.query('UPDATE documents SET source_id = NULL WHERE source_id = $1', [args.id])
    await db.query('DELETE FROM documents WHERE id = $1', [args.id])
    await audit(db, ctx, 'suppression', doc.type, args.id)
    return true
  })
}

/**
 * Retenues à la source d'une facture validée : le tiers verse le net et reverse la retenue à l'État.
 * Chaque retenue est enregistrée comme un règlement « Retenue à la source » (compte de la taxe).
 */
async function recordWithholdings(db: Db, ctx: Ctx, docId: number) {
  const doc = await db.one('SELECT id, type, number, date, party_id, taxes FROM documents WHERE id = $1', [docId])
  if (!doc || (doc.type !== 'FAC' && doc.type !== 'FF')) return
  const purchase = doc.type === 'FF'
  for (const t of (doc.taxes ?? []) as AppliedTax[]) {
    if (t.kind !== 'withholding' || t.value <= 0) continue
    const row = await db.one<{ id: number }>(
      `INSERT INTO payments (direction, party_id, document_id, date, amount, method, reference, note, user_id, tax_account)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [purchase ? 'out' : 'in', doc.party_id, doc.id, doc.date, t.value, WITHHOLDING_METHOD, t.code, t.label, ctx.user?.id ?? null, purchase ? t.account_purchase : t.account_sale]
    )
    await postPayment(db, ctx, row!.id)
  }
}

/** Numéro suivant, atomique même avec plusieurs postes : FAC-2026-0001. */
export async function nextNumber(db: Db, type: DocType, date: string): Promise<string> {
  const year = date.slice(0, 4)
  const row = await db.one<{ value: number }>(
    `INSERT INTO sequences (key, value) VALUES ($1, 1)
     ON CONFLICT (key) DO UPDATE SET value = sequences.value + 1 RETURNING value`,
    [`${type}-${year}`]
  )
  return `${type}-${year}-${String(row!.value).padStart(4, '0')}`
}

/** Le stock a-t-il déjà été mouvementé par un document en amont (BL pour une facture, BR pour une facture fournisseur) ? */
async function upstreamMovedStock(db: Db, sourceId: number | null): Promise<boolean> {
  let id = sourceId
  for (let depth = 0; id && depth < 10; depth++) {
    const s = await db.one('SELECT source_id, stock_applied, status FROM documents WHERE id = $1', [id])
    if (!s) return false
    if (s.stock_applied && s.status === 'valide') return true
    id = s.source_id
  }
  return false
}

export async function validateDocument(ctx: Ctx, args: { id: number; applyStock?: boolean }) {
  await ctx.db.tx(async (db) => {
    const doc = await db.one('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [args.id])
    if (!doc) fail('Document introuvable.')
    if (doc.status !== 'brouillon') fail('Ce document est déjà validé.')
    const type = doc.type as DocType
    const info = DOC_TYPES[type]
    const lines = await db.query('SELECT * FROM document_lines WHERE document_id = $1 ORDER BY position', [doc.id])
    if (lines.length === 0) fail('Ajoutez au moins une ligne avant de valider.')

    // Avoir : le retour en stock est facultatif (simple geste commercial possible).
    const moveStock =
      type === 'AV' ? args.applyStock !== false : info.stock !== 0 && !(await upstreamMovedStock(db, doc.source_id))

    if (moveStock) {
      const settings = await getSettings(db)
      for (const l of lines) {
        if (!l.product_id) continue
        const qty = info.stock * l.quantity
        const unitCost = info.stock > 0 && info.side === 'purchase' ? l.unit_price * (1 - l.discount / 100) : null
        await applyStockMovement(db, ctx, {
          productId: l.product_id,
          quantity: qty,
          unitCost,
          date: doc.date,
          kind: 'document',
          documentId: doc.id,
          warehouseId: doc.warehouse_id,
          allowNegative: settings.allow_negative_stock
        })
        const prod = await db.one<{ tracking: string }>('SELECT tracking FROM products WHERE id = $1', [l.product_id])
        if (prod && prod.tracking !== 'aucun' && l.lot_refs) {
          await moveLots(db, l.product_id, doc.warehouse_id, lineLots(prod.tracking, l.lot_refs, l.quantity), info.stock > 0 ? 1 : -1)
        }
      }
    }
    const number = await nextNumber(db, type, doc.date)
    await db.query(
      "UPDATE documents SET status='valide', number=$1, stock_applied=$2, validated_at=now(), updated_at=now() WHERE id=$3",
      [number, moveStock, doc.id]
    )
    if (type === 'FAC' || type === 'AV') await certify(db, ctx, doc.id)
    await postDocument(db, ctx, doc.id)
    await recordWithholdings(db, ctx, doc.id)
    await audit(db, ctx, 'validation', type, doc.id, number)
  })
  return loadDocument(ctx.db, args.id)
}

export async function cancelDocument(ctx: Ctx, args: { id: number }) {
  await ctx.db.tx(async (db) => {
    const doc = await db.one('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [args.id])
    if (!doc) fail('Document introuvable.')
    if (doc.status !== 'valide') fail('Seul un document validé peut être annulé.')
    if (doc.type === 'FAC' || doc.type === 'AV')
      fail('Une facture ou un avoir validé ne peut pas être annulé : établissez un avoir.')
    const pay = await db.one<{ n: number }>('SELECT COUNT(*)::int AS n FROM payments WHERE document_id = $1 AND method <> $2', [doc.id, WITHHOLDING_METHOD])
    if (pay!.n > 0) fail("Supprimez d'abord les paiements liés à ce document.")
    // Retenues à la source enregistrées automatiquement : annulées avec le document.
    for (const r of await db.query<{ id: number }>('SELECT id FROM payments WHERE document_id = $1 AND method = $2', [doc.id, WITHHOLDING_METHOD])) {
      await removeSourceEntry(db, 'payment', r.id)
      await db.query('DELETE FROM payments WHERE id = $1', [r.id])
    }
    await removeSourceEntry(db, 'document', doc.id)
    const child = await db.one("SELECT number FROM documents WHERE source_id = $1 AND status = 'valide'", [doc.id])
    if (child) fail(`Ce document a été transformé en ${child.number} ; annulez d'abord ce dernier.`)
    if (doc.stock_applied) {
      const moves = await db.query("SELECT product_id, quantity, unit_cost, warehouse_id FROM stock_movements WHERE document_id = $1 AND kind = 'document'", [doc.id])
      for (const m of moves) {
        await applyStockMovement(db, ctx, {
          productId: m.product_id,
          quantity: -m.quantity,
          unitCost: m.quantity < 0 ? m.unit_cost : null,
          date: todayISO(),
          kind: 'annulation',
          documentId: doc.id,
          warehouseId: m.warehouse_id,
          allowNegative: true,
          note: `Annulation ${doc.number}`
        })
      }
      const tracked = await db.query(
        `SELECT l.product_id, l.quantity, l.lot_refs, p.tracking FROM document_lines l JOIN products p ON p.id = l.product_id
         WHERE l.document_id = $1 AND l.lot_refs <> '' AND p.tracking <> 'aucun'`,
        [doc.id]
      )
      const sign = DOC_TYPES[doc.type as DocType].stock > 0 ? -1 : 1
      for (const t of tracked) await moveLots(db, t.product_id, doc.warehouse_id, lineLots(t.tracking, t.lot_refs, t.quantity), sign)
    }
    await db.query("UPDATE documents SET status='annule', updated_at=now() WHERE id=$1", [doc.id])
    await audit(db, ctx, 'annulation', doc.type, doc.id, doc.number)
  })
  return loadDocument(ctx.db, args.id)
}

/** Transforme un document validé en document suivant de la chaîne (brouillon pré-rempli). */
export async function convertDocument(ctx: Ctx, args: { id: number; to: DocType }) {
  const src = await loadDocument(ctx.db, args.id)
  const from = src.type as DocType
  if (!DOC_TYPES[from].convertsTo.includes(args.to)) fail('Transformation impossible pour ce type de document.')
  if (src.status !== 'valide') fail('Validez le document avant de le transformer.')
  return saveDocument(ctx, {
    type: args.to,
    party_id: src.party_id,
    date: todayISO(),
    reference: src.reference || src.number,
    notes: args.to === 'AV' ? `Avoir sur facture ${src.number}` : src.notes,
    source_id: src.id,
    warehouse_id: src.warehouse_id,
    project_id: src.project_id,
    lines: src.lines,
    taxes: (src.taxes ?? []).map((t: AppliedTax) => t.code)
  })
}

/** Duplique n'importe quel document en nouveau brouillon du même type. */
export async function duplicateDocument(ctx: Ctx, args: { id: number }) {
  const src = await loadDocument(ctx.db, args.id)
  return saveDocument(ctx, { type: src.type, party_id: src.party_id, date: todayISO(), notes: src.notes, lines: src.lines, taxes: (src.taxes ?? []).map((t: AppliedTax) => t.code) })
}
