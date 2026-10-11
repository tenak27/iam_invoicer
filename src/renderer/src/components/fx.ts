// Effets de mouvement de l'application (voir design-system/iam-invoicer/MASTER.md, « Mouvement »).
// Tout est coupé quand l'utilisateur demande moins d'animations, et rien ne bloque la saisie :
// les éléments créés sont décoratifs (pointer-events: none) et se retirent seuls.

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

/** Onde au point d'appui sur les boutons, onglets et entrées de menu (écouteur unique). */
export function installRipple() {
  if (typeof document === 'undefined') return
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (reducedMotion() || e.button !== 0) return
      const el = (e.target as Element | null)?.closest?.<HTMLElement>('.btn, .tab, .nav-link, .tab-item, .pos-tile, .kpi-tile, .row-action')
      if (!el || el.matches(':disabled, [aria-disabled="true"]') || !el.animate) return
      const r = el.getBoundingClientRect()
      const d = Math.max(r.width, r.height) * 2.2
      const wave = document.createElement('span')
      wave.className = 'fx-ripple'
      wave.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`
      el.appendChild(wave)
      wave.animate([{ transform: 'scale(0)', opacity: 0.32 }, { transform: 'scale(1)', opacity: 0 }], { duration: 520, easing: 'cubic-bezier(.2, .8, .2, 1)' })
      setTimeout(() => wave.remove(), 540)
    },
    { passive: true }
  )
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

/** Tuiles d'indicateurs : légère inclinaison vers le pointeur (souris uniquement). */
export function installTilt() {
  if (typeof document === 'undefined' || !matchMedia('(hover: hover)').matches) return
  let last: HTMLElement | null = null
  document.addEventListener(
    'pointermove',
    (e) => {
      if (reducedMotion()) return
      const el = (e.target as Element | null)?.closest?.<HTMLElement>('.kpi-tile, .mini-kpi')
      if (last && last !== el) {
        last.style.removeProperty('--tx')
        last.style.removeProperty('--ty')
      }
      last = el ?? null
      if (!el) return
      const r = el.getBoundingClientRect()
      el.style.setProperty('--tx', (((e.clientX - r.left) / r.width - 0.5) * 7).toFixed(2) + 'deg')
      el.style.setProperty('--ty', ((0.5 - (e.clientY - r.top) / r.height) * 7).toFixed(2) + 'deg')
    },
    { passive: true }
  )
}

/** Cartes : un halo suit le pointeur (souris uniquement). */
export function installSpotlight() {
  if (typeof document === 'undefined' || !matchMedia('(hover: hover)').matches) return
  document.addEventListener(
    'pointermove',
    (e) => {
      if (reducedMotion()) return
      const el = (e.target as Element | null)?.closest?.<HTMLElement>('.card, .dcard, .pos-tile, .project-card, .tier-card, .kanban-card')
      if (!el) return
      const r = el.getBoundingClientRect()
      el.style.setProperty('--mx', `${Math.round(e.clientX - r.left)}px`)
      el.style.setProperty('--my', `${Math.round(e.clientY - r.top)}px`)
    },
    { passive: true }
  )
}

/** Boutons principaux : légère attraction vers le pointeur, relâchée en sortant. */
export function installMagnet() {
  if (typeof document === 'undefined' || !matchMedia('(hover: hover)').matches) return
  let last: HTMLElement | null = null
  const release = () => {
    last?.style.removeProperty('--bx')
    last?.style.removeProperty('--by')
    last = null
  }
  document.addEventListener(
    'pointermove',
    (e) => {
      if (reducedMotion()) return
      const el = (e.target as Element | null)?.closest?.<HTMLElement>('.btn-primary, .nav-icon-btn, .avatar-btn')
      if (last && last !== el) release()
      if (!el || el.matches(':disabled')) return
      last = el
      const r = el.getBoundingClientRect()
      el.style.setProperty('--bx', (((e.clientX - r.left) / r.width - 0.5) * 6).toFixed(1) + 'px')
      el.style.setProperty('--by', (((e.clientY - r.top) / r.height - 0.5) * 5).toFixed(1) + 'px')
    },
    { passive: true }
  )
  document.addEventListener('pointerleave', release, true)
}

/**
 * Défilement : les blocs situés sous l'écran montent en fondu quand ils y entrent.
 * Seuls les blocs hors de vue au moment où ils apparaissent sont concernés ; ceux déjà
 * visibles gardent leur entrée en cascade. Sans IntersectionObserver, rien n'est masqué.
 */
export function installReveal() {
  if (typeof document === 'undefined' || typeof IntersectionObserver !== 'function' || typeof MutationObserver !== 'function') return
  const seen = new WeakSet<Element>()
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue
        const el = en.target
        io.unobserve(el)
        el.classList.add('fx-in')
        setTimeout(() => el.classList.remove('fx-reveal', 'fx-in'), 750)
      }
    },
    { rootMargin: '0px 0px -8% 0px' }
  )
  let queued = false
  const scan = () => {
    queued = false
    if (reducedMotion()) return
    document.querySelectorAll('.route-view .page > *, .route-view .bento > *, .route-view .grid > .card').forEach((el) => {
      if (seen.has(el)) return
      seen.add(el)
      if (el.classList.contains('page-hero') || el.getBoundingClientRect().top < innerHeight - 20) return
      el.classList.add('fx-reveal')
      io.observe(el)
    })
  }
  new MutationObserver(() => {
    if (queued) return
    queued = true
    requestAnimationFrame(scan)
  }).observe(document.body, { childList: true, subtree: true })
}
