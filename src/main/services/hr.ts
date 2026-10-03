// Ressources humaines : salariés, paie mensuelle, congés.

import { computePayslip, DEFAULT_PAYROLL_PARAMS, workingDays, type PayrollParams, type PayVariables } from '@shared/payroll'
import { treasuryFor } from '@shared/domain'
import { formatMoney, formatNumber, todayISO } from '@shared/format'
import type { Db } from '../db'
import { postEntry, type EntryLine } from './accounting'
import { audit, fail, num, str, type Ctx } from './context'
import { getSettings } from './settings'

// ---------- Paramètres ----------

export async function getParams(db: Db): Promise<PayrollParams> {
  const row = await db.one<{ value: string }>("SELECT value FROM settings WHERE key = 'payroll_params'")
  return row ? { ...DEFAULT_PAYROLL_PARAMS, ...JSON.parse(row.value) } : DEFAULT_PAYROLL_PARAMS
}

export async function saveParams(ctx: Ctx, input: Partial<PayrollParams>) {
  const p = { ...(await getParams(ctx.db)), ...input }
  for (const k of ['cnss_employee_rate', 'cnss_employer_rate', 'cnss_employer_family', 'cnss_employer_risk', 'cnss_employer_pension', 'tpa_rate', 'abatement_cadre', 'abatement_non_cadre'] as const) {
    p[k] = num(p[k])
    if (p[k] < 0 || p[k] > 100) fail('Un taux doit être compris entre 0 et 100 %.')
  }
  if (!Array.isArray(p.iuts_brackets) || p.iuts_brackets.length === 0) fail("Le barème IUTS doit comporter au moins une tranche.")
  p.cnss_employer_rate = p.cnss_employer_family + p.cnss_employer_risk + p.cnss_employer_pension
  p.contributions = (Array.isArray(p.contributions) ? p.contributions : []).map((c: any, i: number) => {
    const out = {
      code: str(c.code) || `COT${i + 1}`, label: str(c.label), base: (['gross', 'cnss_base', 'base_salary'].includes(c.base) ? c.base : 'gross') as 'gross' | 'cnss_base' | 'base_salary',
      employee_rate: num(c.employee_rate), employer_rate: num(c.employer_rate), ceiling: Math.max(0, num(c.ceiling)), deductible: !!c.deductible, account: str(c.account) || '438', active: c.active !== false
    }
    if (!out.label) fail('Chaque cotisation doit avoir un libellé.')
    if ([out.employee_rate, out.employer_rate].some((x) => x < 0 || x > 100)) fail(`Taux invalide pour « ${out.label} ».`)
    return out
  })
  for (const c of p.contributions) if (!(await ctx.db.one('SELECT 1 FROM accounts WHERE number = $1', [c.account]))) fail(`Compte ${c.account} (${c.label}) inconnu du plan comptable.`)
  p.iuts_brackets = p.iuts_brackets.map((b, i, all) => ({ upTo: i === all.length - 1 ? null : num(b.upTo), rate: num(b.rate) }))
  await ctx.db.query(
    "INSERT INTO settings (key, value) VALUES ('payroll_params', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [JSON.stringify(p)]
  )
  await audit(ctx.db, ctx, 'modification', 'parametres_paie', null)
  return p
}

// ---------- Salariés ----------

export async function listEmployees(ctx: Ctx, args: { search?: string; includeInactive?: boolean } = {}) {
  const search = `%${str(args.search).toLowerCase()}%`
  const params = await getParams(ctx.db)
  const rows = await ctx.db.query(
    `SELECT e.*,
            COALESCE((SELECT SUM(days) FROM leaves l WHERE l.employee_id = e.id AND l.status = 'approuve' AND l.kind = 'conge_paye'), 0) AS leave_taken
     FROM employees e
     WHERE ($1 OR e.active) AND (lower(e.first_name || ' ' || e.last_name) LIKE $2 OR lower(e.matricule) LIKE $2 OR lower(e.job) LIKE $2)
     ORDER BY e.last_name, e.first_name`,
    [!!args.includeInactive, search]
  )
  return rows.map((e) => ({ ...e, leave_balance: leaveBalance(e, params) }))
}

/** Solde de congés payés : jours acquis depuis l'embauche − jours pris (+ ajustement manuel). */
export function leaveBalance(e: { hire_date: string; exit_date?: string | null; leave_adjust: number; leave_taken: number }, p: PayrollParams, at = todayISO()): number {
  const end = e.exit_date && e.exit_date < at ? e.exit_date : at
  const [y1, m1] = e.hire_date.split('-').map(Number)
  const [y2, m2] = end.split('-').map(Number)
  const months = Math.max(0, (y2 - y1) * 12 + (m2 - m1))
  return Math.round((months * p.leave_days_per_month + num(e.leave_adjust) - num(e.leave_taken)) * 10) / 10
}

export async function saveEmployee(ctx: Ctx, input: any) {
  const first = str(input.first_name)
  const last = str(input.last_name)
  if (!first || !last) fail('Nom et prénom obligatoires.')
  const hire = str(input.hire_date)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hire)) fail("Date d'embauche invalide.")
  const base = num(input.base_salary)
  if (base <= 0) fail('Le salaire de base doit être positif.')
  const fields = [
    first, last, str(input.job), str(input.department), input.category === 'cadre' ? 'cadre' : 'non_cadre', hire, str(input.exit_date) || null,
    base, num(input.housing), num(input.transport), num(input.function_allowance), num(input.other_allowances),
    Math.max(0, Math.round(num(input.family_charges))), str(input.cnss_number), str(input.payment_method) || 'Virement',
    str(input.bank_account), str(input.phone), str(input.email), num(input.leave_adjust), input.active ?? true
  ]
  if (input.id) {
    await ctx.db.query(
      `UPDATE employees SET first_name=$1, last_name=$2, job=$3, department=$4, category=$5, hire_date=$6, exit_date=$7, base_salary=$8,
       housing=$9, transport=$10, function_allowance=$11, other_allowances=$12, family_charges=$13, cnss_number=$14, payment_method=$15,
       bank_account=$16, phone=$17, email=$18, leave_adjust=$19, active=$20 WHERE id=$21`,
      [...fields, input.id]
    )
    await audit(ctx.db, ctx, 'modification', 'salarie', input.id, `${first} ${last}`)
    return { id: input.id }
  }
  const n = await ctx.db.one<{ n: number }>("SELECT COALESCE(MAX(NULLIF(regexp_replace(matricule, '\\D', '', 'g'), '')::int), 0)::int + 1 AS n FROM employees")
  const matricule = str(input.matricule) || `MAT-${String(n!.n).padStart(4, '0')}`
  if (await ctx.db.one('SELECT 1 FROM employees WHERE matricule = $1', [matricule])) fail('Ce matricule existe déjà.')
  const row = await ctx.db.one<{ id: number }>(
    `INSERT INTO employees (first_name, last_name, job, department, category, hire_date, exit_date, base_salary, housing, transport,
     function_allowance, other_allowances, family_charges, cnss_number, payment_method, bank_account, phone, email, leave_adjust, active, matricule)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id`,
    [...fields, matricule]
  )
  await audit(ctx.db, ctx, 'creation', 'salarie', row!.id, `${first} ${last}`)
  return row!
}

// ---------- Paie ----------

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/

async function recompute(db: Db, runId: number) {
  const t = await db.one(
    'SELECT COALESCE(SUM(gross), 0) AS gross, COALESCE(SUM(net), 0) AS net, COALESCE(SUM(gross + cnss_employer), 0) AS cost FROM payslips WHERE run_id = $1',
    [runId]
  )
  const tpa = await db.query<{ detail: string }>('SELECT detail FROM payslips WHERE run_id = $1', [runId])
  const tpaTotal = tpa.reduce((s, x) => s + (JSON.parse(x.detail).tpa ?? 0), 0)
  await db.query('UPDATE payroll_runs SET gross = $1, net = $2, employer_cost = $3 WHERE id = $4', [t.gross, t.net, t.cost + tpaTotal, runId])
}

async function computeFor(db: Db, runId: number, employeeId: number, variables: PayVariables, params: PayrollParams) {
  const e = await db.one('SELECT * FROM employees WHERE id = $1', [employeeId])
  if (!e) fail('Salarié introuvable.')
  const slip = computePayslip(e, params, variables)
  const detail = JSON.stringify({ ...slip, variables, employee: { matricule: e.matricule, name: `${e.first_name} ${e.last_name}`, job: e.job, category: e.category, cnss_number: e.cnss_number, family_charges: e.family_charges, payment_method: e.payment_method, bank_account: e.bank_account } })
  await db.query(
    `INSERT INTO payslips (run_id, employee_id, detail, gross, taxable, cnss_employee, iuts, other_deductions, net, cnss_employer)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (run_id, employee_id) DO UPDATE SET detail = EXCLUDED.detail, gross = EXCLUDED.gross, taxable = EXCLUDED.taxable,
       cnss_employee = EXCLUDED.cnss_employee, iuts = EXCLUDED.iuts, other_deductions = EXCLUDED.other_deductions, net = EXCLUDED.net,
       cnss_employer = EXCLUDED.cnss_employer`,
    [runId, employeeId, detail, slip.gross, slip.taxable, slip.cnssEmployee, slip.iuts, slip.otherDeductions, slip.net, slip.cnssEmployer]
  )
}

/** Crée (ou recalcule) la paie d'un mois pour tous les salariés actifs. */
export async function prepareRun(ctx: Ctx, input: { period: string }) {
  const period = str(input.period)
  if (!PERIOD_RE.test(period)) fail('Période invalide (AAAA-MM).')
  return ctx.db.tx(async (db) => {
    let run = await db.one('SELECT * FROM payroll_runs WHERE period = $1 FOR UPDATE', [period])
    if (run?.status === 'valide') fail('Cette paie est déjà validée.')
    if (!run) run = await db.one('INSERT INTO payroll_runs (period) VALUES ($1) RETURNING *', [period])
    const params = await getParams(db)
    const end = `${period}-31`
    const employees = await db.query<{ id: number }>(
      `SELECT id FROM employees WHERE active AND hire_date <= $1 AND (exit_date IS NULL OR exit_date >= $2) ORDER BY id`,
      [end, `${period}-01`]
    )
    for (const e of employees) {
      const existing = await db.one<{ detail: string }>('SELECT detail FROM payslips WHERE run_id = $1 AND employee_id = $2', [run.id, e.id])
      const variables = existing ? JSON.parse(existing.detail).variables ?? {} : {}
      await computeFor(db, run.id, e.id, variables, params)
    }
    await recompute(db, run.id)
    await audit(db, ctx, 'preparation', 'paie', run.id, period)
    return { id: run.id as number }
  })
}

export async function setVariables(ctx: Ctx, input: { runId: number; employeeId: number; variables: PayVariables }) {
  return ctx.db.tx(async (db) => {
    const run = await db.one('SELECT status FROM payroll_runs WHERE id = $1 FOR UPDATE', [input.runId])
    if (!run) fail('Paie introuvable.')
    if (run.status !== 'brouillon') fail('Une paie validée ne peut plus être modifiée.')
    const v = input.variables ?? {}
    const variables: PayVariables = {
      bonus: num(v.bonus), overtime: num(v.overtime), absence_days: num(v.absence_days), advance: num(v.advance), other_deductions: num(v.other_deductions)
    }
    if (Object.values(variables).some((x) => (x ?? 0) < 0)) fail('Les montants variables doivent être positifs.')
    await computeFor(db, input.runId, input.employeeId, variables, await getParams(db))
    await recompute(db, input.runId)
    return true
  })
}

export async function listRuns(ctx: Ctx) {
  return ctx.db.query(
    `SELECT r.*, (SELECT COUNT(*)::int FROM payslips WHERE run_id = r.id) AS employees,
            EXISTS (SELECT 1 FROM journal_entries WHERE source = 'paie_reglement' AND source_id = r.id) AS paid
     FROM payroll_runs r ORDER BY r.period DESC`
  )
}

export async function getRun(ctx: Ctx, args: { id: number }) {
  const run = await ctx.db.one(
    `SELECT r.*, EXISTS (SELECT 1 FROM journal_entries WHERE source = 'paie_reglement' AND source_id = r.id) AS paid FROM payroll_runs r WHERE r.id = $1`,
    [args.id]
  )
  if (!run) fail('Paie introuvable.')
  const slips = await ctx.db.query(
    `SELECT p.*, e.matricule, e.first_name, e.last_name, e.job FROM payslips p JOIN employees e ON e.id = p.employee_id
     WHERE p.run_id = $1 ORDER BY e.last_name, e.first_name`,
    [args.id]
  )
  return { ...run, payslips: slips.map((s) => ({ ...s, detail: JSON.parse(s.detail) })) }
}

export async function deleteRun(ctx: Ctx, args: { id: number }) {
  const run = await ctx.db.one('SELECT status, period FROM payroll_runs WHERE id = $1', [args.id])
  if (!run) fail('Paie introuvable.')
  if (run.status !== 'brouillon') fail('Une paie validée ne peut pas être supprimée.')
  await ctx.db.query('DELETE FROM payroll_runs WHERE id = $1', [args.id])
  await audit(ctx.db, ctx, 'suppression', 'paie', args.id, run.period)
  return true
}

/** Validation : fige les bulletins et passe l'écriture de paie (journal OD). */
export async function validateRun(ctx: Ctx, args: { id: number }) {
  return ctx.db.tx(async (db) => {
    const run = await db.one('SELECT * FROM payroll_runs WHERE id = $1 FOR UPDATE', [args.id])
    if (!run) fail('Paie introuvable.')
    if (run.status !== 'brouillon') fail('Paie déjà validée.')
    const slips = await db.query<{ detail: string }>('SELECT detail FROM payslips WHERE run_id = $1', [args.id])
    if (slips.length === 0) fail('Aucun bulletin dans cette paie.')
    let salaries = 0, allowances = 0, cnssE = 0, cnssR = 0, iuts = 0, tpa = 0, advances = 0, others = 0, net = 0
    const contrib = new Map<string, { label: string; amount: number }>()
    let contribEmployer = 0
    for (const s of slips) {
      const d = JSON.parse(s.detail)
      const allowance = d.lines.filter((l: any) => /Indemnité|Autres indemnités/.test(l.label)).reduce((x: number, l: any) => x + (l.gain ?? 0), 0)
      allowances += allowance
      salaries += d.gross - allowance
      cnssE += d.cnssEmployee
      cnssR += d.cnssEmployer
      iuts += d.iuts
      tpa += d.tpa ?? 0
      for (const c of d.contributions ?? []) {
        const g = contrib.get(c.account) ?? { label: c.label, amount: 0 }
        g.amount += c.employee + c.employer
        contrib.set(c.account, g)
        contribEmployer += c.employer
      }
      advances += d.variables?.advance ?? 0
      others += d.variables?.other_deductions ?? 0
      net += d.net
    }
    const lines: EntryLine[] = [
      { account: '661', label: 'Salaires bruts', debit: salaries },
      { account: '663', label: 'Indemnités', debit: allowances },
      { account: '664', label: 'Charges sociales patronales', debit: cnssR + contribEmployer },
      { account: '641', label: "Taxe patronale d'apprentissage", debit: tpa },
      { account: '431', label: 'CNSS (parts salariale et patronale)', credit: cnssE + cnssR },
      { account: '447', label: 'IUTS retenu' + (tpa ? ' et taxe patronale' : ''), credit: iuts + tpa },
      ...[...contrib.entries()].map(([account, g]) => ({ account, label: g.label, credit: g.amount })),
      { account: '421', label: 'Avances récupérées', credit: advances },
      { account: '423', label: 'Autres retenues', credit: others },
      { account: '422', label: 'Salaires nets à payer', credit: net }
    ]
    await postEntry(db, ctx, { journal: 'OD', date: `${run.period}-28`, label: `Paie ${run.period}`, source: 'paie', source_id: run.id, lines })
    await db.query("UPDATE payroll_runs SET status = 'valide', validated_at = now() WHERE id = $1", [run.id])
    await audit(db, ctx, 'validation', 'paie', run.id, run.period)
    return true
  })
}

/** Paiement des salaires nets : 422 contre trésorerie. */
export async function payRun(ctx: Ctx, args: { id: number; method: string; date?: string }) {
  return ctx.db.tx(async (db) => {
    const run = await db.one('SELECT * FROM payroll_runs WHERE id = $1 FOR UPDATE', [args.id])
    if (!run || run.status !== 'valide') fail('Validez la paie avant de la payer.')
    if (await db.one("SELECT 1 FROM journal_entries WHERE source = 'paie_reglement' AND source_id = $1", [run.id])) fail('Ces salaires sont déjà payés.')
    const t = treasuryFor(str(args.method) || 'Virement')
    await postEntry(db, ctx, {
      journal: t.journal, date: str(args.date) || todayISO(), label: `Paiement des salaires ${run.period}`, source: 'paie_reglement', source_id: run.id,
      lines: [{ account: '422', debit: run.net }, { account: t.account, credit: run.net }]
    })
    await audit(db, ctx, 'paiement', 'paie', run.id, run.period)
    return true
  })
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
export const periodLabel = (p: string) => `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`

/** Bulletins de paie imprimables (un par page). */
export async function payslipsHtml(ctx: Ctx, args: { runId: number; employeeId?: number }) {
  const run = await getRun(ctx, { id: args.runId })
  const company = await getSettings(ctx.db)
  const color = company.doc_color || '#1d6fd6'
  const n = (v?: number) => (v ? formatNumber(v) : '')
  const slips = run.payslips.filter((s: any) => !args.employeeId || s.employee_id === args.employeeId)
  const pages = slips.map((s: any) => {
    const d = s.detail
    return `<section class="slip">
      <div class="head">
        <div>${company.logo ? `<img src="${company.logo}" class="logo">` : ''}<div class="co">${esc(company.name)}</div>
          <div class="muted">${esc(company.address)} ${esc(company.city)}<br>${company.tax_id ? `${esc(company.tax_id_label)} ${esc(company.tax_id)}` : ''}${company.rccm ? ` · RCCM ${esc(company.rccm)}` : ''}</div></div>
        <div class="title"><h1>Bulletin de paie</h1><div>Période : <strong>${esc(periodLabel(run.period))}</strong></div>${run.status === 'brouillon' ? '<div class="draft">PROVISOIRE</div>' : ''}</div>
      </div>
      <table class="emp"><tr><td>Salarié</td><td><strong>${esc(d.employee.name)}</strong> (${esc(d.employee.matricule)})</td><td>Emploi</td><td>${esc(d.employee.job)}</td></tr>
        <tr><td>Catégorie</td><td>${d.employee.category === 'cadre' ? 'Cadre' : 'Non-cadre'}</td><td>N° CNSS</td><td>${esc(d.employee.cnss_number)}</td></tr>
        <tr><td>Charges de famille</td><td>${d.employee.family_charges}</td><td>Paiement</td><td>${esc(d.employee.payment_method)} ${esc(d.employee.bank_account)}</td></tr></table>
      <table class="lines"><thead><tr><th>Rubrique</th><th>Base</th><th>Taux</th><th>Gains</th><th>Retenues</th><th>Part patronale</th></tr></thead><tbody>
        ${d.lines.map((l: any) => `<tr><td>${esc(l.label)}</td><td>${n(l.base)}</td><td>${l.rate ? formatNumber(l.rate, 1) + ' %' : ''}</td><td>${n(l.gain)}</td><td>${n(l.deduction)}</td><td>${n(l.employer)}</td></tr>`).join('')}
      </tbody><tfoot><tr><td>Totaux</td><td></td><td></td><td>${formatNumber(d.gross)}</td><td>${formatNumber(d.cnssEmployee + d.iuts + d.otherDeductions)}</td><td>${formatNumber(d.cnssEmployer + (d.tpa ?? 0))}</td></tr></tfoot></table>
      <div class="net"><span>Net à payer</span><strong>${formatMoney(d.net, company.currency)}</strong></div>
      <p class="muted small">Base imposable IUTS : ${formatNumber(d.taxable)} · Coût total employeur : ${formatMoney(d.employerCost, company.currency)}</p>
      <div class="sign"><div>L'employeur</div><div>Le salarié</div></div>
    </section>`
  })
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Bulletins ${esc(run.period)}</title><style>
    @page { size: A4; margin: 14mm; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 9.5pt; color: #1f2933; margin: 0; }
    .slip { page-break-after: always; } .slip:last-child { page-break-after: auto; }
    .head { display: flex; justify-content: space-between; border-top: 5px solid ${color}; padding-top: 10px; }
    .logo { max-height: 50px; } .co { font-size: 14pt; font-weight: 700; color: ${color}; }
    .title { text-align: right; } h1 { margin: 0; color: ${color}; font-size: 17pt; text-transform: uppercase; }
    .draft { color: #b8321f; font-weight: 800; margin-top: 4px; }
    .muted { color: #5f6b7a; font-size: 8.5pt; } .small { font-size: 8pt; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    .emp td { padding: 4px 6px; border: 1px solid #e1e6ee; } .emp td:nth-child(odd) { color: #5f6b7a; width: 16%; }
    .lines th { background: ${color}; color: #fff; padding: 6px; text-align: left; font-size: 8.5pt; }
    .lines td { padding: 5px 6px; border-bottom: 1px solid #e8ecf1; }
    .lines td:nth-child(n+2), .lines th:nth-child(n+2) { text-align: right; }
    .lines tfoot td { font-weight: 700; border-top: 2px solid #c9d1dd; }
    .net { display: flex; justify-content: space-between; margin-top: 12px; padding: 10px 14px; background: ${color}; color: #fff; font-size: 13pt; border-radius: 6px; }
    .sign { display: flex; justify-content: space-between; margin-top: 26px; } .sign div { width: 40%; border-top: 1px solid #9aa5b1; padding-top: 4px; color: #5f6b7a; height: 60px; }
  </style></head><body>${pages.join('') || '<p>Aucun bulletin.</p>'}</body></html>`
}

/** Déclaration CNSS et IUTS du mois (lignes pour export). */
export async function declaration(ctx: Ctx, args: { runId: number }) {
  const run = await getRun(ctx, { id: args.runId })
  const rows = run.payslips.map((s: any) => ({
    matricule: s.matricule, name: `${s.last_name} ${s.first_name}`, cnss_number: s.detail.employee.cnss_number, gross: s.gross,
    cnss_base: s.detail.cnssBase, cnss_employee: s.cnss_employee, cnss_employer: s.cnss_employer, taxable: s.taxable, iuts: s.iuts, net: s.net
  }))
  const total = (k: string) => rows.reduce((t: number, r: any) => t + r[k], 0)
  return {
    period: run.period, rows,
    totals: { gross: total('gross'), cnss_base: total('cnss_base'), cnss_employee: total('cnss_employee'), cnss_employer: total('cnss_employer'), taxable: total('taxable'), iuts: total('iuts'), net: total('net') }
  }
}

// ---------- Congés ----------

export async function listLeaves(ctx: Ctx, args: { status?: string; employeeId?: number } = {}) {
  return ctx.db.query(
    `SELECT l.*, e.first_name, e.last_name, e.matricule, u.full_name AS decided_by_name
     FROM leaves l JOIN employees e ON e.id = l.employee_id LEFT JOIN users u ON u.id = l.decided_by
     WHERE ($1 = '' OR l.status = $1) AND ($2::int IS NULL OR l.employee_id = $2)
     ORDER BY l.start_date DESC LIMIT 500`,
    [str(args.status), args.employeeId ?? null]
  )
}

export async function saveLeave(ctx: Ctx, input: { id?: number; employee_id: number; kind: string; start_date: string; end_date: string; note?: string }) {
  const start = str(input.start_date)
  const end = str(input.end_date)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) fail('Dates de congé invalides.')
  if (!['conge_paye', 'maladie', 'sans_solde', 'autre'].includes(input.kind)) fail('Type de congé inconnu.')
  const days = workingDays(start, end)
  if (days <= 0) fail('Aucun jour ouvrable sur cette période.')
  const overlap = await ctx.db.one(
    `SELECT 1 FROM leaves WHERE employee_id = $1 AND status <> 'refuse' AND start_date <= $3 AND end_date >= $2 AND ($4::int IS NULL OR id <> $4)`,
    [input.employee_id, start, end, input.id ?? null]
  )
  if (overlap) fail('Ce salarié a déjà une absence sur cette période.')
  if (input.id) {
    const l = await ctx.db.one('SELECT status FROM leaves WHERE id = $1', [input.id])
    if (l?.status !== 'demande') fail('Seule une demande en attente peut être modifiée.')
    await ctx.db.query('UPDATE leaves SET kind=$1, start_date=$2, end_date=$3, days=$4, note=$5 WHERE id=$6', [input.kind, start, end, days, str(input.note), input.id])
    return { id: input.id }
  }
  const row = await ctx.db.one<{ id: number }>(
    'INSERT INTO leaves (employee_id, kind, start_date, end_date, days, note) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [input.employee_id, input.kind, start, end, days, str(input.note)]
  )
  await audit(ctx.db, ctx, 'demande', 'conge', row!.id, `${days} j`)
  return row!
}

export async function decideLeave(ctx: Ctx, input: { id: number; approve: boolean }) {
  return ctx.db.tx(async (db) => {
    const l = await db.one('SELECT l.*, e.hire_date, e.exit_date, e.leave_adjust FROM leaves l JOIN employees e ON e.id = l.employee_id WHERE l.id = $1 FOR UPDATE', [input.id])
    if (!l) fail('Demande introuvable.')
    if (l.status !== 'demande') fail('Cette demande a déjà été traitée.')
    if (input.approve && l.kind === 'conge_paye') {
      const taken = await db.one<{ t: number }>("SELECT COALESCE(SUM(days), 0) AS t FROM leaves WHERE employee_id = $1 AND status = 'approuve' AND kind = 'conge_paye'", [l.employee_id])
      const balance = leaveBalance({ ...l, leave_taken: taken!.t }, await getParams(db), l.start_date)
      if (l.days > balance + 1e-9) fail(`Solde de congés insuffisant : ${formatNumber(balance, 1)} jour(s) disponible(s), ${l.days} demandé(s).`)
    }
    await db.query('UPDATE leaves SET status = $1, decided_by = $2 WHERE id = $3', [input.approve ? 'approuve' : 'refuse', ctx.user?.id ?? null, input.id])
    await audit(db, ctx, input.approve ? 'approbation' : 'refus', 'conge', input.id)
    return true
  })
}
