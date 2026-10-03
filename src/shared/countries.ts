// Profils pays : libellés fiscaux et sociaux, devise, TVA par défaut et régimes
// d'imposition proposés lors de la configuration de la société.
// Pays de la zone OHADA (même droit des affaires, plan SYSCOHADA révisé).
// `verified` = valeurs courantes vérifiées pour le Burkina Faso ; pour les autres
// pays, faites confirmer taux et régimes par un comptable local (ils restent modifiables).

export interface Regime {
  value: string
  label: string
}

export interface CountryProfile {
  code: string
  name: string
  /** Devise affichée sur les documents (montants sans décimales). */
  currency: string
  /** Devise en toutes lettres (montant en lettres des factures). */
  currencyWords: string
  defaultTva: number
  /** Taux de l'impôt sur les bénéfices (BIC / IS), en %. */
  isRate: number
  /** Nom de la taxe sur la valeur ajoutée (TVA, IGV…). */
  vatName: string
  taxId: { short: string; long: string }
  register: string
  regimes: Regime[]
  taxOfficeHint: string
  socialSecurity: string
  wageTax: string
  capital: string
  zone: 'UEMOA' | 'CEMAC' | 'OHADA' | 'Autre'
  verified: boolean
}

const GENERIC_REGIMES: Regime[] = [
  { value: '', label: '— Choisir —' },
  { value: 'Réel normal', label: 'Réel normal' },
  { value: 'Réel simplifié', label: 'Réel simplifié' },
  { value: 'Synthétique', label: 'Synthétique / micro-entreprise' }
]

const fcfa = { currency: 'FCFA', currencyWords: 'francs CFA' }

export const COUNTRIES: CountryProfile[] = [
  {
    code: 'BF', name: 'Burkina Faso', ...fcfa, defaultTva: 18, isRate: 27.5, vatName: 'TVA',
    taxId: { short: 'IFU', long: 'Identifiant financier unique' }, register: 'RCCM',
    regimes: [
      { value: '', label: '— Choisir —' },
      { value: 'RNI', label: 'RNI — Réel normal d’imposition' },
      { value: 'RSI', label: 'RSI — Réel simplifié d’imposition' },
      { value: 'CME', label: 'CME — Contribution des micro-entreprises' }
    ],
    taxOfficeHint: 'DGE, DME Centre, CME Ouaga…', socialSecurity: 'CNSS', wageTax: 'IUTS', capital: 'Ouagadougou', zone: 'UEMOA', verified: true
  },
  {
    code: 'CI', name: "Côte d'Ivoire", ...fcfa, defaultTva: 18, isRate: 25, vatName: 'TVA',
    taxId: { short: 'NCC', long: 'Numéro de compte contribuable' }, register: 'RCCM',
    regimes: [
      { value: '', label: '— Choisir —' },
      { value: 'RNI', label: 'RNI — Réel normal d’imposition' },
      { value: 'RSI', label: 'RSI — Réel simplifié d’imposition' },
      { value: 'Entreprenant', label: 'Régime de l’entreprenant' }
    ],
    taxOfficeHint: 'DGE, centre des impôts de rattachement…', socialSecurity: 'CNPS', wageTax: 'ITS', capital: 'Abidjan', zone: 'UEMOA', verified: false
  },
  {
    code: 'SN', name: 'Sénégal', ...fcfa, defaultTva: 18, isRate: 30, vatName: 'TVA',
    taxId: { short: 'NINEA', long: 'Numéro d’identification nationale des entreprises et associations' }, register: 'RCCM',
    regimes: [
      { value: '', label: '— Choisir —' },
      { value: 'Réel normal', label: 'Réel normal' },
      { value: 'Réel simplifié', label: 'Réel simplifié' },
      { value: 'CGU', label: 'CGU — Contribution globale unique' }
    ],
    taxOfficeHint: 'DGE, centre des services fiscaux…', socialSecurity: 'IPRES / CSS', wageTax: 'IR', capital: 'Dakar', zone: 'UEMOA', verified: false
  },
  {
    code: 'ML', name: 'Mali', ...fcfa, defaultTva: 18, isRate: 30, vatName: 'TVA',
    taxId: { short: 'NIF', long: 'Numéro d’identification fiscale' }, register: 'RCCM',
    regimes: GENERIC_REGIMES, taxOfficeHint: 'DGE, centre des impôts…', socialSecurity: 'INPS', wageTax: 'ITS', capital: 'Bamako', zone: 'UEMOA', verified: false
  },
  {
    code: 'NE', name: 'Niger', ...fcfa, defaultTva: 19, isRate: 30, vatName: 'TVA',
    taxId: { short: 'NIF', long: 'Numéro d’identification fiscale' }, register: 'RCCM',
    regimes: GENERIC_REGIMES, taxOfficeHint: 'DGE, centre des impôts…', socialSecurity: 'CNSS', wageTax: 'IUTS', capital: 'Niamey', zone: 'UEMOA', verified: false
  },
  {
    code: 'BJ', name: 'Bénin', ...fcfa, defaultTva: 18, isRate: 30, vatName: 'TVA',
    taxId: { short: 'IFU', long: 'Identifiant fiscal unique' }, register: 'RCCM',
    regimes: [
      { value: '', label: '— Choisir —' },
      { value: 'Réel', label: 'Régime du réel' },
      { value: 'TPS', label: 'TPS — Taxe professionnelle synthétique' }
    ],
    taxOfficeHint: 'DGE, centre des impôts…', socialSecurity: 'CNSS', wageTax: 'ITS', capital: 'Cotonou', zone: 'UEMOA', verified: false
  },
  {
    code: 'TG', name: 'Togo', ...fcfa, defaultTva: 18, isRate: 27, vatName: 'TVA',
    taxId: { short: 'NIF', long: 'Numéro d’identification fiscale' }, register: 'RCCM',
    regimes: GENERIC_REGIMES, taxOfficeHint: 'OTR, centre des impôts…', socialSecurity: 'CNSS', wageTax: 'IRPP', capital: 'Lomé', zone: 'UEMOA', verified: false
  },
  {
    code: 'GW', name: 'Guinée-Bissau', ...fcfa, defaultTva: 19, isRate: 25, vatName: 'IVA',
    taxId: { short: 'NIF', long: 'Numéro d’identification fiscale' }, register: 'RCCM',
    regimes: GENERIC_REGIMES, taxOfficeHint: 'Direction des contributions…', socialSecurity: 'INSS', wageTax: 'IPR', capital: 'Bissau', zone: 'UEMOA', verified: false
  },
  {
    code: 'GN', name: 'Guinée', currency: 'GNF', currencyWords: 'francs guinéens', defaultTva: 18, isRate: 25, vatName: 'TVA',
    taxId: { short: 'NIF', long: 'Numéro d’identification fiscale' }, register: 'RCCM',
    regimes: GENERIC_REGIMES, taxOfficeHint: 'DNI, centre des impôts…', socialSecurity: 'CNSS', wageTax: 'RTS', capital: 'Conakry', zone: 'OHADA', verified: false
  },
  {
    code: 'CM', name: 'Cameroun', ...fcfa, defaultTva: 19.25, isRate: 33, vatName: 'TVA',
    taxId: { short: 'NIU', long: 'Numéro d’identifiant unique' }, register: 'RCCM',
    regimes: [
      { value: '', label: '— Choisir —' },
      { value: 'Réel', label: 'Régime du réel' },
      { value: 'Simplifié', label: 'Régime simplifié' },
      { value: 'Impôt libératoire', label: 'Impôt libératoire' }
    ],
    taxOfficeHint: 'DGE, CIME, CDI…', socialSecurity: 'CNPS', wageTax: 'IRPP', capital: 'Yaoundé', zone: 'CEMAC', verified: false
  },
  {
    code: 'GA', name: 'Gabon', ...fcfa, defaultTva: 18, isRate: 30, vatName: 'TVA',
    taxId: { short: 'NIF', long: 'Numéro d’identification fiscale' }, register: 'RCCM',
    regimes: GENERIC_REGIMES, taxOfficeHint: 'DGI, centre des impôts…', socialSecurity: 'CNSS', wageTax: 'IRPP', capital: 'Libreville', zone: 'CEMAC', verified: false
  },
  {
    code: 'CG', name: 'Congo', ...fcfa, defaultTva: 18.9, isRate: 28, vatName: 'TVA',
    taxId: { short: 'NIU', long: 'Numéro d’identification unique' }, register: 'RCCM',
    regimes: GENERIC_REGIMES, taxOfficeHint: 'DGE, centre des impôts…', socialSecurity: 'CNSS', wageTax: 'IRPP', capital: 'Brazzaville', zone: 'CEMAC', verified: false
  },
  {
    code: 'TD', name: 'Tchad', ...fcfa, defaultTva: 18, isRate: 35, vatName: 'TVA',
    taxId: { short: 'NIF', long: 'Numéro d’identification fiscale' }, register: 'RCCM',
    regimes: GENERIC_REGIMES, taxOfficeHint: 'DGI, centre des impôts…', socialSecurity: 'CNPS', wageTax: 'IRPP', capital: "N'Djamena", zone: 'CEMAC', verified: false
  },
  {
    code: 'CF', name: 'Centrafrique', ...fcfa, defaultTva: 19, isRate: 30, vatName: 'TVA',
    taxId: { short: 'NIF', long: 'Numéro d’identification fiscale' }, register: 'RCCM',
    regimes: GENERIC_REGIMES, taxOfficeHint: 'DGID, centre des impôts…', socialSecurity: 'CNSS', wageTax: 'IRPP', capital: 'Bangui', zone: 'CEMAC', verified: false
  },
  {
    code: 'GQ', name: 'Guinée équatoriale', ...fcfa, defaultTva: 15, isRate: 35, vatName: 'IVA',
    taxId: { short: 'NIF', long: 'Numéro d’identification fiscale' }, register: 'RCCM',
    regimes: GENERIC_REGIMES, taxOfficeHint: 'Direction des impôts…', socialSecurity: 'INSESO', wageTax: 'IRPF', capital: 'Malabo', zone: 'CEMAC', verified: false
  },
  {
    code: 'CD', name: 'RD Congo', currency: 'CDF', currencyWords: 'francs congolais', defaultTva: 16, isRate: 30, vatName: 'TVA',
    taxId: { short: 'NIF', long: 'Numéro impôt' }, register: 'RCCM',
    regimes: GENERIC_REGIMES, taxOfficeHint: 'DGE, CIS, CDI…', socialSecurity: 'CNSS', wageTax: 'IPR', capital: 'Kinshasa', zone: 'OHADA', verified: false
  },
  {
    code: 'KM', name: 'Comores', currency: 'KMF', currencyWords: 'francs comoriens', defaultTva: 10, isRate: 35, vatName: 'TC',
    taxId: { short: 'NIF', long: 'Numéro d’identification fiscale' }, register: 'RCCM',
    regimes: GENERIC_REGIMES, taxOfficeHint: 'AGID…', socialSecurity: 'CNPS', wageTax: 'ITS', capital: 'Moroni', zone: 'OHADA', verified: false
  },
  {
    code: 'XX', name: 'Autre pays', ...fcfa, defaultTva: 18, isRate: 30, vatName: 'TVA',
    taxId: { short: 'NIF', long: 'Identifiant fiscal' }, register: 'RCCM',
    regimes: GENERIC_REGIMES, taxOfficeHint: 'Centre des impôts de rattachement', socialSecurity: 'Sécurité sociale', wageTax: 'Impôt sur salaires', capital: '', zone: 'Autre', verified: false
  }
]

export const DEFAULT_COUNTRY = 'BF'

/** Profil d'un pays par son code ; à défaut, d'après le nom saisi (anciennes installations). */
export function countryProfile(code?: string | null, name?: string | null): CountryProfile {
  const byCode = COUNTRIES.find((c) => c.code === code)
  if (byCode) return byCode
  const n = (name ?? '').trim().toLowerCase()
  return COUNTRIES.find((c) => c.name.toLowerCase() === n) ?? (n ? COUNTRIES.find((c) => c.code === 'XX')! : COUNTRIES[0])
}

/** Valeurs de la société qui dépendent du pays (à appliquer quand on change de pays). */
export function countryDefaults(p: CountryProfile) {
  return {
    country_code: p.code,
    country: p.code === 'XX' ? '' : p.name,
    currency: p.currency,
    default_tva: p.defaultTva,
    tax_id_label: p.taxId.short,
    city: p.capital,
    regime_fiscal: ''
  }
}
