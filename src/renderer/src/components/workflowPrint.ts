// Documents imprimables des circuits de validation : expression de besoin et pièce de dépense.
// Page A4 à l'en-tête de la société, informations, lignes, montant en lettres, historique du
// circuit et cases de signature (remplies avec le nom et la date quand l'étape est passée).
// Imprimés par window.erp.printHtml : PDF sur ordinateur, fenêtre d'impression sur le web.

import { amountInWords, formatDate, formatMoney, formatQty, todayISO } from '@shared/format'
import { EXPENSE_CATEGORIES, EXPENSE_STATUS, REQUEST_PRIORITIES, REQUEST_STATUS, type ExpenseCategory, type ExpenseStatus, type RequestPriority, type RequestStatus } from '@shared/workflow'

type Company = { name: string; logo?: string; address?: string; city?: string; phone?: string; email?: string; tax_id?: string; tax_id_label?: string; rccm?: string; doc_color?: string }
type WfEvent = { action: string; comment: string; at: string; user_name: string | null }

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const ACTIONS: Record<string, string> = {
  creation: 'Création', soumission: 'Envoi en validation', approbation: 'Approbation', visa: 'Visa du responsable', validation_financiere: 'Validation financière',
  rejet: 'Rejet', paiement: 'Paiement', annulation_paiement: 'Annulation du paiement', commande: 'Bon de commande établi', cloture: 'Clôture'
}
const when = (at: string) => {
  const d = new Date(at)
  return Number.isNaN(d.getTime()) ? '' : `${formatDate(d.toISOString().slice(0, 10))} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
}
/**
 * Dernier passage d'une étape dans le cycle en cours : un rejet (ou l'annulation d'un paiement)
 * remet le circuit à zéro, les visas donnés avant ne valent plus pour la demande renvoyée.
 */
const last = (events: WfEvent[], action: string) => {
  const reset = Math.max(...events.map((e, i) => (e.action === 'rejet' || e.action === 'annulation_paiement' ? i : -1)))
  return events.slice(reset + 1).reverse().find((e) => e.action === action)
}

interface Voucher {
  title: string
  number: string | null
  stamp?: { text: string; tone: 'red' | 'green' | 'grey' }
  facts: [string, string][]
  wide?: [string, string][]
  lines?: { head: string[]; rows: string[][]; numeric: number[] }
  total?: { label: string; value: number }
  events: WfEvent[]
  signatures: { label: string; event?: WfEvent; name?: string }[]
  note?: string
}

function voucherHtml(company: Company, v: Voucher): string {
  const c = /^#[0-9a-fA-F]{6}$/.test(company.doc_color ?? '') ? company.doc_color! : '#1d6fd6'
  const stampColor = v.stamp ? { red: 'rgba(200, 30, 30, .14)', green: 'rgba(22, 128, 61, .14)', grey: 'rgba(80, 90, 105, .13)' }[v.stamp.tone] : ''
  const legal = [company.tax_id ? `${company.tax_id_label || 'IFU'} ${company.tax_id}` : '', company.rccm ? `RCCM ${company.rccm}` : ''].filter(Boolean).join(' · ')
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(`${v.title} ${v.number ?? ''}`)}</title><style>
    @page { size: A4; margin: 14mm 14mm 16mm; @bottom-right { content: 'Page ' counter(page) ' / ' counter(pages); font: 8pt 'Segoe UI', Arial, sans-serif; color: #5d6475; } }
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10pt; color: #1f2433; margin: 0; }
    .band { height: 5px; background: ${c}; border-radius: 3px; margin-bottom: 14px; }
    .head { display: flex; justify-content: space-between; gap: 20px; align-items: flex-start; }
    .co img { max-height: 58px; max-width: 170px; object-fit: contain; display: block; margin-bottom: 6px; }
    .co .name { font-size: 13pt; font-weight: 700; }
    .muted { color: #5d6475; font-size: 8.5pt; line-height: 1.45; }
    .title { text-align: right; }
    .title h1 { margin: 0; font-size: 17pt; color: ${c}; text-transform: uppercase; letter-spacing: .5px; }
    .title .num { font-size: 11.5pt; font-weight: 700; margin-top: 3px; }
    .title .st { display: inline-block; margin-top: 6px; padding: 2px 10px; border-radius: 999px; border: 1.5px solid ${c}; color: ${c}; font-size: 8.5pt; font-weight: 700; }
    .facts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0; margin: 16px 0 10px; border: 1px solid #d9dfe8; border-radius: 6px; overflow: hidden; }
    .facts div { padding: 7px 10px; border-right: 1px solid #e6eaf0; border-bottom: 1px solid #e6eaf0; }
    .facts div:nth-child(3n) { border-right: 0; }
    .facts dt { font-size: 7.5pt; color: #5d6475; text-transform: uppercase; letter-spacing: .4px; }
    .facts dd { margin: 2px 0 0; font-weight: 600; }
    .block { margin: 8px 0; padding: 8px 10px; border-left: 3px solid ${c}; background: #f6f8fc; border-radius: 0 6px 6px 0; white-space: pre-line; }
    .block b { display: block; font-size: 7.5pt; color: #5d6475; text-transform: uppercase; letter-spacing: .4px; margin-bottom: 2px; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0 4px; }
    th { text-align: left; background: ${c}; color: #fff; padding: 6px 8px; font-size: 8.5pt; }
    td { padding: 6px 8px; border-bottom: 1px solid #e3e7ef; vertical-align: top; }
    .n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .total { display: flex; justify-content: flex-end; margin-top: 6px; }
    .total div { min-width: 260px; padding: 8px 12px; border-radius: 6px; background: ${c}; color: #fff; display: flex; justify-content: space-between; gap: 18px; font-weight: 700; font-size: 11pt; }
    .words { text-align: right; font-size: 8.5pt; color: #5d6475; margin-top: 4px; font-style: italic; }
    h2 { font-size: 10pt; margin: 18px 0 4px; color: ${c}; text-transform: uppercase; letter-spacing: .4px; }
    .hist td { font-size: 8.5pt; padding: 4px 8px; }
    .signs { display: grid; grid-template-columns: repeat(${v.signatures.length}, 1fr); gap: 10px; margin-top: 18px; page-break-inside: avoid; }
    .sig { border: 1px solid #d4dbe3; border-radius: 6px; padding: 8px 10px; min-height: 108px; display: flex; flex-direction: column; font-size: 8.5pt; }
    .sig .t { text-transform: uppercase; letter-spacing: .4px; font-size: 7.5pt; color: #5d6475; }
    .sig .who { margin-top: auto; font-weight: 700; }
    .sig .ok { color: #16803d; font-weight: 700; font-size: 8pt; }
    .sig .date { color: #5d6475; font-size: 7.5pt; }
    .stamp { position: fixed; top: 42%; left: 18%; font-size: 60pt; font-weight: 800; color: ${stampColor}; transform: rotate(-24deg); letter-spacing: 4px; }
    footer { margin-top: 14px; font-size: 7.5pt; color: #8a94a3; border-top: 1px solid #e4e9ef; padding-top: 5px; }
  </style></head><body>
    ${v.stamp ? `<div class="stamp">${esc(v.stamp.text)}</div>` : ''}
    <div class="band"></div>
    <div class="head">
      <div class="co">
        ${company.logo ? `<img src="${company.logo}" alt="">` : ''}
        <div class="name">${esc(company.name)}</div>
        <div class="muted">${esc([company.address, company.city].filter(Boolean).join(', '))}${company.phone ? `<br>Tél. ${esc(company.phone)}` : ''}${company.email ? ` · ${esc(company.email)}` : ''}${legal ? `<br>${esc(legal)}` : ''}</div>
      </div>
      <div class="title"><h1>${esc(v.title)}</h1><div class="num">${esc(v.number ?? 'Brouillon')}</div></div>
    </div>
    <dl class="facts">${v.facts.map(([k, val]) => `<div><dt>${esc(k)}</dt><dd>${esc(val || '—')}</dd></div>`).join('')}</dl>
    ${(v.wide ?? []).filter(([, val]) => val).map(([k, val]) => `<div class="block"><b>${esc(k)}</b>${esc(val)}</div>`).join('')}
    ${v.lines ? `<table><thead><tr>${v.lines.head.map((h, i) => `<th${v.lines!.numeric.includes(i) ? ' class="n"' : ''}>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${v.lines.rows.map((r) => `<tr>${r.map((x, i) => `<td${v.lines!.numeric.includes(i) ? ' class="n"' : ''}>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : ''}
    ${v.total ? `<div class="total"><div><span>${esc(v.total.label)}</span><span>${esc(formatMoney(v.total.value))}</span></div></div><div class="words">Arrêté à la somme de ${esc(amountInWords(v.total.value))}</div>` : ''}
    ${v.events.length ? `<h2>Circuit de validation</h2><table class="hist"><tbody>${v.events.map((e) => `<tr><td style="width:28%">${esc(when(e.at))}</td><td style="width:26%"><b>${esc(ACTIONS[e.action] ?? e.action)}</b></td><td>${esc(e.user_name ?? 'Utilisateur supprimé')}${e.comment ? ` — ${esc(e.comment)}` : ''}</td></tr>`).join('')}</tbody></table>` : ''}
    <div class="signs">${v.signatures.map((s) => `<div class="sig"><span class="t">${esc(s.label)}</span>${s.event ? `<span class="ok">✓ ${esc(ACTIONS[s.event.action] ?? 'Fait')}</span>` : ''}<span class="who">${esc(s.event?.user_name ?? s.name ?? '')}</span>${s.event ? `<span class="date">${esc(when(s.event.at))}</span>` : '<span class="date">Date et signature</span>'}</div>`).join('')}</div>
    <footer>${esc(v.note ?? '')}${v.note ? ' · ' : ''}Document édité le ${formatDate(todayISO())} par IAM INVOICER.</footer>
  </body></html>`
}

/** Expression de besoin (demande d'achat interne) avec son circuit : demandeur, responsable, finances, achats. */
export function requestHtml(company: Company, r: any): string {
  const st = REQUEST_STATUS[r.status as RequestStatus]
  const stamp = r.status === 'brouillon' ? { text: 'BROUILLON', tone: 'grey' as const } : r.status === 'rejetee' ? { text: 'REJETÉE', tone: 'red' as const } : undefined
  return voucherHtml(company, {
    title: 'Expression de besoin',
    number: r.number,
    stamp,
    facts: [
      ['Objet', r.title], ['Demandeur', r.user_name], ['Service', r.department],
      ['Date de la demande', formatDate(r.date)], ['Souhaitée pour le', r.needed_by ? formatDate(r.needed_by) : ''], ['Priorité', REQUEST_PRIORITIES[r.priority as RequestPriority] ?? r.priority],
      ['État', st?.label ?? r.status], ['Bon de commande', r.document?.number ?? ''], ['Lignes', String(r.lines.length)]
    ],
    wide: [['Justification', r.justification ?? ''], ['Motif du rejet', r.status === 'rejetee' ? r.rejected_reason : '']],
    lines: {
      head: ['Désignation', 'Quantité', 'Unité', 'Prix estimé', 'Total estimé'],
      numeric: [1, 3, 4],
      rows: r.lines.map((l: any) => [l.description, formatQty(l.quantity), l.unit || '', l.unit_price ? formatMoney(l.unit_price) : '—', l.unit_price ? formatMoney(l.quantity * l.unit_price) : '—'])
    },
    total: r.total ? { label: 'Estimation totale', value: r.total } : undefined,
    events: r.events ?? [],
    signatures: [
      { label: 'Le demandeur', event: last(r.events ?? [], 'soumission'), name: r.user_name },
      { label: 'Visa du responsable', event: last(r.events ?? [], 'visa') },
      { label: 'Validation financière', event: last(r.events ?? [], 'validation_financiere') },
      { label: 'Service achats', event: last(r.events ?? [], 'commande') }
    ],
    note: 'Montants estimés : le bon de commande fait foi.'
  })
}

/** Pièce de dépense (bon de caisse) : demandeur, approbation, paiement et « pour acquit » du bénéficiaire. */
export function expenseHtml(company: Company, e: any): string {
  const st = EXPENSE_STATUS[e.status as ExpenseStatus]
  const cat = EXPENSE_CATEGORIES[e.category as ExpenseCategory]
  const stamp = e.status === 'brouillon' ? { text: 'BROUILLON', tone: 'grey' as const } : e.status === 'rejetee' ? { text: 'REJETÉE', tone: 'red' as const } : e.status === 'payee' ? { text: 'PAYÉE', tone: 'green' as const } : undefined
  return voucherHtml(company, {
    title: 'Pièce de dépense',
    number: e.number,
    stamp,
    facts: [
      ['Libellé', e.label], ['Demandeur', e.user_name], ['Date', formatDate(e.date)],
      ['Catégorie', cat?.label ?? e.category], ['Compte de charge', cat?.account ?? ''], ['État', st?.label ?? e.status],
      ['Bénéficiaire', e.beneficiary ?? ''], ['Mode de paiement', e.method ?? ''], ['Payée le', e.paid_at ? formatDate(String(e.paid_at).slice(0, 10)) : '']
    ],
    wide: [['Observations', e.notes ?? ''], ['Motif du rejet', e.status === 'rejetee' ? e.rejected_reason : '']],
    total: { label: 'Montant', value: Number(e.amount) || 0 },
    events: e.events ?? [],
    signatures: [
      { label: 'Le demandeur', event: last(e.events ?? [], 'soumission'), name: e.user_name },
      { label: 'Approbation', event: last(e.events ?? [], 'approbation') },
      { label: 'Paiement (caisse ou banque)', event: last(e.events ?? [], 'paiement') },
      { label: 'Pour acquit, le bénéficiaire', name: e.beneficiary ?? '' }
    ],
    note: e.receipt ? 'Justificatif joint dans IAM INVOICER.' : 'Joindre le justificatif (facture, reçu) à cette pièce.'
  })
}
