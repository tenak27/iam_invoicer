// Licences d'IAM INVOICER : paliers, modules inclus, nombre d'utilisateurs, durée.
// Une licence est un texte signé (Ed25519) par l'éditeur : « données.signature »
// en base64url. Le logiciel ne contient que la clé publique : il vérifie la
// licence sans connexion Internet, mais ne peut pas en fabriquer.
// Émission : tools/licence/issue.mjs avec la clé privée (hors du dépôt).

import type { Module } from './domain'

export type Tier = 'essentiel' | 'pro' | 'entreprise' | 'sur-mesure'

export interface TierDef {
  label: string
  pitch: string
  modules: Module[]
  /** 0 = illimité */
  users: number
  /** Marque de la société cliente à la place de celle de l'éditeur dans l'application. */
  whiteLabel: boolean
}

/** Modules toujours disponibles (administration de base). */
export const BASE_MODULES: Module[] = ['dashboard', 'settings', 'users']

export const TIERS: Record<Exclude<Tier, 'sur-mesure'>, TierDef> = {
  essentiel: {
    label: 'Essentiel',
    pitch: 'Commerces et prestataires : devis, factures, caisse, clients, articles et stock.',
    modules: [...BASE_MODULES, 'sales', 'clients', 'products', 'stock', 'payments', 'cash', 'reports'],
    users: 2,
    whiteLabel: false
  },
  pro: {
    label: 'Pro',
    pitch: 'PME : en plus, achats, fournisseurs, comptabilité SYSCOHADA, déclarations, e-mails et SMS.',
    modules: [...BASE_MODULES, 'sales', 'clients', 'products', 'stock', 'payments', 'cash', 'reports', 'purchases', 'suppliers', 'accounting', 'messages'],
    users: 5,
    whiteLabel: false
  },
  entreprise: {
    label: 'Entreprise',
    pitch: 'Tous les modules : RH et paie, CRM, projets, immobilisations, budgets ; utilisateurs illimités, à vos couleurs.',
    modules: [...BASE_MODULES, 'sales', 'clients', 'products', 'stock', 'payments', 'cash', 'reports', 'purchases', 'suppliers', 'accounting', 'messages', 'hr', 'crm', 'projects', 'assets', 'budget'],
    users: 0,
    whiteLabel: true
  }
}

export const MODULE_NAMES: Record<Module, string> = {
  dashboard: 'Tableau de bord', sales: 'Ventes', purchases: 'Achats', stock: 'Stock', payments: 'Paiements', clients: 'Clients',
  suppliers: 'Fournisseurs', products: 'Articles', reports: 'Rapports', cash: 'Caisse', accounting: 'Comptabilité et déclarations',
  messages: 'E-mails et SMS', hr: 'RH et paie', crm: 'CRM', projects: 'Projets', assets: 'Immobilisations', budget: 'Budgets et trésorerie',
  settings: 'Paramètres', users: 'Utilisateurs', licensing: 'Émission de licences'
}

export const TRIAL_DAYS = 30

/** Version d'évaluation (sans licence) : tous les modules pour découvrir, mais en quantités limitées. */
export const TRIAL_LIMITS = {
  documents: 30,
  clients: 25,
  suppliers: 10,
  products: 50,
  employees: 3,
  users: 2
} as const
export type TrialQuota = keyof typeof TRIAL_LIMITS
export const TRIAL_QUOTA_LABELS: Record<TrialQuota, string> = {
  documents: 'documents (devis, factures, ventes en caisse, achats)',
  clients: 'clients',
  suppliers: 'fournisseurs',
  products: 'articles et prestations',
  employees: 'salariés',
  users: 'utilisateurs actifs'
}
export interface TrialUsage { key: TrialQuota; label: string; used: number; limit: number }

export interface LicencePayload {
  v: 1
  /** Numéro de licence (référence commerciale). */
  id: string
  /** Raison sociale du client : doit correspondre à celle configurée. */
  company: string
  /** Identifiant fiscal du client (facultatif, contrôlé s'il est renseigné). */
  taxId?: string
  tier: Tier
  modules: Module[]
  users: number
  issued: string
  /** Date de fin (AAAA-MM-JJ) ; null = licence perpétuelle. */
  expires: string | null
  whiteLabel: boolean
}

export type LicenceState = 'trial' | 'active' | 'expired' | 'trial_over' | 'invalid'

export interface LicenceStatus {
  state: LicenceState
  /** Libellé du palier (« Essentiel », « Pro »…, « Évaluation »). */
  label: string
  tier: Tier | 'trial'
  modules: Module[]
  users: number
  expires: string | null
  daysLeft: number | null
  company: string
  licenceId: string | null
  whiteLabel: boolean
  /** Création et modification autorisées (sinon lecture seule). */
  canWrite: boolean
  message: string
  /** Évaluation : consommation des quotas. */
  usage?: TrialUsage[]
  /** Poste ou serveur de l'éditeur : émission de licences possible. */
  vendor?: boolean
}

/** Module accessible au regard de la licence (état inconnu, hors connexion : oui). */
export function moduleLicensed(st: LicenceStatus | null | undefined, m: Module): boolean {
  if (m === 'licensing') return !!st?.vendor
  return !st || st.modules.includes(m)
}

/** Clé publique de vérification des licences (Ed25519, SPKI). */
export const LICENCE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAKizUK3p8NwIrKrWdsaWI8lb33ZMXIuoISWWJ/boCaCc=
-----END PUBLIC KEY-----`

/** Coordonnées de l'éditeur affichées pour acheter ou renouveler une licence. */
export const VENDOR = {
  name: 'IAM Technology',
  city: 'Ouagadougou, Burkina Faso',
  phone: '',
  email: '',
  website: ''
}

/** Nom de société normalisé pour comparer la licence et la configuration. */
export function normalizeCompany(s: string): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\b(SARL|SA|SAS|SASU|SUARL|SNC|GIE|ETS|ETABLISSEMENTS?)\b/g, '')
    .replace(/[^A-Z0-9]/g, '')
}

/** Actions qui ne modifient rien : autorisées même sans licence valide (consultation, impression, export). */
const READ_ACTIONS = /\.(list|get|options|categories|dashboard|sales|valuation|audit|accounts|entries|ledger|balance|income|balanceSheet|month|missing|employees|leaves|runs|params|payslipsHtml|declaration|pipeline|agenda|clients|myWeek|forecast|forecasts|current|history|detail|warehouses|byWarehouse|movements|lots|trace|transfers|log|preview|templates|secrets|needsSetup|status|upcoming)$/

export function isReadAction(name: string): boolean {
  return READ_ACTIONS.test(name) || name === 'hr.run' || name.startsWith('auth.') || name.startsWith('licence.')
}
