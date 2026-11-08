// Habillage des autres documents imprimés (pièces de dépense, expressions de besoin, états, bulletins
// de paie) d'après le modèle choisi pour les factures (Société et paramètres → Documents). Chaque
// modèle est une recette (en-tête plein, titres à empattements, filets dorés, sans aplat…) que
// chaque document traduit dans ses propres règles. Utilisé par le processus principal (bulletins) et
// par l'interface (pièces, états).

import { DOC_LAYOUTS, type DocLayout } from './domain'

export const GOLD = '#b8975a'
export const GOLD_DARK = '#8a6d3b'
const INK = '#111827'

interface Recipe {
  /** Liseré en haut de page. */
  band?: boolean
  /** En-tête plein (couleur de la société, ou teinte sombre). */
  fill?: boolean
  /** Teinte sombre à la place de la couleur de la société (en-têtes de tableau, totaux). */
  dark?: string
  /** Titres à empattements. */
  serif?: boolean
  /** Filets dorés, en-tête centré. */
  gold?: boolean
  /** Aucun aplat : filets seulement. */
  flat?: boolean
  /** Grand titre gras (Épuré). */
  bigTitle?: boolean
  /** Tout en encre, sans la couleur de la société (Minimal). */
  mono?: boolean
  compact?: boolean
}

const RECIPES: Record<DocLayout, Recipe> = {
  moderne: { band: true },
  entreprise: { fill: true },
  prestige: { serif: true, gold: true },
  epure: { flat: true, bigTitle: true },
  contraste: { fill: true, dark: INK },
  bandeau: { fill: true },
  elegant: { serif: true, flat: true },
  classique: { dark: '#33303f' },
  minimal: { flat: true, mono: true },
  compact: { band: true, compact: true }
}

export function printLayout(layout: unknown): DocLayout {
  return DOC_LAYOUTS.some((l) => l.id === layout) ? (layout as DocLayout) : 'moderne'
}

const SERIF = "Georgia, 'Times New Roman', serif"

/** Pièces de dépense et expressions de besoin (workflowPrint.ts : .band .head .co .title .facts th .total .block h2). */
export function voucherThemeCss(layout: unknown, c: string): string {
  const r = RECIPES[printLayout(layout)]
  const x = r.dark ?? c
  const css: string[] = []
  if (!r.band) css.push('.band { display: none; }')
  if (r.fill) css.push(`.head { background: ${x}; color: #fff; padding: 14px 16px; border-radius: 10px; ${r.dark ? `border-bottom: 4px solid ${c};` : ''} }
  .head .name, .head .title h1, .head .num { color: #fff; } .head .muted { color: rgba(255, 255, 255, .82); } .head .title .st { border-color: #fff; color: #fff; }
  .co img { background: #fff; padding: 4px 8px; border-radius: 6px; } .block { background: ${r.dark ? '#f3f4f6' : `color-mix(in srgb, ${c} 7%, #fff)`}; }`)
  if (r.dark) css.push(`th { background: ${x}; } .total div { background: ${x}; } h2 { color: ${x}; }`)
  if (r.serif) css.push(`.co .name, .title h1, h2, .total div { font-family: ${SERIF}; } .title h1 { font-weight: 400; letter-spacing: 3px; } .co .name { font-weight: 400; }`)
  if (r.gold) css.push(`.band { display: block; height: 3px; border-radius: 0; background: linear-gradient(90deg, ${GOLD}, ${c} 50%, ${GOLD}); }
  .head { flex-direction: column; align-items: center; text-align: center; gap: 6px; padding-bottom: 12px; border-bottom: 1px solid ${GOLD}; } .title { text-align: center; }
  .facts { border-color: #e6dcc8; } .facts dt { color: ${GOLD_DARK}; letter-spacing: 1.2px; }
  th { background: none; color: #1f2933; text-transform: uppercase; letter-spacing: 1.2px; font-size: 7pt; border-top: 1px solid ${GOLD}; border-bottom: 1px solid ${GOLD}; }
  .total div { background: none; color: ${c}; border-radius: 0; border-top: 1px solid ${GOLD}; border-bottom: 3px double ${GOLD}; } .block { background: none; border-left-color: ${GOLD}; } h2 { color: ${GOLD_DARK}; } .sig { border-color: #e6dcc8; border-radius: 0; }`)
  if (r.flat) css.push(`th { background: none; color: #1f2933; border-bottom: 1.5px solid ${INK}; } .total div { background: none; color: ${INK}; border-radius: 0; border-top: 1.5px solid ${INK}; } .block { background: none; } .facts { border-radius: 0; } .sig { border-radius: 0; }`)
  if (r.bigTitle) css.push(`.title h1 { font-size: 26pt; font-weight: 800; letter-spacing: -1px; text-transform: none; color: ${INK}; } .title .num { color: #5d6475; } h2 { color: ${INK}; }`)
  if (r.mono) css.push(`.title h1, h2, .co .name { color: #1f2933; } .block { border-left-color: ${INK}; } .title .st { border-color: ${INK}; color: ${INK}; }`)
  if (r.compact) css.push('body { font-size: 8.5pt; } .co .name { font-size: 11.5pt; } .title h1 { font-size: 14pt; } th, td { padding: 4px 6px; } .facts div { padding: 5px 8px; }')
  return css.join('\n')
}

/** États : bilan, compte de résultat, déclarations (reportPrint.ts : header .co h1 h2 th tfoot). */
export function reportThemeCss(layout: unknown, c: string): string {
  const r = RECIPES[printLayout(layout)]
  const x = r.dark ?? c
  const css: string[] = []
  if (r.fill) css.push(`header { background: ${x}; color: #fff; padding: 12px 14px; border-radius: 10px; border-bottom: ${r.dark ? `4px solid ${c}` : '0'}; } header .muted { color: rgba(255, 255, 255, .82); } header img { background: #fff; padding: 4px 8px; border-radius: 6px; }
  th { background: ${x}; color: #fff; border-bottom: 0; }`)
  if (r.dark) css.push(`header { border-bottom-color: ${x}; } th { background: ${x}; color: #fff; border-bottom: 0; } h2 { color: ${x}; }`)
  if (r.serif) css.push(`.co, h1, h2 { font-family: ${SERIF}; } h1 { font-weight: 400; letter-spacing: 1px; }`)
  if (r.gold) css.push(`header { flex-direction: column; text-align: center; gap: 6px; border-bottom: 1px solid ${GOLD}; } h1 { text-align: center; } h1 + .muted { text-align: center; }
  th { background: none; color: #1f2933; text-transform: uppercase; letter-spacing: 1px; font-size: 7.5pt; border-top: 1px solid ${GOLD}; border-bottom: 1px solid ${GOLD}; } tfoot td { background: none; border-top: 3px double ${GOLD}; } h2 { color: ${GOLD_DARK}; }`)
  if (r.flat) css.push(`header { border-bottom: 1.5px solid ${INK}; } th { background: none; color: #1f2933; border-bottom: 1.5px solid ${INK}; } h2 { color: ${INK}; } tfoot td { background: none; }`)
  if (r.bigTitle) css.push('h1 { font-size: 24pt; font-weight: 800; letter-spacing: -.5px; }')
  if (r.compact) css.push('body { font-size: 8.5pt; } th, td { padding: 3px 5px; }')
  return css.join('\n')
}

/** Bulletins de paie (hr.ts : .head .co .logo .title h1 .lines th .net). */
export function payslipThemeCss(layout: unknown, c: string): string {
  const r = RECIPES[printLayout(layout)]
  const x = r.dark ?? c
  const css: string[] = []
  if (r.fill) css.push(`.head { background: ${x}; color: #fff; padding: 12px 14px; border-radius: 10px; border-top: 0; ${r.dark ? `border-bottom: 4px solid ${c};` : ''} } .head .co, .head h1 { color: #fff; } .head .muted { color: rgba(255, 255, 255, .82); } .logo { background: #fff; padding: 4px 8px; border-radius: 6px; }`)
  if (r.dark) css.push(`.lines th { background: ${x}; } .net { background: ${x}; }`)
  if (r.serif) css.push(`.co, h1 { font-family: ${SERIF}; font-weight: 400; } h1 { letter-spacing: 2px; }`)
  if (r.gold) css.push(`.head { border-top: 0; border-bottom: 1px solid ${GOLD}; } .lines th { background: none; color: #1f2933; text-transform: uppercase; letter-spacing: 1px; font-size: 7.5pt; border-top: 1px solid ${GOLD}; border-bottom: 1px solid ${GOLD}; } .net { background: none; color: ${c}; border-radius: 0; border-top: 1px solid ${GOLD}; border-bottom: 3px double ${GOLD}; }`)
  if (r.flat) css.push(`.head { border-top: 0; border-bottom: 1.5px solid ${INK}; } .lines th { background: none; color: #1f2933; border-bottom: 1.5px solid ${INK}; } .net { background: none; color: ${INK}; border-radius: 0; border: 1.5px solid ${INK}; }`)
  if (r.bigTitle) css.push(`h1 { font-size: 22pt; font-weight: 800; letter-spacing: -.5px; text-transform: none; color: ${INK}; }`)
  if (r.mono) css.push(`.co, h1 { color: #1f2933; }`)
  if (r.compact) css.push('body { font-size: 8.5pt; } .lines td, .lines th { padding: 4px 5px; }')
  return css.join('\n')
}
