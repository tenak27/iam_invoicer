// API et webhooks d'IAM INVOICER, serveur web (base commune : tools/socle/server/integrations.ts).
// Chaque client hébergé a sa propre base : un seul espace par base, la société. Une clé d'API appelle les
// mêmes fonctions que l'application, au nom de l'administrateur qui l'a créée ; les webhooks suivent les
// documents (devis, factures, avoirs…), les paiements, les clients et fournisseurs, le stock et la caisse.
import type { Db } from '../main/db'
import { audit, fail, type SessionUser } from '../main/services/context'
import { checkUserPassword } from '../main/services/auth'
import { isDemoDb } from '../main/services/demoMode'
import type { IntegrationsConfig, Trigger } from '../../tools/socle/server/integrations'

export const EVENTS: Record<string, string> = {
  'document.created': 'Document créé (devis, facture, bon de commande…)',
  'document.validated': 'Document validé (facture émise…)',
  'document.cancelled': 'Document annulé',
  'payment.received': 'Paiement enregistré',
  'party.created': 'Client ou fournisseur ajouté',
  'stock.adjusted': 'Stock ajusté',
  'expense.decided': 'Note de frais approuvée ou refusée',
  'cash.closed': 'Caisse clôturée'
}

/** Résumé d'un document pour les webhooks. */
async function doc(db: Db, id: unknown) {
  if (!Number(id)) return null
  return (
    (await db.one(
      `SELECT d.id, d.type, d.number, d.status, d.date, d.due_date, d.reference, d.total_ht, d.total_tva, d.total_ttc, p.id AS party_id, p.kind AS party_kind, p.name AS party
       FROM documents d JOIN parties p ON p.id = d.party_id WHERE d.id = $1`,
      [Number(id)]
    )) ?? null
  )
}

export function integrationsConfig(db: Db, dispatch: IntegrationsConfig['dispatch']): IntegrationsConfig {
  return {
    spaceOf: () => 'societe',
    demo: () => isDemoDb(db),
    isAdmin: (u) => u.role === 'admin',
    userById: async (id) => (await db.one<SessionUser>('SELECT id, username, full_name, role FROM users WHERE id = $1 AND active', [id])) ?? null,
    checkPassword: (u, password) => checkUserPassword(db, u.id, password),
    adminIds: async () => (await db.query<{ id: number }>("SELECT id FROM users WHERE role = 'admin' AND active")).map((r) => r.id),
    log: (u, details) => audit(db, { db, user: u }, 'integrations', 'integrations', null, details),
    dispatch,
    events: EVENTS,
    read: /^(parties\.(list|get|options)|products\.(list|categories)|documents\.(list|get)|payments\.list|stock\.(movements|inventory|valuation|warehouses|byWarehouse|transfers|lots|trace)|reports\.(dashboard|sales)|cash\.(current|history|detail)|accounting\.(accounts|balanceSheet|entries|ledger|balance|income)|declarations\.month|crm\.(list|get|agenda|pipeline|clients)|projects\.(list|get)|assets\.list|expenses\.(list|get)|requests\.(list|get)|budget\.(get|forecasts)|recurring\.(list|upcoming)|taxes\.list)$/,
    // Émission de licences, exercices, messages et signatures (envois), imports, assistant : jamais par une clé
    forbidden: /^(licensing|fiscal|fiscalGuard|messages|signatures|imports|assistant)\.|^documents\.purge$|^recurring\.runDue$/,
    triggers: {
      // Enregistré et validé d'un seul geste (validate: true) : les deux événements partent
      'documents.save': async (a, d) => {
        const x = await doc(db, d?.id)
        const out: Trigger[] = []
        if (!a.id) out.push(['document.created', x])
        if (a.validate && x?.status === 'valide') out.push(['document.validated', x])
        return out
      },
      'documents.validate': async (a) => ['document.validated', await doc(db, a.id)],
      'documents.cancel': async (a) => ['document.cancelled', await doc(db, a.id)],
      'payments.add': async (a) => ['payment.received', { document: await doc(db, a.document_id), amount: Number(a.amount) || 0, method: String(a.method ?? ''), reference: String(a.reference ?? ''), date: a.date ?? null }],
      'parties.save': (a, d) => !a.id && ['party.created', { id: d?.id ?? null, kind: a.kind === 'supplier' ? 'supplier' : 'client', name: String(a.name ?? '') }],
      'stock.adjust': (a) => ['stock.adjusted', { product_id: a.productId ?? null, quantity: Number(a.quantity) || 0, note: String(a.note ?? ''), warehouse_id: a.warehouseId ?? null }],
      'expenses.decide': (a) => ['expense.decided', { id: a.id, approved: !!a.approve, comment: String(a.comment ?? '') }],
      'cash.close': (a) => ['cash.closed', { counted_amount: Number(a.counted_amount) || 0, note: String(a.note ?? '') }]
    },
    examples: ['POST documents.list {"types": ["FAC"], "unpaidOnly": true}', 'GET parties.list?kind=client', 'POST payments.add {"document_id": 42, "amount": 150000, "method": "Orange Money", "reference": "OM-1024"}'],
    settingsUrl: '/settings',
    fail
  }
}
