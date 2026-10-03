// Règles métier partagées entre le processus principal et l'interface.

export type Role = 'admin' | 'commercial' | 'magasinier' | 'comptable' | 'caissier' | 'rh'

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrateur',
  commercial: 'Commercial',
  magasinier: 'Magasinier',
  comptable: 'Comptable',
  caissier: 'Caissier',
  rh: 'Ressources humaines'
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
  | 'settings'
  | 'users'

export const PERMISSIONS: Record<Role, Module[]> = {
  admin: ['dashboard', 'sales', 'purchases', 'stock', 'payments', 'clients', 'suppliers', 'products', 'reports', 'cash', 'accounting', 'messages', 'hr', 'crm', 'projects', 'assets', 'budget', 'settings', 'users'],
  commercial: ['dashboard', 'sales', 'payments', 'clients', 'products', 'cash', 'messages', 'crm', 'projects'],
  magasinier: ['dashboard', 'purchases', 'stock', 'suppliers', 'products'],
  comptable: ['dashboard', 'sales', 'purchases', 'payments', 'clients', 'suppliers', 'reports', 'accounting', 'messages', 'hr', 'projects', 'assets', 'budget'],
  caissier: ['cash'],
  rh: ['hr']
}

/** Matrice des droits personnalisée par la société (Administration → Rôles et droits). */
let roleOverrides: Partial<Record<Role, Module[]>> = {}

export function setRolePermissions(overrides: Partial<Record<Role, Module[]>> | null | undefined) {
  roleOverrides = overrides ?? {}
}

/** Modules accessibles à un rôle : matrice de la société, sinon droits par défaut. L'administrateur a toujours tout. */
export function permissionsOf(role: Role): Module[] {
  if (role === 'admin') return PERMISSIONS.admin
  return roleOverrides[role] ?? PERMISSIONS[role] ?? []
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

export const SALE_TYPES: DocType[] = ['DEV', 'BL', 'FAC', 'AV']
export const PURCHASE_TYPES: DocType[] = ['BC', 'BR', 'FF']

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
