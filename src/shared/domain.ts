// Règles métier partagées entre le processus principal et l'interface.

export type Role = 'admin' | 'directeur' | 'daf' | 'comptable' | 'commercial' | 'acheteur' | 'magasinier' | 'caissier' | 'rh' | 'chef_service' | 'employe' | 'licences'

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrateur',
  directeur: 'Directeur général',
  daf: 'Directeur administratif et financier',
  comptable: 'Comptable',
  commercial: 'Commercial',
  acheteur: 'Responsable des achats',
  magasinier: 'Magasinier',
  caissier: 'Caissier',
  rh: 'Ressources humaines',
  chef_service: 'Chef de service',
  employe: 'Employé',
  licences: 'Gestionnaire de licences'
}

/** Ce que fait chaque rôle dans l'entreprise (page Utilisateurs, choix du rôle). */
export const ROLE_HINTS: Record<Role, string> = {
  admin: 'Tous les droits, paramètres et utilisateurs compris.',
  directeur: 'Voit toute l’activité ; vise et valide les dépenses et les demandes d’achat.',
  daf: 'Finances, comptabilité et trésorerie ; validation financière et paiement des dépenses.',
  comptable: 'Écritures, déclarations, règlements ; paie les dépenses approuvées.',
  commercial: 'Devis, factures, clients, caisse et suivi commercial.',
  acheteur: 'Fournisseurs et commandes ; transforme les demandes validées en bons de commande.',
  magasinier: 'Stock, réceptions et inventaires.',
  caissier: 'Point de vente et sessions de caisse.',
  rh: 'Salariés, paie et congés.',
  chef_service: 'Vise les dépenses et les expressions de besoin de son équipe.',
  employe: 'Saisit ses dépenses et ses expressions de besoin, et suit leur avancement.',
  licences: 'Émission des licences (éditeur).'
}

export type Module =
  | 'dashboard'
  | 'sales'
  | 'purchases'
  | 'stock'
  | 'payments'
  | 'clients'
  | 'suppliers'
  | 'products'
  | 'reports'
  | 'cash'
  | 'accounting'
  | 'messages'
  | 'hr'
  | 'crm'
  | 'projects'
  | 'assets'
  | 'budget'
  /** Dépenses de l'entreprise : saisie et suivi de ses propres dépenses. */
  | 'expenses'
  /** Expressions de besoin : demandes d'achat internes. */
  | 'requests'
  /** Visa du responsable sur les dépenses et les expressions de besoin. */
  | 'approvals'
  /** Validation financière des demandes et paiement des dépenses. */
  | 'finance'
  | 'settings'
  | 'users'
  /** Émission des licences clients : uniquement sur le poste ou le serveur de l'éditeur (clé privée). */
  | 'licensing'

export const PERMISSIONS: Record<Role, Module[]> = {
  admin: ['dashboard', 'sales', 'purchases', 'stock', 'payments', 'clients', 'suppliers', 'products', 'reports', 'cash', 'accounting', 'messages', 'hr', 'crm', 'projects', 'assets', 'budget', 'expenses', 'requests', 'approvals', 'finance', 'settings', 'users', 'licensing'],
  directeur: ['dashboard', 'sales', 'purchases', 'stock', 'payments', 'clients', 'suppliers', 'products', 'reports', 'accounting', 'messages', 'hr', 'crm', 'projects', 'assets', 'budget', 'expenses', 'requests', 'approvals', 'finance'],
  daf: ['dashboard', 'purchases', 'payments', 'suppliers', 'reports', 'accounting', 'hr', 'assets', 'budget', 'expenses', 'requests', 'approvals', 'finance'],
  comptable: ['dashboard', 'sales', 'purchases', 'payments', 'clients', 'suppliers', 'reports', 'accounting', 'messages', 'hr', 'projects', 'assets', 'budget', 'expenses', 'requests', 'finance'],
  commercial: ['dashboard', 'sales', 'payments', 'clients', 'products', 'cash', 'messages', 'crm', 'projects', 'expenses', 'requests'],
  acheteur: ['dashboard', 'purchases', 'suppliers', 'products', 'stock', 'expenses', 'requests'],
  magasinier: ['dashboard', 'purchases', 'stock', 'suppliers', 'products', 'expenses', 'requests'],
  caissier: ['cash', 'expenses'],
  rh: ['hr', 'expenses', 'requests'],
  chef_service: ['dashboard', 'reports', 'projects', 'expenses', 'requests', 'approvals'],
  employe: ['expenses', 'requests'],
  licences: ['licensing']
}

/** Matrice des droits personnalisée par la société (Administration → Rôles et droits). */
let roleOverrides: Partial<Record<Role, Module[]>> = {}

export function setRolePermissions(overrides: Partial<Record<Role, Module[]>> | null | undefined) {
  roleOverrides = overrides ?? {}
}

/**
 * Serveur : la matrice dépend de la base servie par la requête en cours. Le routeur fournit
 * ici de quoi la retrouver ; sans cela, deux sociétés hébergées partageraient la même matrice.
 */
let scoped: (() => Partial<Record<Role, Module[]>> | undefined) | null = null
export function setPermissionResolver(fn: (() => Partial<Record<Role, Module[]>> | undefined) | null) {
  scoped = fn
}

/** Modules accessibles à un rôle : matrice de la société, sinon droits par défaut. L'administrateur a toujours tout. */
export function permissionsOf(role: Role): Module[] {
  if (role === 'admin') return PERMISSIONS.admin
  return (scoped?.() ?? roleOverrides)[role] ?? PERMISSIONS[role] ?? []
}

export function can(role: Role, module: Module): boolean {
  return permissionsOf(role).includes(module)
}

export type DocType = 'DEV' | 'BL' | 'FAC' | 'AV' | 'BC' | 'BR' | 'FF'
export type DocSide = 'sale' | 'purchase'
export type DocStatus = 'brouillon' | 'valide' | 'annule'

export interface DocTypeInfo {
  label: string
  plural: string
  /** Genre grammatical, pour « Nouvelle facture » / « Nouveau devis ». */
  fem: boolean
  side: DocSide
  /** Mouvement de stock à la validation : -1 sortie, +1 entrée, 0 aucun. */
  stock: -1 | 0 | 1
  /** Le document porte une dette/créance réglable par paiement. */
  payable: boolean
  /** Types vers lesquels ce document peut être transformé. */
  convertsTo: DocType[]
}

export const DOC_TYPES: Record<DocType, DocTypeInfo> = {
  DEV: { label: 'Devis', plural: 'Devis', fem: false, side: 'sale', stock: 0, payable: false, convertsTo: ['BL', 'FAC'] },
  BL: { label: 'Bon de livraison', plural: 'Bons de livraison', fem: false, side: 'sale', stock: -1, payable: false, convertsTo: ['FAC'] },
  FAC: { label: 'Facture', plural: 'Factures', fem: true, side: 'sale', stock: -1, payable: true, convertsTo: ['AV'] },
  AV: { label: 'Avoir', plural: 'Avoirs', fem: false, side: 'sale', stock: 1, payable: true, convertsTo: [] },
  BC: { label: 'Bon de commande', plural: 'Bons de commande', fem: false, side: 'purchase', stock: 0, payable: false, convertsTo: ['BR', 'FF'] },
  BR: { label: 'Bon de réception', plural: 'Bons de réception', fem: false, side: 'purchase', stock: 1, payable: false, convertsTo: ['FF'] },
  FF: { label: 'Facture fournisseur', plural: 'Factures fournisseurs', fem: true, side: 'purchase', stock: 1, payable: true, convertsTo: [] }
}

/** Modèles de mise en page des documents (devis, factures, bons) : même contenu, habillage différent. */
export const DOC_LAYOUTS = [
  { id: 'moderne', label: 'Moderne', hint: 'Liseré et en-têtes à la couleur de la société.' },
  { id: 'bandeau', label: 'Bandeau', hint: 'En-tête plein en couleur, blocs teintés.' },
  { id: 'elegant', label: 'Élégant', hint: 'Titres à empattements, filets fins, beaucoup d’air.' },
  { id: 'classique', label: 'Classique', hint: 'Sobre, en-têtes gris anthracite.' },
  { id: 'minimal', label: 'Minimal', hint: 'Sans aplat : économe en encre, idéal en noir et blanc.' },
  { id: 'compact', label: 'Compact', hint: 'Petits caractères : plus de lignes par page.' }
] as const
export type DocLayout = (typeof DOC_LAYOUTS)[number]['id']

export const PAYMENT_METHODS = ['Espèces', 'Orange Money', 'Moov Money', 'Wave', 'Virement', 'Chèque', 'Carte bancaire', 'Autre'] as const

/** Comptes de trésorerie SYSCOHADA et journal associés à chaque mode de paiement. */
export function treasuryFor(method: string): { account: string; journal: 'CA' | 'MM' | 'BQ' } {
  if (method === 'Espèces') return { account: '571', journal: 'CA' }
  if (/money|wave/i.test(method)) return { account: '552', journal: 'MM' }
  return { account: '521', journal: 'BQ' }
}

export const JOURNALS: Record<string, string> = {
  VT: 'Ventes',
  AC: 'Achats',
  CA: 'Caisse',
  MM: 'Mobile money',
  BQ: 'Banque',
  OD: 'Opérations diverses'
}

export interface LineInput {
  product_id: number | null
  description: string
  quantity: number
  unit_price: number
  discount: number // en %
  tva_rate: number // en %
}

export interface Totals {
  ht: number
  tva: number
  ttc: number
  byRate: { rate: number; base: number; tva: number }[]
}

export const roundMoney = (n: number): number => Math.round(n)

export function lineHT(l: Pick<LineInput, 'quantity' | 'unit_price' | 'discount'>): number {
  return roundMoney(l.quantity * l.unit_price * (1 - (l.discount || 0) / 100))
}

/** Totaux d'un document ; la TVA est calculée par taux sur la base cumulée. */
export function computeTotals(lines: LineInput[]): Totals {
  const rates = new Map<number, number>()
  for (const l of lines) rates.set(l.tva_rate, (rates.get(l.tva_rate) ?? 0) + lineHT(l))
  const byRate = [...rates.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rate, base]) => ({ rate, base, tva: roundMoney((base * rate) / 100) }))
  const ht = byRate.reduce((s, r) => s + r.base, 0)
  const tva = byRate.reduce((s, r) => s + r.tva, 0)
  return { ht, tva, ttc: ht + tva, byRate }
}

/** Coût moyen unitaire pondéré après une entrée en stock. */
export function weightedCost(stockQty: number, stockCost: number, inQty: number, inCost: number): number {
  const before = Math.max(stockQty, 0)
  const total = before + inQty
  if (total <= 0) return inCost
  return (before * stockCost + inQty * inCost) / total
}

export type PaymentState = 'non_payee' | 'partielle' | 'payee' | 'en_retard'

export function paymentState(total: number, paid: number, dueDate: string | null, today: string): PaymentState {
  if (paid >= total && total > 0) return 'payee'
  if (dueDate && dueDate < today) return 'en_retard'
  return paid > 0 ? 'partielle' : 'non_payee'
}

export const PAYMENT_STATE_LABELS: Record<PaymentState, string> = {
  non_payee: 'Non payée',
  partielle: 'Partielle',
  payee: 'Payée',
  en_retard: 'En retard'
}
