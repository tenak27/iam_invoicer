// Immobilisations : registre, plan d'amortissement linéaire (prorata temporis,
// année de 360 jours comme en pratique SYSCOHADA), dotations annuelles et cessions.

import { treasuryFor } from '@shared/domain'
import { todayISO } from '@shared/format'
import type { Db } from '../db'
import { postEntry, type EntryLine } from './accounting'
import { audit, fail, num, str, type Ctx } from './context'

const round = (n: number) => Math.round(n)

/** Compte d'amortissement associé : 2444 → 2844, 245 → 2845, 231 → 2831, 213 → 2813. */
export function amortAccount(account: string): string {
  return '28' + account.slice(1, 3)
}

/** Jours (base 360) entre deux dates, convention « 30 jours par mois ». */
function days360(from: string, to: string): number {
  const [y1, m1, d1] = from.split('-').map(Number)
  const [y2, m2, d2] = to.split('-').map(Number)
  return (y2 - y1) * 360 + (m2 - m1) * 30 + (Math.min(d2, 30) - Math.min(d1, 30)) + 1
}

export interface ScheduleRow {
  year: number
  base: number
  dotation: number
  cumulated: number
  net: number
}

/** Plan d'amortissement linéaire : première année au prorata de la date d'acquisition. */
export function schedule(a: { acquisition_date: string; value: number; residual: number; duration_years: number; disposal_date?: string | null }): ScheduleRow[] {
  const base = a.value - (a.residual || 0)
  const annual = base / a.duration_years
  const start = Number(a.acquisition_date.slice(0, 4))
  const rows: ScheduleRow[] = []
  let cumulated = 0
  for (let year = start; cumulated < base - 0.5 && year < start + a.duration_years + 2; year++) {
    let dot = annual
    if (year === start) dot = (annual * Math.min(days360(a.acquisition_date, `${year}-12-30`), 360)) / 360
    if (a.disposal_date && year === Number(a.disposal_date.slice(0, 4))) {
      const from = year === start ? a.acquisition_date : `${year}-01-01`
      dot = (annual * Math.min(days360(from, a.disposal_date), 360)) / 360
    }
    dot = Math.min(round(dot), round(base - cumulated))
    cumulated += dot
    rows.push({ year, base: round(base), dotation: dot, cumulated: round(cumulated), net: round(a.value - cumulated) })
    if (a.disposal_date && year >= Number(a.disposal_date.slice(0, 4))) break
  }
  return rows
}

export async function listAssets(ctx: Ctx, args: { search?: string; status?: string } = {}) {
  const search = `%${str(args.search).toLowerCase()}%`
  const year = Number(todayISO().slice(0, 4))
  const rows = await ctx.db.query(
    `SELECT a.*, ac.label AS account_label,
            COALESCE((SELECT SUM(amount) FROM asset_postings p WHERE p.asset_id = a.id), 0) AS posted
     FROM assets a JOIN accounts ac ON ac.number = a.account
     WHERE (lower(a.name) LIKE $1 OR lower(a.code) LIKE $1) AND ($2 = '' OR a.status = $2)
     ORDER BY a.acquisition_date DESC, a.id DESC`,
    [search, str(args.status)]
  )
  return rows.map((a) => {
    const plan = schedule(a)
    const upTo = plan.filter((r) => r.year <= year)
    const cumulated = upTo.at(-1)?.cumulated ?? 0
    return { ...a, schedule: plan, dotation_year: plan.find((r) => r.year === year)?.dotation ?? 0, cumulated, net_value: round(a.value - cumulated) }
  })
}

export async function saveAsset(ctx: Ctx, input: any) {
  const name = str(input.name)
  if (!name) fail('Désignation obligatoire.')
  const account = str(input.account)
  if (!/^2[1-4]/.test(account)) fail("Choisissez un compte d'immobilisation (classe 2).")
  if (!(await ctx.db.one('SELECT 1 FROM accounts WHERE number = $1', [account]))) fail(`Compte ${account} inconnu du plan comptable.`)
  const date = str(input.acquisition_date)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail("Date d'acquisition invalide.")
  const value = num(input.value)
  if (value <= 0) fail("Valeur d'acquisition invalide.")
  const duration = Math.round(num(input.duration_years))
  if (duration < 1 || duration > 50) fail('Durée d’amortissement entre 1 et 50 ans.')
  const residual = Math.max(0, num(input.residual))
  if (residual >= value) fail('La valeur résiduelle doit être inférieure à la valeur d’acquisition.')
  const fields = [name, account, date, value, residual, duration, str(input.supplier), str(input.location), str(input.notes)]
  if (input.id) {
    const posted = await ctx.db.one<{ n: number }>('SELECT COUNT(*)::int AS n FROM asset_postings WHERE asset_id = $1', [input.id])
    const old = await ctx.db.one('SELECT value, acquisition_date, duration_years, residual FROM assets WHERE id = $1', [input.id])
    if (posted!.n > 0 && (old.value !== value || old.acquisition_date !== date || old.duration_years !== duration || old.residual !== residual))
      fail('Des dotations ont déjà été comptabilisées : la valeur, la date et la durée ne peuvent plus changer.')
    await ctx.db.query(
      'UPDATE assets SET name=$1, account=$2, acquisition_date=$3, value=$4, residual=$5, duration_years=$6, supplier=$7, location=$8, notes=$9 WHERE id=$10',
      [...fields, input.id]
    )
    await audit(ctx.db, ctx, 'modification', 'immobilisation', input.id, name)
    return { id: input.id }
  }
  const n = await ctx.db.one<{ n: number }>("SELECT COALESCE(MAX(NULLIF(regexp_replace(code, '\\D', '', 'g'), '')::int), 0)::int + 1 AS n FROM assets")
  const code = str(input.code) || `IMMO-${String(n!.n).padStart(4, '0')}`
  return ctx.db.tx(async (db) => {
    const row = await db.one<{ id: number }>(
      'INSERT INTO assets (name, account, acquisition_date, value, residual, duration_years, supplier, location, notes, code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',
      [...fields, code]
    )
    // Acquisition à comptabiliser ici si la facture d'achat n'a pas déjà été passée en 24xx.
    const counterpart = str(input.post_acquisition)
    if (counterpart) {
      let credit = '481'
      let journal = 'OD'
      if (counterpart === '481') await ensureAccount(db, '481', "Fournisseurs d'investissements")
      else ({ account: credit, journal } = treasuryFor(counterpart))
      await postEntry(db, ctx, {
        journal, date, label: `Acquisition ${code} ${name}`, source: 'immobilisation', source_id: row!.id,
        lines: [{ account, debit: value }, { account: credit, credit: value }]
      })
    }
    await audit(db, ctx, 'creation', 'immobilisation', row!.id, name)
    return row!
  })
}

async function ensureAccount(db: Db, number: string, label: string) {
  await db.query('INSERT INTO accounts (number, label) VALUES ($1, $2) ON CONFLICT (number) DO NOTHING', [number, label])
}

/** Comptabilise les dotations d'un exercice (une seule fois par bien et par année). */
export async function postYear(ctx: Ctx, input: { year: number }) {
  const year = Math.round(num(input.year))
  if (year < 2000 || year > 2100) fail('Exercice invalide.')
  return ctx.db.tx(async (db) => {
    const assets = await db.query(
      "SELECT * FROM assets WHERE acquisition_date <= $1 AND (status = 'actif' OR disposal_date >= $2) ORDER BY id",
      [`${year}-12-31`, `${year}-01-01`]
    )
    const lines: EntryLine[] = []
    const todo: { id: number; amount: number }[] = []
    for (const a of assets) {
      if (await db.one('SELECT 1 FROM asset_postings WHERE asset_id = $1 AND year = $2', [a.id, year])) continue
      const row = schedule(a).find((r) => r.year === year)
      if (!row || row.dotation <= 0) continue
      const amort = amortAccount(a.account)
      await ensureAccount(db, amort, `Amortissements — compte ${a.account}`)
      lines.push({ account: amort, label: `${a.code} ${a.name}`, credit: row.dotation })
      todo.push({ id: a.id, amount: row.dotation })
    }
    if (todo.length === 0) fail(`Aucune dotation à comptabiliser pour ${year} : déjà fait ou aucun bien amortissable.`)
    const total = todo.reduce((s, t) => s + t.amount, 0)
    // Un exercice peut être complété plus tard (bien ajouté après coup) : écriture complémentaire.
    const first = !(await db.one("SELECT 1 FROM journal_entries WHERE source = 'amortissements' AND source_id = $1", [year]))
    const entryId = await postEntry(db, ctx, {
      journal: 'OD', date: `${year}-12-31`, label: `Dotations ${first ? 'aux amortissements' : 'complémentaires'} ${year}`,
      source: first ? 'amortissements' : null, source_id: first ? year : null,
      lines: [{ account: '681', debit: total }, ...lines]
    })
    for (const t of todo) await db.query('INSERT INTO asset_postings (asset_id, year, amount, entry_id) VALUES ($1,$2,$3,$4)', [t.id, year, t.amount, entryId])
    await audit(db, ctx, 'dotations', 'immobilisations', null, `${year} : ${total}`)
    return { count: todo.length, total }
  })
}

/** Cession ou mise au rebut : dotation complémentaire, sortie du bien, résultat de cession. */
export async function dispose(ctx: Ctx, input: { id: number; date: string; price?: number; method?: string; scrap?: boolean }) {
  const date = str(input.date)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('Date de cession invalide.')
  return ctx.db.tx(async (db) => {
    const a = await db.one('SELECT * FROM assets WHERE id = $1 FOR UPDATE', [input.id])
    if (!a) fail('Immobilisation introuvable.')
    if (a.status !== 'actif') fail('Ce bien est déjà sorti du patrimoine.')
    if (date < a.acquisition_date) fail("La cession ne peut pas précéder l'acquisition.")
    const year = Number(date.slice(0, 4))
    const plan = schedule({ ...a, disposal_date: date })
    const cumulated = plan.at(-1)?.cumulated ?? 0
    const posted = (await db.one<{ s: number }>('SELECT COALESCE(SUM(amount), 0) AS s FROM asset_postings WHERE asset_id = $1', [a.id]))!.s
    const amort = amortAccount(a.account)
    await ensureAccount(db, amort, `Amortissements — compte ${a.account}`)
    const complement = round(cumulated - posted)
    if (complement > 0) {
      const entryId = await postEntry(db, ctx, {
        journal: 'OD', date, label: `Dotation complémentaire ${a.code} (sortie)`,
        lines: [{ account: '681', debit: complement }, { account: amort, credit: complement }]
      })
      await db.query(
        'INSERT INTO asset_postings (asset_id, year, amount, entry_id) VALUES ($1,$2,$3,$4) ON CONFLICT (asset_id, year) DO UPDATE SET amount = asset_postings.amount + EXCLUDED.amount',
        [a.id, year, complement, entryId]
      )
    }
    const net = round(a.value - cumulated)
    const lines: EntryLine[] = [
      { account: amort, label: 'Amortissements cumulés', debit: cumulated },
      { account: '812', label: 'Valeur nette comptable', debit: net },
      { account: a.account, label: `Sortie ${a.code} ${a.name}`, credit: a.value }
    ]
    await postEntry(db, ctx, { journal: 'OD', date, label: `${input.scrap ? 'Mise au rebut' : 'Cession'} ${a.code} ${a.name}`, lines })
    const price = input.scrap ? 0 : Math.max(0, round(num(input.price)))
    if (price > 0) {
      const t = treasuryFor(str(input.method) || 'Virement')
      await postEntry(db, ctx, { journal: t.journal, date, label: `Prix de cession ${a.code}`, lines: [{ account: t.account, debit: price }, { account: '822', credit: price }] })
    }
    await db.query('UPDATE assets SET status = $1, disposal_date = $2, disposal_value = $3 WHERE id = $4', [input.scrap ? 'rebut' : 'cede', date, price, a.id])
    await audit(db, ctx, input.scrap ? 'rebut' : 'cession', 'immobilisation', a.id, `${price}`)
    return { net, price, result: price - net }
  })
}
