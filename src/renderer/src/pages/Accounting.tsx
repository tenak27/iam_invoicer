import { useState } from 'react'
import { JOURNALS } from '@shared/domain'
import { formatDate, formatMoney, formatNumber, todayISO } from '@shared/format'
import { api, exportCsv, run, useQuery } from '../api'
import { confirmDialog, Empty, ErrorBox, Field, Loading, Modal, PageHeader, RowActions, SearchInput, Tabs, useForm } from '../components/ui'
import { PencilSimple, Trash } from '@phosphor-icons/react'

const amount = (n: number) => (n ? formatNumber(n, n % 1 ? 2 : 0) : '')
const firstOfYear = () => `${todayISO().slice(0, 4)}-01-01`

function Period({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  return (
    <>
      <label className="inline">Du <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
      <label className="inline">au <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
    </>
  )
}

/** Écritures rattachées aux données antérieures au module comptable. */
function MissingBanner({ onDone }: { onDone: () => void }) {
  const { data, reload } = useQuery<any>('accounting.missing')
  if (!data || data.documents + data.payments === 0) return null
  const generate = async () => {
    const r = await run(() => api('accounting.generateMissing'), 'Écritures générées.')
    if (r) {
      reload()
      onDone()
    }
  }
  return (
    <div className="info-box">
      <span>{data.documents} pièce(s) et {data.payments} règlement(s) validés avant l'activation de la comptabilité n'ont pas encore d'écriture.</span>
      <button className="btn btn-sm btn-primary" onClick={generate}>Générer les écritures</button>
    </div>
  )
}

export function Entries() {
  const [journal, setJournal] = useState('')
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState(firstOfYear())
  const [to, setTo] = useState('')
  const [editing, setEditing] = useState(false)
  const { data, error, loading, reload } = useQuery<any[]>('accounting.entries', { journal, search, from, to })
  const rows = data ?? []
  const totals = rows.reduce((t, e) => {
    for (const l of e.lines) {
      t.d += l.debit
      t.c += l.credit
    }
    return t
  }, { d: 0, c: 0 })
  const remove = async (e: any) => {
    if (!(await confirmDialog(`Supprimer l'écriture ${e.number} ?`, { danger: true }))) return
    if (await run(() => api('accounting.deleteEntry', { id: e.id }), 'Écriture supprimée.')) reload()
  }
  return (
    <div className="page">
      <PageHeader
        title="Journaux & écritures"
        subtitle="SYSCOHADA révisé — les ventes, achats, règlements et mouvements de caisse sont comptabilisés automatiquement."
        actions={<>
          <button className="btn" disabled={!rows.length} onClick={() => exportCsv('Ecritures.csv', [
            { label: 'Journal', value: (r) => r.journal }, { label: 'N° pièce', value: (r) => r.number }, { label: 'Date', value: (r) => formatDate(r.date) },
            { label: 'Compte', value: (r) => r.account }, { label: 'Intitulé', value: (r) => r.account_label }, { label: 'Tiers', value: (r) => r.party_name },
            { label: 'Libellé', value: (r) => r.label }, { label: 'Débit', value: (r) => r.debit }, { label: 'Crédit', value: (r) => r.credit }
          ], rows.flatMap((e) => e.lines.map((l: any) => ({ ...l, journal: e.journal, number: e.number, date: e.date }))))}>Exporter (Excel)</button>
          <button className="btn btn-primary" onClick={() => setEditing(true)}>Opération diverse</button>
        </>}
      />
      <MissingBanner onDone={reload} />
      <div className="toolbar">
        <Tabs value={journal} onChange={setJournal} tabs={[{ value: '', label: 'Tous' }, ...Object.entries(JOURNALS).map(([value, label]) => ({ value, label }))]} />
        <SearchInput value={search} onChange={setSearch} placeholder="Libellé, n° de pièce…" />
        <Period from={from} to={to} setFrom={setFrom} setTo={setTo} />
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Loading /> : rows.length === 0 ? <Empty>Aucune écriture sur la période.</Empty> : (
        <div className="table-wrap">
          <table className="table compact">
            <thead><tr><th>Date</th><th>Pièce</th><th>Compte</th><th>Libellé</th><th className="num">Débit</th><th className="num">Crédit</th></tr></thead>
            {rows.map((e) => (
              <tbody key={e.id} className="entry">
                <tr className="entry-head">
                  <td>{formatDate(e.date)}</td>
                  <td><span className="badge badge-valide">{e.journal}</span> {e.number}</td>
                  <td colSpan={3} className="strong">{e.label}</td>
                  <td className="actions-col"><RowActions actions={[{ label: "Supprimer l'écriture", icon: Trash, tone: 'danger', hidden: !!e.source, onClick: () => remove(e) }]} /></td>
                </tr>
                {e.lines.map((l: any) => (
                  <tr key={l.id}>
                    <td></td><td></td>
                    <td className={l.credit ? 'indent' : ''}>{l.account} <span className="muted">{l.account_label}</span></td>
                    <td className="muted">{l.party_name ?? (l.label !== e.label ? l.label : '')}</td>
                    <td className="num money">{amount(l.debit)}</td>
                    <td className="num money">{amount(l.credit)}</td>
                  </tr>
                ))}
              </tbody>
            ))}
            <tfoot><tr><td colSpan={4}>Total ({rows.length} écritures{rows.length >= 500 ? ', 500 plus récentes' : ''})</td><td className="num">{formatNumber(totals.d)}</td><td className="num">{formatNumber(totals.c)}</td></tr></tfoot>
          </table>
        </div>
      )}
      {editing && <EntryModal onClose={() => setEditing(false)} onDone={() => { setEditing(false); reload() }} />}
    </div>
  )
}

function EntryModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { data: accounts } = useQuery<any[]>('accounting.accounts')
  const f = useForm({ journal: 'OD', date: todayISO(), label: '' })
  const [lines, setLines] = useState([{ account: '', debit: '', credit: '' }, { account: '', debit: '', credit: '' }])
  const [busy, setBusy] = useState(false)
  const n = (s: string) => parseFloat(String(s).replace(/\s/g, '').replace(',', '.')) || 0
  const d = lines.reduce((s, l) => s + n(l.debit), 0)
  const c = lines.reduce((s, l) => s + n(l.credit), 0)
  const set = (i: number, k: 'account' | 'debit' | 'credit', v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)))
  const submit = async () => {
    setBusy(true)
    const r = await run(() => api('accounting.saveEntry', { ...f.values, lines: lines.map((l) => ({ account: l.account, debit: n(l.debit), credit: n(l.credit) })) }), 'Écriture enregistrée.')
    setBusy(false)
    if (r) onDone()
  }
  return (
    <Modal title="Nouvelle écriture" wide onClose={onClose} footer={<>
      <span className={`grow ${Math.abs(d - c) > 0.001 ? 'text-danger' : 'text-ok'}`}>Débit {formatNumber(d)} · Crédit {formatNumber(c)}{Math.abs(d - c) > 0.001 ? ` · écart ${formatNumber(d - c)}` : ' · équilibrée'}</span>
      <button className="btn" onClick={onClose}>Annuler</button>
      <button className="btn btn-primary" disabled={busy || d === 0 || Math.abs(d - c) > 0.001} onClick={submit}>Enregistrer</button>
    </>}>
      <div className="grid grid-4">
        <Field label="Journal"><select {...f.bind('journal')}>{Object.entries(JOURNALS).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}</select></Field>
        <Field label="Date"><input type="date" {...f.bind('date')} /></Field>
        <Field label="Libellé" span={2}><input autoFocus {...f.bind('label')} placeholder="Salaires de septembre, apport en capital…" /></Field>
      </div>
      <datalist id="accounts-list">{(accounts ?? []).filter((a) => a.active).map((a) => <option key={a.number} value={a.number}>{a.label}</option>)}</datalist>
      <div className="table-wrap">
        <table className="table compact">
          <thead><tr><th>Compte</th><th>Intitulé</th><th className="num">Débit</th><th className="num">Crédit</th><th></th></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td style={{ width: 130 }}><input list="accounts-list" value={l.account} onChange={(e) => set(i, 'account', e.target.value)} /></td>
                <td className="muted">{accounts?.find((a) => a.number === l.account)?.label}</td>
                <td style={{ width: 140 }}><input className="num-input" inputMode="decimal" value={l.debit} onChange={(e) => set(i, 'debit', e.target.value)} /></td>
                <td style={{ width: 140 }}><input className="num-input" inputMode="decimal" value={l.credit} onChange={(e) => set(i, 'credit', e.target.value)} /></td>
                <td>{lines.length > 2 && <button className="icon-btn" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Retirer">×</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="link-btn" onClick={() => setLines([...lines, { account: '', debit: d > c ? String(d - c) : '', credit: c > d ? String(c - d) : '' }])}>+ Ajouter une ligne</button>
    </Modal>
  )
}

export function Ledger() {
  const { data: accounts } = useQuery<any[]>('accounting.accounts')
  const [account, setAccount] = useState('411')
  const [from, setFrom] = useState(firstOfYear())
  const [to, setTo] = useState('')
  const { data, error, loading, reload } = useQuery<any>('accounting.ledger', { account, from, to })
  return (
    <div className="page">
      <PageHeader title="Grand livre" subtitle="Un compte précis (411) ou une racine (6, 60, 52…) pour regrouper plusieurs comptes."
        actions={<button className="btn" disabled={!data?.lines.length} onClick={() => exportCsv(`Grand-livre-${account}.csv`, [
          { label: 'Date', value: (r) => formatDate(r.date) }, { label: 'Pièce', value: (r) => r.number }, { label: 'Compte', value: (r) => r.account },
          { label: 'Libellé', value: (r) => r.label }, { label: 'Tiers', value: (r) => r.party_name }, { label: 'Débit', value: (r) => r.debit },
          { label: 'Crédit', value: (r) => r.credit }, { label: 'Solde', value: (r) => r.balance }
        ], data.lines)}>Exporter (Excel)</button>}
      />
      <div className="toolbar">
        <label className="inline">Compte
          <input list="ledger-accounts" value={account} onChange={(e) => setAccount(e.target.value.trim())} style={{ width: 120 }} />
        </label>
        <datalist id="ledger-accounts">{(accounts ?? []).map((a) => <option key={a.number} value={a.number}>{a.label}</option>)}</datalist>
        <span className="muted">{accounts?.find((a) => a.number === account)?.label}</span>
        <Period from={from} to={to} setFrom={setFrom} setTo={setTo} />
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Loading /> : (
        <div className="table-wrap">
          <table className="table compact">
            <thead><tr><th>Date</th><th>Pièce</th><th>Compte</th><th>Libellé</th><th className="num">Débit</th><th className="num">Crédit</th><th className="num">Solde</th></tr></thead>
            <tbody>
              {from && <tr className="muted"><td>{formatDate(from)}</td><td colSpan={5}>Report à nouveau</td><td className="num money">{formatNumber(data.opening)}</td></tr>}
              {data.lines.map((l: any) => (
                <tr key={l.id}>
                  <td>{formatDate(l.date)}</td>
                  <td>{l.number}</td>
                  <td>{l.account}</td>
                  <td>{l.label}{l.party_name && <span className="muted"> · {l.party_name}</span>}</td>
                  <td className="num money">{amount(l.debit)}</td>
                  <td className="num money">{amount(l.credit)}</td>
                  <td className={`num money ${l.balance < 0 ? 'neg' : ''}`}>{formatNumber(l.balance)}</td>
                </tr>
              ))}
              {data.lines.length === 0 && <tr><td colSpan={7} className="muted">Aucun mouvement sur la période.</td></tr>}
            </tbody>
            <tfoot><tr><td colSpan={6}>Solde final ({data.closing >= 0 ? 'débiteur' : 'créditeur'})</td><td className="num">{formatNumber(Math.abs(data.closing))}</td></tr></tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

export function Balance() {
  const [from, setFrom] = useState(firstOfYear())
  const [to, setTo] = useState('')
  const { data, error, loading, reload } = useQuery<any[]>('accounting.balance', { from, to })
  const rows = data ?? []
  const sum = (k: string) => rows.reduce((s, r) => s + r[k], 0)
  const sd = rows.reduce((s, r) => s + Math.max(r.balance, 0), 0)
  const sc = rows.reduce((s, r) => s + Math.max(-r.balance, 0), 0)
  return (
    <div className="page">
      <PageHeader title="Balance générale" subtitle="Mouvements de la période et soldes cumulés à la date de fin."
        actions={<button className="btn" disabled={!rows.length} onClick={() => exportCsv('Balance.csv', [
          { label: 'Compte', value: (r) => r.number }, { label: 'Intitulé', value: (r) => r.label }, { label: 'Débit période', value: (r) => r.debit },
          { label: 'Crédit période', value: (r) => r.credit }, { label: 'Solde débiteur', value: (r) => Math.max(r.balance, 0) }, { label: 'Solde créditeur', value: (r) => Math.max(-r.balance, 0) }
        ], rows)}>Exporter (Excel)</button>}
      />
      <div className="toolbar"><Period from={from} to={to} setFrom={setFrom} setTo={setTo} /></div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Loading /> : rows.length === 0 ? <Empty>Aucune écriture.</Empty> : (
        <div className="table-wrap">
          <table className="table compact">
            <thead><tr><th>Compte</th><th>Intitulé</th><th className="num">Débit</th><th className="num">Crédit</th><th className="num">Solde débiteur</th><th className="num">Solde créditeur</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.number}>
                  <td className="strong">{r.number}</td><td>{r.label}</td>
                  <td className="num money">{amount(r.debit)}</td><td className="num money">{amount(r.credit)}</td>
                  <td className="num money">{r.balance > 0 ? formatNumber(r.balance) : ''}</td>
                  <td className="num money">{r.balance < 0 ? formatNumber(-r.balance) : ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={2}>Totaux</td><td className="num">{formatNumber(sum('debit'))}</td><td className="num">{formatNumber(sum('credit'))}</td><td className="num">{formatNumber(sd)}</td><td className="num">{formatNumber(sc)}</td></tr></tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

export function IncomeStatement() {
  const [from, setFrom] = useState(firstOfYear())
  const [to, setTo] = useState('')
  const { data, error, loading, reload } = useQuery<any>('accounting.income', { from, to })
  const block = (title: string, rows: any[], total: number) => (
    <div className="card">
      <h3>{title}</h3>
      {rows.length === 0 ? <p className="muted">Aucun montant.</p> : (
        <table className="table compact"><tbody>
          {rows.map((r) => <tr key={r.number}><td>{r.number}</td><td>{r.label}</td><td className="num money">{formatNumber(r.amount)}</td></tr>)}
        </tbody><tfoot><tr><td colSpan={2}>Total</td><td className="num">{formatNumber(total)}</td></tr></tfoot></table>
      )}
    </div>
  )
  return (
    <div className="page">
      <PageHeader title="Compte de résultat" subtitle="Produits (classe 7) moins charges (classe 6). Estimation de gestion : les écritures d'inventaire et d'amortissement sont à passer en opérations diverses." />
      <div className="toolbar"><Period from={from} to={to} setFrom={setFrom} setTo={setTo} /></div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Loading /> : (
        <>
          <div className="kpis">
            <div className="kpi"><div className="kpi-label">Produits</div><div className="kpi-value">{formatMoney(data.totalProduits)}</div></div>
            <div className="kpi"><div className="kpi-label">Charges</div><div className="kpi-value">{formatMoney(data.totalCharges)}</div></div>
            <div className={`kpi ${data.result < 0 ? 'kpi-warn' : ''}`}><div className="kpi-label">{data.result >= 0 ? 'Bénéfice' : 'Perte'}</div><div className="kpi-value">{formatMoney(data.result)}</div></div>
          </div>
          <div className="dash-grid two">
            {block('Produits', data.produits, data.totalProduits)}
            {block('Charges', data.charges, data.totalCharges)}
          </div>
        </>
      )}
    </div>
  )
}

export function Accounts() {
  const { data, error, loading, reload } = useQuery<any[]>('accounting.accounts')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<any | null>(null)
  const rows = (data ?? []).filter((a) => !search || `${a.number} ${a.label}`.toLowerCase().includes(search.toLowerCase()))
  return (
    <div className="page">
      <PageHeader title="Plan comptable" subtitle="Comptes SYSCOHADA révisé. Ajoutez des sous-comptes selon vos besoins (ex. 5211 pour une deuxième banque)."
        actions={<button className="btn btn-primary" onClick={() => setEditing({ isNew: true, number: '', label: '' })}>Nouveau compte</button>} />
      <div className="toolbar"><SearchInput value={search} onChange={setSearch} placeholder="Numéro ou intitulé…" /></div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Loading /> : (
        <div className="table-wrap">
          <table className="table compact">
            <thead><tr><th>Compte</th><th>Intitulé</th><th className="num">Débit</th><th className="num">Crédit</th><th className="num">Solde</th><th className="actions-col">Actions</th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.number} className={`clickable ${a.active ? '' : 'inactive'}`} onClick={() => setEditing(a)}>
                  <td className="strong">{a.number}</td><td>{a.label}</td>
                  <td className="num money">{amount(a.debit)}</td><td className="num money">{amount(a.credit)}</td>
                  <td className="num money">{a.debit || a.credit ? formatNumber(a.debit - a.credit) : ''}</td>
                  <td className="actions-col"><RowActions actions={[{ label: 'Modifier le compte', icon: PencilSimple, tone: 'primary', onClick: () => setEditing(a) }]} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <AccountModal account={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload() }} />}
    </div>
  )
}

function AccountModal({ account, onClose, onDone }: { account: any; onClose: () => void; onDone: () => void }) {
  const f = useForm({ number: account.number, label: account.label, active: account.active ?? true })
  const save = async () => {
    if (await run(() => api('accounting.saveAccount', { ...f.values, isNew: account.isNew }), 'Compte enregistré.')) onDone()
  }
  return (
    <Modal title={account.isNew ? 'Nouveau compte' : `Compte ${account.number}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Annuler</button>
      <button className="btn btn-primary" onClick={save}>Enregistrer</button>
    </>}>
      <div className="grid grid-3">
        <Field label="Numéro"><input autoFocus={account.isNew} disabled={!account.isNew} inputMode="numeric" {...f.bind('number')} /></Field>
        <Field label="Intitulé" span={2}><input autoFocus={!account.isNew} {...f.bind('label')} /></Field>
      </div>
      {!account.isNew && (
        <label className="inline check"><input type="checkbox" checked={!!f.values.active} onChange={(e) => f.set('active', e.target.checked)} /> Compte utilisable</label>
      )}
    </Modal>
  )
}
