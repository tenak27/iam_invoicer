// Préparation des documents imprimables, commune à l'application de bureau
// (export PDF par Electron) et au serveur web (impression par le navigateur).

import { call } from './router'
import { AppError, type Ctx } from './services/context'
import { DOC_TYPES, type DocType } from '@shared/domain'
import { formatDate, formatMoney } from '@shared/format'
import { ensureAuthCode, formatAuthCode, loadDocument } from './services/documents'
import { getSettings } from './services/settings'
import { licenceStatus } from './services/licence'
import { signaturesForPrint } from './services/signatures'
import { documentHtml, pdfFooterTemplate, receiptHtml } from './pdf'

export type PrintFormat = 'a4' | 'ticket'

export interface Printable {
  html: string
  footer: string
  filename: string
  format: PrintFormat
}

/** forPdf : le pied de page est rendu par printToPDF (Electron) au lieu d'un élément fixe. */
export async function printable(ctx: Ctx, id: number, format: PrintFormat = 'a4', forPdf = true): Promise<Printable> {
  // Contrôle des droits : un caissier peut imprimer le ticket d'une vente de sa caisse.
  const check = await call(ctx, 'documents.get', { id })
  if (!check.ok) {
    const own =
      format === 'ticket' &&
      ctx.user &&
      (await ctx.db.one(
        `SELECT 1 FROM payments py JOIN cash_sessions s ON s.id = py.cash_session_id
         WHERE py.document_id = $1 AND s.user_id = $2`,
        [id, ctx.user.id]
      ))
    if (!own) throw new AppError(check.error)
  }
  const doc = await loadDocument(ctx.db, id)
  doc.signatures = await signaturesForPrint(ctx.db, id)
  const company = await getSettings(ctx.db)
  const evaluation = (await licenceStatus(ctx.db)).state !== 'active'
  // Authenticité : QR code vers la page de vérification si l'adresse publique est connue,
  // sinon QR code portant ce que la société a enregistré (poste sans serveur en ligne).
  if (doc.status !== 'brouillon' && company.doc_show_qr !== false) {
    const code = doc.auth_code ?? (await ensureAuthCode(ctx.db, id))
    const base = String(ctx.origin || company.public_url || '').replace(/\/+$/, '')
    const url = /^https?:\/\//.test(base) ? `${base}/verify/${code}` : null
    const text = [
      'Document authentique', company.name, `${DOC_TYPES[doc.type as DocType].label} ${doc.number}`, `Date : ${formatDate(doc.date)}`,
      `Total TTC : ${formatMoney(doc.total_ttc, company.currency || 'FCFA')}`, `Client : ${doc.party.name}`, `Code : ${formatAuthCode(code)}`
    ].join('\n')
    doc.auth = { code: formatAuthCode(code), qr: url ?? text, url }
  }
  const html = format === 'ticket' ? receiptHtml(doc, company, evaluation) : documentHtml(doc, company, forPdf, evaluation)
  const filename = `${doc.number ?? 'Brouillon-' + doc.type + '-' + doc.id} - ${doc.party.name}`.replace(/[\/:*?"<>|]/g, '-') + '.pdf'
  return { html, footer: pdfFooterTemplate(company), filename, format }
}
