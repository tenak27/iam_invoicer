import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatDate, formatMoney, formatQty, todayISO } from '@shared/format'
import { api, exportCsv, run, useQuery } from '../api'
import { KpiStrip } from '../components/KpiStrip'
import { Package, Coins, WarningCircle, Stack } from '@phosphor-icons/react'
import { confirmDialog, Empty, ErrorBox, Field, Loading, Modal, Money, notify, PageHeader, SearchInput, useForm } from '../components/ui'

const KIND_LABELS: Record<string, string> = { document: 'Document', inventaire: 'Inventaire', ajustement: 'Ajustement', annulation: 'Annulation' }

export function StockState() {
  const [search, setSearch] = useState('')
  const [lowOnly, setLowOnly] = useState(false)
  const [adjusting, setAdjusting] = useState<any | null>(null)
  const { data, error, loading, reload } = useQuery<any[]>('products.list', { kind: 'produit', search, lowStock: lowOnly })
  const rows = data ?? []
  const value = rows.reduce((s, r) => s + r.stock_value, 0)
  return (
    <div className="page">
      <PageHeader
        title="État du stock"
        subtitle={`${rows.length} produit(s) · valeur du stock (CMUP) : ${formatMoney(value)}`}
        actions={<button className="btn" disabled={!rows.length} onClick={() => exportCsv('Etat du stock.csv', [
          { label: 'Référence', value: (r) => r.ref }, { label: 'Désignation', value: (r) => r.name }, { label: 'Catégorie', value: (r) => r.category },
          { label: 'Quantité', value: (r) => r.stock_qty }, { label: 'Unité', value: (r) => r.unit }, { label: 'Stock minimum', value: (r) => r.min_stock },
          { label: 'Coût moyen', value: (r) => Math.round(r.avg_cost) }, { label: 'Valeur', value: (r) => Math.round(r.stock_value) }
        ], rows)}>Exporter (Excel)</button>}
      />
      <KpiStrip items={[
        { label: 'Produits suivis', value: rows.length, icon: Package },
        { label: 'Valeur du stock (CMUP)', value: value, icon: Coins, money: true },
        { label: 'Unités en stock', value: rows.reduce((s, r) => s + Math.max(0, r.stock_qty), 0), icon: Stack },
        { label: 'Sous le seuil', value: rows.filter((r) => r.stock_qty <= r.min_stock).length, icon: WarningCircle, tone: 'bad' }
      ]} />
      <div className="toolbar">
        <SearchInput value={search} onChange={setSearch} />
        <label className="inline check"><input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Sous le seuil minimum uniquement</label>
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Loading /> : rows.length === 0 ? <Empty>Aucun produit.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Réf.</th><th>Désignation</th><th>Catégorie</th><th className="num">Quantité</th><th className="num">Minimum</th><th className="num">Coût moyen</th><th className="num">Valeur</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="muted">{r.ref}</td>
                  <td className="strong">{r.name}</td>
                  <td>{r.category}</td>
                  <td className="num"><span className={r.stock_qty <= 0 ? 'text-danger' : r.stock_qty <= r.min_stock ? 'text-warn' : ''}>{formatQty(r.stock_qty)}</span> <span className="muted small">{r.unit}</span></td>
                  <td className="num muted">{formatQty(r.min_stock)}</td>
                  <td className="num"><Money value={r.avg_cost} /></td>
                  <td className="num"><Money value={r.stock_value} /></td>
                  <td className="num"><button className="link-btn" onClick={() => setAdjusting(r)}>Entrée / sortie</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adjusting && <AdjustModal product={adjusting} onClose={() => setAdjusting(null)} onDone={() => { setAdjusting(null); reload() }} />}
    </div>
  )
}

function AdjustModal({ product, onClose, onDone }: { product: any; onClose: () => void; onDone: () => void }) {
  const f = useForm({ direction: 'in', quantity: '', unitCost: String(Math.round(product.avg_cost || product.purchase_price || 0)), date: todayISO(), note: '' })
  const submit = async () => {
    const q = Number(f.values.quantity.replace(',', '.'))
    const r = await run(() => api('stock.adjust', {
      productId: product.id,
      quantity: f.values.direction === 'in' ? q : -q,
      unitCost: f.values.direction === 'in' ? f.values.unitCost : undefined,
      date: f.values.date,
      note: f.values.note
    }), 'Mouvement enregistré.')
    if (r) onDone()
  }
  return (
    <Modal title={`Mouvement manuel — ${product.name}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" onClick={submit}>Enregistrer</button></>}>
      <p className="muted">Stock actuel : <strong>{formatQty(product.stock_qty)} {product.unit}</strong></p>
      <div className="grid grid-2">
        <Field label="Sens">
          <select {...f.bind('direction')}><option value="in">Entrée (stock initial, retour…)</option><option value="out">Sortie (casse, perte, usage interne…)</option></select>
        </Field>
        <Field label="Quantité"><input autoFocus inputMode="decimal" {...f.bind('quantity')} /></Field>
        {f.values.direction === 'in' && <Field label="Coût unitaire HT"><input inputMode="decimal" {...f.bind('unitCost')} /></Field>}
        <Field label="Date"><input type="date" {...f.bind('date')} /></Field>
        <Field label="Motif" span={2}><input {...f.bind('note')} placeholder="Ex. : stock initial, casse, échantillon…" /></Field>
      </div>
    </Modal>
  )
}

export function StockMovements() {
  const nav = useNavigate()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')
  const { data, error, loading, reload } = useQuery<any[]>('stock.movements', { from, to })
  const rows = useMemo(() => {
    const s = search.toLowerCase()
    return (data ?? []).filter((r) => !s || r.product_name.toLowerCase().includes(s) || r.ref.toLowerCase().includes(s) || (r.document_number ?? '').toLowerCase().includes(s))
  }, [data, search])
  return (
    <div className="page">
      <PageHeader title="Mouvements de stock" subtitle={`${rows.length} mouvement(s)`}
        actions={<button className="btn" disabled={!rows.length} onClick={() => exportCsv('Mouvements de stock.csv', [
          { label: 'Date', value: (r) => formatDate(r.date) }, { label: 'Référence', value: (r) => r.ref }, { label: 'Article', value: (r) => r.product_name },
          { label: 'Quantité', value: (r) => r.quantity }, { label: 'Coût unitaire', value: (r) => Math.round(r.unit_cost) }, { label: 'Type', value: (r) => KIND_LABELS[r.kind] },
          { label: 'Document', value: (r) => r.document_number }, { label: 'Motif', value: (r) => r.note }, { label: 'Utilisateur', value: (r) => r.user_name }
        ], rows)}>Exporter (Excel)</button>} />
      <div className="toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder="Article, référence, document…" />
        <label className="inline">Du <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="inline">au <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Loading /> : rows.length === 0 ? <Empty>Aucun mouvement.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Date</th><th>Article</th><th className="num">Quantité</th><th className="num">Coût unit.</th><th>Origine</th><th>Motif</th><th>Par</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.document_id ? 'clickable' : ''} onClick={() => r.document_id && nav(`/doc/${r.document_id}`)}>
                  <td>{formatDate(r.date)}</td>
                  <td>{r.product_name} <span className="muted small">{r.ref}</span></td>
                  <td className={`num strong ${r.quantity < 0 ? 'text-danger' : 'text-ok'}`}>{r.quantity > 0 ? '+' : ''}{formatQty(r.quantity)}</td>
                  <td className="num"><Money value={r.unit_cost} /></td>
                  <td>{KIND_LABELS[r.kind]} {r.document_number && <strong>{r.document_number}</strong>}</td>
                  <td className="muted">{r.note}</td>
                  <td className="muted">{r.user_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function Inventory() {
  const { data, error, loading, reload } = useQuery<any[]>('products.list', { kind: 'produit' })
  const [counts, setCounts] = useState<Record<number, string>>({})
  const [date, setDate] = useState(todayISO())
  const [note, setNote] = useState('Inventaire')
  const [search, setSearch] = useState('')
  const rows = (data ?? []).filter((r) => !search || (r.name + r.ref + r.category).toLowerCase().includes(search.toLowerCase()))
  const entered = Object.entries(counts).filter(([, v]) => v.trim() !== '')
  const diffs = entered.map(([id, v]) => {
    const p = data?.find((x) => x.id === Number(id))
    return p ? Number(v.replace(',', '.')) - p.stock_qty : 0
  })
  const changed = diffs.filter((d) => Math.abs(d) > 1e-9).length

  const submit = async () => {
    if (!(await confirmDialog(`Enregistrer l'inventaire ?`, { detail: `${changed} article(s) seront ajustés au stock compté.` }))) return
    const r = await run(() => api<{ adjusted: number }>('stock.inventory', {
      date, note, counts: entered.map(([id, v]) => ({ productId: Number(id), counted: Number(v.replace(',', '.')) }))
    }))
    if (r) {
      setCounts({})
      reload()
      notify(`Inventaire enregistré : ${r.adjusted} article(s) ajusté(s).`, 'success')
    }
  }
  return (
    <div className="page">
      <PageHeader title="Inventaire" subtitle="Saisissez les quantités comptées ; seuls les écarts sont enregistrés."
        actions={<>
          <button className="btn" onClick={() => exportCsv('Feuille inventaire.csv', [
            { label: 'Référence', value: (r) => r.ref }, { label: 'Désignation', value: (r) => r.name }, { label: 'Catégorie', value: (r) => r.category },
            { label: 'Unité', value: (r) => r.unit }, { label: 'Stock théorique', value: (r) => r.stock_qty }, { label: 'Quantité comptée', value: () => '' }
          ], data ?? [])}>Feuille de comptage (Excel)</button>
          <button className="btn btn-primary" disabled={changed === 0} onClick={submit}>Enregistrer ({changed} écart{changed > 1 ? 's' : ''})</button>
        </>} />
      <div className="toolbar">
        <SearchInput value={search} onChange={setSearch} />
        <label className="inline">Date <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="inline">Libellé <input value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Loading /> : rows.length === 0 ? <Empty>Aucun produit.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Réf.</th><th>Désignation</th><th>Catégorie</th><th className="num">Stock théorique</th><th className="num" style={{ width: 150 }}>Compté</th><th className="num">Écart</th><th className="num">Valeur écart</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const v = counts[r.id] ?? ''
                const diff = v.trim() === '' ? null : Number(v.replace(',', '.')) - r.stock_qty
                return (
                  <tr key={r.id}>
                    <td className="muted">{r.ref}</td>
                    <td className="strong">{r.name}</td>
                    <td>{r.category}</td>
                    <td className="num">{formatQty(r.stock_qty)} <span className="muted small">{r.unit}</span></td>
                    <td><input className="num-input" inputMode="decimal" value={v} onChange={(e) => setCounts((c) => ({ ...c, [r.id]: e.target.value }))} /></td>
                    <td className={`num strong ${diff == null || diff === 0 ? '' : diff < 0 ? 'text-danger' : 'text-ok'}`}>{diff == null || Number.isNaN(diff) ? '' : (diff > 0 ? '+' : '') + formatQty(diff)}</td>
                    <td className="num">{diff ? <Money value={diff * r.avg_cost} /> : ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
