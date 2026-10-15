// Aperçu avant impression d'un document.
// Sur ordinateur : le PDF exact (pages, marges, en-têtes répétés, « Page X / Y »).
// Sur le web et le mobile : le document tel qu'il s'imprime ; la fenêtre d'impression
// du navigateur affiche ensuite son propre aperçu page par page.

import { useEffect, useState } from 'react'
import { DownloadSimple, FilePdf, FileText, Printer, Receipt } from '@phosphor-icons/react'
import { api, run, unwrap } from '../api'
import { Loading, Modal } from './ui'
import { PdfPages } from './PdfPages'

/** `duplicata` : réédition d'un document déjà établi (tampon et mention DUPLICATA sur l'aperçu, le PDF et l'impression). */
export function DocumentPreview({ id, onClose, ticket = false, duplicata = false }: { id: number; onClose: () => void; ticket?: boolean; duplicata?: boolean }) {
  const opts = { duplicata }
  const [format, setFormat] = useState<'a4' | 'ticket'>('a4')
  const [view, setView] = useState<{ pdf?: Uint8Array; html?: string; filename: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setView(null)
    setError(null)
    ;(async () => {
      try {
        const meta = await api<{ html: string; filename: string }>('documents.preview', { id, format, duplicata })
        if (window.erp.pdfPreview) {
          const b64 = await unwrap(window.erp.pdfPreview(id, format, opts))
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
          if (!cancelled) setView({ pdf: bytes, filename: meta.filename })
        } else if (!cancelled) setView({ html: meta.html, filename: meta.filename })
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, format, duplicata])

  return (
    <Modal
      wide
      title={view ? `${duplicata ? 'Duplicata' : 'Aperçu'} — ${view.filename.replace(/\.pdf$/, '').replace(' (duplicata)', '')}` : 'Aperçu avant impression'}
      onClose={onClose}
      footer={
        <>
          {ticket && (
            <div className="seg" role="group" aria-label="Format">
              <button className={format === 'a4' ? 'on' : ''} aria-pressed={format === 'a4'} onClick={() => setFormat('a4')}><FileText size={16} aria-hidden="true" />A4</button>
              <button className={format === 'ticket' ? 'on' : ''} aria-pressed={format === 'ticket'} onClick={() => setFormat('ticket')}><Receipt size={16} aria-hidden="true" />Ticket</button>
            </div>
          )}
          <span className="grow" />
          <button className="btn" onClick={() => run(() => unwrap(window.erp.pdf(id, 'save', format, opts)))}><DownloadSimple size={18} aria-hidden="true" />Enregistrer PDF</button>
          <button className="btn" onClick={() => run(() => unwrap(window.erp.pdf(id, 'open', format, opts)))}><FilePdf size={18} aria-hidden="true" />Ouvrir PDF</button>
          <button className="btn btn-primary" autoFocus onClick={() => run(() => unwrap(window.erp.pdf(id, 'print', format, opts)))}><Printer size={18} aria-hidden="true" />Imprimer</button>
        </>
      }
    >
      {error ? <p className="error-text">{error}</p> : !view ? <Loading /> : view.pdf ? (
        <div className={`preview-frame pdf ${format}`}>
          <PdfPages data={view.pdf} />
        </div>
      ) : (
        <div className={`preview-frame ${format}`}>
          <iframe title="Aperçu du document" srcDoc={view.html} sandbox="allow-same-origin" />
        </div>
      )}
    </Modal>
  )
}
