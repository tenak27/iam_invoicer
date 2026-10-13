// Circuits de validation partagés entre le serveur et l'interface :
//   - dépenses de l'entreprise (notes de frais, petites dépenses, charges courantes) ;
//   - expressions de besoin (demandes d'achat internes), jusqu'au bon de commande.

/** Catégories de dépenses et compte de charge SYSCOHADA débité au paiement. */
export const EXPENSE_CATEGORIES = {
  transport: { label: 'Transport et déplacements', account: '618' },
  carburant: { label: 'Carburant', account: '6053' },
  mission: { label: 'Frais de mission', account: '638' },
  repas: { label: 'Repas et réceptions', account: '638' },
  fournitures: { label: 'Fournitures de bureau', account: '6055' },
  telecom: { label: 'Téléphone et Internet', account: '628' },
  eau: { label: 'Eau', account: '6051' },
  electricite: { label: 'Électricité', account: '6052' },
  loyer: { label: 'Loyer et charges locatives', account: '622' },
  entretien: { label: 'Entretien et réparations', account: '624' },
  assurance: { label: 'Assurances', account: '625' },
  publicite: { label: 'Publicité et communication', account: '627' },
  honoraires: { label: 'Honoraires et conseils', account: '632' },
  banque: { label: 'Frais bancaires', account: '631' },
  taxes: { label: 'Timbres et droits', account: '646' },
  divers: { label: 'Dépenses diverses', account: '658' }
} as const
export type ExpenseCategory = keyof typeof EXPENSE_CATEGORIES

export type ExpenseStatus = 'brouillon' | 'soumise' | 'approuvee' | 'payee' | 'rejetee'
export const EXPENSE_STATUS: Record<ExpenseStatus, { label: string; tone: 'slate' | 'blue' | 'amber' | 'green' | 'red' }> = {
  brouillon: { label: 'Brouillon', tone: 'slate' },
  soumise: { label: 'À approuver', tone: 'amber' },
  approuvee: { label: 'À payer', tone: 'blue' },
  payee: { label: 'Payée', tone: 'green' },
  rejetee: { label: 'Rejetée', tone: 'red' }
}
/** Étapes affichées dans le fil de progression d'une dépense. */
export const EXPENSE_STEPS: { status: ExpenseStatus; label: string; who: string }[] = [
  { status: 'brouillon', label: 'Saisie', who: 'Le demandeur' },
  { status: 'soumise', label: 'Approbation', who: 'Chef de service ou direction' },
  { status: 'approuvee', label: 'Paiement', who: 'Finances ou caisse' },
  { status: 'payee', label: 'Comptabilisée', who: 'Écriture passée' }
]

export type RequestStatus = 'brouillon' | 'soumise' | 'approuvee' | 'validee' | 'commandee' | 'cloturee' | 'rejetee'
export const REQUEST_STATUS: Record<RequestStatus, { label: string; tone: 'slate' | 'blue' | 'amber' | 'green' | 'red' | 'violet' }> = {
  brouillon: { label: 'Brouillon', tone: 'slate' },
  soumise: { label: 'Visa du responsable', tone: 'amber' },
  approuvee: { label: 'Validation financière', tone: 'amber' },
  validee: { label: 'À commander', tone: 'blue' },
  commandee: { label: 'Commandée', tone: 'violet' },
  cloturee: { label: 'Clôturée', tone: 'green' },
  rejetee: { label: 'Rejetée', tone: 'red' }
}
export const REQUEST_STEPS: { status: RequestStatus; label: string; who: string }[] = [
  { status: 'brouillon', label: 'Expression du besoin', who: 'Le demandeur' },
  { status: 'soumise', label: 'Visa du responsable', who: 'Chef de service' },
  { status: 'approuvee', label: 'Validation financière', who: 'Finances ou direction' },
  { status: 'validee', label: 'Commande', who: 'Service achats' },
  { status: 'commandee', label: 'Réception', who: 'Service achats ou magasin' },
  { status: 'cloturee', label: 'Clôture', who: 'Besoin satisfait' }
]

export const REQUEST_PRIORITIES = { basse: 'Basse', normale: 'Normale', haute: 'Haute', urgente: 'Urgente' } as const
export type RequestPriority = keyof typeof REQUEST_PRIORITIES

/** Position d'un statut dans son circuit (‑1 : rejeté ou inconnu). */
export const stepIndex = <S extends string>(steps: { status: S }[], status: S) => steps.findIndex((s) => s.status === status)
