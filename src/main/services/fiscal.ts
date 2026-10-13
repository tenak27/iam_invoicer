// Exercices comptables : ouverture, contrôles avant clôture, clôture (les comptes de charges et de
// produits sont soldés dans le résultat de l'exercice) et réouverture.
//
// Une fois un exercice clôturé, plus aucune écriture ne peut être passée, modifiée ou supprimée à
// une date antérieure ou égale à sa date de fin : le verrou est posé dans la comptabilité elle-même
// (assertPeriodOpen, appelé à chaque écriture), donc aussi pour les factures, règlements, paies…

import { can } from '@shared/domain'
import { todayISO } from '@shared/format'
import type { Db } from '../db'
import { audit, fail, str, type Ctx } from './context'
import { assertFiscalAuth, type GuardAuth } from './fiscalGuard'
import { isCharge, isProduct } from './statements'

export interface FiscalYear {
  id: number
  label: string
  start_date: string
  end_date: string
  status: 'ouvert' | 'cloture'
  result: number | null
  closed_at: string | null
  closed_by_name?: string | null
}

const ISO = /^\d{4}-\d{2}-\d{2}$/
const round = (n: number) => Math.round(n * 100) / 100
const fr = (d: string) => d.split('-').reverse().join('/')
const nextDay = (d: string) => {
  const t = new Date(d + 'T00:00:00Z')
  t.setUTCDate(t.getUTCDate() + 1)
  return t.toISOString().slice(0, 10)
}

/** Dernière date verrouillée (fin du dernier exercice clôturé), ou null. */
export async function lockedUntil(db: Db): Promise<{ date: string; label: string } | null> {
  const row = await db.one<{ end_date: string; label: string }>(`SELECT end_date, label FROM fiscal_years WHERE status = 'cloture' ORDER BY end_date DESC LIMIT 1`)
  return row ? { date: row.end_date, label: row.label } : null
}

/** Refuse toute écriture datée dans un exercice clôturé. */
export async function assertPeriodOpen(db: Db, date: string): Promise<void> {
  const lock = await lockedUntil(db)
  if (lock && date <= lock.date) fail(`L'exercice ${lock.label} est clôturé : aucune écriture n'est possible au ${fr(date)} (période verrouillée jusqu'au ${fr(lock.date)}). Datez l'opération sur l'exercice en cours, ou faites rouvrir l'exercice par un administrateur.`)
}

export async function listFiscalYears(ctx: Ctx) {
  const years = await ctx.db.query<FiscalYear>(
    `SELECT f.id, f.label, f.start_date, f.end_date, f.status, f.result, f.closed_at, u.full_name AS closed_by_name
     FROM fiscal_years f LEFT JOIN users u ON u.id = f.closed_by ORDER BY f.start_date DESC`
  )
  const today = todayISO()
  const current = years.find((y) => y.status === 'ouvert' && y.start_date <= today && y.end_date >= today) ?? years.find((y) => y.status === 'ouvert') ?? null
  const lock = await lockedUntil(ctx.db)
  // Proposition pour le prochain exercice : à la suite du dernier, sinon l'année civile en cours
  const last = years[0]
  const start = last ? nextDay(last.end_date) : `${today.slice(0, 4)}-01-01`
  const end = `${start.slice(0, 4)}-12-31`
  return {
    years, current: current?.id ?? null, lockedUntil: lock?.date ?? null,
    suggestion: { label: start.slice(0, 4), start_date: start, end_date: end },
    rights: { close: can(ctx.user!.role, 'finance'), reopen: ctx.user!.role === 'admin' }
  }
}

/** Ouverture d'un exercice : périodes sans chevauchement, à la suite les unes des autres. */
export async function openFiscalYear(ctx: Ctx, input: { label?: string; start_date: string; end_date: string; auth?: GuardAuth }) {
  if (!can(ctx.user!.role, 'finance')) fail("L'ouverture d'un exercice demande le droit « Validation financière ».")
  const start = str(input?.start_date)
  const end = str(input?.end_date)
  if (!ISO.test(start) || !ISO.test(end) || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) fail('Dates de début et de fin obligatoires.')
  if (end <= start) fail('La date de fin doit suivre la date de début.')
  const days = (Date.parse(end) - Date.parse(start)) / 86_400_000 + 1
  if (days > 731) fail('Un exercice ne peut pas dépasser deux ans.')
  const label = str(input.label).slice(0, 40) || (start.slice(0, 4) === end.slice(0, 4) ? start.slice(0, 4) : `${start.slice(0, 4)}-${end.slice(0, 4)}`)
  // Les refus évidents passent avant le verrou : inutile de consommer un code pour des dates impossibles
  if (await ctx.db.one('SELECT 1 FROM fiscal_years WHERE label = $1', [label])) fail(`Un exercice « ${label} » existe déjà.`)
  const clash = await ctx.db.one<{ label: string }>('SELECT label FROM fiscal_years WHERE start_date <= $2 AND end_date >= $1 LIMIT 1', [start, end])
  if (clash) fail(`Ces dates chevauchent l'exercice ${clash.label}.`)
  await assertFiscalAuth(ctx, 'open', null, input.auth)
  return ctx.db.tx(async (db) => {
    if (await db.one('SELECT 1 FROM fiscal_years WHERE label = $1', [label])) fail(`Un exercice « ${label} » existe déjà.`)
    const clash = await db.one<{ label: string }>('SELECT label FROM fiscal_years WHERE start_date <= $2 AND end_date >= $1 LIMIT 1', [start, end])
    if (clash) fail(`Ces dates chevauchent l'exercice ${clash.label}.`)
    const lock = await lockedUntil(db)
    if (lock && start <= lock.date) fail(`L'exercice ${lock.label} est clôturé jusqu'au ${fr(lock.date)} : le nouvel exercice doit commencer après.`)
    const row = await db.one<{ id: number }>('INSERT INTO fiscal_years (label, start_date, end_date, opened_by) VALUES ($1,$2,$3,$4) RETURNING id', [label, start, end, ctx.user!.id])
    await audit(db, ctx, 'ouverture', 'exercice', row!.id, `${label} : du ${fr(start)} au ${fr(end)}`)
    return { id: row!.id, label }
  })
}

async function mustYear(db: Db, id: unknown, lock = false) {
  const y = await db.one<FiscalYear>(`SELECT * FROM fiscal_years WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [Number(id) || 0])
  if (!y) fail('Exercice introuvable.')
  return y
}

/** Soldes des comptes de charges et de produits sur l'exercice (hors écriture de clôture). */
async function resultLines(db: Db, y: FiscalYear) {
  const rows = await db.query<{ number: string; label: string; balance: number }>(
    `SELECT a.number, a.label, SUM(l.debit - l.credit)::float8 AS balance
     FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.number = l.account
     WHERE e.date >= $1 AND e.date <= $2 AND COALESCE(e.source, '') <> 'fiscal_close'
     GROUP BY a.number, a.label HAVING ABS(SUM(l.debit - l.credit)) >= 0.005 ORDER BY a.number`,
    [y.start_date, y.end_date]
  )
  const pl = rows.filter((r) => isCharge(r.number) || isProduct(r.number))
  const produits = round(pl.filter((r) => isProduct(r.number)).reduce((s, r) => s - r.balance, 0))
  const charges = round(pl.filter((r) => isCharge(r.number)).reduce((s, r) => s + r.balance, 0))
  return { pl, produits, charges, result: round(produits - charges) }
}

/** Contrôles avant clôture : ce qui bloque, ce qui mérite un coup d'œil, et le résultat attendu. */
export async function previewClosing(ctx: Ctx, args: { id: number }) {
  const { db } = ctx
  const y = await mustYear(db, args?.id)
  const [drafts, missing, cash, expenses, unbalanced, earlier, entries] = await Promise.all([
    db.one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM documents WHERE status = 'brouillon' AND date >= $1 AND date <= $2`, [y.start_date, y.end_date]),
    db.one<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM documents d WHERE d.status = 'valide' AND d.type IN ('FAC','AV','FF') AND d.date >= $1 AND d.date <= $2
       AND NOT EXISTS (SELECT 1 FROM journal_entries e WHERE e.source = 'document' AND e.source_id = d.id)`,
      [y.start_date, y.end_date]
    ),
    db.one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM cash_sessions WHERE closed_at IS NULL`).catch(() => ({ n: 0 })),
    db.one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM expenses WHERE status IN ('soumise','approuvee') AND date >= $1 AND date <= $2`, [y.start_date, y.end_date]),
    db.one<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM (SELECT e.id FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id WHERE e.date >= $1 AND e.date <= $2 GROUP BY e.id HAVING ABS(SUM(l.debit - l.credit)) > 0.01) x`,
      [y.start_date, y.end_date]
    ),
    db.one<{ label: string }>(`SELECT label FROM fiscal_years WHERE status = 'ouvert' AND end_date < $1 ORDER BY end_date LIMIT 1`, [y.start_date]),
    db.one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM journal_entries WHERE date >= $1 AND date <= $2 AND COALESCE(source, '') <> 'fiscal_close'`, [y.start_date, y.end_date])
  ])
  const today = todayISO()
  const checks = [
    { key: 'ordre', blocking: true, ok: !earlier, label: earlier ? `L'exercice ${earlier.label}, antérieur, n'est pas clôturé : clôturez-le d'abord.` : 'Les exercices antérieurs sont clôturés.' },
    { key: 'equilibre', blocking: true, ok: !unbalanced?.n, label: unbalanced?.n ? `${unbalanced.n} écriture(s) déséquilibrée(s) à corriger.` : 'Toutes les écritures sont équilibrées.' },
    { key: 'ecritures', blocking: true, ok: !missing?.n, label: missing?.n ? `${missing.n} facture(s) validée(s) sans écriture : lancez « Générer les écritures manquantes » dans les journaux.` : 'Toutes les factures validées sont comptabilisées.' },
    { key: 'brouillons', blocking: false, ok: !drafts?.n, label: drafts?.n ? `${drafts.n} document(s) encore en brouillon sur la période : validez-les ou supprimez-les.` : 'Aucun document en brouillon sur la période.' },
    { key: 'depenses', blocking: false, ok: !expenses?.n, label: expenses?.n ? `${expenses.n} dépense(s) de la période en attente d'approbation ou de paiement.` : 'Aucune dépense en attente sur la période.' },
    { key: 'caisse', blocking: false, ok: !cash?.n, label: cash?.n ? `${cash.n} session(s) de caisse encore ouverte(s).` : 'Toutes les sessions de caisse sont clôturées.' },
    { key: 'date', blocking: false, ok: y.end_date < today, label: y.end_date < today ? "La période de l'exercice est terminée." : `L'exercice court jusqu'au ${fr(y.end_date)} : une clôture anticipée verrouille les dates déjà passées et à venir de cette période.` }
  ]
  const r = await resultLines(db, y)
  return { year: y, checks, canClose: y.status === 'ouvert' && checks.every((c) => c.ok || !c.blocking), entries: entries?.n ?? 0, produits: r.produits, charges: r.charges, result: r.result }
}

/**
 * Clôture : une écriture datée du dernier jour solde chaque compte de charges et de produits ;
 * la différence va au compte 131 (bénéfice) ou 139 (perte). La période est ensuite verrouillée.
 */
export async function closeFiscalYear(ctx: Ctx, args: { id: number; confirm?: string; open_next?: boolean; auth?: GuardAuth }) {
  if (!can(ctx.user!.role, 'finance')) fail("La clôture d'un exercice demande le droit « Validation financière ».")
  const preview = await previewClosing(ctx, args)
  if (preview.year.status !== 'ouvert') fail('Cet exercice est déjà clôturé.')
  const blocking = preview.checks.find((c) => c.blocking && !c.ok)
  if (blocking) fail(`Clôture impossible : ${blocking.label}`)
  if (str(args.confirm) !== preview.year.label) fail(`Pour confirmer, saisissez le nom de l'exercice : ${preview.year.label}.`)
  await assertFiscalAuth(ctx, 'close', preview.year.id, args.auth)

  return ctx.db.tx(async (db) => {
    const y = await mustYear(db, args.id, true)
    if (y.status !== 'ouvert') fail('Cet exercice est déjà clôturé.')
    const r = await resultLines(db, y)
    let entryId: number | null = null
    if (r.pl.length) {
      const lines = r.pl.map((a) => (a.balance > 0 ? { account: a.number, credit: round(a.balance) } : { account: a.number, debit: round(-a.balance) }))
      const debit = lines.reduce((s, l) => s + ((l as any).debit ?? 0), 0)
      const credit = lines.reduce((s, l) => s + ((l as any).credit ?? 0), 0)
      const gap = round(debit - credit) // > 0 : bénéfice à créditer au 131
      if (Math.abs(gap) >= 0.005) lines.push(gap > 0 ? { account: '131', credit: gap } : { account: '139', debit: -gap })
      // Import tardif pour éviter une dépendance circulaire (la comptabilité consulte le verrou)
      const { postEntry } = await import('./accounting')
      entryId = await postEntry(db, ctx, { journal: 'OD', date: y.end_date, label: `Clôture de l'exercice ${y.label} : détermination du résultat`, source: 'fiscal_close', source_id: y.id, lines })
    }
    await db.query(`UPDATE fiscal_years SET status = 'cloture', result = $2, closed_by = $3, closed_at = now(), closing_entry_id = $4 WHERE id = $1`, [y.id, r.result, ctx.user!.id, entryId])
    await audit(db, ctx, 'cloture', 'exercice', y.id, `${y.label} : résultat ${r.result}`)
    let next: { id: number; label: string } | null = null
    if (args.open_next) {
      const start = nextDay(y.end_date)
      const end = `${start.slice(0, 4)}-12-31`
      const label = start.slice(0, 4)
      if (!(await db.one('SELECT 1 FROM fiscal_years WHERE start_date <= $2 AND end_date >= $1 OR label = $3', [start, end, label]))) {
        const row = await db.one<{ id: number }>('INSERT INTO fiscal_years (label, start_date, end_date, opened_by) VALUES ($1,$2,$3,$4) RETURNING id', [label, start, end, ctx.user!.id])
        next = { id: row!.id, label }
        await audit(db, ctx, 'ouverture', 'exercice', row!.id, `${label} : du ${fr(start)} au ${fr(end)}`)
      }
    }
    return { id: y.id, label: y.label, result: r.result, entry_id: entryId, next }
  })
}

/** Réouverture du dernier exercice clôturé (administrateur) : l'écriture de clôture est retirée. */
export async function reopenFiscalYear(ctx: Ctx, args: { id: number; reason?: string; auth?: GuardAuth }) {
  if (ctx.user!.role !== 'admin') fail('Seul un administrateur peut rouvrir un exercice clôturé.')
  const reason = str(args?.reason).slice(0, 300)
  if (reason.length < 5) fail('Indiquez le motif de la réouverture : il est inscrit au journal d’activité.')
  await assertFiscalAuth(ctx, 'reopen', (await mustYear(ctx.db, args.id)).id, args.auth)
  return ctx.db.tx(async (db) => {
    const y = await mustYear(db, args.id, true)
    if (y.status !== 'cloture') fail("Cet exercice n'est pas clôturé.")
    const later = await db.one<{ label: string }>(`SELECT label FROM fiscal_years WHERE status = 'cloture' AND end_date > $1 LIMIT 1`, [y.end_date])
    if (later) fail(`L'exercice ${later.label}, postérieur, est clôturé : rouvrez-le d'abord.`)
    await db.query(`UPDATE fiscal_years SET status = 'ouvert', result = NULL, closed_by = NULL, closed_at = NULL, closing_entry_id = NULL WHERE id = $1`, [y.id])
    await db.query(`DELETE FROM journal_entries WHERE source = 'fiscal_close' AND source_id = $1`, [y.id])
    await audit(db, ctx, 'reouverture', 'exercice', y.id, `${y.label} : ${reason}`)
    return { id: y.id, label: y.label }
  })
}

/** Suppression d'un exercice ouvert sans écriture (erreur de saisie des dates). */
export async function deleteFiscalYear(ctx: Ctx, args: { id: number; auth?: GuardAuth }) {
  if (!can(ctx.user!.role, 'finance')) fail("La suppression d'un exercice demande le droit « Validation financière ».")
  await assertFiscalAuth(ctx, 'delete', (await mustYear(ctx.db, args?.id)).id, args.auth)
  return ctx.db.tx(async (db) => {
    const y = await mustYear(db, args?.id, true)
    if (y.status !== 'ouvert') fail('Un exercice clôturé ne se supprime pas.')
    const used = await db.one<{ n: number }>('SELECT COUNT(*)::int AS n FROM journal_entries WHERE date >= $1 AND date <= $2', [y.start_date, y.end_date])
    if (used?.n) fail(`Cet exercice contient ${used.n} écriture(s) : il ne peut pas être supprimé.`)
    await db.query('DELETE FROM fiscal_years WHERE id = $1', [y.id])
    await audit(db, ctx, 'suppression', 'exercice', y.id, y.label)
    return true
  })
}
