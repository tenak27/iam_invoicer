// Dépenses de l'entreprise : saisie → approbation → paiement → écriture comptable.
//   Saisie et envoi : toute personne qui a le module « Dépenses » (elle ne voit que les siennes).
//   Approbation     : droit « Approbations » (chef de service, direction) ; jamais sa propre dépense,
//                     sauf pour un administrateur.
//   Paiement        : droit « Validation financière » ; la charge est débitée, la trésorerie créditée.

import { can, PAYMENT_METHODS, treasuryFor } from '@shared/domain'
import { todayISO } from '@shared/format'
import { EXPENSE_CATEGORIES, type ExpenseCategory, type ExpenseStatus } from '@shared/workflow'
import { postEntry, removeSourceEntry } from './accounting'
import { audit, fail, num, str, type Ctx } from './context'
import type { Db } from '../db'

const RECEIPT = /^data:(image\/(png|jpe?g|webp)|application\/pdf);base64,[A-Za-z0-9+/=]+$/
const sees = (ctx: Ctx) => can(ctx.user!.role, 'approvals') || can(ctx.user!.role, 'finance')

async function event(db: Db, ctx: Ctx, id: number, action: string, comment = '') {
  await db.query('INSERT INTO workflow_events (kind, ref_id, user_id, action, comment) VALUES ($1,$2,$3,$4,$5)', ['expense', id, ctx.user?.id ?? null, action, comment])
}

async function owned(db: Db, ctx: Ctx, id: unknown, lock = false) {
  const e = await db.one<any>(`SELECT * FROM expenses WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [Number(id) || 0])
  if (!e || (e.user_id !== ctx.user!.id && !sees(ctx))) fail('Dépense introuvable.')
  return e
}

export async function listExpenses(ctx: Ctx, args: { status?: string; search?: string; from?: string; to?: string; mine?: boolean } = {}) {
  const all = sees(ctx) && !args.mine
  const rows = await ctx.db.query(
    `SELECT e.id, e.number, e.date, e.category, e.label, e.amount, e.method, e.beneficiary, e.status, e.user_id, e.project_id, e.paid_at, e.rejected_reason,
            e.receipt <> '' AS has_receipt, u.full_name AS user_name, p.name AS project_name
     FROM expenses e JOIN users u ON u.id = e.user_id LEFT JOIN projects p ON p.id = e.project_id
     WHERE ($1 OR e.user_id = $2)
       AND ($3 = '' OR e.status = $3)
       AND ($4 = '' OR lower(e.label) LIKE $4 OR lower(e.beneficiary) LIKE $4 OR lower(COALESCE(e.number, '')) LIKE $4 OR lower(u.full_name) LIKE $4)
       AND ($5 = '' OR e.date >= $5) AND ($6 = '' OR e.date <= $6)
     ORDER BY e.date DESC, e.id DESC LIMIT 1000`,
    [all, ctx.user!.id, str(args.status), str(args.search) ? `%${str(args.search).toLowerCase()}%` : '', str(args.from), str(args.to)]
  )
  const month = todayISO().slice(0, 7)
  const totals = await ctx.db.one<any>(
    `SELECT COALESCE(SUM(amount) FILTER (WHERE status = 'payee' AND date LIKE $3), 0)::float8 AS paid_month,
            COALESCE(SUM(amount) FILTER (WHERE status = 'soumise'), 0)::float8 AS to_approve, COUNT(*) FILTER (WHERE status = 'soumise')::int AS n_approve,
            COALESCE(SUM(amount) FILTER (WHERE status = 'approuvee'), 0)::float8 AS to_pay, COUNT(*) FILTER (WHERE status = 'approuvee')::int AS n_pay
     FROM expenses WHERE ($1 OR user_id = $2)`,
    [all, ctx.user!.id, month + '%']
  )
  const byCategory = await ctx.db.query<{ category: string; total: number }>(
    `SELECT category, SUM(amount)::float8 AS total FROM expenses WHERE ($1 OR user_id = $2) AND status = 'payee' AND date >= $3 GROUP BY category ORDER BY 2 DESC`,
    [all, ctx.user!.id, todayISO().slice(0, 4) + '-01-01']
  )
  return { rows, totals, byCategory, rights: { approve: can(ctx.user!.role, 'approvals'), pay: can(ctx.user!.role, 'finance'), all: sees(ctx) } }
}

export async function getExpense(ctx: Ctx, args: { id: number }) {
  const e = await owned(ctx.db, ctx, args?.id)
  const events = await ctx.db.query(
    `SELECT w.action, w.comment, w.at, u.full_name AS user_name FROM workflow_events w LEFT JOIN users u ON u.id = w.user_id WHERE w.kind = 'expense' AND w.ref_id = $1 ORDER BY w.id`,
    [e.id]
  )
  const user = await ctx.db.one<{ full_name: string }>('SELECT full_name FROM users WHERE id = $1', [e.user_id])
  return { ...e, user_name: user?.full_name ?? '', events }
}

export async function saveExpense(ctx: Ctx, input: any): Promise<{ id: number; status: ExpenseStatus }> {
  const category = str(input?.category) as ExpenseCategory
  if (!Object.hasOwn(EXPENSE_CATEGORIES, category)) fail('Choisissez une catégorie de dépense.')
  const label = str(input.label)
  if (!label) fail("Indiquez l'objet de la dépense.")
  const amount = Math.round(num(input.amount) * 100) / 100
  if (!(amount > 0)) fail('Le montant doit être supérieur à zéro.')
  const date = str(input.date) || todayISO()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('Date invalide.')
  const method = str(input.method) || 'Espèces'
  if (!(PAYMENT_METHODS as readonly string[]).includes(method)) fail('Mode de paiement inconnu.')
  const receipt = str(input.receipt)
  if (receipt && !RECEIPT.test(receipt)) fail('Justificatif invalide : joignez une image (PNG, JPG) ou un PDF.')
  if (receipt.length > 2_800_000) fail('Justificatif trop lourd (2 Mo au plus).')
  const project = input.project_id ? Number(input.project_id) : null
  if (project && !(await ctx.db.one('SELECT 1 FROM projects WHERE id = $1', [project]))) fail('Projet inconnu.')
  const fields = [date, category, label.slice(0, 200), amount, method, str(input.beneficiary).slice(0, 120), str(input.notes).slice(0, 2000), project]

  return ctx.db.tx(async (db) => {
    let id = Number(input.id) || 0
    if (id) {
      const e = await owned(db, ctx, id, true)
      if (e.user_id !== ctx.user!.id && ctx.user!.role !== 'admin') fail('Seul son auteur peut modifier une dépense.')
      if (e.status !== 'brouillon' && e.status !== 'rejetee') fail('Cette dépense est dans le circuit de validation : elle ne se modifie plus.')
      await db.query(
        `UPDATE expenses SET date=$1, category=$2, label=$3, amount=$4, method=$5, beneficiary=$6, notes=$7, project_id=$8, status='brouillon', rejected_reason='', updated_at=now()${input.receipt !== undefined ? ', receipt=$10' : ''} WHERE id=$9`,
        input.receipt !== undefined ? [...fields, id, receipt] : [...fields, id]
      )
    } else {
      id = (await db.one<{ id: number }>(
        `INSERT INTO expenses (date, category, label, amount, method, beneficiary, notes, project_id, receipt, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [...fields, receipt, ctx.user!.id]
      ))!.id
      await event(db, ctx, id, 'creation')
      await audit(db, ctx, 'creation', 'depense', id, label)
    }
    if (input.submit) return submit(db, ctx, id)
    return { id, status: 'brouillon' as ExpenseStatus }
  })
}

async function submit(db: Db, ctx: Ctx, id: number): Promise<{ id: number; status: ExpenseStatus }> {
  const e = await owned(db, ctx, id, true)
  if (e.user_id !== ctx.user!.id && ctx.user!.role !== 'admin') fail('Seul son auteur peut envoyer une dépense en validation.')
  if (e.status !== 'brouillon') fail('Cette dépense a déjà été envoyée.')
  let number = e.number as string | null
  if (!number) {
    const year = String(e.date).slice(0, 4)
    const seq = await db.one<{ value: number }>(`INSERT INTO sequences (key, value) VALUES ($1, 1) ON CONFLICT (key) DO UPDATE SET value = sequences.value + 1 RETURNING value`, [`DEP-${year}`])
    number = `DEP-${year}-${String(seq!.value).padStart(4, '0')}`
  }
  await db.query(`UPDATE expenses SET status='soumise', number=$2, submitted_at=now(), updated_at=now() WHERE id=$1`, [id, number])
  await event(db, ctx, id, 'soumission')
  return { id, status: 'soumise' }
}

export const submitExpense = (ctx: Ctx, args: { id: number }) => ctx.db.tx((db) => submit(db, ctx, Number(args?.id)))

export async function deleteExpense(ctx: Ctx, args: { id: number }) {
  return ctx.db.tx(async (db) => {
    const e = await owned(db, ctx, args?.id, true)
    if (e.user_id !== ctx.user!.id && ctx.user!.role !== 'admin') fail('Seul son auteur peut supprimer une dépense.')
    if (e.status !== 'brouillon' && e.status !== 'rejetee') fail('Seul un brouillon ou une dépense rejetée peut être supprimé.')
    await db.query(`DELETE FROM workflow_events WHERE kind = 'expense' AND ref_id = $1`, [e.id])
    await db.query('DELETE FROM expenses WHERE id = $1', [e.id])
    await audit(db, ctx, 'suppression', 'depense', e.id, e.label)
    return true
  })
}

/** Approbation ou rejet par le responsable. */
export async function decideExpense(ctx: Ctx, args: { id: number; approve: boolean; comment?: string }) {
  return ctx.db.tx(async (db) => {
    const e = await owned(db, ctx, args?.id, true)
    if (e.status !== 'soumise') fail("Cette dépense n'attend pas d'approbation.")
    if (e.user_id === ctx.user!.id && ctx.user!.role !== 'admin') fail('Vous ne pouvez pas approuver votre propre dépense : un autre responsable doit le faire.')
    const comment = str(args.comment).slice(0, 500)
    if (!args.approve && !comment) fail('Indiquez le motif du rejet.')
    await db.query(`UPDATE expenses SET status=$2, approved_by=$3, approved_at=now(), rejected_reason=$4, updated_at=now() WHERE id=$1`, [e.id, args.approve ? 'approuvee' : 'rejetee', ctx.user!.id, args.approve ? '' : comment])
    await event(db, ctx, e.id, args.approve ? 'approbation' : 'rejet', comment)
    await audit(db, ctx, args.approve ? 'approbation' : 'rejet', 'depense', e.id, e.number)
    return { id: e.id, status: args.approve ? 'approuvee' : 'rejetee' }
  })
}

/** Paiement : la charge est comptabilisée (débit du compte de la catégorie, crédit de la trésorerie). */
export async function payExpense(ctx: Ctx, args: { id: number; date?: string; method?: string }) {
  return ctx.db.tx(async (db) => {
    const e = await owned(db, ctx, args?.id, true)
    if (e.status !== 'approuvee') fail("Cette dépense n'est pas à payer : elle doit d'abord être approuvée.")
    const date = str(args.date) || todayISO()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('Date invalide.')
    const method = str(args.method) || e.method
    if (!(PAYMENT_METHODS as readonly string[]).includes(method)) fail('Mode de paiement inconnu.')
    const { account, journal } = treasuryFor(method)
    const charge = EXPENSE_CATEGORIES[e.category as ExpenseCategory]?.account ?? '658'
    await postEntry(db, ctx, {
      journal, date, label: `${e.number} ${e.label}`.slice(0, 200), source: 'expense', source_id: e.id,
      lines: [{ account: charge, debit: e.amount }, { account, credit: e.amount }]
    })
    await db.query(`UPDATE expenses SET status='payee', method=$2, paid_by=$3, paid_at=$4, updated_at=now() WHERE id=$1`, [e.id, method, ctx.user!.id, date])
    await event(db, ctx, e.id, 'paiement', method)
    await audit(db, ctx, 'paiement', 'depense', e.id, e.number)
    return { id: e.id, status: 'payee' }
  })
}

/** Paiement saisi par erreur : la dépense revient « à payer », l'écriture est retirée (administrateur). */
export async function unpayExpense(ctx: Ctx, args: { id: number }) {
  if (ctx.user!.role !== 'admin') fail("Seul un administrateur peut annuler le paiement d'une dépense.")
  return ctx.db.tx(async (db) => {
    const e = await owned(db, ctx, args?.id, true)
    if (e.status !== 'payee') fail("Cette dépense n'est pas payée.")
    await removeSourceEntry(db, 'expense', e.id)
    await db.query(`UPDATE expenses SET status='approuvee', paid_by=NULL, paid_at=NULL, updated_at=now() WHERE id=$1`, [e.id])
    await event(db, ctx, e.id, 'annulation_paiement')
    return { id: e.id, status: 'approuvee' }
  })
}
