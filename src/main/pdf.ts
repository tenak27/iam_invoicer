// Mise en page HTML des documents imprimables (convertie en PDF par Electron).

import { DOC_LAYOUTS, DOC_TYPES, type DocLayout, type DocType } from '@shared/domain'
import { countryProfile } from '../shared/countries'
import { taxCaption, type AppliedTax } from '../shared/taxes'
import { amountInWords, formatDate, formatMoney, formatNumber, formatQty } from '@shared/format'
import type { CompanySettings } from './services/settings'
import { qrSvg } from './services/secef'

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const nl2br = (s: string): string => esc(s).replace(/\n/g, '<br>')

/** Mentions légales du pied de page. */
const escHtml = (v: unknown) => esc(v as any)

export function legalLine(company: CompanySettings, html = true): string {
  const esc = html ? escHtml : (v: unknown) => String(v ?? '')
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

/** Marges des documents (mm), bornées pour rester imprimables. */
export function docMargins(company: CompanySettings) {
  const mm = (v: unknown, d: number) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? Math.min(40, Math.max(5, n)) : d
  }
  return { top: mm(company.doc_margin_top, 14), side: mm(company.doc_margin_side, 14), bottom: mm(company.doc_margin_bottom, 22) }
}

/** Texte pour une propriété CSS « content » (pied de page imprimé). */
const cssString = (s: string) => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\n\r]+/g, ' ') + '"'

/** Pied de page natif de Chromium (export PDF) avec numérotation des pages. */
export function pdfFooterTemplate(company: CompanySettings): string {
  return `<div style="width:100%;font-family:Segoe UI,Arial,sans-serif;font-size:7.5pt;color:#7b8794;padding:0 14mm;display:flex;justify-content:space-between"><span>${legalLine(company)}</span><span>Page <span class="pageNumber"></span>/<span class="totalPages"></span></span></div>`
}

/** Teinte claire de la couleur de la société (fonds de blocs). */
const tint = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, #fff)`

/**
 * Habillage de chaque modèle : le contenu et la structure sont identiques, seules ces règles
 * changent. Elles s'appliquent à l'aperçu, à l'export PDF et à l'impression.
 */
const TEMPLATE_CSS: Record<DocLayout, (c: string) => string> = {
  moderne: () => `.band { display: block; }`,
  classique: () => `
  table.lines th, .totals .grand td { background: #33303f; }`,
  bandeau: (c) => `
  .head { background: ${c}; color: #fff; padding: 16px 18px; border-radius: 10px; }
  .head .company-name, .head .doc-title h1 { color: #fff; }
  .head .muted, .head .meta td:first-child { color: rgba(255, 255, 255, .86); }
  .head .logo { background: #fff; padding: 5px 8px; border-radius: 6px; }
  .box { border: none; border-left: 4px solid ${c}; border-radius: 4px; background: ${tint(c, 9)}; }
  table.lines th { background: ${tint(c, 14)}; color: #1f2933; border-bottom: 2px solid ${c}; }
  table.lines tr:nth-child(even) td { background: ${tint(c, 4)}; }
  .words { background: ${tint(c, 9)}; }
  .totals .grand td:first-child { border-radius: 6px 0 0 6px; }
  .totals .grand td:last-child { border-radius: 0 6px 6px 0; }`,
  elegant: (c) => `
  .company-name, .doc-title h1, .box .name { font-family: Georgia, 'Times New Roman', serif; }
  .company-name { font-weight: 400; font-size: 18pt; }
  .doc-title h1 { font-weight: 400; letter-spacing: 3px; font-size: 21pt; }
  .head { padding-bottom: 14px; border-bottom: 1px solid ${c}; }
  .box { border: none; border-top: 1.5px solid ${c}; border-radius: 0; padding: 8px 0 0; }
  table.lines th { background: none; color: #1f2933; border-top: 1.5px solid ${c}; border-bottom: 1.5px solid ${c}; text-transform: uppercase; letter-spacing: .8px; font-size: 7.5pt; padding: 8px 6px; }
  table.lines td { padding: 8px 6px; }
  table.lines tr:nth-child(even) td { background: none; }
  .totals .grand td { background: none; color: ${c}; border-top: 1.5px solid ${c}; border-bottom: 1.5px solid ${c}; font-size: 12pt; }
  .words { background: none; border-left: none; border-top: 1px solid #d4dbe3; border-bottom: 1px solid #d4dbe3; font-style: italic; }
  .sigbox, .secef, .auth { border-radius: 0; }`,
  minimal: () => `
  .company-name, .doc-title h1, .secef .t, .auth .t { color: #1f2933; }
  table.lines th { background: none; color: #1f2933; border-bottom: 1.5px solid #1f2933; }
  table.lines tr:nth-child(even) td { background: none; }
  .totals .grand td { background: none; color: #1f2933; border-top: 1.5px solid #1f2933; border-bottom: 1.5px solid #1f2933; }
  .words { background: none; border-left: 2px solid #1f2933; }`,
  compact: () => `
  .band { display: block; height: 4px; margin-bottom: 8px; }
  body { font-size: 8.5pt; }
  .logo { max-height: 46px; }
  .company-name { font-size: 13pt; }
  .doc-title h1 { font-size: 15pt; }
  .doc-title .num { font-size: 10.5pt; }
  .muted { font-size: 8pt; line-height: 1.35; }
  .parties { margin: 10px 0; }
  .box { padding: 6px 10px; }
  table.lines th { padding: 4px 5px; font-size: 7.5pt; }
  table.lines td { padding: 3px 5px; }
  .bottom { margin-top: 8px; }
  .totals td { padding: 2px 8px; }
  .words { margin-top: 8px; padding: 5px 10px; }
  .signs, .sign { margin-top: 14px; }`
}

/** Document d'exemple pour l'aperçu des modèles (Société et paramètres → Documents). */
export function sampleDocumentHtml(company: CompanySettings, layout: DocLayout, color?: string): string {
  const line = (description: string, quantity: number, unit_price: number, tva_rate: number, product_ref: string, discount = 0) => ({
    description, quantity, unit_price, tva_rate, product_ref, discount, product_unit: '', total_ht: Math.round(quantity * unit_price * (1 - discount / 100))
  })
  const lines = [
    line('Caméra dôme 4K 12 MP\nPose et réglage compris', 4, 295000, 18, 'ART-0012'),
    line('Enregistreur NVR 16 voies', 1, 150000, 18, 'ART-0031'),
    line('Abonnement connexion (mensuel)', 3, 63800, 18, 'PRE-0004', 5),
    line("Main-d'œuvre, câblage et mise en service", 1, 100000, 18, 'PRE-0001')
  ]
  const ht = lines.reduce((s, l) => s + l.total_ht, 0)
  const tva = Math.round(ht * 0.18)
  const doc = {
    type: 'FAC', number: 'FAC-2026-0042', status: 'valide', date: '2026-10-11', due_date: '2026-11-10', reference: 'Devis DEV-2026-0017',
    party: { name: 'Société Exemple SARL', code: 'CLI-0007', contact: 'Mme Awa Ouédraogo', address: 'Avenue Kwame Nkrumah', city: 'Ouagadougou', phone: '70 00 00 00', tax_id: '00012345A', rccm: '' },
    lines, notes: 'Livraison sous 7 jours après règlement de l’acompte.', total_ht: ht, total_tva: tva, total_ttc: ht + tva, total_withheld: 0, paid: 0, taxes: [], signatures: [],
    auth: { code: 'K7MQ-2XPA-9RDW-4TZH', qr: 'https://exemple.bf/verify/K7MQ2XPA9RDW4TZH', url: 'https://exemple.bf/verify/K7MQ2XPA9RDW4TZH' }
  }
  return documentHtml(doc, { ...company, name: company.name || 'Votre société', doc_layout: layout, doc_color: color ?? company.doc_color, doc_show_qr: true }, false, false)
}

/** forPdf : le pied de page est rendu par printToPDF au lieu d'un élément fixe. */
/** Mention portée par les documents tant qu'aucune licence n'est active. */
const EVALUATION_NOTE = "Document établi avec une version d'évaluation d'IAM INVOICER"

export function documentHtml(doc: any, company: CompanySettings, forPdf = false, evaluation = false): string {
  const type = doc.type as DocType
  const info = DOC_TYPES[type]
  const cur = company.currency || 'FCFA'
  const money = (n: number) => formatMoney(n, cur)
  const party = doc.party
  const showPrices = type !== 'BL' && type !== 'BR'
  const isDraft = doc.status === 'brouillon'
  const isCancelled = doc.status === 'annule'
  const c = /^#[0-9a-fA-F]{6}$/.test(company.doc_color ?? '') ? company.doc_color : '#1d6fd6'
  const layout: DocLayout = DOC_LAYOUTS.some((l) => l.id === company.doc_layout) ? company.doc_layout : 'moderne'
  // Authenticité : QR code et code lisible, sur les documents validés (ou annulés) uniquement
  const auth: { code: string; qr: string; url: string | null } | null = company.doc_show_qr !== false && doc.auth?.code ? doc.auth : null
  const signatures: any[] = doc.signatures ?? []
  const showStamp = company.doc_show_stamp && doc.status === 'valide' && (company.stamp || company.signature_image) && info.side === 'sale'

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

  const margins = docMargins(company)
  const numbered = company.doc_line_numbers !== false
  const lines = doc.lines
    .map(
      (l: any, i: number) => `
      <tr>
        ${numbered ? `<td class="n">${i + 1}</td>` : ''}
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
  // Taxes du document ; les retenues à la source sont enregistrées comme règlements à la validation.
  const applied = (doc.taxes ?? []) as AppliedTax[]
  const cashPaid = Math.max(0, (doc.paid ?? 0) - (doc.status === 'valide' ? doc.total_withheld ?? 0 : 0))

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>${esc(doc.number ?? info.label)}</title>
<style>
  @page {
    size: A4;
    margin: ${margins.top}mm ${margins.side}mm ${margins.bottom}mm;
    ${forPdf ? '' : `@bottom-left { content: ${cssString(legalLine(company, false))}; font: 7.5pt 'Segoe UI', Arial, sans-serif; color: #7b8794; vertical-align: top; padding-top: 4mm; }
    @bottom-right { content: "Page " counter(page) " / " counter(pages); font: 7.5pt 'Segoe UI', Arial, sans-serif; color: #7b8794; vertical-align: top; padding-top: 4mm; white-space: nowrap; }`}
  }
  /* Sauts de page : en-tête du tableau répété, lignes jamais coupées, blocs gardés entiers */
  table.lines thead { display: table-header-group; }
  table.lines tr, table.totals tr { break-inside: avoid; page-break-inside: avoid; }
  .head, .parties { break-after: avoid; page-break-after: avoid; }
  .bottom, .words, .signs, .sign, .secef, .terms { break-inside: avoid; page-break-inside: avoid; }
  td.n, th.n { width: 26px; text-align: center; color: #7b8794; }
  * { box-sizing: border-box; }
  /* Couleurs et aplats imprimés tels qu'à l'écran, quel que soit le navigateur ou l'imprimante */
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: 'Segoe UI', 'Helvetica Neue', Roboto, 'Noto Sans', Arial, sans-serif; font-size: 10pt; color: #1f2933; margin: 0; font-variant-numeric: tabular-nums; }
  img { max-width: 100%; }
  /* Aperçu à l'écran : la feuille avec ses marges, comme à l'impression */
  @media screen { html { background: #fff; } body { padding: ${margins.top}mm ${margins.side}mm ${Math.max(10, margins.bottom - 8)}mm; } }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
  .logo { max-height: 70px; max-width: 220px; margin-bottom: 6px; }
  .company-name { font-size: 16pt; font-weight: 700; color: ${c}; }
  .muted { color: #5f6b7a; font-size: 9pt; line-height: 1.45; }
  .doc-title { text-align: right; }
  .doc-title h1 { margin: 0; font-size: 20pt; color: ${c}; letter-spacing: .5px; text-transform: uppercase; }
  .doc-title .num { font-size: 12pt; font-weight: 600; margin-top: 4px; }
  .meta { margin-top: 6px; }
  .meta td { padding: 1px 0 1px 12px; }
  .meta td:first-child { color: #5f6b7a; }
  .parties { display: flex; justify-content: flex-end; margin: 22px 0 18px; }
  .box { border: 1px solid #d4dbe3; border-radius: 6px; padding: 10px 14px; min-width: 46%; }
  .box .label { font-size: 8pt; text-transform: uppercase; color: #5f6b7a; letter-spacing: .5px; }
  .box .name { font-size: 11.5pt; font-weight: 600; margin: 2px 0 4px; }
  table.lines { width: 100%; border-collapse: collapse; }
  table.lines th { background: ${c}; color: #fff; font-weight: 600; font-size: 8.5pt; text-align: left; padding: 6px 6px; }
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
  .totals .strong td { font-weight: 700; }
  .totals .withheld td { color: #9a4306; }
  .totals .grand td { background: ${c}; color: #fff; font-weight: 700; font-size: 11pt; }
  .words { margin-top: 16px; padding: 8px 12px; background: #f6f8fb; border-left: 3px solid ${c}; page-break-inside: avoid; }
  .notes { flex: 1; }
  .sign { display: flex; justify-content: space-between; margin-top: 28px; page-break-inside: avoid; }
  .sign div { width: 45%; border-top: 1px solid #9aa5b1; padding-top: 4px; font-size: 9pt; color: #5f6b7a; height: 70px; }
  .footer { margin-top: 24px; text-align: center; font-size: 7.5pt; color: #7b8794; border-top: 1px solid #e4e9ef; padding-top: 4px; }
  /* À l'impression, le pied de page se répète en bas de chaque page ; à l'écran (aperçu), il suit le document. */
  /* À l'impression, mentions légales et numéros de page sont dans la marge basse de chaque page. */
  @media print { .footer { display: none; } }
  .band { display: none; height: 6px; background: ${c}; border-radius: 3px; margin-bottom: 14px; }
  .auth { display: flex; gap: 12px; align-items: center; margin-top: 16px; padding: 8px 12px; border: 1px solid #d4dbe3; border-radius: 6px; break-inside: avoid; page-break-inside: avoid; font-size: 8.5pt; width: fit-content; max-width: 100%; }
  .auth svg { display: block; flex-shrink: 0; }
  .auth .t { font-weight: 700; color: ${c}; text-transform: uppercase; letter-spacing: .4px; font-size: 8pt; }
  .auth .code { font-family: Consolas, 'Courier New', monospace; font-weight: 700; letter-spacing: .5px; }
  .auth .muted { font-size: 7.5pt; }
  ${TEMPLATE_CSS[layout](c)}
  .signs { display: flex; justify-content: space-between; gap: 18px; margin-top: 24px; page-break-inside: avoid; }
  .sigbox { flex: 1; border: 1px solid #d4dbe3; border-radius: 6px; padding: 8px 12px; min-height: 96px; font-size: 8.5pt; color: #5f6b7a; position: relative; }
  .sigbox .t { text-transform: uppercase; letter-spacing: .4px; font-size: 7.5pt; }
  .sigbox img.sig { max-height: 58px; max-width: 200px; display: block; margin: 4px 0; }
  .sigbox img.cachet { position: absolute; right: 10px; top: 10px; max-height: 78px; max-width: 120px; opacity: .9; }
  .sigbox .proof { font-size: 6.5pt; color: #8a94a3; word-break: break-all; }
  .secef { display: flex; gap: 14px; align-items: center; margin-top: 16px; padding: 10px 12px; border: 1px solid #d4dbe3; border-radius: 6px; page-break-inside: avoid; font-size: 8.5pt; }
  .secef .t { font-weight: 700; color: ${c}; text-transform: uppercase; letter-spacing: .4px; font-size: 8pt; }
  .secef.sim .t { color: #b8321f; }
  .terms { margin-top: 16px; font-size: 7.5pt; color: #5f6b7a; border-top: 1px solid #e4e9ef; padding-top: 6px; white-space: pre-line; page-break-inside: avoid; }
  .stamp { position: fixed; top: 40%; left: 15%; font-size: 64pt; color: rgba(200, 30, 30, .13); transform: rotate(-25deg); font-weight: 800; }
  .eval-mark { position: fixed; top: 58%; left: 8%; font-size: 40pt; color: rgba(29, 111, 214, .11); transform: rotate(-25deg); font-weight: 800; letter-spacing: 2px; white-space: nowrap; pointer-events: none; }
</style></head>
<body class="tpl-${layout}">
  <div class="band"></div>
  ${isDraft ? '<div class="stamp">BROUILLON</div>' : isCancelled ? '<div class="stamp">ANNULÉ</div>' : ''}
  ${evaluation ? '<div class="eval-mark" aria-hidden="true">VERSION D’ÉVALUATION</div>' : ''}
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
      ${numbered ? '<th class="n">N°</th>' : ''}<th>Réf.</th><th>Désignation</th><th class="num">Qté</th>
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
      ${applied.filter((t) => t.kind === 'addition' && t.value > 0).map((t) => `<tr><td>${esc(t.label)}</td><td>${money(t.value)}</td></tr>`).join('')}
      <tr class="${doc.total_withheld > 0 ? 'strong' : 'grand'}"><td>Total TTC</td><td>${money(doc.total_ttc)}</td></tr>
      ${applied.filter((t) => t.kind === 'withholding' && t.value > 0).map((t) => `<tr class="withheld"><td>− ${esc(taxCaption(t))}</td><td>− ${money(t.value)}</td></tr>`).join('')}
      ${doc.total_withheld > 0 ? `<tr class="grand"><td>Net à payer</td><td>${money(doc.total_ttc - doc.total_withheld)}</td></tr>` : ''}
      ${info.payable && cashPaid > 0 ? `<tr><td>Déjà réglé</td><td>${money(cashPaid)}</td></tr><tr><td><strong>Reste à payer</strong></td><td><strong>${money(remaining)}</strong></td></tr>` : ''}
    </table>
  </div>
  <div class="words">Arrêté${type === 'FAC' || type === 'FF' ? 'e' : ''} ${type === 'DEV' ? 'le présent devis' : type === 'BC' ? 'le présent bon de commande' : type === 'AV' ? 'le présent avoir' : 'la présente facture'} à la somme de : <strong>${esc(amountInWords(doc.total_ttc, countryProfile(company.country_code, company.country).currencyWords))}</strong> TTC.</div>
  ` : doc.notes ? `<div class="muted" style="margin-top:14px"><strong>Observations</strong><br>${nl2br(doc.notes)}</div>` : ''}

  ${type === 'DEV' ? '<p class="muted" style="margin-top:14px">Devis valable 30 jours. Bon pour accord : date, signature et cachet du client.</p>' : ''}
  ${type === 'FAC' && company.bank_account ? `<p class="muted" style="margin-top:14px">Règlement par virement : ${esc(company.bank_name)} — ${esc(company.bank_account)}</p>` : ''}
  ${signatures.length > 0 || showStamp
    ? `<div class="signs">
        ${showStamp ? `<div class="sigbox"><div class="t">Pour ${esc(company.name)}</div>
          ${company.signature_image ? `<img class="sig" src="${company.signature_image}">` : ''}
          ${company.stamp ? `<img class="cachet" src="${company.stamp}">` : ''}
          <div>${esc(company.signatory_name)}${company.signatory_title ? ' — ' + esc(company.signatory_title) : ''}</div></div>` : ''}
        ${signatures.map((g: any) => `<div class="sigbox"><div class="t">${type === 'BL' ? 'Reçu par le client' : 'Bon pour accord du client'}</div>
          <img class="sig" src="${g.image}">
          <div><strong>${esc(g.signer_name)}</strong> — signé ${g.method === 'a_distance' ? 'en ligne' : 'sur place'} le ${esc(new Date(g.signed_at).toLocaleString('fr-FR'))}</div>
          <div class="proof">Empreinte SHA-256 du contenu : ${esc(g.content_hash)}</div></div>`).join('')}
      </div>`
    : type === 'BL' || type === 'BR' || type === 'DEV' || type === 'BC'
      ? `<div class="sign"><div>${type === 'BL' ? 'Livré par' : type === 'BR' ? 'Réceptionné par' : 'Pour ' + esc(company.name)}</div><div>${type === 'BL' ? 'Reçu par le client (nom, date, signature)' : type === 'BR' ? 'Livreur' : type === 'DEV' ? 'Bon pour accord du client' : 'Signature et cachet'}</div></div>`
      : ''}
  ${doc.secef_code ? `<div class="secef ${doc.secef_code.startsWith('SIM-') ? 'sim' : ''}">${qrSvg(doc.secef_qr)}<div><div class="t">${doc.secef_code.startsWith('SIM-') ? 'Simulation SECeF — non valable fiscalement' : 'Facture certifiée SECeF — DGI'}</div><div>Code : <strong>${esc(doc.secef_code)}</strong></div><div>NIM : ${esc(doc.secef_nim)} · Compteurs : ${esc(doc.secef_counters)}</div><div>Date et heure : ${esc(doc.secef_date)}</div></div></div>` : ''}
  ${auth ? `<div class="auth">${qrSvg(auth.qr, 84)}<div><div class="t">Document authentique</div><div>Code : <span class="code">${esc(auth.code)}</span></div><div class="muted">${auth.url ? `Scannez ce code, ou saisissez-le sur ${esc(auth.url.replace(/^https?:\/\//, '').replace(/\/verify\/.*$/, '/verify'))}, pour vérifier ce document.` : `Scannez ce code pour lire le numéro, la date et le montant enregistrés par ${esc(company.name)}.`}</div></div></div>` : ''}
  ${company.doc_terms && info.side === 'sale' ? `<div class="terms"><strong>Conditions générales</strong>\n${esc(company.doc_terms)}</div>` : ''}
  ${company.invoice_footer && info.side === 'sale' ? `<p class="muted" style="margin-top:18px;text-align:center">${esc(company.invoice_footer)}</p>` : ''}
  ${evaluation ? `<p class="muted" style="margin-top:8px;text-align:center;font-size:8pt">${EVALUATION_NOTE}</p>` : ''}

  ${forPdf ? '' : `<div class="footer">${legalLine(company)}</div>`}
</body></html>`
}

/** Ticket de caisse 80 mm (imprimante thermique). */
export function receiptHtml(doc: any, company: CompanySettings, evaluation = false): string {
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
  ${company.doc_show_qr !== false && doc.auth?.code ? `<div class="c" style="margin-top:2mm">${qrSvg(doc.auth.qr, 96)}<div class="muted">Authenticité : ${esc(doc.auth.code)}</div></div>` : ''}
  ${evaluation ? `<div class="c muted">${EVALUATION_NOTE}</div>` : ''}
</body></html>`
}
