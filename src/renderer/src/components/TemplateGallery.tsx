// Choix du modèle des documents : chaque vignette est le vrai rendu d'une facture d'exemple
// (même gabarit que l'aperçu, l'export PDF et l'impression), à la couleur choisie.

import { useEffect, useRef, useState } from 'react'
import { CheckCircle, MagnifyingGlassPlus } from '@phosphor-icons/react'
import { DOC_LAYOUTS, type DocLayout } from '@shared/domain'
import { api } from '../api'
import { Modal } from './ui'

// Feuille A4 à 96 points par pouce : la vignette en est une réduction exacte
const SHEET = { w: 794, h: 1123 }

export function TemplateGallery({ value, color, options, onChange }: { value: DocLayout; color: string; options: Record<string, unknown>; onChange: (l: DocLayout) => void }) {
  const [html, setHtml] = useState<Partial<Record<DocLayout, string>>>({})
  const [zoom, setZoom] = useState<DocLayout | null>(null)
  const key = JSON.stringify([color, options])
  // Échelle des vignettes : largeur réelle d'une vignette rapportée à celle de la feuille
  const grid = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = grid.current
    if (!el || typeof ResizeObserver !== 'function') return
    const measure = () => {
      const w = el.querySelector('.tpl-thumb')?.clientWidth
      if (w) el.style.setProperty('--tpl-scale', String(w / SHEET.w))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    let cancelled = false
    // Léger délai : la couleur personnalisée change en continu pendant le choix
    const t = setTimeout(() => {
      for (const l of DOC_LAYOUTS)
        api<{ html: string }>('settings.docSample', { layout: l.id, color, ...options })
          .then((r) => !cancelled && setHtml((h) => ({ ...h, [l.id]: r.html })))
          .catch(() => {})
    }, 180)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return (
    <>
      <div className="tpl-gallery" ref={grid} role="radiogroup" aria-label="Modèle des documents">
        {DOC_LAYOUTS.map((l, i) => (
          <div key={l.id} className={`tpl-pick ${value === l.id ? 'on' : ''}`} style={{ animationDelay: `${i * 50}ms` }}>
            <button type="button" role="radio" aria-checked={value === l.id} className="tpl-thumb" onClick={() => onChange(l.id)} aria-label={`${l.label} : ${l.hint}`}>
              {html[l.id] ? (
                <iframe title="" aria-hidden="true" tabIndex={-1} srcDoc={html[l.id]} sandbox="" width={SHEET.w} height={SHEET.h} />
              ) : (
                <span className="skeleton tpl-skel" />
              )}
              {value === l.id && <span className="tpl-check"><CheckCircle size={26} weight="fill" aria-hidden="true" /></span>}
            </button>
            <div className="tpl-meta">
              <div><strong>{l.label}</strong><span className="muted small">{l.hint}</span></div>
              <button type="button" className="icon-btn" onClick={() => setZoom(l.id)} aria-label={`Agrandir le modèle ${l.label}`} title="Agrandir"><MagnifyingGlassPlus size={20} aria-hidden="true" /></button>
            </div>
          </div>
        ))}
      </div>
      {zoom && (
        <Modal wide title={`Modèle ${DOC_LAYOUTS.find((l) => l.id === zoom)!.label}`} onClose={() => setZoom(null)}
          footer={<><button className="btn" onClick={() => setZoom(null)}>Fermer</button><button className="btn btn-primary" onClick={() => { onChange(zoom); setZoom(null) }}>Choisir ce modèle</button></>}>
          <div className="preview-frame a4"><iframe title="Aperçu du modèle" srcDoc={html[zoom]} sandbox="" /></div>
        </Modal>
      )}
    </>
  )
}
