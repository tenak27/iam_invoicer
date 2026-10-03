import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowsLeftRight, Barcode, MagnifyingGlass, Plus, Warehouse } from '@phosphor-icons/react'
import { formatDate, formatMoney, formatQty } from '@shared/format'
import { api, exportCsv, run, useQuery } from '../api'
import { Empty, ErrorBox, Field, Loading, Modal, PageHeader, SearchInput, Tabs, useForm } from '../components/ui'

type Tab = 'stock' | 'depots' | 'transferts' | 'lots'

export function StockAdvanced() {
  const [tab, setTab] = useState<Tab>('stock')
  const [transfer, setTransfer] = useState(false)
  const [key, setKey] = useState(0)
  return (
    <div className="page">
      <PageHeader
        title="Dépôts, transferts et lots"
        subtitle="Stock par dépôt, mouvements entre dépôts et traçabilité des lots et numéros de série."
        actions={<button className="btn btn-primary" onClick={() => setTransfer(true)}><ArrowsLeftRight size={18} aria-hidden="true" />Nouveau transfert</button>}
      />
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'stock', label: 'Stock par dépôt' },
        { value: 'depots', label: 'Dépôts' },
        { value: 'transferts', label: 'Transferts' },
        { value: 'lots', label: 'Lots et séries' }
      ]} />
      <div className="tab-panel" key={tab + key}>
        {tab === 'stock' && <StockMatrix />}
        {tab === 'depots' && <Warehouses />}
        {tab === 'transferts' && <Transfers />}
        {tab === 'lots' && <Lots />}
      </div>
      {transfer && <TransferModal onClose={() => setTransfer(false)} onDone={() => { setTransfer(false); setKey((k) => k + 1); setTab('transferts') }} />}
    </div>
  )
}

function StockMatrix() {
  const [search, setSearch] = useState('')
  const { data, error, loading, reload } = useQuery<any>('stock.byWarehouse', { search })
  if (error) return <ErrorBox error={error} onRetry={reload} />
  if (loading && !data) return <Loading />
  const { warehouses, rows } = data
  return (
    <>
      <div className="toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder="Article, référence…" />
        <button className="btn" onClick={() => exportCsv('Stock-par-depot.csv', [
          { label: 'Référence', value: (r) => r.ref }, { label: 'Article', value: (r) => r.name },
          ...warehouses.map((w: any) => ({ label: w.name, value: (r: any) => r.by_wh[w.id] ?? 0 })),
          { label: 'Total', value: (r) => r.stock_qty }, { label: 'Valeur', value: (r) => Math.round(r.stock_qty * r.avg_cost) }
        ], rows)}>Exporter (Excel)</button>
      </div>
      {rows.length === 0 ? <Empty>Aucun article stocké.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Article</th>{warehouses.map((w: any) => <th key={w.id} className="num">{w.name}</th>)}<th className="num">Total</th><th className="num">Valeur</th></tr></thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.id}>
                  <td><span className="strong">{r.name}</span><div className="muted small">{r.ref}{r.tracking !== 'aucun' ? ` · suivi par ${r.tracking === 'serie' ? 'numéro de série' : 'lot'}` : ''}</div></td>
                  {warehouses.map((w: any) => {
                    const q = r.by_wh[w.id] ?? 0
                    return <td key={w.id} className={`num ${q < 0 ? 'text-danger' : q === 0 ? 'muted' : ''}`}>{formatQty(q)}</td>
                  })}
                  <td className={`num strong ${r.stock_qty <= r.min_stock ? 'text-warn' : ''}`}>{formatQty(r.stock_qty)} {r.unit}</td>
                  <td className="num money">{formatMoney(r.stock_qty * r.avg_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function Warehouses() {
  const { data, error, loading, reload } = useQuery<any[]>('stock.warehouses')
  const [editing, setEditing] = useState<any | null>(null)
  if (error) return <ErrorBox error={error} onRetry={reload} />
  if (loading && !data) return <Loading />
  return (
    <>
      <div className="row end"><button className="btn" onClick={() => setEditing({})}><Plus size={18} aria-hidden="true" />Nouveau dépôt</button></div>
      <div className="card-grid">
        {data!.map((w) => (
          <button key={w.id} className={`dcard pick-card ${w.active ? '' : 'inactive'}`} onClick={() => setEditing(w)}>
            <span className="tint tint-md tint-primary" aria-hidden="true"><Warehouse size={22} weight="duotone" /></span>
            <div className="grow">
              <strong>{w.name}</strong>
              <span className="muted small">{w.code}{w.address ? ` · ${w.address}` : ''}{w.active ? '' : ' · inactif'}</span>
            </div>
            <div className="num"><strong>{formatMoney(w.stock_value)}</strong><span className="muted small">{w.products} article(s)</span></div>
          </button>
        ))}
      </div>
      {editing && <WarehouseModal w={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload() }} />}
    </>
  )
}

function WarehouseModal({ w, onClose, onDone }: { w: any; onClose: () => void; onDone: () => void }) {
  const f = useForm({ code: w.code ?? '', name: w.name ?? '', address: w.address ?? '', active: w.active ?? true })
  const save = async () => {
    if (await run(() => api('stock.saveWarehouse', { ...f.values, id: w.id }), 'Dépôt enregistré.')) onDone()
  }
  return (
    <Modal title={w.id ? `Dépôt ${w.name}` : 'Nouveau dépôt'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" onClick={save}>Enregistrer</button></>}>
      <div className="grid grid-3">
        <Field label="Code"><input autoFocus {...f.bind('code')} placeholder="BOBO" /></Field>
        <Field label="Nom" span={2}><input {...f.bind('name')} placeholder="Agence de Bobo-Dioulasso" /></Field>
        <Field label="Adresse" span={3}><input {...f.bind('address')} /></Field>
      </div>
      {w.id && <label className="inline check"><input type="checkbox" checked={!!f.values.active} onChange={(e) => f.set('active', e.target.checked)} /> Dépôt utilisable</label>}
    </Modal>
  )
}

function Transfers() {
  const { data, error, loading, reload } = useQuery<any[]>('stock.transfers')
  if (error) return <ErrorBox error={error} onRetry={reload} />
  if (loading && !data) return <Loading />
  if (data!.length === 0) return <Empty>Aucun transfert. Utilisez « Nouveau transfert » pour déplacer du stock d'un dépôt à l'autre.</Empty>
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>N°</th><th>Date</th><th>De</th><th>Vers</th><th>Articles</th><th>Par</th></tr></thead>
        <tbody>
          {data!.map((t) => (
            <tr key={t.id}>
              <td className="strong nowrap">{t.number}</td><td>{formatDate(t.date)}</td><td>{t.from_name}</td><td>{t.to_name}</td>
              <td>{(typeof t.lines === 'string' ? JSON.parse(t.lines) : t.lines ?? []).map((l: any, i: number) => <div key={i}>{formatQty(l.quantity)} × {l.product}{l.lot ? <span className="muted"> ({l.lot})</span> : null}</div>)}</td>
              <td className="muted">{t.user_name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TransferModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { data: wh } = useQuery<any[]>('warehouses.options')
  const { data: products } = useQuery<any[]>('products.list', { kind: 'produit' })
  const [from, setFrom] = useState('1')
  const [to, setTo] = useState('')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState([{ productId: '', quantity: '1', lot: '' }])
  const set = (i: number, k: string, v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)))
  const save = async () => {
    const r = await run(() => api('stock.transfer', { from: Number(from), to: Number(to), note, lines: lines.map((l) => ({ productId: Number(l.productId), quantity: Number(l.quantity.replace(',', '.')), lot: l.lot })) }))
    if (r) onDone()
  }
  return (
    <Modal title="Transfert entre dépôts" wide onClose={onClose} footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" onClick={save}>Transférer</button></>}>
      <div className="grid grid-3">
        <Field label="Dépôt d'origine"><select value={from} onChange={(e) => setFrom(e.target.value)}>{(wh ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
        <Field label="Dépôt de destination"><select value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choisir…</option>{(wh ?? []).filter((w) => String(w.id) !== from).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
        <Field label="Motif"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Réassort agence" /></Field>
      </div>
      <div className="table-wrap">
        <table className="table compact">
          <thead><tr><th>Article</th><th style={{ width: 110 }}>Quantité</th><th style={{ width: 180 }}>Lot / n° de série</th><th /></tr></thead>
          <tbody>
            {lines.map((l, i) => {
              const p = products?.find((x) => String(x.id) === l.productId)
              return (
                <tr key={i}>
                  <td><select value={l.productId} onChange={(e) => set(i, 'productId', e.target.value)} aria-label="Article"><option value="">Choisir…</option>{(products ?? []).map((x) => <option key={x.id} value={x.id}>{x.name} ({formatQty(x.stock_qty)})</option>)}</select></td>
                  <td><input className="num-input" inputMode="decimal" value={l.quantity} onChange={(e) => set(i, 'quantity', e.target.value)} aria-label="Quantité" /></td>
                  <td><input value={l.lot} disabled={!p || p.tracking === 'aucun'} onChange={(e) => set(i, 'lot', e.target.value)} aria-label="Lot" placeholder={p?.tracking === 'aucun' ? '—' : ''} /></td>
                  <td>{lines.length > 1 && <button className="icon-btn" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Retirer">×</button>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <button className="link-btn" onClick={() => setLines([...lines, { productId: '', quantity: '1', lot: '' }])}>+ Ajouter un article</button>
    </Modal>
  )
}

function Lots() {
  const [search, setSearch] = useState('')
  const [trace, setTrace] = useState('')
  const { data, error, loading, reload } = useQuery<any[]>('stock.lots', { search })
  const [result, setResult] = useState<any | null>(null)
  const doTrace = async () => setResult(await run(() => api('stock.trace', { lot: trace })) ?? null)
  return (
    <>
      <div className="dcard trace-card">
        <div className="row gap wrap">
          <span className="tint tint-md tint-info" aria-hidden="true"><Barcode size={22} weight="duotone" /></span>
          <div className="grow"><strong>Traçabilité</strong><div className="muted small">Retrouvez l'entrée, la sortie et l'emplacement d'un numéro de série ou d'un lot.</div></div>
          <form className="row gap" onSubmit={(e) => { e.preventDefault(); doTrace() }}>
            <input value={trace} onChange={(e) => setTrace(e.target.value)} placeholder="SN-001…" aria-label="Numéro à tracer" />
            <button className="btn btn-primary"><MagnifyingGlass size={18} aria-hidden="true" />Tracer</button>
          </form>
        </div>
        {result && (
          <div className="trace-result">
            {result.stock.length === 0 && result.documents.length === 0 ? <p className="muted">Aucune trace de « {trace} ».</p> : (
              <ol className="timeline">
                {result.documents.map((d: any) => (
                  <li key={d.id}><span className="tl-dot" /><div><Link to={`/doc/${d.id}`} className="strong">{d.number ?? d.type}</Link> · {formatDate(d.date)} · {d.party_name}<div className="muted small">{d.description}</div></div></li>
                ))}
                {result.stock.map((s: any) => (
                  <li key={s.id}><span className="tl-dot now" /><div><strong>{s.qty > 0 ? `En stock : ${s.warehouse_name}` : `Sorti du stock (${s.warehouse_name})`}</strong><div className="muted small">{s.product_name}{s.expiry ? ` · péremption ${formatDate(s.expiry)}` : ''}</div></div></li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
      <div className="toolbar"><SearchInput value={search} onChange={setSearch} placeholder="Lot, numéro de série, article…" /></div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Loading /> : data!.length === 0 ? (
        <Empty>Aucun lot en stock. Activez le suivi « lot » ou « numéro de série » sur un article, puis saisissez les références lors des réceptions.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Lot / n° de série</th><th>Article</th><th>Dépôt</th><th>Péremption</th><th className="num">Quantité</th></tr></thead>
            <tbody>
              {data!.map((l) => (
                <tr key={l.id}><td className="strong">{l.lot}</td><td>{l.product_name} <span className="muted small">{l.ref}</span></td><td>{l.warehouse_name}</td><td>{l.expiry ? formatDate(l.expiry) : '—'}</td><td className="num">{formatQty(l.qty)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
