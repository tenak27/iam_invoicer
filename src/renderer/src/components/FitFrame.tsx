// Document imprimable (feuille A4 ou ticket) montré en entier dans la place disponible : la feuille
// garde sa vraie largeur et l'ensemble est réduit, comme dans un lecteur PDF. Sur téléphone, rien n'est
// coupé ni tassé ; « Taille réelle » permet de lire de près (défilement de côté).

import { useEffect, useRef, useState } from 'react'
import { ArrowsIn, ArrowsOut } from '@phosphor-icons/react'

/** Largeur d'une feuille A4 à 96 points par pouce. */
export const A4_WIDTH = 794

export function FitFrame({ html, width = A4_WIDTH, title = 'Aperçu du document' }: { html: string; width?: number; title?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const [avail, setAvail] = useState(width)
  const [height, setHeight] = useState(Math.round(width * 1.414))
  const [actual, setActual] = useState(false)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => setAvail(el.clientWidth)
    measure()
    if (typeof ResizeObserver !== 'function') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => setActual(false), [html])

  // Hauteur réelle du document (une fois les images et les polices chargées)
  const fit = () => {
    const d = frame.current?.contentDocument
    if (d?.documentElement) setHeight(Math.max(d.documentElement.scrollHeight, d.body?.scrollHeight ?? 0))
  }
  const scale = actual ? 1 : Math.min(1, avail / width)
  const small = avail < width - 4

  return (
    <div className={`fit-frame${actual ? ' actual' : ''}`} ref={box}>
      {small && (
        <button type="button" className="fit-toggle" onClick={() => setActual(!actual)} aria-pressed={actual}>
          {actual ? <><ArrowsIn size={16} aria-hidden="true" />Ajuster à l’écran</> : <><ArrowsOut size={16} aria-hidden="true" />Taille réelle</>}
        </button>
      )}
      <div className="fit-sheet" style={{ width: Math.round(width * scale), height: Math.round(height * scale) }}>
        <iframe
          ref={frame}
          title={title}
          srcDoc={html}
          sandbox="allow-same-origin"
          onLoad={() => {
            fit()
            // Polices et images arrivées après le chargement : seconde mesure
            setTimeout(fit, 300)
          }}
          style={{ width, height, transform: scale === 1 ? undefined : `scale(${scale})` }}
        />
      </div>
    </div>
  )
}
