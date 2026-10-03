// Mise en page HTML des documents imprimables (convertie en PDF par Electron).

import { DOC_TYPES, type DocType } from '@shared/domain'
import { amountInWords, formatDate, formatMoney, formatNumber, formatQty } from '@shared/format'
import type { CompanySettings } from './services/settings'

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const nl2br = (s: string): string => esc(s).replace(/\n/g, '<br>')

/** Mentions légales du pied de page. */
export function legalLine(company: CompanySettings): string {
  const parts = [
    company.legal_form && `${esc(company.legal_form)}${company.capital ? ` au capital de ${esc(company.capital)}` : ''}`,
    company.rccm && `RCCM : ${esc(company.rccm)}`,
    company.tax_id && `${esc(company.tax_id_label || 'IFU')} : ${esc(company.tax_id)}`,
    company.regime_fiscal && `Régime ${esc(company.regime_fiscal)}`,
    company.division_fiscale && esc(company.division_fiscale),
    company.bank_name && `${esc(company.bank_name)}${company.bank_account ? ` — ${esc(company.bank_account)}` : ''}`
  ].filter(Boolean).join(' · ')
  return esc(company.name) + (parts ? ' · ' + parts : '')
}

/** Pied de page natif de Chromium (export PDF) avec numérotation des pages. */
export function pdfFooterTemplate(company: CompanySettings): string {
  return `<div style="width:100%;font-family:Segoe UI,Arial,sans-serif;font-size:7.5pt;color:#7b8794;padding:0 14mm;display:flex;justify-content:space-between"><span>${legalLine(company)}</span><span>Page <span class="pageNumber"></span>/<span class="totalPages"></span></span></div>`
}

/** forPdf : le pied de page est rendu par printToPDF au lieu d'un élément fixe. */
export function documentHtml(doc: any, company: CompanySettings, forPdf = false): string {
  const type = doc.type as DocType
  const info = DOC_TYPES[type]
  const cur = company.currency || 'FCFA'
  const money = (n: number) => formatMoney(n, cur)
  const party = doc.party
  const showPrices = type !== 'BL' && type !== 'BR'
  const isDraft = doc.status === 'brouillon'
  const isCancelled = doc.status === 'annule'

  const rates = new Map<number, { base: number; tva: number }>()
  for (const l of doc.lines) {
    const r = rates.get(l.tva_rate) ?? { base: 0, tva: 0 }
    r.base += l.total_ht
    rates.set(l.tva_rate, r)
  }
  const tvaRows = [...rates.entries()]
    .filter(([rate]) => rate > 0)
    .map(([rate, r]) => `<tr><td>TVA ${formatNumber(rate, rate % 1 ? 1 : 0)} % sur ${money(r.base)}</td><td>${money(Math.round((r.base * rate) / 100))}</td></tr>`)
    .join('')

  const lines = doc.lines
    .map(
      (l: any) => `
      <tr>
        <td class="ref">${esc(l.product_ref ?? '')}</td>
        <td>${nl2br(l.description)}</td>
        <td class="num">${formatQty(l.quantity)}${l.product_unit ? ` <span class="unit">${esc(l.product_unit)}</span>` : ''}</td>
        ${showPrices ? `
        <td class="num">${formatNumber(l.unit_price)}</td>
        <td class="num">${l.discount ? formatNumber(l.discount, l.discount % 1 ? 1 : 0) + ' %' : ''}</td>
        <td class="num">${formatNumber(l.tva_rate)} %</td>
        <td class="num">${formatNumber(l.total_ht)}</td>` : ''}
      </tr>`
    )
    .join('')


  const partyLabel = info.side === 'sale' ? (type === 'DEV' ? 'Client' : 'Facturé à') : 'Fournisseur'
  const remaining = doc.total_ttc - (doc.paid ?? 0)

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>${esc(doc.number ?? info.label)}</title>
<style>
  @page { size: A4; margin: 14mm 14mm 20mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10pt; color: #1f2933; margin: 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
  .logo { max-height: 70px; max-width: 220px; margin-bottom: 6px; }
  .company-name { font-size: 16pt; font-weight: 700; color: #0b4f8a; }
  .muted { color: #5f6b7a; font-size: 9pt; line-height: 1.45; }
  .doc-title { text-align: right; }
  .doc-title h1 { margin: 0; font-size: 20pt; color: #0b4f8a; letter-spacing: .5px; text-transform: uppercase; }
  .doc-title .num { font-size: 12pt; font-weight: 600; margin-top: 4px; }
  .meta { margin-top: 6px; }
  .meta td { padding: 1px 0 1px 12px; }
  .meta td:first-child { color: #5f6b7a; }
  .parties { display: flex; justify-content: flex-end; margin: 22px 0 18px; }
  .box { border: 1px solid #d4dbe3; border-radius: 6px; padding: 10px 14px; min-width: 46%; }
  .box .label { font-size: 8pt; text-transform: uppercase; color: #5f6b7a; letter-spacing: .5px; }
  .box .name { font-size: 11.5pt; font-weight: 600; margin: 2px 0 4px; }
  table.lines { width: 100%; border-collapse: collapse; }
  table.lines th { background: #0b4f8a; color: #fff; font-weight: 600; font-size: 8.5pt; text-align: left; padding: 6px 6px; }
  table.lines td { padding: 6px 6px; border-bottom: 1px solid #e4e9ef; vertical-align: top; }
  table.lines tr:nth-child(even) td { background: #f6f8fb; }
  .num { text-align: right; white-space: nowrap; }
  th.num { text-align: right; }
  .ref { color: #5f6b7a; font-size: 8.5pt; white-space: nowrap; }
  .unit { color: #5f6b7a; font-size: 8pt; }
  .bottom { display: flex; justify-content: space-between; gap: 24px; margin-top: 14px; page-break-inside: avoid; }
  .totals { border-collapse: collapse; min-width: 44%; }
  .totals td { padding: 4px 8px; }
  .totals td:last-child { text-align: right; white-space: nowrap; }
  .totals .grand td { background: #0b4f8a; color: #fff; font-weight: 700; font-size: 11pt; }
  .words { margin-top: 16px; padding: 8px 12px; background: #f6f8fb; border-left: 3px solid #0b4f8a; page-break-inside: avoid; }
  .notes { flex: 1; }
  .sign { display: flex; justify-content: space-between; margin-top: 28px; page-break-inside: avoid; }
  .sign div { width: 45%; border-top: 1px solid #9aa5b1; padding-top: 4px; font-size: 9pt; color: #5f6b7a; height: 70px; }
  .footer { position: fixed; bottom: 0; left: 0; right: 0; text-align: center; font-size: 7.5pt; color: #7b8794; border-top: 1px solid #e4e9ef; padding-top: 4px; }
  .stamp { position: fixed; top: 40%; left: 15%; font-size: 64pt; color: rgba(200, 30, 30, .13); transform: rotate(-25deg); font-weight: 800; }
</style></head>
<body>
  ${isDraft ? '<div class="stamp">BROUILLON</div>' : isCancelled ? '<div class="stamp">ANNULÉ</div>' : ''}
  <div class="head">
    <div>
      ${company.logo ? `<img class="logo" src="${company.logo}">` : ''}
      <div class="company-name">${esc(company.name)}</div>
      <div class="muted">
        ${company.activity ? esc(company.activity) + '<br>' : ''}
        ${company.address ? nl2br(company.address) + '<br>' : ''}
        ${[company.city, company.country].filter(Boolean).map(esc).join(', ')}${company.city || company.country ? '<br>' : ''}
        ${company.phone ? 'Tél. ' + esc(company.phone) + '<br>' : ''}
        ${company.email ? esc(company.email) : ''}${company.website ? ' · ' + esc(company.website) : ''}
      </div>
    </div>
    <div class="doc-title">
      <h1>${esc(info.label)}</h1>
      <div class="num">${esc(doc.number ?? 'Brouillon')}</div>
      <table class="meta" align="right">
        <tr><td>Date</td><td>${formatDate(doc.date)}</td></tr>
        ${doc.due_date && info.payable ? `<tr><td>Échéance</td><td>${formatDate(doc.due_date)}</td></tr>` : ''}
        ${doc.reference ? `<tr><td>Référence</td><td>${esc(doc.reference)}</td></tr>` : ''}
        ${party.code ? `<tr><td>Code ${info.side === 'sale' ? 'client' : 'fournisseur'}</td><td>${esc(party.code)}</td></tr>` : ''}
      </table>
    </div>
  </div>

  <div class="parties">
    <div class="box">
      <div class="label">${partyLabel}</div>
      <div class="name">${esc(party.name)}</div>
      <div class="muted">
        ${party.contact ? 'À l’attention de ' + esc(party.contact) + '<br>' : ''}
        ${party.address ? nl2br(party.address) + '<br>' : ''}
        ${party.city ? esc(party.city) + '<br>' : ''}
        ${party.phone ? 'Tél. ' + esc(party.phone) + '<br>' : ''}
        ${party.tax_id ? esc(company.tax_id_label || 'NIF') + ' : ' + esc(party.tax_id) + '<br>' : ''}
        ${party.rccm ? 'RCCM : ' + esc(party.rccm) : ''}
      </div>
    </div>
  </div>

  <table class="lines">
    <thead><tr>
      <th>Réf.</th><th>Désignation</th><th class="num">Qté</th>
      ${showPrices ? '<th class="num">P.U. HT</th><th class="num">Remise</th><th class="num">TVA</th><th class="num">Total HT</th>' : ''}
    </tr></thead>
    <tbody>${lines}</tbody>
  </table>

  ${showPrices ? `
  <div class="bottom">
    <div class="notes">${doc.notes ? `<div class="muted"><strong>Observations</strong><br>${nl2br(doc.notes)}</div>` : ''}</div>
    <table class="totals">
      <tr><td>Total HT</td><td>${money(doc.total_ht)}</td></tr>
      ${tvaRows}
      <tr class="grand"><td>Total TTC</td><td>${money(doc.total_ttc)}</td></tr>
      ${info.payable && doc.paid > 0 ? `<tr><td>Déjà réglé</td><td>${money(doc.paid)}</td></tr><tr><td><strong>Reste à payer</strong></td><td><strong>${money(remaining)}</strong></td></tr>` : ''}
    </table>
  </div>
  <div class="words">Arrêté${type === 'FAC' || type === 'FF' ? 'e' : ''} ${type === 'DEV' ? 'le présent devis' : type === 'BC' ? 'le présent bon de commande' : type === 'AV' ? 'le présent avoir' : 'la présente facture'} à la somme de : <strong>${esc(amountInWords(doc.total_ttc))}</strong> TTC.</div>
  ` : doc.notes ? `<div class="muted" style="margin-top:14px"><strong>Observations</strong><br>${nl2br(doc.notes)}</div>` : ''}

  ${type === 'DEV' ? '<p class="muted" style="margin-top:14px">Devis valable 30 jours. Bon pour accord : date, signature et cachet du client.</p>' : ''}
  ${type === 'FAC' && company.bank_account ? `<p class="muted" style="margin-top:14px">Règlement par virement : ${esc(company.bank_name)} — ${esc(company.bank_account)}</p>` : ''}
  ${type === 'BL' || type === 'BR' || type === 'DEV' || type === 'BC'
    ? `<div class="sign"><div>${type === 'BL' ? 'Livré par' : type === 'BR' ? 'Réceptionné par' : 'Pour ' + esc(company.name)}</div><div>${type === 'BL' ? 'Reçu par le client (nom, date, signature)' : type === 'BR' ? 'Livreur' : type === 'DEV' ? 'Bon pour accord du client' : 'Signature et cachet'}</div></div>`
    : ''}
  ${company.invoice_footer && info.side === 'sale' ? `<p class="muted" style="margin-top:18px;text-align:center">${esc(company.invoice_footer)}</p>` : ''}

  ${forPdf ? '' : `<div class="footer">${legalLine(company)}</div>`}
</body></html>`
}

/** Ticket de caisse 80 mm (imprimante thermique). */
export function receiptHtml(doc: any, company: CompanySettings): string {
  const cur = company.currency || 'FCFA'
  const lines = doc.lines
    .map(
      (l: any) => `<tr><td colspan="2">${esc(l.description)}</td></tr>
      <tr><td class="muted">${formatQty(l.quantity)} × ${formatNumber(l.unit_price)}${l.discount ? ` −${formatNumber(l.discount)} %` : ''}</td><td class="num">${formatNumber(l.total_ht)}</td></tr>`
    )
    .join('')
  const paid = (doc.payments ?? []).map((p: any) => `<tr><td>${esc(p.method)}</td><td class="num">${formatNumber(p.amount)}</td></tr>`).join('')
  const remaining = doc.total_ttc - (doc.paid ?? 0)
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>${esc(doc.number ?? 'Ticket')}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 9pt; color: #000; margin: 0; width: 72mm; }
  .c { text-align: center; }
  .logo { max-width: 40mm; max-height: 18mm; }
  h1 { font-size: 12pt; margin: 2mm 0 0; }
  .muted { color: #444; font-size: 8pt; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: .4mm 0; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; }
  hr { border: none; border-top: 1px dashed #000; margin: 2mm 0; }
  .total td { font-size: 11pt; font-weight: 700; }
</style></head>
<body>
  <div class="c">
    ${company.logo ? `<img class="logo" src="${company.logo}"><br>` : ''}
    <h1>${esc(company.name)}</h1>
    <div class="muted">
      ${[company.address, company.city].filter(Boolean).map(esc).join(', ')}<br>
      ${company.phone ? 'Tél. ' + esc(company.phone) + '<br>' : ''}
      ${company.tax_id ? esc(company.tax_id_label || 'IFU') + ' ' + esc(company.tax_id) : ''}${company.rccm ? ' · RCCM ' + esc(company.rccm) : ''}
    </div>
  </div>
  <hr>
  <div>${esc(doc.number ?? 'Brouillon')} — ${formatDate(doc.date)}</div>
  ${doc.party?.code !== 'COMPTOIR' ? `<div>Client : ${esc(doc.party?.name)}</div>` : ''}
  <hr>
  <table>${lines}</table>
  <hr>
  <table>
    <tr><td>Total HT</td><td class="num">${formatNumber(doc.total_ht)}</td></tr>
    <tr><td>TVA</td><td class="num">${formatNumber(doc.total_tva)}</td></tr>
    <tr class="total"><td>TOTAL TTC</td><td class="num">${formatMoney(doc.total_ttc, cur)}</td></tr>
    ${paid}
    ${remaining > 0.5 ? `<tr><td><strong>Reste dû</strong></td><td class="num"><strong>${formatNumber(remaining)}</strong></td></tr>` : ''}
  </table>
  <hr>
  <div class="c muted">${esc(company.invoice_footer || 'Merci de votre visite.')}</div>
</body></html>`
}
