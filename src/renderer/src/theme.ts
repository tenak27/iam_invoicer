// Thème d'affichage : suit le système par défaut, ou clair / sombre au choix.
// Préférence propre à l'appareil (un caissier en boutique et un comptable le
// soir n'ont pas les mêmes besoins), donc conservée localement.

import { useEffect, useState } from 'react'

export type ThemeChoice = 'system' | 'light' | 'dark'

const KEY = 'iam.theme'

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

function apply(choice: ThemeChoice) {
  const root = document.documentElement
  if (choice === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', choice)
  const dark = choice === 'dark' || (choice === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0a1120' : '#14223d')
}

/** À appeler avant le premier rendu pour éviter un flash du mauvais thème. */
export function initTheme() {
  apply(read())
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => apply(read()))
}

export function useTheme(): [ThemeChoice, (t: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(read)
  useEffect(() => {
    apply(choice)
    try {
      if (choice === 'system') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, choice)
    } catch {
      /* préférence non mémorisée : elle vaut pour la session */
    }
  }, [choice])
  return [choice, setChoice]
}
