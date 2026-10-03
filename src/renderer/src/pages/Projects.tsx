import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Clock, FileText, Kanban, Plus, Receipt, Timer, TrendUp } from '@phosphor-icons/react'
import { DOC_TYPES, type DocType } from '@shared/domain'
import { formatDate, formatMoney, formatNumber, todayISO } from '@shared/format'
import { api, run, useQuery } from '../api'
import { Progress } from '../components/charts'
import { confirmDialog, Empty, ErrorBox, Field, Loading, Modal, PageHeader, SearchInput, StatusBadge, Tabs, useForm } from '../components/ui'
import { useCan } from '../session'

const STATUS: Record<string, { label: string; cls: string }> = {
  prospect: { label: 'Prospect', cls: 'badge-brouillon' },
  en_cours: { label: 'En cours', cls: 'badge-valide' },
  suspendu: { label: 'Suspendu', cls: 'pay-partielle' },
  termine: { label: 'Terminé', cls: 'pay-payee' },
  annule: { label: 'Annulé', cls: 'badge-annule' }
}

export function ProjectsPage() {
  const nav = useNavigate()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const { data, error, loading, reload } = useQuery<any[]>('projects.list', { search, status })
  const [editing, setEditing] = useState<any | null>(null)
  const rows = data ?? []
  return (
    <div className="page">
      <PageHeader title="Projets et chantiers" subtitle="Temps passés, coûts, facturation et rentabilité par projet."
        actions={<button className="btn btn-primary" onClick={() => setEditing({ status: 'en_cours' })}><Plus size={18} aria-hidden="true" />Nouveau projet</button>} />
      <div className="toolbar">
        <Tabs value={status} onChange={setStatus} tabs={[{ value: '', label: 'Tous' }, { value: 'en_cours', label: 'En cours' }, { value: 'prospect', label: 'Prospects' }, { value: 'termine', label: 'Terminés' }]} />
        <SearchInput value={search} onChange={setSearch} placeholder="Projet, code, client…" />
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Loading /> : rows.length === 0 ? <Empty>Aucun projet. Créez un projet pour suivre les temps et la rentabilité d'un chantier.</Empty> : (
        <div className="card-grid projects">
          {rows.map((p) => {
            const hoursPct = p.budget_hours ? (p.hours / p.budget_hours) * 100 : 0
            const amountPct = p.budget_amount ? (p.invoiced / p.budget_amount) * 100 : 0
            return (
              <button key={p.id} className="dcard project-card" onClick={() => nav(`/projets/${p.id}`)}>
                <div className="row gap">
                  <span className="tint tint-md tint-primary" aria-hidden="true"><Kanban size={22} weight="duotone" /></span>
                  <div className="grow"><strong>{p.name}</strong><span className="muted small">{p.code}{p.party_name ? ` · ${p.party_name}` : ''}</span></div>
                  <span className={`badge ${STATUS[p.status].cls}`}>{STATUS[p.status].label}</span>
                </div>
                <div className="project-figs">
                  <div><span>Heures</span><strong>{formatNumber(p.hours, 1)}{p.budget_hours ? ` / ${formatNumber(p.budget_hours)}` : ''}</strong></div>
                  <div><span>Facturé HT</span><strong>{formatMoney(p.invoiced)}</strong></div>
                  <div><span>À facturer</span><strong className={p.unbilled ? 'text-warn' : ''}>{formatMoney(p.unbilled)}</strong></div>
                </div>
                {p.budget_hours > 0 && <Progress value={hoursPct} color={hoursPct > 100 ? 'var(--c-danger)' : hoursPct > 80 ? 'var(--c-warning)' : 'var(--c-primary)'} label="Heures consommées" />}
                {p.budget_amount > 0 && <Progress value={amountPct} color="var(--c-success)" label="Budget facturé" />}
              </button>
            )
          })}
        </div>
      )}
      {editing && <ProjectModal p={editing} onClose={() => setEditing(null)} onDone={(id) => { setEditing(null); reload(); if (id) nav(`/projets/${id}`) }} />}
    </div>
  )
}

function ProjectModal({ p, onClose, onDone }: { p: any; onClose: () => void; onDone: (id?: number) => void }) {
  const { data: clients } = useQuery<any[]>('projects.clients')
  const f = useForm<any>({ name: '', party_id: '', status: 'en_cours', start_date: todayISO(), end_date: '', budget_amount: '0', budget_hours: '0', hourly_rate: '0', description: '', ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v === null ? '' : typeof v === 'number' ? String(v) : v])) })
  const save = async () => {
    const r = await run(() => api('projects.save', { ...f.values, id: p.id }), 'Projet enregistré.')
    if (r) onDone(p.id ? undefined : r.id)
  }
  return (
    <Modal title={p.id ? p.name : 'Nouveau projet'} wide onClose={onClose} footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" onClick={save}>Enregistrer</button></>}>
      <div className="grid grid-4">
        <Field label="Nom du projet" span={2}><input autoFocus {...f.bind('name')} placeholder="Câblage agence de Koudougou" /></Field>
        <Field label="Client"><select {...f.bind('party_id')}><option value="">—</option>{(clients ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="État"><select {...f.bind('status')}>{Object.entries(STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}</select></Field>
        <Field label="Début"><input type="date" {...f.bind('start_date')} /></Field>
        <Field label="Fin prévue"><input type="date" {...f.bind('end_date')} /></Field>
        <Field label="Taux horaire HT" hint="Pour facturer les heures"><input inputMode="numeric" {...f.bind('hourly_rate')} /></Field>
        <Field label="Budget en heures"><input inputMode="numeric" {...f.bind('budget_hours')} /></Field>
        <Field label="Budget HT"><input inputMode="numeric" {...f.bind('budget_amount')} /></Field>
        <Field label="Description" span={3}><input {...f.bind('description')} /></Field>
      </div>
    </Modal>
  )
}

export function ProjectDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const canSales = useCan('sales')
  const { data: p, error, loading, reload } = useQuery<any>('projects.get', { id: Number(id) })
  const [editing, setEditing] = useState(false)
  const [time, setTime] = useState<any | null>(null)
  if (error) return <div className="page"><ErrorBox error={error} onRetry={reload} /></div>
  if (loading && !p) return <Loading />
  const invoice = async () => {
    const r = await run(() => api('projects.invoiceTime', { id: p.id }), 'Facture préparée en brouillon.')
    if (r) nav(`/doc/${r.documentId}`)
  }
  return (
    <div className="page">
      <PageHeader title={p.name} subtitle={<span className="row gap wrap"><Link to="/projets">← Projets</Link><span className={`badge ${STATUS[p.status].cls}`}>{STATUS[p.status].label}</span><span className="muted">{p.code}{p.party_name ? ` · ${p.party_name}` : ''}</span></span>}
        actions={<>
          <button className="btn" onClick={() => setEditing(true)}>Modifier</button>
          <button className="btn" onClick={() => setTime({ project_id: p.id, date: todayISO(), hours: '', description: '', billable: true, rate: '' })}><Timer size={18} aria-hidden="true" />Saisir du temps</button>
          {canSales && p.unbilled > 0 && <button className="btn btn-primary" onClick={invoice}><Receipt size={18} aria-hidden="true" />Facturer {formatMoney(p.unbilled)}</button>}
        </>} />
      <div className="kpi-row">
        <div className="mini-kpi"><span><Clock size={16} aria-hidden="true" /> Heures</span><strong>{formatNumber(p.hours, 1)}{p.budget_hours ? ` / ${formatNumber(p.budget_hours)}` : ''}</strong></div>
        <div className="mini-kpi"><span>Valeur des heures</span><strong>{formatMoney(p.laborValue)}</strong></div>
        <div className="mini-kpi"><span>Facturé HT</span><strong>{formatMoney(p.invoiced)}</strong></div>
        <div className="mini-kpi"><span>Achats imputés</span><strong>{formatMoney(p.purchases)}</strong></div>
        <div className={`mini-kpi ${p.margin < 0 ? 'bad' : 'good'}`}><span><TrendUp size={16} aria-hidden="true" /> Marge (facturé − achats)</span><strong>{formatMoney(p.margin)}</strong></div>
      </div>
      <div className="dash-grid two">
        <div className="card">
          <h3>Temps passés</h3>
          {p.entries.length === 0 ? <Empty>Aucun temps saisi.</Empty> : (
            <table className="table compact">
              <thead><tr><th>Date</th><th>Travail</th><th>Par</th><th className="num">Heures</th><th /></tr></thead>
              <tbody>
                {p.entries.map((t: any) => (
                  <tr key={t.id}>
                    <td className="nowrap">{formatDate(t.date)}</td>
                    <td>{t.description}{!t.billable && <span className="muted small"> · non facturable</span>}{t.invoice_number && <div className="muted small">Facturé : {t.invoice_number}</div>}</td>
                    <td className="muted">{t.user_name}</td>
                    <td className="num">{formatNumber(t.hours, 2)}</td>
                    <td className="num">{!t.invoice_id && <button className="link-btn danger small" onClick={async () => { if (await confirmDialog('Supprimer cette saisie ?', { danger: true })) if (await run(() => api('projects.deleteTime', { id: t.id }))) reload() }}>Supprimer</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="stack">
          <div className="card">
            <h3>Documents du projet</h3>
            {p.documents.length === 0 ? <p className="muted">Choisissez ce projet sur un devis, une facture ou une facture fournisseur pour l'y rattacher.</p> : (
              <ul className="rows">
                {p.documents.map((d: any) => (
                  <li key={d.id} className="clickable" onClick={() => nav(`/doc/${d.id}`)}>
                    <span className="tint tint-sm tint-primary" aria-hidden="true"><FileText size={18} weight="duotone" /></span>
                    <div className="grow"><b>{d.number ?? DOC_TYPES[d.type as DocType].label}</b><span>{DOC_TYPES[d.type as DocType].label} · {formatDate(d.date)}</span></div>
                    <strong>{formatMoney(d.total_ht)}</strong>
                    <StatusBadge status={d.status} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          {p.byUser.length > 0 && (
            <div className="card">
              <h3>Répartition par intervenant</h3>
              <ul className="rows">
                {p.byUser.map((u: any) => (
                  <li key={u.name}><span className="initials hue-1" aria-hidden="true">{u.name.slice(0, 2).toUpperCase()}</span><div className="grow"><b>{u.name}</b><Progress value={(u.hours / p.hours) * 100} label={`Part de ${u.name}`} /></div><strong>{formatNumber(u.hours, 1)} h</strong></li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
      {editing && <ProjectModal p={p} onClose={() => setEditing(false)} onDone={() => { setEditing(false); reload() }} />}
      {time && <TimeModal t={time} rate={p.hourly_rate} onClose={() => setTime(null)} onDone={() => { setTime(null); reload() }} />}
    </div>
  )
}

function TimeModal({ t, rate, onClose, onDone }: { t: any; rate: number; onClose: () => void; onDone: () => void }) {
  const f = useForm<any>(t)
  const save = async () => {
    if (await run(() => api('projects.saveTime', { ...f.values, hours: Number(String(f.values.hours).replace(',', '.')), rate: Number(f.values.rate) || 0 }), 'Temps enregistré.')) onDone()
  }
  return (
    <Modal title="Saisir du temps" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" onClick={save}>Enregistrer</button></>}>
      <div className="grid grid-3">
        <Field label="Date"><input type="date" {...f.bind('date')} /></Field>
        <Field label="Heures"><input autoFocus inputMode="decimal" {...f.bind('hours')} placeholder="2,5" /></Field>
        <Field label="Taux horaire" hint={rate ? `Par défaut : ${formatMoney(rate)}` : undefined}><input inputMode="numeric" {...f.bind('rate')} /></Field>
        <Field label="Travail effectué" span={3}><input {...f.bind('description')} placeholder="Installation et configuration du routeur" /></Field>
      </div>
      <label className="inline check"><input type="checkbox" checked={!!f.values.billable} onChange={(e) => f.set('billable', e.target.checked)} /> Facturable au client</label>
    </Modal>
  )
}
