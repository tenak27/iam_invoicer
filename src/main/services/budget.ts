// Budgets (prévu / réalisé par compte et par mois) et trésorerie prévisionnelle.

import { addDays, todayISO } from '@shared/format'
import { audit, fail, num, str, type Ctx } from './context'

// ---------- Budgets ----------

export async function getBudget(ctx: Ctx, args: { year: number }) {
  const year = Math.round(num(args.year)) || Number(todayISO().slice(0, 4))
  const lines = await ctx.db.query<{ id: number; account: string; label: string; amounts: string }>(
    'SELECT * FROM budget_lines WHERE year = $1 ORDER BY account',
    [year]
  )
  // Réalisé mensuel par racine de compte : charges (6) au débit, produits (7) au crédit.
  const result = []
  for (const l of lines) {
    const actual = await ctx.db.query<{ m: number; amount: number }>(
      `SELECT EXTRACT(MONTH FROM e.date::date)::int AS m,
              SUM(CASE WHEN $2 LIKE '7%' THEN l.credit - l.debit ELSE l.debit - l.credit END) AS amount
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
       WHERE l.account LIKE $2 || '%' AND e.date LIKE $1 || '%' GROUP BY 1`,
      [String(year), l.account]
    )
    const planned: number[] = JSON.parse(l.amounts)
    const real = Array.from({ length: 12 }, (_, i) => Math.round(actual.find((a) => a.m === i + 1)?.amount ?? 0))
    result.push({ ...l, planned, actual: real, totalPlanned: planned.reduce((s, v) => s + v, 0), totalActual: real.reduce((s, v) => s + v, 0) })
  }
  return { year, lines: result }
}

export async function saveBudgetLine(ctx: Ctx, input: { id?: number; year: number; account: string; label?: string; amounts: number[] }) {
  const account = str(input.account)
  if (!/^[1-9]\d{0,7}$/.test(account)) fail('Compte ou racine de compte invalide (ex. 6, 60, 605, 701).')
  const acc = await ctx.db.one<{ label: string }>('SELECT label FROM accounts WHERE number = $1', [account])
  const label = str(input.label) || acc?.label || `Comptes ${account}…`
  if (!Array.isArray(input.amounts) || input.amounts.length !== 12) fail('Saisissez les 12 montants mensuels.')
  const amounts = input.amounts.map((v) => Math.round(num(v)))
  if (input.id) {
    await ctx.db.query('UPDATE budget_lines SET account = $1, label = $2, amounts = $3 WHERE id = $4', [account, label, JSON.stringify(amounts), input.id])
  } else {
    if (await ctx.db.one('SELECT 1 FROM budget_lines WHERE year = $1 AND account = $2', [input.year, account])) fail('Ce compte a déjà une ligne de budget pour cette année.')
    await ctx.db.query('INSERT INTO budget_lines (year, account, label, amounts) VALUES ($1,$2,$3,$4)', [input.year, account, label, JSON.stringify(amounts)])
  }
  await audit(ctx.db, ctx, 'modification', 'budget', null, `${input.year} ${account}`)
  return true
}

export async function deleteBudgetLine(ctx: Ctx, input: { id: number }) {
  await ctx.db.query('DELETE FROM budget_lines WHERE id = $1', [input.id])
  return true
}

/** Reprend le réalisé d'une année comme budget de l'année suivante (+ x %). */
export async function copyFromActual(ctx: Ctx, input: { fromYear: number; toYear: number; growth?: number }) {
  const factor = 1 + num(input.growth) / 100
  const rows = await ctx.db.query<{ account: string; label: string; m: number; amount: number }>(
    `SELECT l.account, a.label, EXTRACT(MONTH FROM e.date::date)::int AS m,
            SUM(CASE WHEN l.account LIKE '7%' THEN l.credit - l.debit ELSE l.debit - l.credit END) AS amount
     FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.number = l.account
     WHERE (l.account LIKE '6%' OR l.account LIKE '7%') AND e.date LIKE $1 || '%' GROUP BY 1, 2, 3`,
    [String(input.fromYear)]
  )
  const byAccount = new Map<string, { label: string; amounts: number[] }>()
  for (const r of rows) {
    const b = byAccount.get(r.account) ?? { label: r.label, amounts: Array(12).fill(0) }
    b.amounts[r.m - 1] = Math.round(r.amount * factor)
    byAccount.set(r.account, b)
  }
  let created = 0
  for (const [account, b] of byAccount) {
    if (await ctx.db.one('SELECT 1 FROM budget_lines WHERE year = $1 AND account = $2', [input.toYear, account])) continue
    await ctx.db.query('INSERT INTO budget_lines (year, account, label, amounts) VALUES ($1,$2,$3,$4)', [input.toYear, account, b.label, JSON.stringify(b.amounts)])
    created++
  }
  return { created }
}

// ---------- Trésorerie prévisionnelle ----------

export async function listForecasts(ctx: Ctx) {
  return ctx.db.query('SELECT * FROM cash_forecasts ORDER BY date')
}

export async function saveForecast(ctx: Ctx, input: { id?: number; date: string; label: string; amount: number; recurrence?: string; end_date?: string }) {
  const date = str(input.date)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('Date invalide.')
  const label = str(input.label)
  if (!label) fail('Libellé obligatoire.')
  const amount = Math.round(num(input.amount))
  if (amount === 0) fail('Montant nul.')
  const rec = input.recurrence === 'mensuelle' ? 'mensuelle' : 'aucune'
  if (input.id) await ctx.db.query('UPDATE cash_forecasts SET date=$1, label=$2, amount=$3, recurrence=$4, end_date=$5 WHERE id=$6', [date, label, amount, rec, str(input.end_date) || null, input.id])
  else await ctx.db.query('INSERT INTO cash_forecasts (date, label, amount, recurrence, end_date) VALUES ($1,$2,$3,$4,$5)', [date, label, amount, rec, str(input.end_date) || null])
  return true
}

export async function deleteForecast(ctx: Ctx, input: { id: number }) {
  await ctx.db.query('DELETE FROM cash_forecasts WHERE id = $1', [input.id])
  return true
}

/**
 * Projection sur N semaines : solde actuel (banque 52, mobile money 55, caisse 57)
 * + encaissements attendus (factures clients non soldées, à leur échéance)
 * − décaissements attendus (factures fournisseurs non soldées)
 * ± prévisions saisies (ponctuelles ou mensuelles) − masse salariale estimée.
 */
export async function forecast(ctx: Ctx, args: { weeks?: number; includePayroll?: boolean } = {}) {
  const weeks = Math.min(Math.max(Math.round(num(args.weeks)) || 13, 4), 52)
  const today = todayISO()
  const horizon = addDays(today, weeks * 7 - 1)
  const start = await ctx.db.one<{ s: number }>(
    "SELECT COALESCE(SUM(debit - credit), 0) AS s FROM journal_lines WHERE account LIKE '52%' OR account LIKE '55%' OR account LIKE '57%'"
  )
  const open = (type: string) =>
    ctx.db.query<{ id: number; number: string; due: string; remaining: number; party_name: string }>(
      `SELECT d.id, d.number, COALESCE(d.due_date, d.date) AS due, p.name AS party_name,
              d.total_ttc - COALESCE((SELECT SUM(amount) FROM payments WHERE document_id = d.id), 0) AS remaining
       FROM documents d JOIN parties p ON p.id = d.party_id
       WHERE d.type = $1 AND d.status = 'valide' AND d.total_ttc > COALESCE((SELECT SUM(amount) FROM payments WHERE document_id = d.id), 0) + 0.5`,
      [type]
    )
  const [receivables, payables, manual] = await Promise.all([open('FAC'), open('FF'), listForecasts(ctx)])
  const events: { date: string; label: string; amount: number; kind: string }[] = []
  for (const r of receivables) events.push({ date: r.due < today ? today : r.due, label: `${r.number} ${r.party_name}${r.due < today ? ' (en retard)' : ''}`, amount: r.remaining, kind: 'client' })
  for (const p of payables) events.push({ date: p.due < today ? today : p.due, label: `${p.number} ${p.party_name}`, amount: -p.remaining, kind: 'fournisseur' })
  for (const f of manual) {
    if (f.recurrence === 'mensuelle') {
      for (let d = f.date; d <= horizon && (!f.end_date || d <= f.end_date); ) {
        if (d >= today) events.push({ date: d, label: f.label, amount: f.amount, kind: 'prevision' })
        const [y, m, day] = d.split('-').map(Number)
        const next = new Date(y, m, Math.min(day, 28))
        d = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`
      }
    } else if (f.date >= today && f.date <= horizon) events.push({ date: f.date, label: f.label, amount: f.amount, kind: 'prevision' })
  }
  if (args.includePayroll !== false) {
    const last = await ctx.db.one<{ net: number; employer_cost: number; gross: number }>("SELECT net, employer_cost, gross FROM payroll_runs WHERE status = 'valide' ORDER BY period DESC LIMIT 1")
    if (last) {
      // Salaires nets en fin de mois, charges sociales et IUTS le 15 du mois suivant (estimation).
      for (let i = 0; i <= Math.ceil(weeks / 4) + 1; i++) {
        const base = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 + i, 1)
        const ym = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}`
        const endMonth = `${ym}-28`
        if (endMonth >= today && endMonth <= horizon) events.push({ date: endMonth, label: 'Salaires nets (estimation)', amount: -last.net, kind: 'paie' })
        const charges = last.employer_cost - last.net
        const due = `${ym}-15`
        if (due >= today && due <= horizon && i > 0) events.push({ date: due, label: 'CNSS et IUTS (estimation)', amount: -charges, kind: 'paie' })
      }
    }
  }
  events.sort((a, b) => a.date.localeCompare(b.date))
  const series = []
  let balance = start!.s
  for (let w = 0; w < weeks; w++) {
    const from = addDays(today, w * 7)
    const to = addDays(today, w * 7 + 6)
    const inWeek = events.filter((e) => e.date >= from && e.date <= to)
    const inflow = inWeek.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0)
    const outflow = inWeek.filter((e) => e.amount < 0).reduce((s, e) => s - e.amount, 0)
    balance += inflow - outflow
    series.push({ week: w + 1, from, to, inflow: Math.round(inflow), outflow: Math.round(outflow), balance: Math.round(balance) })
  }
  return {
    start: Math.round(start!.s),
    series,
    events: events.filter((e) => e.date <= horizon),
    lowest: series.reduce((m, s) => (s.balance < m.balance ? s : m), series[0])
  }
}
