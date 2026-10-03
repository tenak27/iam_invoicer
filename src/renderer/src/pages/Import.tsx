// Importer des données : clients, fournisseurs, articles, stock initial, salariés,
// plan comptable — depuis Excel (.xlsx), CSV ou un copier-coller de cellules.

import { useMemo, useState } from 'react'
import {
  ArrowLeft, Bank, CheckCircle, ClipboardText, DownloadSimple, FileArrowUp, IdentificationBadge, Package, Stack, Truck, UploadSimple, Users, WarningCircle, type Icon
} from '@phosphor-icons/react'
import { importDefs, mapHeaders, parseCsv, rowsToRecords, templateCsv, type ImportDef, type ImportKind } from '@shared/imports'
import { api, run, unwrap } from '../api'
import { Field, PageHeader, notify } from '../components/ui'
import { useSession } from '../session'
import { can } from '@shared/domain'
import { readXlsx } from '../xlsx'

const ICONS: Record<ImportKind, Icon> = { clients: Users, suppliers: Truck, products: Package, stock: Stack, employees: IdentificationBadge, accounts: Bank }
const TILES: Record<ImportKind, string> = { clients: 'kpi-blue', suppliers: 'kpi-amber', products: 'kpi-green', stock: 'kpi-violet', employees: 'kpi-rose', accounts: 'kpi-teal' }

type Report = { created: number; updated: number; errors: { line: number; message: string }[] }

export function ImportPage() {
  const { company, user } = useSession()
  const allowed = importDefs(company.tax_id_label || 'IFU').filter((d) => can(user.role, d.module))
  const [def, setDef] = useState<ImportDef | null>(null)
  return (
    <div className="page">
      <PageHeader
        title="Importer des données"
        subtitle="Reprenez vos fichiers Excel ou CSV : clients, fournisseurs, articles, stock, salariés et comptes."
        actions={def ? <button className="btn" onClick={() => setDef(null)}><ArrowLeft size={18} aria-hidden="true" />Autre type de données</button> : undefined}
      />
      {!def ? (
        <div className="import-grid">
          {allowed.map((d) => {
            const I = ICONS[d.kind]
            return (
              <button key={d.kind} className={`kpi-tile import-tile ${TILES[d.kind]}`} onClick={() => setDef(d)}>
                <div className="kpi-tile-top"><span className="kpi-tile-icon"><I size={24} weight="duotone" aria-hidden="true" /></span><h2>{d.label}</h2></div>
                <p>{d.description}</p>
                <span className="import-go">Importer <FileArrowUp size={16} aria-hidden="true" /></span>
              </button>
            )
          })}
        </div>
      ) : (
        <ImportWizard key={def.kind} def={def} />
      )}
    </div>
  )
}

function ImportWizard({ def }: { def: ImportDef }) {
  const [table, setTable] = useState<string[][] | null>(null)
  const [fileName, setFileName] = useState('')
  const [mapping, setMapping] = useState<(string | null)[]>([])
  const [paste, setPaste] = useState('')
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<Report | null>(null)

  const load = (rows: string[][], name: string) => {
    if (rows.length < 2) return notify('Le fichier doit contenir une ligne d’en-têtes et au moins une ligne de données.', 'error')
    setTable(rows)
    setFileName(name)
    setMapping(mapHeaders(rows[0], def))
    setReport(null)
  }
  const pickFile = async (file: File | undefined) => {
    if (!file) return
    try {
      const rows = /\.xlsx$/i.test(file.name) ? await readXlsx(file) : parseCsv(await file.text())
      load(rows, file.name)
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'error')
    }
  }
  const records = useMemo(() => (table ? rowsToRecords(table, mapping) : []), [table, mapping])
  const missing = def.columns.filter((c) => c.required && !mapping.includes(c.key))

  const template = () => run(() => unwrap(window.erp.saveText(`modele-import-${def.kind}.csv`, templateCsv(def))))
  const submit = async () => {
    setBusy(true)
    const r = await run(() => api<Report>('imports.run', { kind: def.kind, rows: records }))
    setBusy(false)
    if (!r) return
    setReport(r)
    requestAnimationFrame(() => document.querySelector('.import-report')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    notify(`${r.created} créé(s), ${r.updated} mis à jour${r.errors.length ? `, ${r.errors.length} ligne(s) refusée(s)` : ''}.`, r.errors.length ? 'info' : 'success')
  }
  const exportErrors = () =>
    run(() => unwrap(window.erp.saveText(`erreurs-import-${def.kind}.csv`, '﻿Ligne;Erreur\r\n' + report!.errors.map((e) => `${e.line};"${e.message.replace(/"/g, '""')}"`).join('\r\n'))))

  return (
    <>
      <div className="card import-steps">
        <div className="import-step">
          <span className="step-num">1</span>
          <div>
            <h3>Préparer le fichier</h3>
            <p className="muted">Une ligne d’en-têtes puis une ligne par {def.label.toLowerCase().replace(/s$/, '')}. Les intitulés courants sont reconnus (« Raison sociale », « Tél », « PV HT »…).</p>
            <button className="btn" onClick={template}><DownloadSimple size={18} aria-hidden="true" />Télécharger le modèle</button>
          </div>
        </div>
        <div className="import-step">
          <span className="step-num">2</span>
          <div className="grow">
            <h3>Choisir le fichier</h3>
            <label className="drop-zone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pickFile(e.dataTransfer.files[0]) }}>
              <UploadSimple size={30} weight="duotone" aria-hidden="true" />
              <span><strong>{fileName || 'Glissez votre fichier ici ou cliquez pour le choisir'}</strong><br /><span className="muted small">Excel (.xlsx) ou CSV</span></span>
              <input type="file" accept=".xlsx,.csv,.txt,text/csv" onChange={(e) => pickFile(e.target.files?.[0])} />
            </label>
            <details className="paste-box">
              <summary><ClipboardText size={16} aria-hidden="true" /> Ou coller des cellules copiées depuis Excel</summary>
              <Field label="Cellules (avec la ligne d’en-têtes)"><textarea rows={5} value={paste} onChange={(e) => setPaste(e.target.value)} /></Field>
              <button className="btn btn-sm" disabled={!paste.trim()} onClick={() => load(parseCsv(paste), 'Cellules collées')}>Utiliser ces cellules</button>
            </details>
          </div>
        </div>
      </div>

      {table && (
        <div className="card">
          <div className="row space-between wrap gap">
            <h3>3. Vérifier puis importer — {records.length} ligne(s)</h3>
            <button className="btn btn-primary" disabled={busy || missing.length > 0 || !records.length} onClick={submit}>
              <FileArrowUp size={18} aria-hidden="true" />{busy ? 'Import en cours…' : `Importer ${records.length} ligne(s)`}
            </button>
          </div>
          {missing.length > 0 && (
            <div className="info-box warn-box"><WarningCircle size={18} aria-hidden="true" /><span>Colonne(s) obligatoire(s) non associée(s) : <strong>{missing.map((c) => c.label).join(', ')}</strong>. Choisissez la colonne correspondante ci-dessous.</span></div>
          )}
          <p className="muted small">Les fiches existantes (même {def.columns.find((c) => c.key === def.match)?.label.toLowerCase() ?? 'code'}) sont mises à jour au lieu d’être créées en double.</p>
          <div className="table-wrap">
            <table className="table compact import-preview">
              <thead>
                <tr>
                  {table[0].map((h, i) => (
                    <th key={i}>
                      <div className="muted small">{h || `Colonne ${i + 1}`}</div>
                      <select
                        aria-label={`Champ pour la colonne ${h || i + 1}`}
                        value={mapping[i] ?? ''}
                        onChange={(e) => setMapping((m) => m.map((x, j) => (j === i ? e.target.value || null : x === e.target.value ? null : x)))}
                      >
                        <option value="">— Ignorer —</option>
                        {def.columns.map((c) => <option key={c.key} value={c.key}>{c.label}{c.required ? ' *' : ''}</option>)}
                      </select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.slice(1, 9).map((r, i) => (
                  <tr key={i}>{table[0].map((_, j) => <td key={j} className={mapping[j] ? '' : 'muted'}>{r[j]}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          {table.length > 9 && <p className="muted small">… et {table.length - 9} autre(s) ligne(s).</p>}
        </div>
      )}

      {report && (
        <div className="card import-report">
          <h3>Compte rendu</h3>
          <div className="kpi-row">
            <div className="mini-kpi good"><span><CheckCircle size={16} aria-hidden="true" />Créés</span><strong>{report.created}</strong></div>
            <div className="mini-kpi"><span>Mis à jour</span><strong>{report.updated}</strong></div>
            <div className={`mini-kpi ${report.errors.length ? 'bad' : 'good'}`}><span>Refusés</span><strong>{report.errors.length}</strong></div>
          </div>
          {report.errors.length > 0 && (
            <>
              <div className="table-wrap">
                <table className="table compact">
                  <thead><tr><th>Ligne</th><th>Motif</th></tr></thead>
                  <tbody>{report.errors.slice(0, 50).map((e) => <tr key={e.line}><td className="strong">{e.line}</td><td>{e.message}</td></tr>)}</tbody>
                </table>
              </div>
              <button className="btn" onClick={exportErrors}><DownloadSimple size={18} aria-hidden="true" />Exporter les erreurs</button>
            </>
          )}
        </div>
      )}
    </>
  )
}
