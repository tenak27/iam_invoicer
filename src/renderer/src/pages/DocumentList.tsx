import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { DOC_TYPES, type DocType } from '@shared/domain'
import { formatDate, todayISO } from '@shared/format'
import { api, exportCsv, run, unwrap, useQuery } from '../api'
import { confirmDialog, Empty, ErrorBox, Loading, Money, PageHeader, PaymentBadge, RowActions, SearchInput, StatusBadge } from '../components/ui'
import { Copy, Eye, FilePdf, Printer, Trash, Files, Coins, HourglassMedium, Warning, PencilLine } from '@phosphor-icons/react'
import { KpiStrip } from '../components/KpiStrip'
import { DocumentPreview } from '../components/DocumentPreview'

export function DocumentList() {
  const { type } = useParams<{ type: string }>()
  if (!type || !(type in DOC_TYPES)) return <Navigate to="/" />
  return <DocumentListInner key={type} type={type as DocType} />
}

function DocumentListInner({ type }: { type: DocType }) {
  const info = DOC_TYPES[type]
  const nav = useNavigate()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [unpaidOnly, setUnpaidOnly] = useState(false)
  const { data, error, loading, reload } = useQuery<any[]>('documents.list', { types: [type], search, status, from, to, unpaidOnly })
  const rows = data ?? []
  const totals = rows.filter((r) => r.status === 'valide').reduce((s, r) => ({ ht: s.ht + r.total_ht, ttc: s.ttc + r.total_ttc, rest: s.rest + (r.total_ttc - r.paid) }), { ht: 0, ttc: 0, rest: 0 })
  const partyLabel = info.side === 'sale' ? 'Client' : 'Fournisseur'
  const [preview, setPreview] = useState<number | null>(null)
  const duplicate = async (r: any) => {
    const copy = await run(() => api<{ id: number }>('documents.duplicate', { id: r.id }), 'Copie créée en brouillon.')
    if (copy) nav(`/doc/${copy.id}`)
  }
  const remove = async (r: any) => {
    if (!(await confirmDialog('Supprimer ce brouillon ?', { danger: true }))) return
    if (await run(() => api('documents.delete', { id: r.id }), 'Brouillon supprimé.')) reload()
  }

  const doExport = () =>
    exportCsv(`${info.plural}.csv`, [
      { label: 'Numéro', value: (r) => r.number ?? 'Brouillon' },
      { label: 'Date', value: (r) => formatDate(r.date) },
      { label: partyLabel, value: (r) => r.party_name },
      { label: 'Référence', value: (r) => r.reference },
      { label: 'Statut', value: (r) => r.status },
      { label: 'Total HT', value: (r) => r.total_ht },
      { label: 'TVA', value: (r) => r.total_tva },
      { label: 'Total TTC', value: (r) => r.total_ttc },
      ...(info.payable ? [{ label: 'Réglé', value: (r: any) => r.paid }, { label: 'Échéance', value: (r: any) => formatDate(r.due_date) }] : [])
    ], rows)

  return (
    <div className="page">
      <PageHeader
        title={info.plural}
        subtitle={`${rows.length} document(s)${totals.ttc ? ` · validés : ${Math.round(totals.ttc).toLocaleString('fr-FR')} TTC` : ''}${info.payable && totals.rest > 0 ? ` · reste à régler : ${Math.round(totals.rest).toLocaleString('fr-FR')}` : ''}`}
        actions={
          <>
            <button className="btn" onClick={doExport} disabled={rows.length === 0}>Exporter (Excel)</button>
            <button className="btn btn-primary" onClick={() => nav(`/docs/${type}/new`)}>{info.fem ? 'Nouvelle' : 'Nouveau'} {info.label.toLowerCase()}</button>
          </>
        }
      />
      <KpiStrip items={[
        { label: info.plural, value: rows.length, icon: Files },
        { label: 'Total TTC validé', value: totals.ttc, icon: Coins, money: true },
        { label: 'Reste à régler', value: totals.rest, icon: HourglassMedium, money: true, hidden: !info.payable },
        { label: 'En retard', value: rows.filter((r) => r.status === 'valide' && r.due_date && r.due_date < todayISO() && r.total_ttc - r.paid > 0.5).length, icon: Warning, tone: 'bad', hidden: !info.payable },
        { label: 'Brouillons', value: rows.filter((r) => r.status === 'brouillon').length, icon: PencilLine }
      ]} />
      <div className="toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder={`Numéro, ${partyLabel.toLowerCase()}, référence…`} />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Statut">
          <option value="">Tous les statuts</option>
          <option value="brouillon">Brouillons</option>
          <option value="valide">Validés</option>
          <option value="annule">Annulés</option>
        </select>
        <label className="inline">Du <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="inline">au <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        {info.payable && (
          <label className="inline check"><input type="checkbox" checked={unpaidOnly} onChange={(e) => setUnpaidOnly(e.target.checked)} /> Non soldés</label>
        )}
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Loading /> : rows.length === 0 ? (
        <Empty>Aucun document. Cliquez sur « {info.fem ? 'Nouvelle' : 'Nouveau'} {info.label.toLowerCase()} » pour commencer.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Numéro</th><th>Date</th><th>{partyLabel}</th><th>Référence</th><th>Statut</th>
                {info.payable && <th>Échéance</th>}
                {info.payable && <th>Paiement</th>}
                <th className="num">Total HT</th><th className="num">Total TTC</th>
                {info.payable && <th className="num">Reste</th>}
                <th className="actions-col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => nav(`/doc/${r.id}`)}>
                  <td className="strong nowrap">{r.number ?? <span className="muted">Brouillon n°{r.id}</span>}</td>
                  <td>{formatDate(r.date)}</td>
                  <td>{r.party_name}</td>
                  <td className="muted">{r.reference}</td>
                  <td><StatusBadge status={r.status} /></td>
                  {info.payable && <td>{formatDate(r.due_date)}</td>}
                  {info.payable && <td>{r.status === 'valide' && <PaymentBadge total={r.total_ttc} paid={r.paid} dueDate={r.due_date} />}</td>}
                  <td className="num"><Money value={r.total_ht} /></td>
                  <td className="num strong"><Money value={r.total_ttc} /></td>
                  {info.payable && <td className="num">{r.status === 'valide' && <Money value={r.total_ttc - r.paid} />}</td>}
                  <td className="actions-col">
                    <RowActions actions={[
                      { label: 'Aperçu', icon: Eye, onClick: () => setPreview(r.id) },
                      { label: 'Voir le PDF', icon: FilePdf, tone: 'primary', onClick: () => run(() => unwrap(window.erp.pdf(r.id, 'open'))) },
                      { label: 'Imprimer (avec aperçu)', icon: Printer, onClick: () => setPreview(r.id) },
                      { label: 'Dupliquer', icon: Copy, tone: 'success', onClick: () => duplicate(r) },
                      { label: 'Supprimer le brouillon', icon: Trash, tone: 'danger', hidden: r.status !== 'brouillon', onClick: () => remove(r) }
                    ]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {preview && <DocumentPreview id={preview} ticket={type === 'FAC'} onClose={() => setPreview(null)} />}
    </div>
  )
}
