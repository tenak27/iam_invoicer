// Expressions de besoin (demandes d'achat internes) :
//   brouillon → soumise → approuvée (visa du responsable) → validée (finances) → commandée → clôturée
//   Un rejet, à n'importe quelle étape de validation, renvoie la demande à son auteur avec le motif.
//
//   Expression et envoi   : module « Expressions de besoin » (chacun voit les siennes).
//   Visa du responsable   : droit « Approbations ».
//   Validation financière : droit « Validation financière ».
//   Commande              : module « Achats » ; la demande devient un bon de commande en brouillon.
// Personne ne vise ni ne valide sa propre demande, sauf un administrateur.

import { can } from '@shared/domain'
import { todayISO } from '@shared/format'
import { REQUEST_PRIORITIES, type RequestStatus } from '@shared/workflow'
import { audit, fail, num, str, type Ctx } from './context'
import { saveDocument } from './documents'
import type { Db } from '../db'

interface Line { product_id: number | null; description: string; quantity: number; unit: string; unit_price: number }

const sees = (ctx: Ctx) => can(ctx.user!.role, 'approvals') || can(ctx.user!.role, 'finance') || can(ctx.user!.role, 'purchases')
const rights = (ctx: Ctx) => ({ approve: can(ctx.user!.role, 'approvals'), finance: can(ctx.user!.role, 'finance'), order: can(ctx.user!.role, 'purchases'), all: sees(ctx) })

async function event(db: Db, ctx: Ctx, id: number, action: string, comment = '') {
  await db.query('INSERT INTO workflow_events (kind, ref_id, user_id, action, comment) VALUES ($1,$2,$3,$4,$5)', ['request', id, ctx.user?.id ?? null, action, comment])
}

async function owned(db: Db, ctx: Ctx, id: unknown, lock = false) {
  const r = await db.one<any>(`SELECT * FROM purchase_requests WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [Number(id) || 0])
  if (!r || (r.user_id !== ctx.user!.id && !sees(ctx))) fail('Demande introuvable.')
  return r
}

function cleanLines(raw: unknown): Line[] {
  const lines = (Array.isArray(raw) ? raw : [])
    .map((l: any) => ({
      product_id: l?.product_id ? Number(l.product_id) : null,
      description: str(l?.description).slice(0, 300),
      quantity: Math.round(num(l?.quantity) * 1000) / 1000,
      unit: str(l?.unit).slice(0, 20),
      unit_price: Math.max(0, Math.round(num(l?.unit_price) * 100) / 100)
    }))
    .filter((l) => l.description && l.quantity > 0)
  if (!lines.length) fail('Ajoutez au moins une ligne : désignation et quantité.')
  if (lines.length > 100) fail('Trop de lignes (100 au plus).')
  return lines
}

export async function listRequests(ctx: Ctx, args: { status?: string; search?: string; mine?: boolean } = {}) {
  const all = sees(ctx) && !args.mine
  const rows = await ctx.db.query(
    `SELECT r.id, r.number, r.date, r.needed_by, r.title, r.department, r.priority, r.status, r.total, r.user_id, r.document_id, r.rejected_reason,
            u.full_name AS user_name, d.number AS document_number, d.status AS document_status, d.type AS document_type,
            (SELECT COUNT(*)::int FROM purchase_request_lines l WHERE l.request_id = r.id) AS lines
     FROM purchase_requests r JOIN users u ON u.id = r.user_id LEFT JOIN documents d ON d.id = r.document_id
     WHERE ($1 OR r.user_id = $2) AND ($3 = '' OR r.status = $3)
       AND ($4 = '' OR lower(r.title) LIKE $4 OR lower(r.department) LIKE $4 OR lower(COALESCE(r.number, '')) LIKE $4 OR lower(u.full_name) LIKE $4)
     ORDER BY r.id DESC LIMIT 1000`,
    [all, ctx.user!.id, str(args.status), str(args.search) ? `%${str(args.search).toLowerCase()}%` : '']
  )
  const counts = await ctx.db.query<{ status: RequestStatus; n: number; total: number }>(
    `SELECT status, COUNT(*)::int AS n, COALESCE(SUM(total), 0)::float8 AS total FROM purchase_requests WHERE ($1 OR user_id = $2) GROUP BY status`,
    [all, ctx.user!.id]
  )
  return { rows, counts, rights: rights(ctx) }
}

export async function getRequest(ctx: Ctx, args: { id: number }) {
  const r = await owned(ctx.db, ctx, args?.id)
  const [lines, events, user, doc] = await Promise.all([
    ctx.db.query('SELECT product_id, description, quantity, unit, unit_price FROM purchase_request_lines WHERE request_id = $1 ORDER BY position', [r.id]),
    ctx.db.query(`SELECT w.action, w.comment, w.at, u.full_name AS user_name FROM workflow_events w LEFT JOIN users u ON u.id = w.user_id WHERE w.kind = 'request' AND w.ref_id = $1 ORDER BY w.id`, [r.id]),
    ctx.db.one<{ full_name: string }>('SELECT full_name FROM users WHERE id = $1', [r.user_id]),
    r.document_id ? ctx.db.one('SELECT id, number, status, type FROM documents WHERE id = $1', [r.document_id]) : null
  ])
  return { ...r, user_name: user?.full_name ?? '', lines, events, document: doc, rights: rights(ctx) }
}

export async function saveRequest(ctx: Ctx, input: any): Promise<{ id: number; status: RequestStatus }> {
  const title = str(input?.title).slice(0, 200)
  if (!title) fail("Donnez un objet à l'expression de besoin.")
  const priority = Object.hasOwn(REQUEST_PRIORITIES, str(input.priority)) ? str(input.priority) : 'normale'
  const needed = str(input.needed_by)
  if (needed && !/^\d{4}-\d{2}-\d{2}$/.test(needed)) fail('Date souhaitée invalide.')
  const lines = cleanLines(input.lines)
  const total = Math.round(lines.reduce((s, l) => s + l.quantity * l.unit_price, 0) * 100) / 100
  const fields = [title, str(input.department).slice(0, 120), priority, needed || null, str(input.justification).slice(0, 3000), total]

  return ctx.db.tx(async (db) => {
    let id = Number(input.id) || 0
    if (id) {
      const r = await owned(db, ctx, id, true)
      if (r.user_id !== ctx.user!.id && ctx.user!.role !== 'admin') fail('Seul son auteur peut modifier une demande.')
      if (r.status !== 'brouillon' && r.status !== 'rejetee') fail('Cette demande est dans le circuit de validation : elle ne se modifie plus.')
      await db.query(`UPDATE purchase_requests SET title=$1, department=$2, priority=$3, needed_by=$4, justification=$5, total=$6, status='brouillon', rejected_reason='', updated_at=now() WHERE id=$7`, [...fields, id])
      await db.query('DELETE FROM purchase_request_lines WHERE request_id = $1', [id])
    } else {
      id = (await db.one<{ id: number }>(
        `INSERT INTO purchase_requests (title, department, priority, needed_by, justification, total, date, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [...fields, todayISO(), ctx.user!.id]
      ))!.id
      await event(db, ctx, id, 'creation')
      await audit(db, ctx, 'creation', 'besoin', id, title)
    }
    let pos = 0
    for (const l of lines)
      await db.query('INSERT INTO purchase_request_lines (request_id, position, product_id, description, quantity, unit, unit_price) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, pos++, l.product_id, l.description, l.quantity, l.unit, l.unit_price])
    if (input.submit) return submit(db, ctx, id)
    return { id, status: 'brouillon' as RequestStatus }
  })
}

async function submit(db: Db, ctx: Ctx, id: number): Promise<{ id: number; status: RequestStatus }> {
  const r = await owned(db, ctx, id, true)
  if (r.user_id !== ctx.user!.id && ctx.user!.role !== 'admin') fail('Seul son auteur peut envoyer une demande.')
  if (r.status !== 'brouillon') fail('Cette demande a déjà été envoyée.')
  let number = r.number as string | null
  if (!number) {
    const year = todayISO().slice(0, 4)
    const seq = await db.one<{ value: number }>(`INSERT INTO sequences (key, value) VALUES ($1, 1) ON CONFLICT (key) DO UPDATE SET value = sequences.value + 1 RETURNING value`, [`EB-${year}`])
    number = `EB-${year}-${String(seq!.value).padStart(4, '0')}`
  }
  await db.query(`UPDATE purchase_requests SET status='soumise', number=$2, submitted_at=now(), updated_at=now() WHERE id=$1`, [id, number])
  await event(db, ctx, id, 'soumission')
  return { id, status: 'soumise' }
}

export const submitRequest = (ctx: Ctx, args: { id: number }) => ctx.db.tx((db) => submit(db, ctx, Number(args?.id)))

export async function deleteRequest(ctx: Ctx, args: { id: number }) {
  return ctx.db.tx(async (db) => {
    const r = await owned(db, ctx, args?.id, true)
    if (r.user_id !== ctx.user!.id && ctx.user!.role !== 'admin') fail('Seul son auteur peut supprimer une demande.')
    if (r.status !== 'brouillon' && r.status !== 'rejetee') fail('Seul un brouillon ou une demande rejetée peut être supprimé.')
    await db.query(`DELETE FROM workflow_events WHERE kind = 'request' AND ref_id = $1`, [r.id])
    await db.query('DELETE FROM purchase_requests WHERE id = $1', [r.id])
    await audit(db, ctx, 'suppression', 'besoin', r.id, r.title)
    return true
  })
}

/**
 * Décision à l'étape en cours : visa du responsable (demande « soumise ») ou validation
 * financière (demande « approuvée »). Chaque étape exige le droit correspondant.
 */
export async function decideRequest(ctx: Ctx, args: { id: number; approve: boolean; comment?: string }) {
  return ctx.db.tx(async (db) => {
    const r = await owned(db, ctx, args?.id, true)
    const step = r.status === 'soumise' ? 'approvals' : r.status === 'approuvee' ? 'finance' : null
    if (!step) fail("Cette demande n'attend pas de décision.")
    if (!can(ctx.user!.role, step)) fail(step === 'approvals' ? "Le visa du responsable demande le droit « Approbations »." : 'La validation financière demande le droit « Validation financière ».')
    if (r.user_id === ctx.user!.id && ctx.user!.role !== 'admin') fail('Vous ne pouvez pas valider votre propre demande : un autre responsable doit le faire.')
    const comment = str(args.comment).slice(0, 500)
    if (!args.approve && !comment) fail('Indiquez le motif du rejet.')
    const next: RequestStatus = !args.approve ? 'rejetee' : step === 'approvals' ? 'approuvee' : 'validee'
    await db.query(`UPDATE purchase_requests SET status=$2, rejected_reason=$3, updated_at=now() WHERE id=$1`, [r.id, next, args.approve ? '' : comment])
    const action = !args.approve ? 'rejet' : step === 'approvals' ? 'visa' : 'validation_financiere'
    await event(db, ctx, r.id, action, comment)
    await audit(db, ctx, action, 'besoin', r.id, r.number)
    return { id: r.id, status: next }
  })
}

/** Le service achats transforme la demande validée en bon de commande (brouillon à compléter). */
export async function orderRequest(ctx: Ctx, args: { id: number; supplier_id: number }) {
  if (!can(ctx.user!.role, 'purchases')) fail('La commande est passée par le service achats (droit « Achats »).')
  const r = await owned(ctx.db, ctx, args?.id)
  if (r.status !== 'validee') fail("Cette demande n'est pas encore validée : elle ne peut pas être commandée.")
  const supplier = await ctx.db.one<{ kind: string }>('SELECT kind FROM parties WHERE id = $1 AND active', [Number(args.supplier_id) || 0])
  if (!supplier || supplier.kind !== 'supplier') fail('Choisissez le fournisseur de la commande.')
  const lines = await ctx.db.query<Line>('SELECT product_id, description, quantity, unit_price FROM purchase_request_lines WHERE request_id = $1 ORDER BY position', [r.id])
  const doc = await saveDocument(ctx, {
    type: 'BC', party_id: Number(args.supplier_id), date: todayISO(), reference: r.number, notes: `Expression de besoin ${r.number} — ${r.title}`,
    lines: lines.map((l) => ({ product_id: l.product_id, description: l.description, quantity: l.quantity, unit_price: l.unit_price, discount: 0, tva_rate: 0 })), taxes: []
  })
  return ctx.db.tx(async (db) => {
    const again = await db.one<{ status: string }>('SELECT status FROM purchase_requests WHERE id = $1 FOR UPDATE', [r.id])
    if (again?.status !== 'validee') fail('Cette demande vient d’être traitée par quelqu’un d’autre.')
    await db.query(`UPDATE purchase_requests SET status='commandee', document_id=$2, updated_at=now() WHERE id=$1`, [r.id, doc.id])
    await event(db, ctx, r.id, 'commande')
    await audit(db, ctx, 'commande', 'besoin', r.id, r.number)
    return { id: r.id, status: 'commandee', document_id: doc.id }
  })
}

/** Clôture : le besoin est satisfait (marchandise ou prestation reçue). */
export async function closeRequest(ctx: Ctx, args: { id: number; comment?: string }) {
  if (!can(ctx.user!.role, 'purchases')) fail('La clôture est faite par le service achats (droit « Achats »).')
  return ctx.db.tx(async (db) => {
    const r = await owned(db, ctx, args?.id, true)
    if (r.status !== 'commandee') fail('Seule une demande commandée peut être clôturée.')
    await db.query(`UPDATE purchase_requests SET status='cloturee', updated_at=now() WHERE id=$1`, [r.id])
    await event(db, ctx, r.id, 'cloture', str(args.comment).slice(0, 500))
    return { id: r.id, status: 'cloturee' }
  })
}
