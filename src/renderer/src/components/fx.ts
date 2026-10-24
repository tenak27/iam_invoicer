// Effets de mouvement de l'application (voir design-system/iam-invoicer/MASTER.md, « Mouvement »).
// Tout est coupé quand l'utilisateur demande moins d'animations, et rien ne bloque la saisie :
// les éléments créés sont décoratifs (pointer-events: none) et se retirent seuls.
// Plus d'effet permanent (onde, inclinaison, halo, aimant, apparition au défilement) : ce qu'on
// voit des dizaines de fois par jour ne doit pas bouger (règles d'Emil Kowalski, socle/motion.css).

import { useLayoutEffect, useState, type RefObject } from 'react'

export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

const CONFETTI = ['#1d6fd6', '#e8a817', '#17874f', '#7367f0', '#ff9f43', '#0784a3']

/**
 * Pluie de confettis : marque un moment qui compte (vente encaissée, facture validée,
 * règlement reçu, licence activée). Part de l'élément ou du point donné.
 */
export function celebrate(from?: Element | { x: number; y: number } | null) {
  if (reducedMotion() || typeof document === 'undefined' || !document.body.animate) return
  let x = innerWidth / 2
  let y = innerHeight / 3
  if (from instanceof Element) {
    const r = from.getBoundingClientRect()
    x = r.left + r.width / 2
    y = r.top + r.height / 2
  } else if (from) ({ x, y } = from)
  const layer = document.createElement('div')
  layer.className = 'fx-layer'
  layer.setAttribute('aria-hidden', 'true')
  document.body.appendChild(layer)
  const N = 34
  let longest = 0
  for (let i = 0; i < N; i++) {
    const p = document.createElement('i')
    const size = 6 + Math.random() * 6
    p.style.cssText = `left:${x}px;top:${y}px;width:${size}px;height:${size * (Math.random() > 0.5 ? 1 : 0.45)}px;background:${CONFETTI[i % CONFETTI.length]};border-radius:${Math.random() > 0.6 ? '50%' : '2px'}`
    layer.appendChild(p)
    const angle = (i / N) * Math.PI * 2 + Math.random() * 0.5
    const speed = 90 + Math.random() * 170
    const dx = Math.cos(angle) * speed
    const dy = Math.sin(angle) * speed - 120
    const duration = 900 + Math.random() * 700
    longest = Math.max(longest, duration)
    p.animate(
      [
        { transform: 'translate(-50%, -50%) scale(.4) rotate(0deg)', opacity: 1 },
        { transform: `translate(calc(-50% + ${dx * 0.7}px), calc(-50% + ${dy}px)) scale(1) rotate(${Math.random() * 360}deg)`, opacity: 1, offset: 0.35 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy + 260}px)) scale(.9) rotate(${360 + Math.random() * 540}deg)`, opacity: 0 }
      ],
      { duration, easing: 'cubic-bezier(.2, .7, .3, 1)', fill: 'forwards' }
    )
  }
  // Retrait par minuteur (jamais par événement de fin d'animation)
  setTimeout(() => layer.remove(), longest + 100)
}

/**
 * Changement de thème : le nouveau thème se dévoile en cercle depuis le bouton.
 * Sans l'API View Transitions (ou avec moins d'animations), le thème change simplement.
 */
export function themeReveal(from: Element | null, change: () => void) {
  const start = (document as any).startViewTransition?.bind(document)
  if (!start || reducedMotion() || !from) return change()
  const r = from.getBoundingClientRect()
  const x = r.left + r.width / 2
  const y = r.top + r.height / 2
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
  document.documentElement.classList.add('theme-reveal')
  const t = start(change)
  t.ready
    .then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 520, easing: 'cubic-bezier(.2, .8, .2, 1)', pseudoElement: '::view-transition-new(root)' }
      )
    })
    .catch(() => {})
  t.finished.finally(() => document.documentElement.classList.remove('theme-reveal'))
}

/**
 * Indicateur du menu : une pastille unique glisse vers l'entrée active (continuité entre
 * les pages) au lieu de disparaître d'une entrée pour réapparaître sur une autre.
 */
export function useNavIndicator(nav: RefObject<HTMLElement | null>, deps: unknown[]) {
  const [ind, setInd] = useState<{ x: number; y: number; w: number; h: number; ready: boolean } | null>(null)
  useLayoutEffect(() => {
    const el = nav.current
    if (!el) return
    const measure = () => {
      const a = el.querySelector<HTMLElement>('.nav-link.active')
      if (!a) return setInd(null)
      const ar = a.getBoundingClientRect()
      const nr = el.getBoundingClientRect()
      setInd((prev) => ({ x: ar.left - nr.left, y: ar.top - nr.top + el.scrollTop, w: ar.width, h: ar.height, ready: !!prev }))
    }
    measure()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    return () => ro?.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return ind
}
