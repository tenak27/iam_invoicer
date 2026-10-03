// Point d'entrée unique des appels de l'interface : contrôle de session et de
// droits, puis appel du service. Indépendant d'Electron pour être testable.

import { can, DOC_TYPES, type DocType, type Module } from '@shared/domain'
import { AppError, fail, type Ctx } from './services/context'
import * as auth from './services/auth'
import * as settings from './services/settings'
import * as parties from './services/parties'
import * as products from './services/products'
import * as documents from './services/documents'
import * as stock from './services/stock'
import * as payments from './services/payments'
import * as reports from './services/reports'
import * as accounting from './services/accounting'
import * as cash from './services/cash'
import * as messaging from './services/messaging'
import * as signatures from './services/signatures'
import { saveSecrets, secretStatus } from './services/settings'

type Handler = (ctx: Ctx, args: any) => Promise<unknown>
type Access = Module | 'public' | 'user' | ((ctx: Ctx, args: any) => Promise<Module>)

const partyModule = (args: any): Module => (args?.kind === 'supplier' ? 'suppliers' : 'clients')
const sideModule = (type: DocType): Module => (DOC_TYPES[type]?.side === 'purchase' ? 'purchases' : 'sales')
const docModule = async (ctx: Ctx, args: any): Promise<Module> => {
  const d = await ctx.db.one('SELECT type FROM documents WHERE id = $1', [args?.id ?? args?.document_id ?? args?.documentId])
  if (!d) fail('Document introuvable.')
  return sideModule(d.type)
}

/** Envoi lié à un document : droit sur ce document ET droit « messages ». */
const docOrMessages = async (ctx: Ctx, args: any): Promise<Module> => {
  if (args?.documentId) {
    const mod = await docModule(ctx, args)
    if (!can(ctx.user!.role, mod)) return mod
  }
  return 'messages'
}

export const routes: Record<string, { access: Access; fn: Handler }> = {
  'auth.needsSetup': { access: 'public', fn: (ctx) => auth.needsSetup(ctx.db) },
  'auth.setup': { access: 'public', fn: auth.setup },
  'auth.changePassword': { access: 'user', fn: auth.changeOwnPassword },

  'users.list': { access: 'users', fn: auth.listUsers },
  'users.save': { access: 'users', fn: auth.saveUser },

  'settings.get': { access: 'user', fn: (ctx) => settings.getSettings(ctx.db) },
  'settings.save': { access: 'settings', fn: settings.saveSettings },

  'parties.list': { access: async (_c, a) => partyModule(a), fn: parties.listParties },
  'parties.get': {
    access: async (ctx, a) => {
      const p = await ctx.db.one('SELECT kind FROM parties WHERE id = $1', [a?.id])
      return partyModule(p)
    },
    fn: parties.getParty
  },
  'parties.save': { access: async (_c, a) => partyModule(a), fn: parties.saveParty },
  // Listes de choix utilisées dans les documents : accessibles à qui gère le côté concerné.
  'parties.options': {
    access: async (_c, a) => (a?.kind === 'supplier' ? 'purchases' : 'sales'),
    fn: (ctx, a) => ctx.db.query('SELECT id, code, name, payment_terms FROM parties WHERE kind = $1 AND active ORDER BY name', [a.kind])
  },

  'products.list': { access: 'user', fn: products.listProducts },
  'products.categories': { access: 'user', fn: products.listCategories },
  'products.save': { access: 'products', fn: products.saveProduct },

  'documents.list': {
    access: async (_c, a) => sideModule((a?.types ?? [])[0]),
    fn: documents.listDocuments
  },
  'documents.get': { access: docModule, fn: documents.getDocument },
  'documents.save': {
    access: async (ctx, a) => (a?.id ? docModule(ctx, a) : sideModule(a?.type)),
    fn: documents.saveDocument
  },
  'documents.delete': { access: docModule, fn: documents.deleteDraft },
  'documents.validate': { access: docModule, fn: documents.validateDocument },
  'documents.cancel': { access: docModule, fn: documents.cancelDocument },
  'documents.convert': { access: docModule, fn: documents.convertDocument },
  'documents.duplicate': { access: docModule, fn: documents.duplicateDocument },

  'stock.movements': { access: 'stock', fn: stock.listMovements },
  'stock.inventory': { access: 'stock', fn: stock.recordInventory },
  'stock.adjust': { access: 'stock', fn: stock.adjustStock },
  'stock.valuation': { access: 'stock', fn: reports.stockValuation },

  'payments.list': { access: 'payments', fn: payments.listPayments },
  'payments.add': { access: 'payments', fn: payments.addPayment },
  'payments.delete': { access: 'payments', fn: payments.deletePayment },

  'reports.dashboard': { access: 'dashboard', fn: reports.dashboard },
  'reports.sales': { access: 'reports', fn: reports.salesReport },
  'reports.audit': { access: 'users', fn: reports.auditLog },

  'cash.current': { access: 'cash', fn: cash.current },
  'cash.open': { access: 'cash', fn: cash.open },
  'cash.sale': { access: 'cash', fn: cash.sale },
  'cash.movement': { access: 'cash', fn: cash.movement },
  'cash.close': { access: 'cash', fn: cash.close },
  'cash.history': { access: 'cash', fn: cash.history },
  'cash.detail': { access: 'cash', fn: cash.detail },
  'cash.options': { access: 'cash', fn: cash.options },

  'accounting.accounts': { access: 'accounting', fn: accounting.listAccounts },
  'accounting.saveAccount': { access: 'accounting', fn: accounting.saveAccount },
  'accounting.entries': { access: 'accounting', fn: accounting.listEntries },
  'accounting.ledger': { access: 'accounting', fn: accounting.ledger },
  'accounting.balance': { access: 'accounting', fn: accounting.trialBalance },
  'accounting.income': { access: 'accounting', fn: accounting.incomeStatement },
  'accounting.saveEntry': { access: 'accounting', fn: accounting.saveManualEntry },
  'accounting.deleteEntry': { access: 'accounting', fn: accounting.deleteManualEntry },
  'accounting.missing': { access: 'accounting', fn: accounting.missingCount },
  'accounting.generateMissing': { access: 'accounting', fn: accounting.generateMissing },

  'settings.secrets': { access: 'settings', fn: secretStatus },
  'settings.saveSecrets': { access: 'settings', fn: saveSecrets },

  // Communications : le droit sur le document est vérifié en plus du droit « messages ».
  'messages.templates': { access: 'messages', fn: messaging.listTemplates },
  'messages.saveTemplate': { access: 'settings', fn: messaging.saveTemplate },
  'messages.preview': { access: docOrMessages, fn: messaging.preview },
  'messages.sendEmail': { access: docOrMessages, fn: messaging.sendEmail },
  'messages.sendDocument': { access: docOrMessages, fn: messaging.sendDocument },
  'messages.sendSms': { access: docOrMessages, fn: messaging.sendSms },
  'messages.test': { access: 'settings', fn: messaging.sendTest },
  'messages.log': { access: 'messages', fn: messaging.listLog },
  'messages.remind': { access: docOrMessages, fn: messaging.remind },
  'messages.remindAll': { access: 'messages', fn: messaging.remindAll },

  'signatures.list': { access: docModule, fn: signatures.listSignatures },
  'signatures.signOnSite': { access: docModule, fn: signatures.signOnSite },
  'signatures.request': { access: docModule, fn: signatures.createRequest }
}

export type CallResult = { ok: true; data: unknown } | { ok: false; error: string }

export async function call(ctx: Ctx, name: string, args: unknown): Promise<CallResult> {
  try {
    const route = routes[name]
    if (!route) fail(`Action inconnue : ${name}`)
    if (route.access !== 'public') {
      if (!ctx.user) fail('Session expirée, veuillez vous reconnecter.')
      if (route.access !== 'user') {
        const mod = typeof route.access === 'function' ? await route.access(ctx, args) : route.access
        if (!can(ctx.user.role, mod)) fail("Vous n'avez pas les droits pour cette action.")
      }
    }
    return { ok: true, data: await route.fn(ctx, args ?? {}) }
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message }
    console.error(`[${name}]`, e)
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `Erreur technique : ${msg}` }
  }
}
