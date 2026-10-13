// Apparence : un thème de couleurs (Ciel, Améthyste, Lavande) et un mode (automatique,
// clair, sombre). Préférences propres à l'appareil (un caissier en boutique et un
// comptable le soir n'ont pas les mêmes besoins), donc conservées localement.

import { useSyncExternalStore } from 'react'

export type ThemeChoice = 'system' | 'light' | 'dark'
export type Palette = 'ciel' | 'amethyste' | 'lavande'

/** Thèmes proposés ; `swatch` = fond, menu, couleur d'action (aperçu du sélecteur). */
export const PALETTES: { id: Palette; name: string; hint: string; swatch: [string, string, string]; bar: [string, string] }[] = [
  { id: 'ciel', name: 'Ciel', hint: 'Bleu lumineux, menu clair', swatch: ['#e8f1fd', '#ffffff', '#1b6ef3'], bar: ['#e8f1fd', '#0a1528'] },
  { id: 'amethyste', name: 'Améthyste', hint: 'Menu violet, cartes blanches', swatch: ['#f1f0f8', '#5b4a9e', '#5b4a9e'], bar: ['#5b4a9e', '#14112a'] },
  { id: 'lavande', name: 'Lavande', hint: 'Pervenche douce, très sobre', swatch: ['#eef0fa', '#ffffff', '#5a63c2'], bar: ['#eef0fa', '#12142c'] }
]

const THEME_KEY = 'iam.theme'
const PALETTE_KEY = 'iam.palette'
const DEFAULT_PALETTE: Palette = 'ciel'

function readTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

function readPalette(): Palette {
  try {
    const v = localStorage.getItem(PALETTE_KEY)
    return PALETTES.some((p) => p.id === v) ? (v as Palette) : DEFAULT_PALETTE
  } catch {
    return DEFAULT_PALETTE
  }
}

let state = { theme: readTheme(), palette: readPalette() }
const listeners = new Set<() => void>()

const systemDark = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches

/** Pose le mode effectif (clair ou sombre, « automatique » résolu) et le thème sur la racine. */
function paint() {
  const root = document.documentElement
  const dark = state.theme === 'dark' || (state.theme === 'system' && systemDark())
  root.setAttribute('data-theme', dark ? 'dark' : 'light')
  root.setAttribute('data-palette', state.palette)
  const bar = PALETTES.find((p) => p.id === state.palette)!.bar
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bar[dark ? 1 : 0])
}

function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* préférence non mémorisée : elle vaut pour la session */
  }
}

function update(next: Partial<typeof state>) {
  state = { ...state, ...next }
  paint()
  store(THEME_KEY, state.theme === 'system' ? null : state.theme)
  store(PALETTE_KEY, state.palette)
  listeners.forEach((l) => l())
}

export const setTheme = (theme: ThemeChoice) => update({ theme })
export const setPalette = (palette: Palette) => update({ palette })

/** À appeler avant le premier rendu pour éviter un flash du mauvais thème. */
export function initTheme() {
  paint()
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paint)
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useAppearance() {
  return useSyncExternalStore(subscribe, () => state)
}
