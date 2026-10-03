// Calcul de la paie — Burkina Faso.
//
// IMPORTANT : les taux et barèmes ci-dessous sont des valeurs par défaut issues
// du Code général des impôts (IUTS) et de la réglementation CNSS telles que
// connues lors du développement. Ils sont modifiables dans « Paramètres de paie »
// et DOIVENT être vérifiés avec votre comptable ou la DGI/CNSS avant usage réel.

export interface Bracket {
  /** Borne supérieure de la tranche (FCFA), null = au-delà. */
  upTo: number | null
  /** Taux en %. */
  rate: number
}

/** Cotisation ou retenue supplémentaire (assurance maladie, mutuelle, caisse de retraite, syndicat…). */
export interface Contribution {
  code: string
  label: string
  /** Base de calcul : brut, base sécurité sociale (plafonnée) ou salaire de base. */
  base: 'gross' | 'cnss_base' | 'base_salary'
  employee_rate: number
  employer_rate: number
  /** Plafond mensuel de la base (0 = sans plafond). */
  ceiling: number
  /** Part salariale déductible de la base imposable (IUTS). */
  deductible: boolean
  /** Compte créditeur (organisme), ex. 438. */
  account: string
  active: boolean
}

export interface PayrollParams {
  cnss_employee_rate: number // % salarié (pension)
  cnss_employer_rate: number // % employeur (pension + prestations familiales + risques professionnels)
  /** Détail de la part patronale CNSS (la somme remplace cnss_employer_rate). */
  cnss_employer_family: number
  cnss_employer_risk: number
  cnss_employer_pension: number
  contributions: Contribution[]
  cnss_ceiling: number // plafond mensuel de la base CNSS
  tpa_rate: number // % taxe patronale éventuelle (0 si non applicable)
  abatement_cadre: number // % abattement forfaitaire sur le salaire de base, cadres
  abatement_non_cadre: number // % idem, non-cadres
  housing_exempt_rate: number // % du salaire de base, indemnité de logement exonérée
  housing_exempt_cap: number
  transport_exempt_rate: number
  transport_exempt_cap: number
  function_exempt_rate: number
  function_exempt_cap: number
  family_reductions: number[] // % de réduction de l'IUTS par nombre de charges (index = nombre)
  iuts_brackets: Bracket[]
  leave_days_per_month: number
}

export const DEFAULT_PAYROLL_PARAMS: PayrollParams = {
  cnss_employee_rate: 5.5,
  cnss_employer_rate: 16,
  // Prestations familiales 7 %, risques professionnels 3,5 % (selon l'activité), pension 5,5 %
  cnss_employer_family: 7,
  cnss_employer_risk: 3.5,
  cnss_employer_pension: 5.5,
  contributions: [],
  cnss_ceiling: 600000,
  // Taxe patronale d'apprentissage (Burkina Faso) : à confirmer avec votre comptable
  tpa_rate: 3,
  abatement_cadre: 20,
  abatement_non_cadre: 25,
  housing_exempt_rate: 20,
  housing_exempt_cap: 75000,
  transport_exempt_rate: 5,
  transport_exempt_cap: 30000,
  function_exempt_rate: 5,
  function_exempt_cap: 50000,
  family_reductions: [0, 8, 10, 12, 14],
  iuts_brackets: [
    { upTo: 30000, rate: 0 },
    { upTo: 50000, rate: 12.1 },
    { upTo: 80000, rate: 13.9 },
    { upTo: 120000, rate: 15.7 },
    { upTo: 170000, rate: 18.4 },
    { upTo: 250000, rate: 21.7 },
    { upTo: null, rate: 25 }
  ],
  leave_days_per_month: 2.5
}

export interface EmployeePay {
  category: 'cadre' | 'non_cadre'
  base_salary: number
  housing: number
  transport: number
  function_allowance: number
  other_allowances: number
  family_charges: number
}

export interface PayVariables {
  bonus?: number // primes imposables
  overtime?: number // heures supplémentaires (montant)
  absence_days?: number // jours d'absence non payés (base 30 jours)
  advance?: number // avance sur salaire à retenir
  other_deductions?: number // autres retenues (prêt, opposition…)
}

export interface PayLine {
  label: string
  base?: number
  rate?: number
  gain?: number
  deduction?: number
  employer?: number
}

export interface Payslip {
  lines: PayLine[]
  gross: number
  cnssBase: number
  cnssEmployee: number
  taxable: number
  iutsGross: number
  familyReduction: number
  iuts: number
  otherDeductions: number
  net: number
  cnssEmployer: number
  /** Détail de la part patronale CNSS. */
  cnssEmployerDetail: { family: number; risk: number; pension: number }
  tpa: number
  /** Cotisations supplémentaires. */
  contributions: { code: string; label: string; base: number; employee: number; employer: number; account: string }[]
  contribEmployee: number
  contribEmployer: number
  employerCost: number
}

/** Taux patronal CNSS total (somme du détail s'il est renseigné). */
export function employerCnssRate(p: PayrollParams): number {
  const parts = [p.cnss_employer_family, p.cnss_employer_risk, p.cnss_employer_pension]
  return parts.every((x) => typeof x === 'number') ? parts.reduce((s, x) => s + x, 0) : p.cnss_employer_rate
}

const r = Math.round

/** IUTS progressif sur la base imposable mensuelle (arrondie à la centaine inférieure). */
export function iutsFromBrackets(taxable: number, brackets: Bracket[]): number {
  let tax = 0
  let lower = 0
  for (const b of brackets) {
    const upper = b.upTo ?? Infinity
    if (taxable > lower) tax += ((Math.min(taxable, upper) - lower) * b.rate) / 100
    lower = upper
    if (taxable <= upper) break
  }
  return tax
}

export function computePayslip(e: EmployeePay, p: PayrollParams = DEFAULT_PAYROLL_PARAMS, v: PayVariables = {}): Payslip {
  const absence = Math.min(Math.max(v.absence_days ?? 0, 0), 30)
  const base = r(e.base_salary - (e.base_salary / 30) * absence)
  const bonus = r(v.bonus ?? 0)
  const overtime = r(v.overtime ?? 0)
  const gross = base + r(e.housing) + r(e.transport) + r(e.function_allowance) + r(e.other_allowances) + bonus + overtime

  const cnssBase = Math.min(gross, p.cnss_ceiling)
  const cnssEmployee = r((cnssBase * p.cnss_employee_rate) / 100)
  const detailed = [p.cnss_employer_family, p.cnss_employer_risk, p.cnss_employer_pension].every((x) => typeof x === 'number')
  const cnssEmployerDetail = detailed
    ? { family: r((cnssBase * p.cnss_employer_family) / 100), risk: r((cnssBase * p.cnss_employer_risk) / 100), pension: r((cnssBase * p.cnss_employer_pension) / 100) }
    : { family: 0, risk: 0, pension: 0 }
  const cnssEmployer = detailed ? cnssEmployerDetail.family + cnssEmployerDetail.risk + cnssEmployerDetail.pension : r((cnssBase * p.cnss_employer_rate) / 100)
  const tpa = r((gross * p.tpa_rate) / 100)

  // Cotisations supplémentaires
  const contributions = (p.contributions ?? [])
    .filter((c) => c.active && (c.employee_rate > 0 || c.employer_rate > 0))
    .map((c) => {
      const raw = c.base === 'gross' ? gross : c.base === 'cnss_base' ? cnssBase : base
      const b = c.ceiling > 0 ? Math.min(raw, c.ceiling) : raw
      return { code: c.code, label: c.label, base: b, employee: r((b * c.employee_rate) / 100), employer: r((b * c.employer_rate) / 100), account: c.account, deductible: c.deductible, employee_rate: c.employee_rate }
    })
  const contribEmployee = contributions.reduce((s, c) => s + c.employee, 0)
  const contribEmployer = contributions.reduce((s, c) => s + c.employer, 0)
  const contribDeductible = contributions.filter((c) => c.deductible).reduce((s, c) => s + c.employee, 0)

  const exHousing = Math.min(e.housing, (base * p.housing_exempt_rate) / 100, p.housing_exempt_cap)
  const exTransport = Math.min(e.transport, (base * p.transport_exempt_rate) / 100, p.transport_exempt_cap)
  const exFunction = Math.min(e.function_allowance, (base * p.function_exempt_rate) / 100, p.function_exempt_cap)
  const abatement = (base * (e.category === 'cadre' ? p.abatement_cadre : p.abatement_non_cadre)) / 100
  const taxable = Math.max(0, Math.floor((gross - cnssEmployee - contribDeductible - exHousing - exTransport - exFunction - abatement) / 100) * 100)

  const iutsGross = iutsFromBrackets(taxable, p.iuts_brackets)
  const reductionRate = p.family_reductions[Math.min(Math.max(e.family_charges, 0), p.family_reductions.length - 1)] ?? 0
  const familyReduction = (iutsGross * reductionRate) / 100
  const iuts = r(iutsGross - familyReduction)

  const otherDeductions = r((v.advance ?? 0) + (v.other_deductions ?? 0))
  const net = gross - cnssEmployee - contribEmployee - iuts - otherDeductions

  const lines: PayLine[] = [
    { label: absence ? `Salaire de base (${absence} j d'absence déduits)` : 'Salaire de base', gain: base },
    e.housing ? { label: 'Indemnité de logement', gain: r(e.housing) } : null,
    e.transport ? { label: 'Indemnité de transport', gain: r(e.transport) } : null,
    e.function_allowance ? { label: 'Indemnité de fonction', gain: r(e.function_allowance) } : null,
    e.other_allowances ? { label: 'Autres indemnités', gain: r(e.other_allowances) } : null,
    bonus ? { label: 'Primes', gain: bonus } : null,
    overtime ? { label: 'Heures supplémentaires', gain: overtime } : null,
    { label: 'CNSS — pension (part salariale)', base: cnssBase, rate: p.cnss_employee_rate, deduction: cnssEmployee, employer: detailed ? cnssEmployerDetail.pension : cnssEmployer },
    detailed && cnssEmployerDetail.family ? { label: 'CNSS — prestations familiales', base: cnssBase, rate: p.cnss_employer_family, employer: cnssEmployerDetail.family } : null,
    detailed && cnssEmployerDetail.risk ? { label: 'CNSS — risques professionnels', base: cnssBase, rate: p.cnss_employer_risk, employer: cnssEmployerDetail.risk } : null,
    ...contributions.map((c) => ({ label: c.label, base: c.base, rate: c.employee_rate || undefined, deduction: c.employee || undefined, employer: c.employer || undefined })),
    { label: `IUTS${e.family_charges ? ` (réduction ${reductionRate} % pour ${e.family_charges} charge(s))` : ''}`, base: taxable, deduction: iuts },
    v.advance ? { label: 'Avance sur salaire', deduction: r(v.advance) } : null,
    v.other_deductions ? { label: 'Autres retenues', deduction: r(v.other_deductions) } : null,
    tpa ? { label: "Taxe patronale d'apprentissage (TPA)", base: gross, rate: p.tpa_rate, employer: tpa } : null
  ].filter(Boolean) as PayLine[]

  return {
    lines,
    gross,
    cnssBase,
    cnssEmployee,
    taxable,
    iutsGross: r(iutsGross),
    familyReduction: r(familyReduction),
    iuts,
    otherDeductions,
    net,
    cnssEmployer,
    cnssEmployerDetail,
    tpa,
    contributions: contributions.map(({ deductible: _d, employee_rate: _r, ...c }) => c),
    contribEmployee,
    contribEmployer,
    employerCost: gross + cnssEmployer + tpa + contribEmployer
  }
}

/** Jours ouvrables (lundi à samedi) entre deux dates incluses. */
export function workingDays(start: string, end: string): number {
  const a = new Date(start + 'T12:00:00')
  const b = new Date(end + 'T12:00:00')
  if (b < a) return 0
  let n = 0
  for (const d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) if (d.getDay() !== 0) n++
  return n
}
