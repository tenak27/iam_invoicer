// Cachet de société dessiné par l'application (Société et paramètres → Cachet et signatures) : rond,
// ovale ou rectangulaire, à l'encre choisie, avec le nom en couronne, des lignes au centre (forme
// juridique, RCCM, IFU, téléphone) et la ville en bas. Le SVG produit est converti en PNG par
// l'interface puis gardé comme n'importe quel cachet importé.

export type StampShape = 'rond' | 'ovale' | 'rectangle'

export const STAMP_SHAPES: { id: StampShape; label: string }[] = [
  { id: 'rond', label: 'Rond' },
  { id: 'ovale', label: 'Ovale' },
  { id: 'rectangle', label: 'Rectangulaire' }
]

export const STAMP_COLORS: { id: string; label: string; hex: string }[] = [
  { id: 'bleu', label: 'Bleu', hex: '#1e40af' },
  { id: 'rouge', label: 'Rouge', hex: '#b91c1c' },
  { id: 'noir', label: 'Noir', hex: '#1f2937' },
  { id: 'vert', label: 'Vert', hex: '#15803d' },
  { id: 'violet', label: 'Violet', hex: '#6d28d9' }
]

export interface StampSpec {
  shape: StampShape
  /** Couleur de l'encre (#rrggbb). */
  color: string
  /** Texte de la couronne du haut (nom de la société). */
  top: string
  /** Texte du bas (ville, pays…). */
  bottom: string
  /** Lignes du centre (forme juridique, RCCM, IFU, téléphone…), quatre au plus. */
  lines: string[]
  /** Encre légèrement irrégulière, comme un vrai tampon. */
  worn: boolean
  /** Étoiles entre la couronne du haut et celle du bas. */
  stars: boolean
}

interface StampCompany {
  name?: string
  legal_form?: string
  city?: string
  country?: string
  rccm?: string
  tax_id?: string
  tax_id_label?: string
  phone?: string
}

/** Cachet proposé d'après la fiche de la société. */
export function defaultStampSpec(c: StampCompany): StampSpec {
  const lines = [
    c.legal_form ? String(c.legal_form).toUpperCase() : '',
    c.rccm ? `RCCM ${c.rccm}` : '',
    c.tax_id ? `${c.tax_id_label || 'IFU'} ${c.tax_id}` : '',
    c.phone ? `Tél. ${c.phone}` : ''
  ].filter(Boolean)
  return {
    shape: 'rond',
    color: STAMP_COLORS[0].hex,
    top: String(c.name ?? '').toUpperCase() || 'VOTRE SOCIÉTÉ',
    bottom: [c.city, c.country].filter(Boolean).join(' · ').toUpperCase() || 'OUAGADOUGOU · BURKINA FASO',
    lines,
    worn: true,
    stars: true
  }
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)
const FONT = "'Segoe UI', 'Helvetica Neue', Arial, Helvetica, sans-serif"

/** Taille de caractère d'un texte courbe : plus le texte est long, plus il est petit. */
const arcSize = (text: string, arcLength: number, max: number) => Math.max(14, Math.min(max, (arcLength / Math.max(8, text.length)) * 1.55))

/** Lignes du centre : la première en gras, taille selon leur nombre et leur longueur. */
function centerLines(lines: string[], cx: number, cy: number, width: number, color: string, gap: number): string {
  const kept = lines.filter((l) => l.trim()).slice(0, 4)
  if (!kept.length) return ''
  const longest = Math.max(...kept.map((l) => l.length), 8)
  const size = Math.max(16, Math.min(gap * 0.72, (width / longest) * 1.7))
  const start = cy - ((kept.length - 1) * gap) / 2
  return kept
    .map((l, i) => `<text x="${cx}" y="${start + i * gap}" text-anchor="middle" dominant-baseline="middle" font-family="${FONT}" font-size="${size.toFixed(1)}" font-weight="${i === 0 ? 700 : 600}" fill="${color}" letter-spacing="${i === 0 ? 1.5 : 0.5}">${esc(l)}</text>`)
    .join('')
}

/** Code SVG du cachet (fond transparent). */
export function stampSvg(spec: StampSpec): string {
  const c = /^#[0-9a-fA-F]{6}$/.test(spec.color) ? spec.color : STAMP_COLORS[0].hex
  const top = spec.top.trim()
  const bottom = spec.bottom.trim()
  const worn = spec.worn
    ? `<filter id="worn" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.08" numOctaves="4" seed="11" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.5 1.45" result="m"/><feComposite in="SourceGraphic" in2="m" operator="in"/></filter>`
    : ''
  const g = (inner: string, w: number, h: number) =>
    `<svg xmlns="http://www.w3.org/2000/svg" text-rendering="geometricPrecision" shape-rendering="geometricPrecision" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><defs>${worn}</defs><g ${spec.worn ? 'filter="url(#worn)"' : ''} transform="rotate(-3 ${w / 2} ${h / 2})" opacity="0.94">${inner}</g></svg>`

  if (spec.shape === 'rond') {
    const W = 600
    const cx = 300
    const r = 228
    const arc = Math.PI * r // demi-cercle
    const stars = spec.stars ? `<text x="${cx - r}" y="${300 + 11}" text-anchor="middle" font-size="30" fill="${c}">★</text><text x="${cx + r}" y="${300 + 11}" text-anchor="middle" font-size="30" fill="${c}">★</text>` : ''
    return g(
      `<circle cx="${cx}" cy="300" r="285" fill="none" stroke="${c}" stroke-width="11"/>
      <circle cx="${cx}" cy="300" r="262" fill="none" stroke="${c}" stroke-width="3"/>
      <circle cx="${cx}" cy="300" r="192" fill="none" stroke="${c}" stroke-width="3"/>
      <path id="st" d="M ${cx - r} 300 A ${r} ${r} 0 0 1 ${cx + r} 300" fill="none"/>
      <path id="sb" d="M ${cx - r} 300 A ${r} ${r} 0 0 0 ${cx + r} 300" fill="none"/>
      <text font-family="${FONT}" font-weight="700" font-size="${arcSize(top, arc, 44).toFixed(1)}" fill="${c}" letter-spacing="3" dominant-baseline="middle"><textPath href="#st" startOffset="50%" text-anchor="middle">${esc(top)}</textPath></text>
      <text font-family="${FONT}" font-weight="600" font-size="${arcSize(bottom, arc, 34).toFixed(1)}" fill="${c}" letter-spacing="3" dominant-baseline="middle"><textPath href="#sb" startOffset="50%" text-anchor="middle">${esc(bottom)}</textPath></text>
      ${stars}
      ${centerLines(spec.lines, cx, 300, 330, c, 52)}`,
      W,
      W
    )
  }
  if (spec.shape === 'ovale') {
    const W = 760
    const H = 520
    const rx = 300
    const ry = 185
    const arc = Math.PI * Math.sqrt((rx * rx + ry * ry) / 2)
    const stars = spec.stars ? `<text x="${380 - rx}" y="${260 + 11}" text-anchor="middle" font-size="30" fill="${c}">★</text><text x="${380 + rx}" y="${260 + 11}" text-anchor="middle" font-size="30" fill="${c}">★</text>` : ''
    return g(
      `<ellipse cx="380" cy="260" rx="365" ry="245" fill="none" stroke="${c}" stroke-width="11"/>
      <ellipse cx="380" cy="260" rx="343" ry="223" fill="none" stroke="${c}" stroke-width="3"/>
      <ellipse cx="380" cy="260" rx="258" ry="140" fill="none" stroke="${c}" stroke-width="3"/>
      <path id="st" d="M ${380 - rx} 260 A ${rx} ${ry} 0 0 1 ${380 + rx} 260" fill="none"/>
      <path id="sb" d="M ${380 - rx} 260 A ${rx} ${ry} 0 0 0 ${380 + rx} 260" fill="none"/>
      <text font-family="${FONT}" font-weight="700" font-size="${arcSize(top, arc, 42).toFixed(1)}" fill="${c}" letter-spacing="3" dominant-baseline="middle"><textPath href="#st" startOffset="50%" text-anchor="middle">${esc(top)}</textPath></text>
      <text font-family="${FONT}" font-weight="600" font-size="${arcSize(bottom, arc, 32).toFixed(1)}" fill="${c}" letter-spacing="3" dominant-baseline="middle"><textPath href="#sb" startOffset="50%" text-anchor="middle">${esc(bottom)}</textPath></text>
      ${stars}
      ${centerLines(spec.lines, 380, 260, 440, c, 48)}`,
      W,
      H
    )
  }
  const W = 760
  const H = 460
  const topSize = Math.max(18, Math.min(46, (620 / Math.max(8, top.length)) * 1.6))
  const bottomSize = Math.max(14, Math.min(30, (620 / Math.max(8, bottom.length)) * 1.6))
  return g(
    `<rect x="18" y="18" width="724" height="424" rx="26" fill="none" stroke="${c}" stroke-width="11"/>
    <rect x="40" y="40" width="680" height="380" rx="16" fill="none" stroke="${c}" stroke-width="3"/>
    <line x1="70" y1="128" x2="690" y2="128" stroke="${c}" stroke-width="3"/>
    <line x1="70" y1="352" x2="690" y2="352" stroke="${c}" stroke-width="3"/>
    <text x="380" y="92" text-anchor="middle" dominant-baseline="middle" font-family="${FONT}" font-weight="700" font-size="${topSize.toFixed(1)}" fill="${c}" letter-spacing="3">${esc(top)}</text>
    <text x="380" y="388" text-anchor="middle" dominant-baseline="middle" font-family="${FONT}" font-weight="600" font-size="${bottomSize.toFixed(1)}" fill="${c}" letter-spacing="2">${esc(bottom)}</text>
    ${centerLines(spec.lines, 380, 240, 600, c, 48)}`,
    W,
    H
  )
}
