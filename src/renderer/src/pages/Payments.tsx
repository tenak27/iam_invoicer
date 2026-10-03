import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DOC_TYPES, type DocType } from '@shared/domain'
import { formatDate, formatMoney } from '@shared/format'
import { api, exportCsv, run, useQuery } from '../api'
import { confirmDialog, Empty, ErrorBox, Field, Loading, Modal, Money, PageHeader, RowActions, SearchInput, Tabs } from '../components/ui'
import { Eye, Trash } from '@phosphor-icons/react'
import { useCan } from '../session'
import { PaymentModal } from './DocumentEditor'

export function Payments() {
  const nav = useNavigate()
  const [direction, setDirection] = useState<'' | 'in' | 'out'>('')
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [picking, setPicking] = useState(false)
  const { data, error, loading, reload } = useQuery<any[]>('payments.list', { direction, search, from, to })
  const rows = data ?? []
  const totalIn = rows.filter((r) => r.direction === 'in').reduce((s, r) => s + r.amount, 0)
  const totalOut = rows.filter((r) => r.direction === 'out').reduce((s, r) => s + r.amount, 0)
  const byMethod = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.method] = (acc[r.method] ?? 0) + (r.direction === 'in' ? r.amount : -r.amount)
    return acc
  }, {})
  return (
    <div className="page">
      <PageHeader
        title="Paiements"
        subtitle={`Encaissé : ${formatMoney(totalIn)} · Décaissé : ${formatMoney(totalOut)} · Net : ${formatMoney(totalIn - totalOut)}`}
        actions={<>
          <button className="btn" disabled={!rows.length} onClick={() => exportCsv('Paiements.csv', [
            { label: 'Date', value: (r) => formatDate(r.date) }, { label: 'Sens', value: (r) => (r.direction === 'in' ? 'Encaissement' : 'Décaissement') },
            { label: 'Tiers', value: (r) => r.party_name }, { label: 'Document', value: (r) => r.document_number }, { label: 'Mode', value: (r) => r.method },
            { label: 'Référence', value: (r) => r.reference }, { label: 'Montant', value: (r) => r.amount }, { label: 'Saisi par', value: (r) => r.user_name }
          ], rows)}>Exporter (Excel)</button>
          <button className="btn btn-primary" onClick={() => setPicking(true)}>Nouveau règlement</button>
        </>}
      />
      <div className="toolbar">
        <Tabs value={direction} onChange={setDirection} tabs={[{ value: '', label: 'Tous' }, { value: 'in', label: 'Encaissements' }, { value: 'out', label: 'Décaissements' }]} />
        <SearchInput value={search} onChange={setSearch} placeholder="Tiers, document, référence…" />
        <label className="inline">Du <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="inline">au <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      {Object.keys(byMethod).length > 0 && (
        <div className="chips">
          {Object.entries(byMethod).map(([m, v]) => <span key={m} className="chip">{m} : <strong>{formatMoney(v)}</strong></span>)}
        </div>
      )}
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Loading /> : rows.length === 0 ? <Empty>Aucun règlement sur la période.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Date</th><th>Tiers</th><th>Document</th><th>Mode</th><th>Référence</th><th>Saisi par</th><th className="num">Montant</th><th className="actions-col">Actions</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.document_id ? 'clickable' : ''} onClick={() => r.document_id && nav(`/doc/${r.document_id}`)}>
                  <td>{formatDate(r.date)}</td>
                  <td className="strong">{r.party_name}</td>
                  <td>{r.document_number}</td>
                  <td>{r.method}</td>
                  <td className="muted">{r.reference}</td>
                  <td className="muted">{r.user_name}</td>
                  <td className="num strong"><Money value={r.direction === 'in' ? r.amount : -r.amount} /></td>
                  <td className="actions-col">
                    <RowActions actions={[
                      { label: 'Voir le document', icon: Eye, hidden: !r.document_id, onClick: () => nav(`/doc/${r.document_id}`) },
                      {
                        label: 'Supprimer le règlement', icon: Trash, tone: 'danger',
                        onClick: async () => {
                          if (await confirmDialog(`Supprimer le règlement de ${formatMoney(r.amount)} ?`, { danger: true, detail: "L'écriture comptable correspondante est aussi supprimée. Impossible pour un règlement d'une caisse clôturée." }))
                            if (await run(() => api('payments.delete', { id: r.id }), 'Règlement supprimé.')) reload()
                        }
                      }
                    ]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {picking && <PickDocument onClose={() => setPicking(false)} onDone={() => { setPicking(false); reload() }} />}
    </div>
  )
}

/** Choix de la facture à régler, puis saisie du règlement. */
function PickDocument({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const canSales = useCan('sales')
  const canPurchases = useCan('purchases')
  const [side, setSide] = useState<'sale' | 'purchase'>(canSales ? 'sale' : 'purchase')
  const types: DocType[] = side === 'sale' ? ['FAC', 'AV'] : ['FF']
  const [search, setSearch] = useState('')
  const { data, loading } = useQuery<any[]>('documents.list', { types, search, unpaidOnly: true })
  const [selected, setSelected] = useState<any | null>(null)
  if (selected) return <PaymentModal doc={selected} remaining={selected.total_ttc - selected.paid} onClose={() => setSelected(null)} onDone={onDone} />
  return (
    <Modal title="Document à régler" onClose={onClose} wide>
      <div className="toolbar">
        {canSales && canPurchases && (
          <Tabs value={side} onChange={setSide} tabs={[{ value: 'sale', label: 'Clients' }, { value: 'purchase', label: 'Fournisseurs' }]} />
        )}
        <Field label=""><SearchInput value={search} onChange={setSearch} placeholder="Numéro ou nom…" /></Field>
      </div>
      {loading && !data ? <Loading /> : !data?.length ? <Empty>Aucun document en attente de règlement.</Empty> : (
        <table className="table compact">
          <thead><tr><th>Document</th><th>Tiers</th><th>Échéance</th><th className="num">Reste</th></tr></thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.id} className="clickable" onClick={() => setSelected(d)}>
                <td>{DOC_TYPES[d.type as DocType].label} <strong>{d.number}</strong></td>
                <td>{d.party_name}</td>
                <td>{formatDate(d.due_date)}</td>
                <td className="num"><Money value={d.total_ttc - d.paid} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  )
}
