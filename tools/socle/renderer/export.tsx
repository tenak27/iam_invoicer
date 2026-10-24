// Export d'une liste vers Excel : fichier CSV (séparateur « ; », accents conservés, lisible par Excel
// en français). Base commune des applications IAM : source iam-erp/tools/socle, recopiée par
// sync.mjs ; ne pas modifier ici. Navigateur et ordinateur : le fichier est enregistré directement.
// Application téléphone : le serveur le garde 10 minutes (/api/socle/export) et le navigateur du
// téléphone l'ouvre (enregistrer, partager, ouvrir dans Excel).
import { useState } from 'react'
import { DownloadSimple } from '@phosphor-icons/react'

export type Cell = string | number | boolean | null | undefined

export interface ExportColumn<T> {
  label: string
  value: (row: T) => Cell
}

/** Ce que l'application fournit : adresse du serveur, session, application installée, ouverture d'une adresse. */
export interface ExportEnv {
  server: string
  token: string | null
  native: boolean
  open: (url: string) => unknown
}

/** Marque UTF-8 en tête du fichier : sans elle, Excel lit mal les accents. */
const BOM = String.fromCharCode(0xfeff)

const cell = (v: Cell) => {
  let s = v == null ? '' : typeof v === 'boolean' ? (v ? 'oui' : 'non') : typeof v === 'number' ? String(v).replace('.', ',') : String(v)
  // Texte commençant comme une formule (=, +, -, @) : Excel l'exécuterait à l'ouverture (nom de client
  // saisi sur la boutique, par exemple) ; l'apostrophe le garde en texte
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^[+-]?\d+([.,]\d+)?$/.test(s)) s = `'${s}`
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Tableau → CSV pour Excel. */
export const toCsv = (table: Cell[][]) => BOM + table.map((r) => r.map(cell).join(';')).join('\r\n')

/** Lignes et colonnes → tableau, ligne d'en-tête comprise. */
export const tableOf = <T,>(rows: T[], columns: ExportColumn<T>[]): Cell[][] => [columns.map((c) => c.label), ...rows.map((r) => columns.map((c) => c.value(r)))]

const DAY = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
const TIME = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })
const asDate = (v: unknown) => {
  if (v == null || v === '') return null
  // « 2026-10-24 » seul : jour du calendrier, sans décalage horaire
  const d = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00`) : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d
}

/** Date reconnue par Excel : « 24/10/2026 ». */
export const excelDate = (v: unknown): string => {
  const d = asDate(v)
  return d ? DAY.format(d) : ''
}

/** Date et heure reconnues par Excel : « 24/10/2026 07:00 ». */
export const excelDateTime = (v: unknown): string => {
  const d = asDate(v)
  return d ? `${DAY.format(d)} ${TIME.format(d)}` : ''
}

/** Téléphone gardé en texte et lisible : « (+226) 76 99 00 11 », « 76 99 00 11 ». */
export const phoneText = (v: unknown): string => {
  const raw = String(v ?? '').trim()
  const s = raw.replace(/[\s.-]+/g, '')
  const bf = /^(?:\+|00)226(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(s)
  if (bf) return `(+226) ${bf.slice(1).join(' ')}`
  const local = /^(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(s)
  if (local) return local.slice(1).join(' ')
  return raw
}

/** Enregistre (ou, sur téléphone, ouvre) le fichier « nom-AAAA-MM-JJ.csv ». */
export async function saveCsv(name: string, table: Cell[][], env: ExportEnv): Promise<void> {
  const file = `${name}-${new Date().toISOString().slice(0, 10)}.csv`
  const content = toCsv(table)
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
