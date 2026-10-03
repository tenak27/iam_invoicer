import { describe, expect, it } from 'vitest'
import { computePayslip, DEFAULT_PAYROLL_PARAMS, employerCnssRate, type PayrollParams } from '../src/shared/payroll'

const employee = { category: 'non_cadre' as const, base_salary: 200000, housing: 50000, transport: 20000, function_allowance: 0, other_allowances: 0, family_charges: 2 }

describe('Charges sociales et fiscales de la paie', () => {
  it('part patronale CNSS détaillée (16 % au total) et TPA', () => {
    const s = computePayslip(employee)
    expect(employerCnssRate(DEFAULT_PAYROLL_PARAMS)).toBe(16)
    expect(s.cnssEmployerDetail).toEqual({ family: 18900, risk: 9450, pension: 14850 }) // base 270 000
    expect(s.cnssEmployer).toBe(43200)
    expect(s.tpa).toBe(8100) // 3 % du brut
    expect(s.employerCost).toBe(270000 + 43200 + 8100)
    expect(s.net).toBe(237754) // inchangé pour le salarié
    expect(s.lines.map((l) => l.label)).toEqual(expect.arrayContaining(['CNSS — prestations familiales', 'CNSS — risques professionnels', "Taxe patronale d'apprentissage (TPA)"]))
  })

  it('cotisations supplémentaires : part salariale, part patronale, plafond, déductibilité', () => {
    const p: PayrollParams = {
      ...DEFAULT_PAYROLL_PARAMS,
      contributions: [
        { code: 'AMU', label: 'Assurance maladie', base: 'gross', employee_rate: 2, employer_rate: 2, ceiling: 0, deductible: true, account: '438', active: true },
        { code: 'MUT', label: 'Mutuelle', base: 'base_salary', employee_rate: 1, employer_rate: 0, ceiling: 100000, deductible: false, account: '438', active: true },
        { code: 'OFF', label: 'Inactive', base: 'gross', employee_rate: 50, employer_rate: 50, ceiling: 0, deductible: false, account: '438', active: false }
      ]
    }
    const s = computePayslip(employee, p)
    expect(s.contributions).toEqual([
      { code: 'AMU', label: 'Assurance maladie', base: 270000, employee: 5400, employer: 5400, account: '438' },
      { code: 'MUT', label: 'Mutuelle', base: 100000, employee: 1000, employer: 0, account: '438' }
    ])
    expect(s.contribEmployee).toBe(6400)
    expect(s.contribEmployer).toBe(5400)
    // La part déductible (AMU) réduit la base imposable
    const base = computePayslip(employee)
    expect(s.taxable).toBe(base.taxable - 5400)
    expect(s.net).toBe(270000 - s.cnssEmployee - 6400 - s.iuts)
  })
})
