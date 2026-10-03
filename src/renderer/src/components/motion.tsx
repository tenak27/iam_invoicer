// Petites briques d'animation : chiffre qui défile, squelette de chargement.
// Toutes respectent « réduire les animations » du système.

import { useEffect, useRef, useState } from 'react'

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
