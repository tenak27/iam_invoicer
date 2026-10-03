import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { computeTotals, lineHT, PAYMENT_METHODS, type LineInput } from '@shared/domain'
import { formatMoney, formatNumber, formatQty } from '@shared/format'
import { api, run, unwrap, useQuery } from '../api'
import { Empty, ErrorBox, Field, Loading, Modal, Money, PageHeader, SearchInput, useForm } from '../components/ui'
import { KpiStrip } from '../components/KpiStrip'
import { CashRegister as CashRegisterIcon, Coins, LockOpen, Warning } from '@phosphor-icons/react'
import { useCan, useSession } from '../session'

type CartLine = LineInput & { key: number; ref?: string; stock?: number; kind?: string }

const parseAmount = (s: string) => {
  const n = parseFloat(String(s).replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? Math.round(n) : 0
}

const dateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '')

/** Point de vente : ouverture de caisse, panier, encaissement, clôture. */
export function CashRegister() {
  const { data: summary, error, loading, reload } = useQuery<any>('cash.current')
  if (error) return <div className="page"><ErrorBox error={error} onRetry={reload} /></div>
  if (loading && summary === undefined) return <Loading />
  if (!summary) return <OpenRegister onOpened={reload} />
  return <Pos summary={summary} reload={reload} />
}

function OpenRegister({ onOpened }: { onOpened: () => void }) {
  const [amount, setAmount] = useState('0')
  const [busy, setBusy] = useState(false)
  const open = async () => {
    setBusy(true)
    const r = await run(() => api('cash.open', { opening_amount: parseAmount(amount) }), 'Caisse ouverte.')
    setBusy(false)
    if (r) onOpened()
  }
  return (
    <div className="page">
      <PageHeader title="Point de vente" subtitle="Votre caisse est fermée." actions={<Link className="btn" to="/caisse/sessions">Sessions de caisse</Link>} />
      <div className="card narrow">
        <h3>Ouvrir la caisse</h3>
        <p className="muted">Comptez les espèces présentes dans le tiroir avant la première vente.</p>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); open() }}>
          <Field label="Fonds de caisse (FCFA)"><input autoFocus inputMode="numeric" value={amount} onFocus={(e) => e.target.select()} onChange={(e) => setAmount(e.target.value)} /></Field>
          <button className="btn btn-primary btn-block" disabled={busy}>Ouvrir la caisse</button>
        </form>
      </div>
    </div>
  )
}

function Pos({ summary, reload }: { summary: any; reload: () => void }) {
  const { company } = useSession()
  const canSales = useCan('sales')
  const { data: products } = useQuery<any[]>('products.list', {})
  const { data: options } = useQuery<any>('cash.options')
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [clientId, setClientId] = useState('')
  const [paying, setPaying] = useState(false)
  const [done, setDone] = useState<any | null>(null)
  const [movement, setMovement] = useState<'entree' | 'sortie' | null>(null)
  const [closing, setClosing] = useState(false)
  const [showCart, setShowCart] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (products ?? []).filter((p) => !q || `${p.name} ${p.ref} ${p.category}`.toLowerCase().includes(q)).slice(0, 120)
  }, [products, search])

  const totals = computeTotals(cart)
  const count = cart.reduce((s, l) => s + l.quantity, 0)

  const add = (p: any) => {
    setCart((c) => {
      const i = c.findIndex((l) => l.product_id === p.id)
      if (i >= 0) return c.map((l, j) => (j === i ? { ...l, quantity: l.quantity + 1 } : l))
      return [...c, { key: Date.now() + Math.random(), product_id: p.id, description: p.name, quantity: 1, unit_price: p.sale_price, discount: 0, tva_rate: p.tva_rate ?? company.default_tva, ref: p.ref, stock: p.stock_qty, kind: p.kind }]
    })
  }
  const setQty = (key: number, q: number) => setCart((c) => (q <= 0 ? c.filter((l) => l.key !== key) : c.map((l) => (l.key === key ? { ...l, quantity: q } : l))))
  // Lecteur de codes-barres : il saisit la référence puis « Entrée ».
  const onScan = () => {
    const q = search.trim().toLowerCase()
    const exact = (products ?? []).find((p) => p.ref.toLowerCase() === q)
    const target = exact ?? (filtered.length === 1 ? filtered[0] : null)
    if (target) {
      add(target)
      setSearch('')
    }
  }
  const s = summary

  return (
    <div className="page pos-page">
      <PageHeader
        title="Point de vente"
        subtitle={<>Caisse de {s.session.user_name} ouverte le {dateTime(s.session.opened_at)} · Espèces attendues : <strong>{formatMoney(s.expected)}</strong></>}
        actions={<>
          <button className="btn" onClick={() => setMovement('entree')}>Entrée d'espèces</button>
          <button className="btn" onClick={() => setMovement('sortie')}>Sortie / dépense</button>
          <button className="btn btn-danger" onClick={() => setClosing(true)}>Clôturer la caisse</button>
        </>}
      />
      <div className="chips">
        <span className="chip">Fonds : <strong>{formatMoney(s.session.opening_amount)}</strong></span>
        <span className="chip">Ventes : <strong>{formatMoney(s.salesTotal)}</strong> ({s.sales.length})</span>
        {s.byMethod.filter((m: any) => m.direction === 'in').map((m: any) => <span key={m.method} className="chip">{m.method} : <strong>{formatMoney(m.total)}</strong></span>)}
        {s.sorties > 0 && <span className="chip">Sorties : <strong>{formatMoney(s.sorties)}</strong></span>}
      </div>

      <div className={`pos ${showCart ? 'show-cart' : ''}`}>
        <section className="pos-catalog">
          <form onSubmit={(e) => { e.preventDefault(); onScan() }}>
            <SearchInput value={search} onChange={setSearch} placeholder="Rechercher ou scanner une référence…" />
          </form>
          {!products ? <Loading /> : filtered.length === 0 ? <Empty>Aucun article. Créez vos articles dans « Articles & prestations ».</Empty> : (
            <div className="pos-grid">
              {filtered.map((p) => (
                <button key={p.id} className="pos-tile" onClick={() => add(p)}>
                  <span className="pos-tile-name">{p.name}</span>
                  <span className="pos-tile-price">{formatMoney(Math.round(p.sale_price * (1 + p.tva_rate / 100)), company.currency)}</span>
                  <span className="pos-tile-meta">{p.ref}{p.kind === 'produit' ? ` · stock ${formatQty(p.stock_qty)}` : ''}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="pos-cart card">
          <div className="row gap">
            <h3 className="grow" style={{ margin: 0 }}>Panier</h3>
            {cart.length > 0 && <button className="link-btn danger small" onClick={() => setCart([])}>Vider</button>}
          </div>
          <Field label="Client">
            <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Client comptoir (paiement comptant)</option>
              {(options?.clients ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          {cart.length === 0 ? <p className="muted">Touchez un article pour l'ajouter.</p> : (
            <div className="cart-lines">
              {cart.map((l) => (
                <div key={l.key} className="cart-line">
                  <div className="grow">
                    <div className="strong">{l.description}</div>
                    <div className="muted small">{formatNumber(l.unit_price)} HT · TVA {formatNumber(l.tva_rate)} %{l.kind === 'produit' && l.stock !== undefined && l.quantity > l.stock ? <span className="text-warn"> · stock {formatQty(l.stock)}</span> : null}</div>
                  </div>
                  <div className="qty">
                    <button className="btn btn-sm" onClick={() => setQty(l.key, l.quantity - 1)} aria-label="Moins">−</button>
                    <input className="num-input" inputMode="decimal" value={l.quantity} onChange={(e) => setQty(l.key, parseFloat(e.target.value.replace(',', '.')) || 0)} />
                    <button className="btn btn-sm" onClick={() => setQty(l.key, l.quantity + 1)} aria-label="Plus">+</button>
                  </div>
                  <div className="num strong">{formatNumber(lineHT(l))}</div>
                </div>
              ))}
            </div>
          )}
          <table className="totals full">
            <tbody>
              <tr><td>Total HT</td><td><Money value={totals.ht} /></td></tr>
              <tr><td>TVA</td><td><Money value={totals.tva} /></td></tr>
              <tr className="grand"><td>À payer</td><td><Money value={totals.ttc} /></td></tr>
            </tbody>
          </table>
          <button className="btn btn-primary btn-block btn-lg" disabled={cart.length === 0} onClick={() => setPaying(true)}>Encaisser {formatMoney(totals.ttc)}</button>
        </section>
      </div>

      <button className="pos-cart-toggle btn btn-primary" onClick={() => setShowCart(!showCart)}>
        {showCart ? '← Articles' : `Panier (${formatQty(count)}) · ${formatMoney(totals.ttc)}`}
      </button>

      {paying && (
        <CheckoutModal
          total={totals.ttc}
          credit={!!clientId}
          onClose={() => setPaying(false)}
          onPay={async (payments) => {
            const r = await run(() => api('cash.sale', { party_id: clientId ? Number(clientId) : null, lines: cart, payments }))
            if (r) {
              const cash = payments.find((p) => p.method === 'Espèces')
              setDone({ ...r, change: cash?.received ? cash.received - cash.amount : 0 })
              setPaying(false)
              setCart([])
              setClientId('')
              setShowCart(false)
              reload()
            }
          }}
        />
      )}
      {done && (
        <Modal title="Vente enregistrée" onClose={() => setDone(null)} footer={<>
          {!done.queued && <button className="btn" onClick={() => run(() => unwrap(window.erp.pdf(done.id, 'print', 'ticket')))}>Imprimer le ticket</button>}
          {canSales && !done.queued && <button className="btn" onClick={() => run(() => unwrap(window.erp.pdf(done.id, 'open', 'a4')))}>Facture A4</button>}
          <button className="btn btn-primary" autoFocus onClick={() => setDone(null)}>Nouvelle vente</button>
        </>}>
          {done.queued
            ? <p className="confirm-msg">Vente enregistrée <strong>hors connexion</strong>. Elle sera envoyée et numérotée dès le retour du réseau.</p>
            : <p className="confirm-msg">Facture <strong>{done.number}</strong> — {formatMoney(done.total_ttc)}</p>}
          {done.change > 0 && <div className="change-box">Monnaie à rendre : <strong>{formatMoney(done.change)}</strong></div>}
          {!done.queued && done.paid < done.total_ttc && <p className="text-warn">Reste dû par le client : {formatMoney(done.total_ttc - done.paid)}</p>}
        </Modal>
      )}
      {movement && <MovementModal kind={movement} accounts={options?.accounts ?? []} onClose={() => setMovement(null)} onDone={() => { setMovement(null); reload() }} />}
      {closing && <CloseModal summary={s} onClose={() => setClosing(false)} onDone={() => { setClosing(false); reload() }} />}
    </div>
  )
}

type Pay = { method: string; amount: number; received?: number }

function CheckoutModal({ total, credit, onClose, onPay }: { total: number; credit: boolean; onClose: () => void; onPay: (p: Pay[]) => Promise<void> }) {
  const [rows, setRows] = useState([{ method: 'Espèces', amount: String(total), received: '' }])
  const [busy, setBusy] = useState(false)
  const amounts = rows.map((r) => parseAmount(r.amount))
  const paid = amounts.reduce((s, a) => s + a, 0)
  const rest = total - paid
  const set = (i: number, k: 'method' | 'amount' | 'received', v: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
  const submit = async () => {
    setBusy(true)
    await onPay(rows.map((r, i) => ({ method: r.method, amount: amounts[i], received: r.method === 'Espèces' ? parseAmount(r.received) || amounts[i] : undefined })).filter((p) => p.amount > 0))
    setBusy(false)
  }
  const cashRow = rows.find((r) => r.method === 'Espèces')
  const change = cashRow && parseAmount(cashRow.received) > parseAmount(cashRow.amount) ? parseAmount(cashRow.received) - parseAmount(cashRow.amount) : 0
  return (
    <Modal title={`Encaisser ${formatMoney(total)}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Annuler</button>
      <button className="btn btn-primary" disabled={busy || rest < 0 || (!credit && rest !== 0)} onClick={submit}>Valider la vente</button>
    </>}>
      <div className="method-pick">
        {PAYMENT_METHODS.filter((m) => m !== 'Autre').map((m) => (
          <button key={m} className={`btn ${rows.length === 1 && rows[0].method === m ? 'btn-primary' : ''}`} onClick={() => setRows([{ method: m, amount: String(total), received: '' }])}>{m}</button>
        ))}
      </div>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-3 pay-row">
          <Field label="Mode">
            <select value={r.method} onChange={(e) => set(i, 'method', e.target.value)}>{PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}</select>
          </Field>
          <Field label="Montant"><input inputMode="numeric" value={r.amount} onFocus={(e) => e.target.select()} onChange={(e) => set(i, 'amount', e.target.value)} /></Field>
          {r.method === 'Espèces' ? (
            <Field label="Reçu du client"><input inputMode="numeric" value={r.received} placeholder={r.amount} onChange={(e) => set(i, 'received', e.target.value)} /></Field>
          ) : rows.length > 1 ? (
            <div className="field"><span className="field-label">&nbsp;</span><button className="btn" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Retirer</button></div>
          ) : <div />}
        </div>
      ))}
      <button className="link-btn" onClick={() => setRows([...rows, { method: 'Orange Money', amount: String(Math.max(rest, 0)), received: '' }])}>+ Ajouter un autre moyen de paiement</button>
      {change > 0 && <div className="change-box">Monnaie à rendre : <strong>{formatMoney(change)}</strong></div>}
      {rest > 0 && <p className={credit ? 'text-warn' : 'text-danger'}>{credit ? `Reste ${formatMoney(rest)} à crédit sur le compte du client.` : `Il manque ${formatMoney(rest)}. Le client comptoir doit tout régler.`}</p>}
      {rest < 0 && <p className="text-danger">Les montants dépassent le total de {formatMoney(-rest)}.</p>}
    </Modal>
  )
}

function MovementModal({ kind, accounts, onClose, onDone }: { kind: 'entree' | 'sortie'; accounts: any[]; onClose: () => void; onDone: () => void }) {
  const f = useForm({ amount: '', account: kind === 'sortie' ? '618' : '585', label: '' })
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    const r = await run(() => api('cash.movement', { kind, ...f.values, amount: parseAmount(f.values.amount) }), kind === 'entree' ? 'Entrée enregistrée.' : 'Sortie enregistrée.')
    setBusy(false)
    if (r) onDone()
  }
  const choices = kind === 'sortie' ? accounts.filter((a) => /^(6|4|5|1)/.test(a.number)) : accounts
  return (
    <Modal title={kind === 'entree' ? "Entrée d'espèces" : 'Sortie / dépense de caisse'} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Annuler</button>
      <button className="btn btn-primary" disabled={busy} onClick={submit}>Enregistrer</button>
    </>}>
      <div className="grid grid-2">
        <Field label="Montant"><input autoFocus inputMode="numeric" {...f.bind('amount')} /></Field>
        <Field label={kind === 'sortie' ? 'Nature de la dépense' : 'Provenance'}>
          <select {...f.bind('account')}>{choices.map((a) => <option key={a.number} value={a.number}>{a.number} — {a.label}</option>)}</select>
        </Field>
        <Field label="Motif" span={2}><input {...f.bind('label')} placeholder={kind === 'sortie' ? 'Carburant livraison, achat fournitures…' : 'Retrait banque, apport…'} /></Field>
      </div>
      <p className="muted small">L'écriture comptable est passée automatiquement dans le journal de caisse.</p>
    </Modal>
  )
}

function CloseModal({ summary, onClose, onDone }: { summary: any; onClose: () => void; onDone: () => void }) {
  const [counted, setCounted] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const expected = Math.round(summary.expected)
  const diff = counted === '' ? 0 : parseAmount(counted) - expected
  const submit = async () => {
    setBusy(true)
    const r = await run(() => api('cash.close', { counted_amount: parseAmount(counted), note }), 'Caisse clôturée.')
    setBusy(false)
    if (r) onDone()
  }
  return (
    <Modal title="Clôturer la caisse" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Annuler</button>
      <button className="btn btn-danger" disabled={busy || counted === ''} onClick={submit}>Clôturer</button>
    </>}>
      <table className="totals full">
        <tbody>
          <tr><td>Fonds de caisse</td><td><Money value={summary.session.opening_amount} /></td></tr>
          <tr><td>+ Ventes en espèces</td><td><Money value={summary.cashIn} /></td></tr>
          {summary.cashOut > 0 && <tr><td>− Règlements en espèces</td><td><Money value={-summary.cashOut} /></td></tr>}
          <tr><td>+ Entrées</td><td><Money value={summary.entrees} /></td></tr>
          <tr><td>− Sorties</td><td><Money value={-summary.sorties} /></td></tr>
          <tr className="grand"><td>Espèces attendues</td><td><Money value={expected} /></td></tr>
        </tbody>
      </table>
      <Field label="Espèces comptées dans le tiroir"><input autoFocus inputMode="numeric" value={counted} onChange={(e) => setCounted(e.target.value)} /></Field>
      {counted !== '' && (diff === 0 ? <p className="text-ok">Caisse juste.</p> : <p className="text-danger">Écart : {formatMoney(diff)} {diff < 0 ? '(manquant)' : '(excédent)'}</p>)}
      {diff !== 0 && <Field label="Explication de l'écart (obligatoire)"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>}
    </Modal>
  )
}

export function CashSessions() {
  const nav = useNavigate()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const { data, error, loading, reload } = useQuery<any[]>('cash.history', { from, to })
  const rows = data ?? []
  return (
    <div className="page">
      <PageHeader title="Sessions de caisse" actions={<Link className="btn btn-primary" to="/caisse">Point de vente</Link>} />
      <KpiStrip items={[
        { label: 'Sessions', value: rows.length, icon: CashRegisterIcon },
        { label: 'Ventes encaissées', value: rows.reduce((s, r) => s + r.sales_total, 0), icon: Coins, money: true, tone: 'good' },
        { label: 'Caisses ouvertes', value: rows.filter((r) => r.status === 'ouverte').length, icon: LockOpen },
        { label: 'Écarts de caisse', value: rows.filter((r) => r.status === 'fermee' && Math.abs((r.counted_amount ?? 0) - (r.expected_amount ?? 0)) > 0.5).length, icon: Warning, tone: 'bad' }
      ]} />
      <div className="toolbar">
        <label className="inline">Du <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="inline">au <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Loading /> : rows.length === 0 ? <Empty>Aucune session de caisse.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>N°</th><th>Caissier</th><th>Ouverture</th><th>Clôture</th><th className="num">Ventes</th><th className="num">Attendu</th><th className="num">Compté</th><th className="num">Écart</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const diff = r.counted_amount != null ? r.counted_amount - r.expected_amount : null
                return (
                  <tr key={r.id} className="clickable" onClick={() => nav(`/caisse/session/${r.id}`)}>
                    <td>{r.id}</td>
                    <td className="strong">{r.user_name}</td>
                    <td>{dateTime(r.opened_at)}</td>
                    <td>{r.status === 'ouverte' ? <span className="badge badge-valide">Ouverte</span> : dateTime(r.closed_at)}</td>
                    <td className="num"><Money value={r.sales_total} /></td>
                    <td className="num">{r.expected_amount != null && <Money value={r.expected_amount} />}</td>
                    <td className="num">{r.counted_amount != null && <Money value={r.counted_amount} />}</td>
                    <td className={`num ${diff ? 'text-danger' : ''}`}>{diff != null && formatMoney(diff)}</td>
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

export function CashSessionDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const canSales = useCan('sales')
  const { data: s, error, loading, reload } = useQuery<any>('cash.detail', { id: Number(id) })
  if (error) return <div className="page"><ErrorBox error={error} onRetry={reload} /></div>
  if (loading && !s) return <Loading />
  return (
    <div className="page">
      <PageHeader
        title={`Caisse n° ${s.session.id} — ${s.session.user_name}`}
        subtitle={`Ouverte le ${dateTime(s.session.opened_at)}${s.session.closed_at ? ` · clôturée le ${dateTime(s.session.closed_at)}` : ' · en cours'}`}
        actions={<Link className="btn" to="/caisse/sessions">Toutes les sessions</Link>}
      />
      <div className="kpis">
        <div className="kpi"><div className="kpi-label">Fonds de caisse</div><div className="kpi-value">{formatMoney(s.session.opening_amount)}</div></div>
        <div className="kpi"><div className="kpi-label">Ventes encaissées</div><div className="kpi-value">{formatMoney(s.salesTotal)}</div></div>
        <div className="kpi"><div className="kpi-label">Espèces attendues</div><div className="kpi-value">{formatMoney(s.session.expected_amount ?? s.expected)}</div></div>
        {s.session.counted_amount != null && (
          <div className={`kpi ${s.session.counted_amount !== s.session.expected_amount ? 'kpi-warn' : ''}`}>
            <div className="kpi-label">Compté</div><div className="kpi-value">{formatMoney(s.session.counted_amount)}</div>
            {s.session.note && <div className="kpi-sub">{s.session.note}</div>}
          </div>
        )}
      </div>
      <div className="dash-grid two">
        <div className="card">
          <h3>Par moyen de paiement</h3>
          {s.byMethod.length === 0 ? <Empty>Aucun règlement.</Empty> : (
            <table className="table compact"><tbody>
              {s.byMethod.map((m: any) => <tr key={m.method + m.direction}><td>{m.method}{m.direction === 'out' ? ' (sortie)' : ''}</td><td className="num">{m.n}</td><td className="num"><Money value={m.direction === 'out' ? -m.total : m.total} /></td></tr>)}
            </tbody></table>
          )}
        </div>
        <div className="card">
          <h3>Entrées et sorties</h3>
          {s.movements.length === 0 ? <Empty>Aucun mouvement.</Empty> : (
            <table className="table compact"><tbody>
              {s.movements.map((m: any) => <tr key={m.id}><td>{m.label}<div className="muted small">{m.account} — {m.account_label}</div></td><td className="num"><Money value={m.kind === 'sortie' ? -m.amount : m.amount} /></td></tr>)}
            </tbody></table>
          )}
        </div>
      </div>
      <h3 className="section-title">Ventes</h3>
      {s.sales.length === 0 ? <Empty>Aucune vente.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Facture</th><th>Heure</th><th>Client</th><th>Paiement</th><th className="num">Montant</th><th></th></tr></thead>
            <tbody>
              {s.sales.map((v: any) => (
                <tr key={v.id}>
                  <td className="strong">{canSales ? <button className="link-btn" onClick={() => nav(`/doc/${v.id}`)}>{v.number}</button> : v.number}</td>
                  <td>{dateTime(v.validated_at)}</td>
                  <td>{v.party_name}</td>
                  <td>{v.methods}</td>
                  <td className="num"><Money value={v.total_ttc} /></td>
                  <td className="num"><button className="btn btn-sm" onClick={() => run(() => unwrap(window.erp.pdf(v.id, 'print', 'ticket')))}>Ticket</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
