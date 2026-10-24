// Export d'une liste vers Excel : fichier CSV (séparateur « ; », accents conservés, lisible par Excel
// en français). Base commune des applications IAM : source iam-erp/tools/socle, recopiée par
// sync.mjs ; ne pas modifier ici. Navigateur et ordinateur : le fichier est enregistré directement.
// Application téléphone : le serveur le garde 10 minutes (/api/socle/export) et le navigateur du
// téléphone l'ouvre (enregistrer, partager, ouvrir dans Excel).
import { useState } from 'react'
import { DownloadSimple } from '@phosphor-icons/react'
import { tableOf, toCsv, type Cell, type ExportColumn } from './csv'

export { excelDate, excelDateTime, phoneText, tableOf, toCsv, type Cell, type ExportColumn } from './csv'

/** Ce que l'application fournit : adresse du serveur, session, application installée, ouverture d'une adresse. */
export interface ExportEnv {
  server: string
  token: string | null
  native: boolean
  open: (url: string) => unknown
}

/** Enregistre (ou, sur téléphone, ouvre) le fichier « nom-AAAA-MM-JJ.csv ». */
export async function saveCsv(name: string, table: Cell[][], env: ExportEnv): Promise<void> {
  await saveCsvText(`${name}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(table), env)
}

/** CSV déjà prêt (journal comptable calculé par le serveur, par exemple) : même enregistrement que saveCsv. */
export async function saveCsvText(file: string, content: string, env: ExportEnv): Promise<void> {
  if (env.native) {
    const r = await fetch(`${env.server}/api/socle/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(env.token ? { Authorization: `Bearer ${env.token}` } : {}) },
      body: JSON.stringify({ name: file, content })
    })
    const j = await r.json().catch(() => ({ ok: false, error: `Export impossible (${r.status}).` }))
    if (!j.ok) throw new Error(j.error || 'Export impossible.')
    await env.open(env.server + j.data.url)
    return
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  a.download = file
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

/** Bouton « Exporter » d'une liste (désactivé quand elle est vide). */
export function ExportButton<T>({ name, rows, columns, env, onError, label = 'Exporter', className = 'btn' }: { name: string; rows: T[] | null | undefined; columns: ExportColumn<T>[]; env: ExportEnv; onError?: (message: string) => void; label?: string; className?: string }) {
  const [busy, setBusy] = useState(false)
  const run = async () => {
    if (!rows?.length) return
    setBusy(true)
    try {
      await saveCsv(name, tableOf(rows, columns), env)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (onError) onError(message)
      else window.alert(message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <button type="button" className={className} onClick={() => void run()} disabled={busy || !rows?.length} title="Exporter la liste vers Excel (fichier CSV)">
      <DownloadSimple size={18} aria-hidden="true" /> {busy ? 'Export…' : label}
    </button>
  )
}
