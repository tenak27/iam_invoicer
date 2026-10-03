// Aperçu d'un document dans l'application (tel qu'il sera imprimé), avec impression
// et PDF : utile partout, y compris sur téléphone et dans le navigateur.

import { useEffect, useState } from 'react'
import { DownloadSimple, FilePdf, Printer, Receipt, FileText } from '@phosphor-icons/react'
import { api, run, unwrap } from '../api'
import { Loading, Modal } from './ui'

export function DocumentPreview({ id, onClose, ticket = false }: { id: number; onClose: () => void; ticket?: boolean }) {
  const [format, setFormat] = useState<'a4' | 'ticket'>('a4')
  const [doc, setDoc] = useState<{ html: string; filename: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setDoc(null)
    api<{ html: string; filename: string }>('documents.preview', { id, format }).then(setDoc, (e) => setError(e instanceof Error ? e.message : String(e)))
  }, [id, format])
  return (
    <Modal
      wide
      title={doc ? doc.filename.replace(/\.pdf$/, '') : 'Aperçu'}
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
          <button className="btn" onClick={() => run(() => unwrap(window.erp.pdf(id, 'save', format)))}><DownloadSimple size={18} aria-hidden="true" />Enregistrer PDF</button>
          <button className="btn" onClick={() => run(() => unwrap(window.erp.pdf(id, 'open', format)))}><FilePdf size={18} aria-hidden="true" />Ouvrir PDF</button>
          <button className="btn btn-primary" onClick={() => run(() => unwrap(window.erp.pdf(id, 'print', format)))}><Printer size={18} aria-hidden="true" />Imprimer</button>
        </>
      }
    >
      {error ? <p className="error-text">{error}</p> : !doc ? <Loading /> : (
        <div className={`preview-frame ${format}`}>
          <iframe title="Aperçu du document" srcDoc={doc.html} sandbox="allow-same-origin" />
        </div>
      )}
    </Modal>
  )
}
