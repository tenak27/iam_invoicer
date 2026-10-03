// États financiers et déclarations :
//  - bilan SYSCOHADA (présentation simplifiée par rubriques) à une date ;
//  - déclarations du mois : TVA, retenues à la source, salaires (CNSS / IUTS).
// Les montants viennent des écritures (bilan) ou des pièces validées (TVA,
// retenues), qui sont la source des écritures automatiques.

import type { AppliedTax } from '@shared/taxes'
import { fail, type Ctx } from './context'

const round = (n: number) => Math.round(n)
const str = (v: unknown) => String(v ?? '').trim()

type Line = { number: string; label: string; amount: number }
export interface Section { code: string; label: string; lines: Line[]; total: number }

/** Comptes de charges et de produits (classes 6, 7 et 8 HAO). */
export function isCharge(n: string) {
  return n.startsWith('6') || /^8[13579]/.test(n)
}
export function isProduct(n: string) {
  return n.startsWith('7') || /^8[2468]/.test(n)
}

/** Bilan à une date : soldes cumulés de toutes les écritures jusqu'à cette date. */
export async function balanceSheet(ctx: Ctx, args: { to?: string } = {}) {
  const to = str(args.to)
  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) fail('Date invalide.')
  const rows = await ctx.db.query<{ number: string; label: string; balance: number }>(
    `SELECT a.number, a.label, SUM(l.debit - l.credit) AS balance
     FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.number = l.account
     WHERE ($1 = '' OR e.date <= $1)
     GROUP BY a.number, a.label HAVING ABS(SUM(l.debit - l.credit)) >= 0.5
     ORDER BY a.number`,
    [to]
  )
  // Résultat : produits − charges (classes 6, 7, 8) non encore affectés.
  const result = round(rows.filter((r) => isProduct(r.number) || isCharge(r.number)).reduce((s, r) => s - r.balance, 0))

  const actif: Section[] = [
    { code: 'AI', label: 'Actif immobilisé', lines: [], total: 0 },
    { code: 'AS', label: 'Stocks et encours', lines: [], total: 0 },
    { code: 'AC', label: 'Créances et emplois assimilés', lines: [], total: 0 },
    { code: 'AT', label: 'Trésorerie – actif', lines: [], total: 0 }
  ]
  const passif: Section[] = [
    { code: 'CP', label: 'Capitaux propres et ressources assimilées', lines: [], total: 0 },
    { code: 'DF', label: 'Dettes financières et ressources assimilées', lines: [], total: 0 },
    { code: 'PC', label: 'Passif circulant', lines: [], total: 0 },
    { code: 'PT', label: 'Trésorerie – passif', lines: [], total: 0 }
  ]
  const add = (sections: Section[], code: string, r: { number: string; label: string }, amount: number) => {
    sections.find((s) => s.code === code)!.lines.push({ number: r.number, label: r.label, amount: round(amount) })
  }
  for (const r of rows) {
    const n = r.number
    const b = r.balance
    if (isCharge(n) || isProduct(n)) continue
    if (n.startsWith('1')) {
      // Capitaux propres (10 à 15) ; emprunts et dettes assimilées (16 à 19)
      add(passif, /^1[6-9]/.test(n) ? 'DF' : 'CP', r, -b)
    } else if (n.startsWith('2')) {
      // Immobilisations, amortissements (28) et dépréciations (29) en moins
      add(actif, 'AI', r, b)
    } else if (n.startsWith('3')) {
      add(actif, 'AS', r, b)
    } else if (n.startsWith('4')) {
      // Tiers : débiteur à l'actif, créditeur au passif
      if (b > 0) add(actif, 'AC', r, b)
      else add(passif, 'PC', r, -b)
    } else if (n.startsWith('5')) {
      if (b > 0) add(actif, 'AT', r, b)
      else add(passif, 'PT', r, -b)
    }
  }
  if (result !== 0) passif[0].lines.push({ number: '13', label: result >= 0 ? 'Résultat net : bénéfice' : 'Résultat net : perte', amount: result })
  for (const s of [...actif, ...passif]) s.total = s.lines.reduce((t, l) => t + l.amount, 0)
  const totalActif = actif.reduce((t, s) => t + s.total, 0)
  const totalPassif = passif.reduce((t, s) => t + s.total, 0)
  return { to, actif, passif, totalActif, totalPassif, result, balanced: Math.abs(totalActif - totalPassif) < 1 }
}

/** Déclarations d'un mois (AAAA-MM) : TVA, retenues à la source, salaires. */
export async function monthlyDeclarations(ctx: Ctx, args: { month: string }) {
  const month = str(args.month)
  if (!/^\d{4}-\d{2}$/.test(month)) fail('Mois invalide (AAAA-MM).')
  const from = `${month}-01`
  const to = `${month}-31`

  // TVA collectée par taux (factures moins avoirs) et TVA déductible (factures fournisseurs)
  const collected = await ctx.db.query<{ rate: number; base: number; tva: number }>(
    `SELECT l.tva_rate AS rate,
            SUM(CASE WHEN d.type = 'AV' THEN -l.total_ht ELSE l.total_ht END) AS base,
            SUM(CASE WHEN d.type = 'AV' THEN -l.total_ht ELSE l.total_ht END * l.tva_rate / 100) AS tva
     FROM document_lines l JOIN documents d ON d.id = l.document_id
     WHERE d.status = 'valide' AND d.type IN ('FAC','AV') AND d.date BETWEEN $1 AND $2
     GROUP BY l.tva_rate ORDER BY l.tva_rate DESC`,
    [from, to]
  )
  const totals = await ctx.db.one<{ collected: number; deductible: number; purchases_ht: number }>(
    `SELECT COALESCE(SUM(CASE WHEN type = 'FAC' THEN total_tva WHEN type = 'AV' THEN -total_tva ELSE 0 END), 0) AS collected,
            COALESCE(SUM(CASE WHEN type = 'FF' THEN total_tva ELSE 0 END), 0) AS deductible,
            COALESCE(SUM(CASE WHEN type = 'FF' THEN total_ht ELSE 0 END), 0) AS purchases_ht
     FROM documents WHERE status = 'valide' AND type IN ('FAC','AV','FF') AND date BETWEEN $1 AND $2`,
    [from, to]
  )

  // Retenues à la source : subies (sur nos factures) et opérées (sur les factures fournisseurs)
  const docs = await ctx.db.query<{ type: string; number: string; date: string; party_name: string; taxes: AppliedTax[] }>(
    `SELECT d.type, d.number, d.date, p.name AS party_name, d.taxes FROM documents d JOIN parties p ON p.id = d.party_id
     WHERE d.status = 'valide' AND d.type IN ('FAC','FF') AND d.total_withheld > 0 AND d.date BETWEEN $1 AND $2 ORDER BY d.date, d.number`,
    [from, to]
  )
  const withholding = (type: 'FAC' | 'FF') => {
    const byTax = new Map<string, { code: string; label: string; basis: number; amount: number; documents: { number: string; date: string; party: string; basis: number; amount: number }[] }>()
    for (const d of docs.filter((x) => x.type === type)) {
      for (const t of (d.taxes ?? []).filter((x) => x.kind === 'withholding' && x.value > 0)) {
        const g = byTax.get(t.code) ?? { code: t.code, label: t.label, basis: 0, amount: 0, documents: [] }
        g.basis += t.basis
        g.amount += t.value
        g.documents.push({ number: d.number, date: d.date, party: d.party_name, basis: t.basis, amount: t.value })
        byTax.set(t.code, g)
      }
    }
    return [...byTax.values()]
  }
  const suffered = withholding('FAC')
  const operated = withholding('FF')
  // TVA déjà retenue par les clients (retenue sur la TVA) : vient en déduction de la TVA à payer.
  const vatWithheld = docs
    .filter((d) => d.type === 'FAC')
    .flatMap((d) => d.taxes ?? [])
    .filter((t) => t.kind === 'withholding' && t.base === 'tva')
    .reduce((sum, t) => sum + t.value, 0)

  const vat = {
    rows: collected.map((r) => ({ rate: r.rate, base: round(r.base), tva: round(r.tva) })),
    collected: round(totals!.collected),
    deductible: round(totals!.deductible),
    purchasesHt: round(totals!.purchases_ht),
    withheldByClients: round(vatWithheld),
    // Positif : TVA à payer ; négatif : crédit de TVA à reporter
    net: round(totals!.collected - totals!.deductible - vatWithheld)
  }

  // Salaires : paie du mois (validée ou en préparation)
  const run = await ctx.db.one<{ id: number; status: string }>('SELECT id, status FROM payroll_runs WHERE period = $1', [month])
  let payroll: null | { status: string; employees: number; gross: number; cnssEmployee: number; cnssEmployer: number; iuts: number; net: number } = null
  if (run) {
    const p = await ctx.db.one<any>(
      `SELECT COUNT(*)::int AS employees, COALESCE(SUM(gross), 0) AS gross, COALESCE(SUM(cnss_employee), 0) AS cnss_employee,
              COALESCE(SUM(cnss_employer), 0) AS cnss_employer, COALESCE(SUM(iuts), 0) AS iuts, COALESCE(SUM(net), 0) AS net
       FROM payslips WHERE run_id = $1`,
      [run.id]
    )
    payroll = { status: run.status, employees: p.employees, gross: round(p.gross), cnssEmployee: round(p.cnss_employee), cnssEmployer: round(p.cnss_employer), iuts: round(p.iuts), net: round(p.net) }
  }

  return {
    month,
    vat,
    withholdings: { suffered, operated, totalSuffered: round(suffered.reduce((s, g) => s + g.amount, 0)), totalOperated: round(operated.reduce((s, g) => s + g.amount, 0)) },
    payroll
  }
}
