// Petites briques d'animation : chiffre qui défile, squelette de chargement.
// Toutes respectent « réduire les animations » du système.

import { useEffect, useRef, useState, type RefObject } from 'react'

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Anime une valeur numérique de 0 à `value` (900 ms, décélération). Le texte final est lu par les lecteurs d'écran. */
export function CountUp({ value, format, duration = 900 }: { value: number; format: (n: number) => string; duration?: number }) {
  const [shown, setShown] = useState(() => (reduced() ? value : 0))
  const from = useRef(0)
  useEffect(() => {
    if (reduced()) {
      setShown(value)
      return
    }
    const start = performance.now()
    const a = from.current
    let raf = 0
    const tick = (t: number) => {
      const k = Math.min((t - start) / duration, 1)
      const eased = 1 - Math.pow(1 - k, 3)
      setShown(a + (value - a) * eased)
      if (k < 1) raf = requestAnimationFrame(tick)
      else from.current = value
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration])
  return (
    <>
      <span aria-hidden="true">{format(shown)}</span>
      <span className="sr-only">{format(value)}</span>
    </>
  )
}

/**
 * Fait défiler les chiffres des indicateurs d'une page (tuiles .mini-kpi, .kpi, puces)
 * dès qu'ils apparaissent, sans toucher au rendu React : seul le nœud texte existant
 * est modifié, et l'animation s'arrête si React change la valeur entre-temps.
 */
export function useCountUpEnhancer(root: RefObject<HTMLElement | null>, key: string) {
  useEffect(() => {
    const el = root.current
    if (!el || reduced() || typeof MutationObserver === 'undefined') return
    const seen = new WeakSet<Element>()
    const frames = new Set<number>()
    const run = () => {
      el.querySelectorAll('.mini-kpi strong, .kpi-value, .chip strong').forEach((target) => {
        if (seen.has(target)) return
        seen.add(target)
        const node = target.firstChild
        if (!node || node.nodeType !== Node.TEXT_NODE || target.childNodes.length !== 1) return
        const text = node.nodeValue ?? ''
        const m = /^(\D*?)(\d{1,3}(?:([\s\u202f\u00a0])\d{3})+|\d+)(?![.,]?\d)(.*)$/s.exec(text)
        if (!m) return
        const [, before, digits, sep = '', after] = m
        const value = Number(digits.replace(/\D/g, ''))
        if (!value) return
        const fmt = (n: number) => before + (sep ? String(n).replace(/\B(?=(\d{3})+(?!\d))/g, sep) : String(n)) + after
        const start = performance.now()
        let last = fmt(0)
        node.nodeValue = last
        const tick = (t: number) => {
          if (node.nodeValue !== last) return // React a mis la valeur à jour
          const k = Math.min((t - start) / 900, 1)
          last = k < 1 ? fmt(Math.round(value * (1 - Math.pow(1 - k, 3)))) : text
          node.nodeValue = last
          if (k < 1) frames.add(requestAnimationFrame(tick))
        }
        frames.add(requestAnimationFrame(tick))
      })
    }
    run()
    const observer = new MutationObserver(run)
    observer.observe(el, { childList: true, subtree: true })
    // Seuls les chiffres qui apparaissent au chargement de la page défilent
    const stop = setTimeout(() => observer.disconnect(), 4000)
    return () => {
      observer.disconnect()
      clearTimeout(stop)
      frames.forEach(cancelAnimationFrame)
    }
  }, [root, key])
}

/** Squelette du tableau de bord pendant le chargement. */
export function DashboardSkeleton() {
  return (
    <div className="page" aria-busy="true" aria-label="Chargement du tableau de bord">
      <div className="bento">
        {[3, 3, 3, 3, 5, 7, 4, 4, 4].map((span, i) => (
          <div key={i} className={`skeleton span-${span}`} style={{ height: i < 4 ? 150 : 260 }} />
        ))}
      </div>
    </div>
  )
}
