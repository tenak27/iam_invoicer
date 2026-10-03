// Impression des états (bilan, déclarations, compte de résultat…) : page A4 sobre
// à l'en-tête de la société (logo, nom, identifiant fiscal), sans mention de l'éditeur.

import { formatDate, formatNumber, todayISO } from '@shared/format'

export interface ReportTable {
  title?: string
  head: string[]
  rows: (string | number)[][]
  foot?: (string | number)[]
  /** Colonnes numériques (alignées à droite, séparateurs de milliers). */
  numeric?: number[]
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function reportHtml(company: { name: string; logo?: string; tax_id_label?: string; tax_id?: string; address?: string; city?: string }, title: string, subtitle: string, tables: ReportTable[], note = ''): string {
  const cell = (v: string | number, i: number, numeric: number[]) =>
    numeric.includes(i) ? `<td class="n">${typeof v === 'number' ? formatNumber(v) : esc(v)}</td>` : `<td>${esc(v)}</td>`
  const body = tables
    .map((t) => {
      const numeric = t.numeric ?? []
      return `${t.title ? `<h2>${esc(t.title)}</h2>` : ''}<table>
        <thead><tr>${t.head.map((h, i) => `<th${numeric.includes(i) ? ' class="n"' : ''}>${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${t.rows.map((r) => `<tr>${r.map((v, i) => cell(v, i, numeric)).join('')}</tr>`).join('')}</tbody>
        ${t.foot ? `<tfoot><tr>${t.foot.map((v, i) => cell(v, i, numeric)).join('')}</tr></tfoot>` : ''}
      </table>`
    })
    .join('')
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    @page { size: A4; margin: 14mm; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10pt; color: #1f2433; margin: 0; }
    header { display: flex; align-items: center; gap: 14px; border-bottom: 3px solid #1550a8; padding-bottom: 10px; margin-bottom: 14px; }
    header img { max-height: 54px; max-width: 160px; object-fit: contain; }
    .co { font-size: 13pt; font-weight: 700; }
    .muted { color: #5d6475; font-size: 9pt; }
    h1 { font-size: 15pt; margin: 0 0 2px; }
    h2 { font-size: 11pt; margin: 16px 0 6px; color: #1550a8; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 8px; page-break-inside: auto; }
    tr { page-break-inside: avoid; }
    th { text-align: left; background: #eef3fb; color: #1550a8; padding: 5px 6px; font-size: 9pt; border-bottom: 1.5px solid #9db6dc; }
    td { padding: 4px 6px; border-bottom: 1px solid #e3e7ef; }
    .n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    tfoot td { font-weight: 700; border-top: 1.5px solid #1f2433; background: #f6f8fc; }
    footer { margin-top: 18px; font-size: 8.5pt; color: #5d6475; }
  </style></head><body>
    <header>
      ${company.logo ? `<img src="${company.logo}" alt="">` : ''}
      <div><div class="co">${esc(company.name)}</div>
      <div class="muted">${esc([company.address, company.city].filter(Boolean).join(', '))}${company.tax_id ? ` · ${esc(company.tax_id_label || 'IFU')} ${esc(company.tax_id)}` : ''}</div></div>
    </header>
    <h1>${esc(title)}</h1><div class="muted">${esc(subtitle)}</div>
    ${body}
    ${note ? `<footer>${esc(note)}</footer>` : ''}
    <footer>Édité le ${formatDate(todayISO())}</footer>
  </body></html>`
}
