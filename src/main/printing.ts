// Préparation des documents imprimables, commune à l'application de bureau
// (export PDF par Electron) et au serveur web (impression par le navigateur).

import { call } from './router'
import { AppError, type Ctx } from './services/context'
import { loadDocument } from './services/documents'
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
  const html = format === 'ticket' ? receiptHtml(doc, company, evaluation) : documentHtml(doc, company, forPdf, evaluation)
  const filename = `${doc.number ?? 'Brouillon-' + doc.type + '-' + doc.id} - ${doc.party.name}`.replace(/[\/:*?"<>|]/g, '-') + '.pdf'
  return { html, footer: pdfFooterTemplate(company), filename, format }
}
