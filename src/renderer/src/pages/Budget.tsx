import { useState } from 'react'
import { ArrowDown, ArrowUp, Copy, Plus, Trash, Warning } from '@phosphor-icons/react'
import { formatDate, formatMoney, todayISO } from '@shared/format'
import { api, run, useQuery } from '../api'
import { compact, Progress } from '../components/charts'
import { confirmDialog, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Tabs, useForm } from '../components/ui'

const M = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc']

export function BudgetPage() {
  const [tab, setTab] = useState<'tresorerie' | 'budget'>('tresorerie')
  return (
    <div className="page">
      <PageHeader title="Budgets et trésorerie" subtitle="Projection de trésorerie à 13 semaines et suivi budgétaire prévu / réalisé." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'tresorerie', label: 'Trésorerie prévisionnelle' }, { value: 'budget', label: 'Budget' }]} />
      <div className="tab-panel" key={tab}>{tab === 'tresorerie' ? <Treasury /> : <Budgets />}</div>
    </div>
  )
}

function Treasury() {
  const [weeks, setWeeks] = useState(13)
  const { data, error, loading, reload } = useQuery<any>('budget.forecast', { weeks })
  const { data: manual, reload: reloadManual } = useQuery<any[]>('budget.forecasts')
  const [adding, setAdding] = useState(false)
  if (error) return <ErrorBox error={error} onRetry={reload} />
  if (loading && !data) return <Loading />
  const refresh = () => {
    reload()
    reloadManual()
  }
  const max = Math.max(...data.series.map((s: any) => Math.max(s.inflow, s.outflow, Math.abs(s.balance))), 1)
  const W = 1100, H = 300, top = 20, bottom = 30, colW = (W - 20) / data.series.length
  const y = (v: number) => top + (1 - (v + max) / (2 * max)) * (H - top - bottom)
  const zero = y(0)
  const line = data.series.map((s: any, i: number) => `${i ? 'L' : 'M'}${10 + i * colW + colW / 2},${y(s.balance)}`).join(' ')
  const negative = data.lowest.balance < 0
  return (
    <>
      <div className="kpi-row">
        <div className="mini-kpi"><span>Trésorerie aujourd'hui</span><strong>{formatMoney(data.start)}</strong></div>
        <div className="mini-kpi"><span>Dans {weeks} semaines</span><strong>{formatMoney(data.series.at(-1).balance)}</strong></div>
        <div className={`mini-kpi ${negative ? 'bad' : 'good'}`}><span>Point le plus bas</span><strong>{formatMoney(data.lowest.balance)}</strong><span className="muted small">semaine du {formatDate(data.lowest.from)}</span></div>
      </div>
      {negative && <div className="error-box"><span><Warning size={18} aria-hidden="true" /> La trésorerie devient négative la semaine du {formatDate(data.series.find((s: any) => s.balance < 0).from)} : relancez les clients, négociez les échéances fournisseurs ou prévoyez un financement.</span></div>}
      <div className="card">
        <div className="row gap wrap"><h3 className="grow" style={{ margin: 0 }}>Projection hebdomadaire</h3>
          <Tabs value={String(weeks)} onChange={(v) => setWeeks(Number(v))} tabs={[{ value: '8', label: '8 sem.' }, { value: '13', label: '13 sem.' }, { value: '26', label: '26 sem.' }]} /></div>
        <svg viewBox={`0 0 ${W} ${H}`} className="area-chart cash-chart" role="img" aria-label={`Projection de trésorerie : de ${formatMoney(data.start)} à ${formatMoney(data.series.at(-1).balance)}, point bas ${formatMoney(data.lowest.balance)}.`}>
          <line x1={10} x2={W - 10} y1={zero} y2={zero} className="chart-axis" />
          {data.series.map((s: any, i: number) => {
            const x = 10 + i * colW
            return (
              <g key={i}>
                <rect x={x + colW * 0.18} y={y(s.inflow)} width={colW * 0.3} height={Math.max(zero - y(s.inflow), 0)} rx={2} className="bar-in"><title>{`Semaine du ${formatDate(s.from)} : entrées ${formatMoney(s.inflow)}`}</title></rect>
                <rect x={x + colW * 0.52} y={zero} width={colW * 0.3} height={Math.max(y(-s.outflow) - zero, 0)} rx={2} className="bar-out"><title>{`Semaine du ${formatDate(s.from)} : sorties ${formatMoney(s.outflow)}`}</title></rect>
                {(i % Math.ceil(data.series.length / 9) === 0) && <text x={x + colW / 2} y={H - 8} className="chart-label">{formatDate(s.from).slice(0, 5)}</text>}
              </g>
            )
          })}
          <path d={line} className="area-line draw" pathLength={1} />
          {data.series.map((s: any, i: number) => <circle key={i} cx={10 + i * colW + colW / 2} cy={y(s.balance)} r={3.5} className={`bal-dot ${s.balance < 0 ? 'neg' : ''}`}><title>{`Solde fin de semaine : ${formatMoney(s.balance)}`}</title></circle>)}
        </svg>
        <div className="legend inline-legend"><span><i className="lg-in" />Entrées</span><span><i className="lg-out" />Sorties</span><span><i className="lg-bal" />Solde</span></div>
      </div>
      <div className="dash-grid two">
        <div className="card">
          <h3>Mouvements prévus</h3>
          {data.events.length === 0 ? <Empty>Aucun mouvement prévu.</Empty> : (
            <ul className="rows scroll-list">
              {data.events.slice(0, 60).map((e: any, i: number) => (
                <li key={i}>
                  <span className={`tint tint-sm tint-${e.amount > 0 ? 'success' : 'danger'}`} aria-hidden="true">{e.amount > 0 ? <ArrowDown size={18} /> : <ArrowUp size={18} />}</span>
                  <div className="grow"><b>{e.label}</b><span>{formatDate(e.date)} · {{ client: 'Client', fournisseur: 'Fournisseur', prevision: 'Prévision', paie: 'Paie' }[e.kind as string]}</span></div>
                  <strong className={`money ${e.amount > 0 ? 'plus' : 'neg'}`}>{e.amount > 0 ? '+' : ''}{formatMoney(e.amount)}</strong>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card">
          <div className="row gap"><h3 className="grow" style={{ margin: 0 }}>Prévisions saisies</h3><button className="btn btn-sm btn-tonal" onClick={() => setAdding(true)}><Plus size={16} aria-hidden="true" />Ajouter</button></div>
          <p className="muted small">Loyer, emprunt, impôts, apport… Les factures et la paie sont déjà prises en compte automatiquement.</p>
          {(manual ?? []).length === 0 ? <p className="muted">Aucune prévision.</p> : (
            <ul className="rows">
              {manual!.map((f) => (
                <li key={f.id}>
                  <div className="grow"><b>{f.label}</b><span>{formatDate(f.date)}{f.recurrence === 'mensuelle' ? ' · chaque mois' : ''}</span></div>
                  <strong className={`money ${f.amount > 0 ? 'plus' : 'neg'}`}>{formatMoney(f.amount)}</strong>
                  <button className="icon-btn" aria-label={`Supprimer ${f.label}`} onClick={async () => { if (await run(() => api('budget.deleteForecast', { id: f.id }))) refresh() }}><Trash size={16} /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {adding && <ForecastModal onClose={() => setAdding(false)} onDone={() => { setAdding(false); refresh() }} />}
    </>
  )
}

function ForecastModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const f = useForm({ date: todayISO(), label: '', amount: '', direction: 'out', recurrence: 'aucune', end_date: '' })
  const save = async () => {
    const amount = (Number(String(f.values.amount).replace(/\s/g, '')) || 0) * (f.values.direction === 'out' ? -1 : 1)
    if (await run(() => api('budget.saveForecast', { ...f.values, amount }), 'Prévision ajoutée.')) onDone()
  }
  return (
    <Modal title="Nouvelle prévision" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" onClick={save}>Ajouter</button></>}>
      <div className="grid grid-2">
        <Field label="Libellé" span={2}><input autoFocus {...f.bind('label')} placeholder="Loyer du siège" /></Field>
        <Field label="Sens"><select {...f.bind('direction')}><option value="out">Sortie (dépense)</option><option value="in">Entrée (recette)</option></select></Field>
        <Field label="Montant"><input inputMode="numeric" {...f.bind('amount')} /></Field>
        <Field label="Date"><input type="date" {...f.bind('date')} /></Field>
        <Field label="Répétition"><select {...f.bind('recurrence')}><option value="aucune">Une seule fois</option><option value="mensuelle">Chaque mois</option></select></Field>
        {f.values.recurrence === 'mensuelle' && <Field label="Jusqu'au (facultatif)"><input type="date" {...f.bind('end_date')} /></Field>}
      </div>
    </Modal>
  )
}

function Budgets() {
  const [year, setYear] = useState(new Date().getFullYear())
  const { data, error, loading, reload } = useQuery<any>('budget.get', { year })
  const [editing, setEditing] = useState<any | null>(null)
  if (error) return <ErrorBox error={error} onRetry={reload} />
  if (loading && !data) return <Loading />
  const copy = async () => {
    if (!(await confirmDialog(`Créer le budget ${year} à partir du réalisé ${year - 1} (+5 %) ?`))) return
    const r = await run(() => api('budget.copyFromActual', { fromYear: year - 1, toYear: year, growth: 5 }), 'Budget initialisé.')
    if (r) reload()
  }
  const currentMonth = year === new Date().getFullYear() ? new Date().getMonth() : 11
  return (
    <>
      <div className="toolbar">
        <label className="inline">Exercice <select value={year} onChange={(e) => setYear(Number(e.target.value))}>{[year - 1, year, year + 1].map((y) => <option key={y}>{y}</option>)}</select></label>
        <button className="btn" onClick={copy}><Copy size={18} aria-hidden="true" />Reprendre le réalisé {year - 1}</button>
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setEditing({ year, account: '', label: '', amounts: Array(12).fill(0) })}><Plus size={18} aria-hidden="true" />Ligne de budget</button>
      </div>
      {data.lines.length === 0 ? <Empty>Aucun budget pour {year}. Ajoutez des lignes par compte (ex. 701 ventes, 605 achats, 66 personnel) ou reprenez le réalisé de l'an dernier.</Empty> : (
        <div className="budget-grid">
          {data.lines.map((l: any) => {
            const ytdPlan = l.planned.slice(0, currentMonth + 1).reduce((s: number, v: number) => s + v, 0)
            const ytdReal = l.actual.slice(0, currentMonth + 1).reduce((s: number, v: number) => s + v, 0)
            const revenue = l.account.startsWith('7')
            const pct = ytdPlan ? (ytdReal / ytdPlan) * 100 : 0
            const good = revenue ? pct >= 100 : pct <= 100
            const max = Math.max(...l.planned, ...l.actual, 1)
            return (
              <button key={l.id} className="dcard budget-card" onClick={() => setEditing(l)}>
                <div className="row gap"><div className="grow"><strong>{l.label}</strong><span className="muted small">{l.account} · {revenue ? 'produits' : 'charges'}</span></div><span className={`badge ${good ? 'pay-payee' : 'pay-en_retard'}`}>{Math.round(pct)} %</span></div>
                <div className="spark-bars" aria-hidden="true">
                  {l.planned.map((p: number, i: number) => (
                    <span key={i} className="sb"><i className="sb-plan" style={{ height: `${(p / max) * 100}%` }} /><i className={`sb-real ${good ? '' : 'over'}`} style={{ height: `${(Math.max(l.actual[i], 0) / max) * 100}%` }} /><em>{M[i][0]}</em></span>
                  ))}
                </div>
                <Progress value={pct} color={good ? 'var(--c-success)' : 'var(--c-danger)'} label={`${l.label} : réalisé sur prévu`} />
                <div className="budget-figs"><span>Prévu à date <b>{compact(ytdPlan)}</b></span><span>Réalisé <b>{compact(ytdReal)}</b></span><span>Année <b>{compact(l.totalPlanned)}</b></span></div>
              </button>
            )
          })}
        </div>
      )}
      {editing && <BudgetModal line={editing} year={year} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload() }} />}
    </>
  )
}

function BudgetModal({ line, year, onClose, onDone }: { line: any; year: number; onClose: () => void; onDone: () => void }) {
  const [account, setAccount] = useState(line.account)
  const [label, setLabel] = useState(line.label)
  const [amounts, setAmounts] = useState<string[]>((line.planned ?? line.amounts).map(String))
  const [spread, setSpread] = useState('')
  const save = async () => {
    if (await run(() => api('budget.saveLine', { id: line.id, year, account, label, amounts: amounts.map((a) => Number(a.replace(/\s/g, '')) || 0) }), 'Budget enregistré.')) onDone()
  }
  return (
    <Modal title={line.id ? `Budget ${year} — ${line.label}` : `Nouvelle ligne de budget ${year}`} wide onClose={onClose} footer={<>
      {line.id && <button className="btn btn-ghost" onClick={async () => { if (await confirmDialog('Supprimer cette ligne de budget ?', { danger: true })) if (await run(() => api('budget.deleteLine', { id: line.id }))) onDone() }}>Supprimer</button>}
      <span className="grow muted small">Total : {formatMoney(amounts.reduce((s, a) => s + (Number(a.replace(/\s/g, '')) || 0), 0))}</span>
      <button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" onClick={save}>Enregistrer</button>
    </>}>
      <div className="grid grid-3">
        <Field label="Compte ou racine" hint="701, 605, 66…"><input autoFocus={!line.id} value={account} onChange={(e) => setAccount(e.target.value)} /></Field>
        <Field label="Libellé" span={2}><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Repris du plan comptable si vide" /></Field>
        <Field label="Répartir un total annuel"><div className="row gap"><input inputMode="numeric" value={spread} onChange={(e) => setSpread(e.target.value)} /><button className="btn" onClick={() => setAmounts(Array(12).fill(String(Math.round((Number(spread.replace(/\s/g, '')) || 0) / 12))))}>Répartir</button></div></Field>
      </div>
      <div className="months-grid">
        {amounts.map((a, i) => <Field key={i} label={M[i]}><input inputMode="numeric" value={a} onChange={(e) => setAmounts(amounts.map((x, j) => (j === i ? e.target.value : x)))} /></Field>)}
      </div>
    </Modal>
  )
}
