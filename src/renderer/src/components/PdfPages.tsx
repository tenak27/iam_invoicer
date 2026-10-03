// Affiche un PDF page par page (pdf.js) : aperçu fidèle avant impression,
// sans dépendre de la visionneuse PDF du système. Chargé à la demande.

import { useEffect, useRef, useState } from 'react'
import { Loading } from './ui'

export function PdfPages({ data }: { data: Uint8Array }) {
  const host = useRef<HTMLDivElement>(null)
  const [pages, setPages] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let doc: { destroy: () => Promise<void> } | null = null
    ;(async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
        pdfjs.GlobalWorkerOptions.workerSrc = worker
        const pdf = await pdfjs.getDocument({ data: data.slice() }).promise
        doc = pdf
        if (cancelled) return
        setPages(pdf.numPages)
        const el = host.current
        if (!el) return
        el.replaceChildren()
        const width = Math.min(el.clientWidth - 32, 900)
        for (let n = 1; n <= pdf.numPages && !cancelled; n++) {
          const page = await pdf.getPage(n)
          const base = page.getViewport({ scale: 1 })
          const scale = width / base.width
          const ratio = window.devicePixelRatio || 1
          const viewport = page.getViewport({ scale: scale * ratio })
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          canvas.style.width = `${Math.floor(viewport.width / ratio)}px`
          canvas.style.height = `${Math.floor(viewport.height / ratio)}px`
          canvas.setAttribute('role', 'img')
          canvas.setAttribute('aria-label', `Page ${n} sur ${pdf.numPages}`)
          const wrap = document.createElement('div')
          wrap.className = 'pdf-page'
          const label = document.createElement('div')
          label.className = 'pdf-page-num'
          label.textContent = `Page ${n} / ${pdf.numPages}`
          wrap.append(canvas, label)
          el.append(wrap)
          await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
      doc?.destroy().catch(() => {})
    }
  }, [data])

  if (error) return <p className="error-text">Aperçu impossible : {error}</p>
  return (
    <>
      {!pages && <Loading />}
      <div className="pdf-pages" ref={host} />
    </>
  )
}
