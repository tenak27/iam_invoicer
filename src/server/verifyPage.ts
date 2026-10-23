// Page publique de vérification d'un document (QR code d'authenticité) : affiche ce que la
// société a enregistré sous ce code, pour le comparer au document présenté.

import { formatDate, formatMoney } from '@shared/format'

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export interface VerifiedDocument {
  code: string
  label: string
  number: string
  cancelled: boolean
  date: string
  total_ttc: number
  party: string
  settled: boolean | null
}

export function verifyPageHtml(opts: { company: any; doc: VerifiedDocument | null; asked: string; action: string }): string {
  const { company, doc, asked, action } = opts
  const color = /^#[0-9a-fA-F]{6}$/.test(company.doc_color ?? '') ? company.doc_color : '#1d6fd6'
  const name = esc(company.name || 'IAM INVOICER')
  const row = (k: string, v: string) => `<div class="row"><dt>${k}</dt><dd>${v}</dd></div>`
  const state = !doc ? (asked ? 'unknown' : 'ask') : doc.cancelled ? 'cancelled' : 'ok'
  const head = {
    ok: `<svg class="mark ok" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg><h1>Document authentique</h1><p>Ce document a bien été émis par <strong>${name}</strong>. Comparez les informations ci-dessous avec celles du document que vous avez en main.</p>`,
    cancelled: `<svg class="mark bad" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M18 18l16 16M34 18L18 34"/></svg><h1>Document annulé</h1><p>Ce document a été émis par <strong>${name}</strong>, puis <strong>annulé</strong> : il n'a plus de valeur.</p>`,
    unknown: `<svg class="mark bad" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M26 15v15M26 37v.5"/></svg><h1>Code inconnu</h1><p>Aucun document de <strong>${name}</strong> ne porte ce code. Vérifiez la saisie ; si le code est exact, ce document n'a pas été émis par cette société.</p>`,
    ask: `<svg class="mark neutral" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M17 17h7v7h-7zM28 17h7v7h-7zM17 28h7v7h-7zM29 29h2v2h-2zM33 33h2v2h-2z"/></svg><h1>Vérifier un document</h1><p>Saisissez le code d'authenticité imprimé près du QR code du document émis par <strong>${name}</strong>.</p>`
  }[state]
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Vérification d'un document — ${name}</title>
<style>
  :root { --c: ${color}; --ok: #128052; --bad: #c9393a; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 20px 14px; font: 16px/1.5 "Segoe UI", system-ui, -apple-system, Roboto, sans-serif; color: #1c2333; background: radial-gradient(900px 500px at 85% -10%, color-mix(in srgb, var(--c) 18%, transparent), transparent 70%), radial-gradient(700px 420px at -10% 110%, rgba(226, 168, 31, .16), transparent 70%), #f3f5fa; }
  .card { width: min(520px, 100%); background: #fff; border-radius: 20px; overflow: hidden; box-shadow: 0 30px 60px -30px rgba(20, 30, 60, .45); animation: in .5s cubic-bezier(.2, .8, .2, 1) backwards; }
  @keyframes in { from { opacity: 0; transform: translateY(18px) scale(.97); } }
  .weave { height: 6px; background: repeating-linear-gradient(90deg, #1d6fd6 0 22px, #e2a81f 22px 30px, #128052 30px 44px, #e2a81f 44px 52px); }
  .in { padding: 26px 26px 22px; text-align: center; }
  .logo { max-height: 54px; max-width: 200px; margin-bottom: 10px; }
  .mark { width: 76px; height: 76px; margin: 4px auto 10px; display: block; fill: none; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
  .mark circle { stroke-dasharray: 151; stroke-dashoffset: 151; animation: draw .6s .15s ease-out forwards; }
  .mark path { stroke-dasharray: 80; stroke-dashoffset: 80; animation: draw .45s .6s ease-out forwards; }
  .mark.ok { stroke: var(--ok); } .mark.bad { stroke: var(--bad); } .mark.neutral { stroke: var(--c); }
  @keyframes draw { to { stroke-dashoffset: 0; } }
  h1 { margin: 0 0 6px; font-size: 23px; }
  p { margin: 0; color: #4d5567; }
  dl { margin: 20px 0 0; text-align: left; border: 1px solid #e3e7ef; border-radius: 14px; overflow: hidden; }
  .row { display: flex; justify-content: space-between; gap: 16px; padding: 11px 16px; animation: in .4s backwards; }
  .row:nth-child(even) { background: #f7f9fc; }
  .row:nth-child(1) { animation-delay: .5s; } .row:nth-child(2) { animation-delay: .57s; } .row:nth-child(3) { animation-delay: .64s; } .row:nth-child(4) { animation-delay: .71s; } .row:nth-child(5) { animation-delay: .78s; } .row:nth-child(6) { animation-delay: .85s; }
  dt { color: #5d6475; } dd { margin: 0; font-weight: 600; text-align: right; overflow-wrap: anywhere; }
  .amount dd { font-size: 19px; color: var(--c); }
  .pill { display: inline-block; padding: 2px 11px; border-radius: 999px; font-size: 13px; font-weight: 700; }
  .pill.ok { background: rgba(18, 128, 82, .13); color: var(--ok); } .pill.bad { background: rgba(201, 57, 58, .12); color: var(--bad); } .pill.wait { background: rgba(226, 168, 31, .2); color: #8a5a00; }
  form { display: flex; gap: 8px; margin-top: 20px; }
  input { flex: 1; min-width: 0; min-height: 46px; padding: 0 14px; border: 1px solid #cfd6e3; border-radius: 10px; font: inherit; letter-spacing: .08em; text-transform: uppercase; }
  input:focus-visible, button:focus-visible { outline: 3px solid color-mix(in srgb, var(--c) 45%, transparent); outline-offset: 2px; }
  button { min-height: 46px; padding: 0 18px; border: none; border-radius: 10px; background: var(--c); color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
  .foot { padding: 12px 26px 18px; text-align: center; font-size: 12.5px; color: #7b8494; }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; } .mark circle, .mark path { stroke-dashoffset: 0; } }
</style></head>
<body><main class="card">
  <div class="weave"></div>
  <div class="in">
    ${/^data:image\/(png|jpe?g|svg\+xml|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(String(company.logo ?? '')) ? `<img class="logo" src="${esc(company.logo)}" alt="">` : ''}
    ${head}
    ${doc ? `<dl>
      ${row('Document', `${esc(doc.label)} ${esc(doc.number)}`)}
      ${row('Date', esc(formatDate(doc.date)))}
      ${row('Établi pour', esc(doc.party))}
      <div class="row amount"><dt>Total TTC</dt><dd>${esc(formatMoney(doc.total_ttc, company.currency || 'FCFA'))}</dd></div>
      ${doc.cancelled ? row('État', '<span class="pill bad">Annulé</span>') : doc.settled === null ? '' : row('Règlement', doc.settled ? '<span class="pill ok">Réglé</span>' : '<span class="pill wait">Non soldé</span>')}
      ${row('Code', esc(doc.code))}
    </dl>` : ''}
    <form method="get" action="${esc(action)}">
      <input name="code" aria-label="Code d'authenticité" placeholder="XXXX-XXXX-XXXX-XXXX" autocomplete="off" spellcheck="false" value="${doc ? '' : esc(asked)}" ${state === 'ask' || state === 'unknown' ? 'autofocus' : ''}>
      <button type="submit">Vérifier</button>
    </form>
  </div>
  <div class="foot">Vérification fournie par ${name} avec IAM INVOICER · ${esc(new Date().toLocaleString('fr-FR'))}</div>
</main></body></html>`
}
