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
      code: 'PREL-BIC', label: 'Prélèvement à la source BIC (acompte sur l’impôt)', kind: 'addition', base: 'ht', rate: 2, amount: 0,
      account_sale: '447', account_purchase: '4413', applies_to: 'both', auto: false, active: false
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
    // Burkina Faso : retenues et prélèvement du Code général des impôts, proposés actifs pour être
    // choisis sur les factures (aucun n'est appliqué d'office) ; timbre et taxe spécifique à compléter.
    const ras = (code: string, label: string, rate: number): TaxDef => ({ ...common[0], code, label, rate, active: true })
    return [
      ras('RAS-PS', 'Retenue à la source 5 % (prestataire résident immatriculé à l’IFU)', 5),
      ras('RAS-PS-25', 'Retenue à la source 25 % (prestataire résident sans IFU)', 25),
      ras('RAS-BTP', 'Retenue à la source 1 % (travaux immobiliers et travaux publics)', 1),
      ras('RAS-NR', 'Retenue à la source 20 % (prestataire non résident)', 20),
      { ...common[1], label: 'Retenue de TVA à la source (marchés publics)' },
      { ...common[2], label: 'Prélèvement à la source 2 % (acompte BIC / IS, ventes en gros)', active: true },
      common[3],
      common[4]
    ]
  }
  return common
}

/** Impôt ou taxe applicable dans un pays : repère pour l'utilisateur, avec l'endroit où l'application le traite. */
export interface TaxGuideEntry {
  code: string
  name: string
  rate: string
  base: string
  /** Périodicité et échéance habituelles. */
  period: string
  /** Où cela se passe dans l'application. */
  where: string
  /** Géré par l'application (calcul et état préparatoire), en partie, ou à suivre hors de l'application. */
  handled: 'oui' | 'partiel' | 'non'
}

/**
 * Panorama des impôts et taxes d'une entreprise au Burkina Faso (Code général des impôts,
 * CNSS). Repère de gestion : taux et échéances sont à confirmer auprès de la DGI, de la CNSS ou
 * d'un comptable, et se modifient dans l'application (taxes, paramètres de paie, taux d'IS).
 */
export function taxGuide(countryCode: string): TaxGuideEntry[] {
  if (countryCode !== 'BF') return []
  return [
    { code: 'TVA', name: 'Taxe sur la valeur ajoutée', rate: '18 % (exportations : 0 %)', base: 'Chiffre d’affaires hors taxes', period: 'Mensuelle au réel normal, trimestrielle au réel simplifié ; au plus tard le 20', where: 'Taux sur chaque ligne de document ; Déclarations → TVA', handled: 'oui' },
    { code: 'RAS', name: 'Retenue à la source sur prestations', rate: '5 % avec IFU, 25 % sans IFU, 1 % travaux immobiliers et publics, 20 % non-résidents', base: 'Montant hors taxes versé au prestataire', period: 'Mensuelle ; reversée au plus tard le 20 du mois suivant', where: 'À choisir sur la facture ; Déclarations → Retenues à la source', handled: 'oui' },
    { code: 'PREL', name: 'Prélèvement à la source (acompte sur BIC / IS)', rate: '2 % sur les ventes en gros ; autres taux selon l’opération (importations…)', base: 'Montant hors taxes de la vente ou de l’achat', period: 'Mensuelle ; au plus tard le 20 du mois suivant', where: 'Taxe « PREL-BIC » sur la facture ; Déclarations → Taxes ajoutées', handled: 'oui' },
    { code: 'IUTS', name: 'Impôt unique sur les traitements et salaires', rate: 'Barème progressif, de 0 à 25 %', base: 'Salaire imposable, après abattements et charges de famille', period: 'Mensuelle ; au plus tard le 20 du mois suivant', where: 'RH et paie → bulletins ; Déclarations → Salaires', handled: 'oui' },
    { code: 'TPA', name: 'Taxe patronale et d’apprentissage', rate: '3 %', base: 'Masse salariale brute', period: 'Mensuelle, avec l’IUTS', where: 'RH et paie ; Déclarations → Salaires', handled: 'oui' },
    { code: 'CNSS', name: 'Cotisations sociales (CNSS)', rate: '16 % employeur (7 % famille, 3,5 % risques, 5,5 % pension) et 5,5 % salarié', base: 'Salaire brut, dans la limite du plafond (600 000 F par mois dans les paramètres de paie)', period: 'Mensuelle ou trimestrielle selon l’effectif', where: 'RH et paie ; Déclarations → Salaires', handled: 'oui' },
    { code: 'IS', name: 'Impôt sur les sociétés / BIC', rate: '27,5 % pour les sociétés ; barème pour les entreprises individuelles', base: 'Bénéfice imposable de l’exercice', period: 'Annuelle ; déclaration avant le 30 avril', where: 'Déclarations → estimation de l’impôt sur les bénéfices', handled: 'partiel' },
    { code: 'MFP', name: 'Minimum forfaitaire de perception', rate: '0,5 % du chiffre d’affaires ; minimum annuel de 1 000 000 F (réel normal) ou 300 000 F (réel simplifié)', base: 'Chiffre d’affaires hors taxes', period: 'Acomptes mensuels au réel normal, trimestriels au réel simplifié ; au plus tard le 20', where: 'Déclarations → échéancier du mois', handled: 'oui' },
    { code: 'CME', name: 'Contribution des micro-entreprises', rate: 'Forfait selon le chiffre d’affaires et la zone', base: 'Entreprises sous le seuil du réel simplifié, sans TVA', period: 'Annuelle', where: 'Régime « CME » dans Société : TVA à 0 % sur les articles', handled: 'non' },
    { code: 'IRF', name: 'Impôt sur les revenus fonciers', rate: 'Barème sur le loyer, après abattement', base: 'Loyers versés ; retenu par le locataire quand il est une entreprise', period: 'Mensuelle ; au plus tard le 20 du mois suivant', where: 'À créer comme retenue dans cet onglet si vous louez vos locaux', handled: 'partiel' },
    { code: 'PATENTE', name: 'Contribution des patentes', rate: 'Droit fixe selon le chiffre d’affaires et droit proportionnel sur la valeur locative', base: 'Chiffre d’affaires et locaux professionnels', period: 'Annuelle', where: 'À comptabiliser en charge (compte 64) à réception de l’avis', handled: 'non' },
    { code: 'TIMBRE', name: 'Droits de timbre', rate: 'Montant fixe selon l’acte', base: 'Quittances, effets et actes', period: 'À l’acte', where: 'Taxe « TIMBRE » : saisissez le montant puis activez-la', handled: 'partiel' }
  ]
}
