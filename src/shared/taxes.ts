// Taxes de facturation au-delà de la TVA des lignes :
//  - taxes additionnelles, ajoutées au total TTC (droit de timbre, taxe spécifique…) ;
//  - retenues à la source, déduites du net à payer (retenue sur prestations de
//    services, retenue de TVA des marchés publics…). Le client verse le net et
//    reverse la retenue à l'État : elle est enregistrée comme un règlement
//    « Retenue à la source » à la validation.
// Les taux proposés sont des modèles : faites-les confirmer par un comptable.

import { computeTotals, roundMoney, type LineInput, type Totals } from './domain'

export type TaxKind = 'addition' | 'withholding'
export type TaxBase = 'ht' | 'tva' | 'ttc' | 'fixed'
export type TaxSide = 'sale' | 'purchase' | 'both'

export interface TaxDef {
  code: string
  label: string
  kind: TaxKind
  base: TaxBase
  /** Taux en % (bases ht, tva, ttc). */
  rate: number
  /** Montant fixe (base « fixed »). */
  amount: number
  /** Compte de la taxe sur les ventes (crédit d'une addition, débit d'une retenue subie). */
  account_sale: string
  /** Compte de la taxe sur les achats (débit d'une addition, crédit d'une retenue opérée). */
  account_purchase: string
  applies_to: TaxSide
  /** Ajoutée automatiquement aux nouveaux documents (taxes additionnelles uniquement). */
  auto: boolean
  active: boolean
}

export interface AppliedTax extends Omit<TaxDef, 'auto' | 'active' | 'applies_to'> {
  /** Base de calcul retenue pour ce document. */
  basis: number
  /** Montant de la taxe pour ce document. */
  value: number
}

export interface FullTotals extends Totals {
  taxes: AppliedTax[]
  /** Total des taxes additionnelles (comprises dans le TTC). */
  additions: number
  /** Total des retenues à la source. */
  withheld: number
  /** TTC − retenues : ce que le client verse effectivement. */
  net: number
}

export const TAX_KIND_LABELS: Record<TaxKind, string> = {
  addition: 'Taxe ajoutée au total',
  withholding: 'Retenue à la source (déduite du net à payer)'
}

export const TAX_BASE_LABELS: Record<TaxBase, string> = {
  ht: 'du montant HT',
  tva: 'de la TVA',
  ttc: 'du montant TTC',
  fixed: 'montant fixe'
}

/** Mode de règlement utilisé pour enregistrer une retenue à la source. */
export const WITHHOLDING_METHOD = 'Retenue à la source'

export function taxBasis(t: Pick<TaxDef, 'base'>, totals: Totals): number {
  if (t.base === 'ht') return totals.ht
  if (t.base === 'tva') return totals.tva
  if (t.base === 'ttc') return totals.ht + totals.tva
  return 0
}

export function taxValue(t: Pick<TaxDef, 'base' | 'rate' | 'amount'>, totals: Totals): number {
  if (t.base === 'fixed') return roundMoney(Math.max(0, t.amount))
  return roundMoney((taxBasis(t, totals) * Math.max(0, t.rate)) / 100)
}

/** Totaux d'un document avec ses taxes : HT, TVA, taxes additionnelles, TTC, retenues, net à payer. */
export function computeFullTotals(lines: LineInput[], taxes: Omit<TaxDef, 'auto' | 'active' | 'applies_to'>[] = []): FullTotals {
  const t = computeTotals(lines)
  const applied: AppliedTax[] = taxes.map((d) => ({
    code: d.code, label: d.label, kind: d.kind, base: d.base, rate: d.rate, amount: d.amount,
    account_sale: d.account_sale, account_purchase: d.account_purchase,
    basis: taxBasis(d, t),
    value: t.ht > 0 || d.base === 'fixed' ? taxValue(d, t) : 0
  }))
  const additions = applied.filter((a) => a.kind === 'addition').reduce((s, a) => s + a.value, 0)
  const ttc = t.ht + t.tva + additions
  const withheld = Math.min(ttc, applied.filter((a) => a.kind === 'withholding').reduce((s, a) => s + a.value, 0))
  return { ...t, ttc, taxes: applied, additions, withheld, net: ttc - withheld }
}

/** Libellé court d'une taxe : « Retenue sur prestations (5 % du HT) ». */
export function taxCaption(t: Pick<TaxDef, 'label' | 'base' | 'rate'>): string {
  if (t.base === 'fixed') return t.label
  const base = t.base === 'ht' ? 'HT' : t.base === 'tva' ? 'TVA' : 'TTC'
  return `${t.label} (${String(t.rate).replace('.', ',')} % ${t.base === 'tva' ? 'de la' : 'du'} ${base})`
}

/**
 * Modèles de taxes proposés selon le pays. Tous inactifs à l'import : à activer
 * après vérification des taux auprès d'un comptable ou de l'administration fiscale.
 */
export function taxPresets(countryCode: string): TaxDef[] {
  const common: TaxDef[] = [
    {
      code: 'RAS-PS', label: 'Retenue à la source sur prestations de services', kind: 'withholding', base: 'ht', rate: 5, amount: 0,
      account_sale: '449', account_purchase: '447', applies_to: 'both', auto: false, active: false
    },
    {
      code: 'RAS-TVA', label: 'Retenue de TVA à la source', kind: 'withholding', base: 'tva', rate: 100, amount: 0,
      account_sale: '449', account_purchase: '447', applies_to: 'both', auto: false, active: false
    },
    {
      code: 'TIMBRE', label: 'Droit de timbre', kind: 'addition', base: 'fixed', rate: 0, amount: 0,
      account_sale: '447', account_purchase: '646', applies_to: 'both', auto: false, active: false
    },
    {
      code: 'TAXE-SPE', label: 'Taxe spécifique', kind: 'addition', base: 'ht', rate: 0, amount: 0,
      account_sale: '447', account_purchase: '645', applies_to: 'both', auto: false, active: false
    }
  ]
  if (countryCode === 'BF') {
    common[0] = { ...common[0], label: 'Retenue à la source sur prestations de services (BIC)' }
  }
  return common
}
