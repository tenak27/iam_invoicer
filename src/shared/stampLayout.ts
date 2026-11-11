// Réglage du cachet et de la signature sur les documents imprimés (Société & paramètres → Cachet et
// signatures → Ajuster) : taille, décalage, et pour le cachet rotation et intensité de l'encre.
// Les décalages sont en pixels de la page A4 (794 px de large, soit environ 3,78 px par millimètre).

export interface StampLayout {
  stamp: { size: number; x: number; y: number; rotate: number; opacity: number }
  sign: { size: number; x: number; y: number }
}

export const DEFAULT_STAMP_LAYOUT: StampLayout = {
  stamp: { size: 100, x: 0, y: 0, rotate: 0, opacity: 92 },
  sign: { size: 100, x: 0, y: 0 }
}

/** Taille de base à 100 % (px) : cachet d'environ 29 mm de haut, signature de 15 mm. */
export const STAMP_BASE = { height: 110, width: 170 }
export const SIGN_BASE = { height: 58, width: 200 }
export const LAYOUT_LIMITS = { size: [40, 250], offset: [-260, 260], rotate: [-45, 45], opacity: [30, 100] } as const

const clamp = (v: unknown, [min, max]: readonly [number, number], fallback: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback
}

/** Réglage propre à partir d'une valeur quelconque (base, saisie) : bornes appliquées, défauts sinon. */
export function parseStampLayout(v: unknown): StampLayout {
  const o = (v && typeof v === 'object' ? v : {}) as any
  const d = DEFAULT_STAMP_LAYOUT
  return {
    stamp: {
      size: clamp(o.stamp?.size, LAYOUT_LIMITS.size, d.stamp.size),
      x: clamp(o.stamp?.x, LAYOUT_LIMITS.offset, 0),
      y: clamp(o.stamp?.y, LAYOUT_LIMITS.offset, 0),
      rotate: clamp(o.stamp?.rotate, LAYOUT_LIMITS.rotate, 0),
      opacity: clamp(o.stamp?.opacity, LAYOUT_LIMITS.opacity, d.stamp.opacity)
    },
    sign: {
      size: clamp(o.sign?.size, LAYOUT_LIMITS.size, d.sign.size),
      x: clamp(o.sign?.x, LAYOUT_LIMITS.offset, 0),
      y: clamp(o.sign?.y, LAYOUT_LIMITS.offset, 0)
    }
  }
}

/** Style en ligne de l'image du cachet (posée en haut à droite du cadre de signature). */
export function stampStyle(l: StampLayout): string {
  const k = l.stamp.size / 100
  return `max-height:${Math.round(STAMP_BASE.height * k)}px;max-width:${Math.round(STAMP_BASE.width * k)}px;opacity:${(l.stamp.opacity / 100).toFixed(2)};transform:translate(${l.stamp.x}px,${l.stamp.y}px) rotate(${l.stamp.rotate}deg)`
}

/** Style en ligne de l'image de la signature. */
export function signStyle(l: StampLayout): string {
  const k = l.sign.size / 100
  return `max-height:${Math.round(SIGN_BASE.height * k)}px;max-width:${Math.round(SIGN_BASE.width * k)}px;position:relative;transform:translate(${l.sign.x}px,${l.sign.y}px)`
}
