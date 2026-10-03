import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  CalendarBlank, CheckCircle, Clock, Coins, FileText, Flag, Kanban, PencilSimple, Plus, Receipt, Timer, Trash, TrendUp, Warning, Wallet, Image as ImageIcon, ListChecks, ChartBar
} from '@phosphor-icons/react'
import { DOC_TYPES, PAYMENT_METHODS, type DocType } from '@shared/domain'
import { formatDate, formatMoney, formatNumber, todayISO } from '@shared/format'
import { EXPENSE_CATEGORIES, TASK_STATUS, isLate, type TaskStatus } from '@shared/projects'
import { api, run, unwrap, useQuery } from '../api'
import { Progress } from '../components/charts'
import { KpiStrip } from '../components/KpiStrip'
import { confirmDialog, Empty, ErrorBox, Field, Loading, Modal, PageHeader, RowActions, SearchInput, StatusBadge, Tabs, useForm } from '../components/ui'
import { useCan, useSession } from '../session'

const STATUS: Record<string, { label: string; cls: string }> = {
  prospect: { label: 'Prospect', cls: 'badge-brouillon' },
  en_cours: { label: 'En cours', cls: 'badge-valide' },
  suspendu: { label: 'Suspendu', cls: 'pay-partielle' },
  termine: { label: 'Terminé', cls: 'pay-payee' },
  annule: { label: 'Annulé', cls: 'badge-annule' }
}
const n = (v: unknown) => Number(String(v ?? '').replace(/\s/g, '').replace(',', '.')) || 0

export function ProjectsPage() {
  const nav = useNavigate()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const { data, error, loading, reload } = useQuery<any[]>('projects.list', { search, status })
  const [editing, setEditing] = useState<any | null>(null)
  const rows = data ?? []
  return (
    <div className="page">
      <PageHeader title="Projets et chantiers" subtitle="Tâches, temps passés, dépenses, budget, facturation et rentabilité par projet."
        actions={<button className="btn btn-primary" onClick={() => setEditing({ status: 'en_cours' })}><Plus size={18} aria-hidden="true" />Nouveau projet</button>} />
      <KpiStrip items={[
        { label: 'Projets en cours', value: rows.filter((p) => p.status === 'en_cours').length, icon: Kanban },
        { label: 'Facturé HT', value: rows.reduce((s, p) => s + p.invoiced, 0), icon: Coins, money: true, tone: 'good' },
        { label: 'Dépenses', value: rows.reduce((s, p) => s + p.expenses + p.purchases, 0), icon: Wallet, money: true },
        { label: 'À facturer', value: rows.reduce((s, p) => s + p.unbilled, 0), icon: Receipt, money: true },
        { label: 'Tâches en retard', value: rows.reduce((s, p) => s + p.tasks_late, 0), icon: Warning, tone: 'bad' }
      ]} />
      <div className="toolbar">
        <Tabs value={status} onChange={setStatus} tabs={[{ value: '', label: 'Tous' }, { value: 'en_cours', label: 'En cours' }, { value: 'prospect', label: 'Prospects' }, { value: 'termine', label: 'Terminés' }]} />
        <SearchInput value={search} onChange={setSearch} placeholder="Projet, code, client…" />
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Loading /> : rows.length === 0 ? <Empty>Aucun projet. Créez un projet pour suivre les tâches, les dépenses et la rentabilité d'un chantier.</Empty> : (
        <div className="card-grid projects">
          {rows.map((p) => {
            const progress = p.tasks_total ? Math.round((p.tasks_done / p.tasks_total) * 100) : 0
            const cost = p.expenses + p.purchases
            const budgetPct = p.budget_amount ? (cost / p.budget_amount) * 100 : 0
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
                  <div><span>Dépenses</span><strong>{formatMoney(cost)}</strong></div>
                </div>
                {p.tasks_total > 0 && <Progress value={progress} color="var(--c-success)" label={`Tâches terminées : ${p.tasks_done} / ${p.tasks_total}`} />}
                {p.budget_amount > 0 && <Progress value={budgetPct} color={budgetPct > 100 ? 'var(--c-danger)' : budgetPct > 80 ? 'var(--c-warning)' : 'var(--c-primary)'} label="Budget consommé" />}
                {p.tasks_late > 0 && <span className="project-alert"><Warning size={15} weight="fill" aria-hidden="true" />{p.tasks_late} tâche(s) en retard</span>}
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
  const lines = (p.budget_lines ?? {}) as Record<string, number>
  const f = useForm<any>({
    name: '', party_id: '', status: 'en_cours', start_date: todayISO(), end_date: '', budget_amount: '0', budget_hours: '0', hourly_rate: '0', cost_rate: '0', description: '',
    ...Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'budget_lines').map(([k, v]) => [k, v === null ? '' : typeof v === 'number' ? String(v) : v])),
    ...Object.fromEntries(Object.keys(EXPENSE_CATEGORIES).map((k) => [`bl_${k}`, lines[k] ? String(lines[k]) : '']))
  })
  const save = async () => {
    const budget_lines = Object.fromEntries(Object.keys(EXPENSE_CATEGORIES).map((k) => [k, n(f.values[`bl_${k}`])]))
    const r = await run(() => api('projects.save', { ...f.values, budget_lines, id: p.id }), 'Projet enregistré.')
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
        <Field label="Coût horaire interne" hint="Pour calculer la rentabilité"><input inputMode="numeric" {...f.bind('cost_rate')} /></Field>
        <Field label="Budget en heures"><input inputMode="numeric" {...f.bind('budget_hours')} /></Field>
        <Field label="Budget HT"><input inputMode="numeric" {...f.bind('budget_amount')} /></Field>
        <Field label="Description" span={2}><input {...f.bind('description')} /></Field>
      </div>
      <h4 className="section-title">Budget par poste (HT, facultatif)</h4>
      <div className="grid grid-4">
        {Object.entries(EXPENSE_CATEGORIES).map(([k, c]) => <Field key={k} label={c.label}><input inputMode="numeric" {...f.bind(`bl_${k}`)} /></Field>)}
      </div>
    </Modal>
  )
}

type DetailTab = 'apercu' | 'taches' | 'depenses' | 'temps' | 'documents'

export function ProjectDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const canSales = useCan('sales')
  const { data: p, error, loading, reload } = useQuery<any>('projects.get', { id: Number(id) })
  const [tab, setTab] = useState<DetailTab>('apercu')
  const [editing, setEditing] = useState(false)
  const [time, setTime] = useState<any | null>(null)
  const [expense, setExpense] = useState<any | null>(null)
  const [task, setTask] = useState<any | null>(null)
  const [receipt, setReceipt] = useState<string | null>(null)
  if (error) return <div className="page"><ErrorBox error={error} onRetry={reload} /></div>
  if (loading && !p) return <Loading />
  const invoice = async (what: 'time' | 'expenses') => {
    const r = await run(() => api(what === 'time' ? 'projects.invoiceTime' : 'projects.invoiceExpenses', { id: p.id }), 'Facture préparée en brouillon.')
    if (r) nav(`/doc/${r.documentId}`)
  }
  const today = todayISO()
  const late = p.tasks.filter((t: any) => isLate(t, today)).length
  return (
    <div className="page">
      <PageHeader title={p.name} subtitle={<span className="row gap wrap"><Link to="/projets">← Projets</Link><span className={`badge ${STATUS[p.status].cls}`}>{STATUS[p.status].label}</span><span className="muted">{p.code}{p.party_name ? ` · ${p.party_name}` : ''}{p.end_date ? ` · fin prévue ${formatDate(p.end_date)}` : ''}</span></span>}
        actions={<>
          <button className="btn" onClick={() => setEditing(true)}><PencilSimple size={18} aria-hidden="true" />Modifier</button>
          <button className="btn" onClick={() => setTask({ project_id: p.id, status: 'a_faire' })}><ListChecks size={18} aria-hidden="true" />Nouvelle tâche</button>
          <button className="btn" onClick={() => setExpense({ project_id: p.id, date: today, category: 'materiel', tva_rate: '0', paid: true, payment_method: 'Espèces' })}><Wallet size={18} aria-hidden="true" />Nouvelle dépense</button>
          <button className="btn" onClick={() => setTime({ project_id: p.id, date: today, hours: '', description: '', billable: true, rate: '' })}><Timer size={18} aria-hidden="true" />Saisir du temps</button>
          {canSales && p.unbilled > 0 && <button className="btn btn-primary" onClick={() => invoice('time')}><Receipt size={18} aria-hidden="true" />Facturer {formatMoney(p.unbilled)}</button>}
        </>} />
      <div className="kpi-row">
        <div className="mini-kpi"><span><ChartBar size={16} aria-hidden="true" /> Avancement</span><strong>{p.progress} %</strong></div>
        <div className="mini-kpi"><span><Clock size={16} aria-hidden="true" /> Heures</span><strong>{formatNumber(p.hours, 1)}{p.budget_hours ? ` / ${formatNumber(p.budget_hours)}` : ''}</strong></div>
        <div className="mini-kpi"><span>Facturé HT</span><strong>{formatMoney(p.invoiced)}</strong></div>
        <div className="mini-kpi"><span><Wallet size={16} aria-hidden="true" /> Coût total</span><strong>{formatMoney(p.totalCost)}</strong></div>
        <div className={`mini-kpi ${p.margin < 0 ? 'bad' : 'good'}`}><span><TrendUp size={16} aria-hidden="true" /> Marge</span><strong>{formatMoney(p.margin)}</strong></div>
      </div>
      {p.alerts.length > 0 && (
        <div className="project-alerts" role="status">
          <Warning size={20} weight="fill" aria-hidden="true" />
          <ul>{p.alerts.map((a: string) => <li key={a}>{a}</li>)}</ul>
        </div>
      )}
      <Tabs value={tab} onChange={(v) => setTab(v as DetailTab)} tabs={[
        { value: 'apercu', label: "Vue d'ensemble" },
        { value: 'taches', label: `Tâches (${p.tasks.length})${late ? ` · ${late} en retard` : ''}` },
        { value: 'depenses', label: `Dépenses (${p.expenses.length})` },
        { value: 'temps', label: `Temps (${p.entries.length})` },
        { value: 'documents', label: `Documents (${p.documents.length})` }
      ]} />

      {tab === 'apercu' && (
        <div className="tab-panel dash-grid two" key="apercu">
          <div className="card">
            <h3>Rentabilité</h3>
            <table className="table compact decl">
              <tbody>
                <tr><td>Chiffre d'affaires facturé (HT)</td><td className="num money">{formatNumber(p.invoiced)}</td></tr>
                <tr><td>− Main-d'œuvre ({formatNumber(p.hours, 1)} h au coût interne)</td><td className="num money">{formatNumber(p.laborCost)}</td></tr>
                <tr><td>− Dépenses du projet</td><td className="num money">{formatNumber(p.expensesTotal)}</td></tr>
                <tr><td>− Achats imputés (factures fournisseurs)</td><td className="num money">{formatNumber(p.purchases)}</td></tr>
              </tbody>
              <tfoot><tr><td>Marge</td><td className="num">{formatNumber(p.margin)}</td></tr></tfoot>
            </table>
            <div className="stack" style={{ marginTop: 12 }}>
              {p.budget_amount > 0 && <Progress value={p.budgetUsed ?? 0} color={(p.budgetUsed ?? 0) > 100 ? 'var(--c-danger)' : 'var(--c-primary)'} label={`Budget consommé : ${p.budgetUsed} % de ${formatMoney(p.budget_amount)}`} />}
              {p.budget_hours > 0 && <Progress value={(p.hours / p.budget_hours) * 100} color={p.hours > p.budget_hours ? 'var(--c-danger)' : 'var(--c-warning)'} label={`Heures : ${formatNumber(p.hours, 1)} / ${formatNumber(p.budget_hours)}`} />}
              <Progress value={p.progress} color="var(--c-success)" label={`Avancement des tâches : ${p.progress} %`} />
            </div>
            <p className="muted small">À facturer : {formatMoney(p.unbilled)} d'heures et {formatMoney(p.unbilledExpenses)} de dépenses refacturables.</p>
          </div>
          <div className="card">
            <h3>Budget par poste</h3>
            <div className="budget-lines">
              {p.byCategory.filter((c: any) => c.budget > 0 || c.actual > 0).length === 0 ? <p className="muted">Aucune dépense ni budget par poste. Renseignez-les dans « Modifier ».</p> :
                p.byCategory.filter((c: any) => c.budget > 0 || c.actual > 0).map((c: any) => {
                  const pct = c.budget ? (c.actual / c.budget) * 100 : 100
                  return (
                    <div key={c.key} className="budget-line">
                      <div className="row space-between"><b>{c.label}</b><span className={c.budget && c.actual > c.budget ? 'text-danger strong' : 'muted'}>{formatMoney(c.actual)}{c.budget ? ` / ${formatMoney(c.budget)}` : ''}</span></div>
                      <Progress value={Math.min(pct, 100)} color={pct > 100 ? 'var(--c-danger)' : pct > 80 ? 'var(--c-warning)' : 'var(--c-success)'} label={`${c.label} : ${Math.round(pct)} %`} />
                    </div>
                  )
                })}
            </div>
          </div>
        </div>
      )}

      {tab === 'taches' && <TaskBoard key="taches" project={p} onEdit={setTask} reload={reload} />}

      {tab === 'depenses' && (
        <div className="tab-panel card" key="depenses">
          <div className="row space-between wrap gap">
            <h3>Dépenses du projet</h3>
            {canSales && p.unbilledExpenses > 0 && <button className="btn btn-primary btn-sm" onClick={() => invoice('expenses')}><Receipt size={16} aria-hidden="true" />Refacturer {formatMoney(p.unbilledExpenses)}</button>}
          </div>
          {p.expenses.length === 0 ? <Empty>Aucune dépense. Enregistrez achats de matériel, transport, sous-traitance… avec leur justificatif.</Empty> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Date</th><th>Poste</th><th>Dépense</th><th>Fournisseur</th><th className="num">HT</th><th className="num">TTC</th><th>Règlement</th><th className="actions-col">Actions</th></tr></thead>
                <tbody>
                  {p.expenses.map((e: any) => (
                    <tr key={e.id}>
                      <td className="nowrap">{formatDate(e.date)}</td>
                      <td>{EXPENSE_CATEGORIES[e.category as keyof typeof EXPENSE_CATEGORIES]?.label}</td>
                      <td>{e.description}{e.billable && <div className="muted small">{e.invoice_number ? `Refacturée : ${e.invoice_number}` : `Refacturable${e.markup ? ` (+${formatNumber(e.markup)} %)` : ''}`}</div>}</td>
                      <td className="muted">{e.supplier}</td>
                      <td className="num money">{formatNumber(e.amount_ht)}</td>
                      <td className="num money strong">{formatNumber(e.amount_ttc)}</td>
                      <td>{e.paid ? <span className="badge pay-payee">{e.payment_method}</span> : <span className="badge pay-partielle">À payer</span>}</td>
                      <td className="actions-col">
                        <RowActions actions={[
                          { label: 'Voir le justificatif', icon: ImageIcon, hidden: !e.receipt, onClick: () => setReceipt(e.receipt) },
                          { label: 'Modifier', icon: PencilSimple, tone: 'primary', hidden: !!e.invoice_id, onClick: () => setExpense({ ...e, amount_ht: String(e.amount_ht), tva_rate: String(e.tva_rate), markup: String(e.markup) }) },
                          { label: 'Supprimer', icon: Trash, tone: 'danger', hidden: !!e.invoice_id, onClick: async () => { if (await confirmDialog(`Supprimer « ${e.description} » ?`, { danger: true, detail: "L'écriture comptable est aussi supprimée." })) if (await run(() => api('projects.deleteExpense', { id: e.id }), 'Dépense supprimée.')) reload() } }
                        ]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={4}>Total</td><td className="num">{formatNumber(p.expenses.reduce((s: number, e: any) => s + e.amount_ht, 0))}</td><td className="num">{formatNumber(p.expenses.reduce((s: number, e: any) => s + e.amount_ttc, 0))}</td><td colSpan={2} /></tr></tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'temps' && (
        <div className="tab-panel dash-grid two" key="temps">
          <div className="card">
            <h3>Temps passés</h3>
            {p.entries.length === 0 ? <Empty>Aucun temps saisi.</Empty> : (
              <table className="table compact">
                <thead><tr><th>Date</th><th>Travail</th><th>Par</th><th className="num">Heures</th><th className="actions-col">Actions</th></tr></thead>
                <tbody>
                  {p.entries.map((t: any) => (
                    <tr key={t.id}>
                      <td className="nowrap">{formatDate(t.date)}</td>
                      <td>{t.description}{t.task_id && <span className="muted small"> · {p.tasks.find((k: any) => k.id === t.task_id)?.title}</span>}{!t.billable && <span className="muted small"> · non facturable</span>}{t.invoice_number && <div className="muted small">Facturé : {t.invoice_number}</div>}</td>
                      <td className="muted">{t.user_name}</td>
                      <td className="num">{formatNumber(t.hours, 2)}</td>
                      <td className="actions-col"><RowActions actions={[{ label: 'Supprimer la saisie', icon: Trash, tone: 'danger', hidden: !!t.invoice_id, onClick: async () => { if (await confirmDialog('Supprimer cette saisie ?', { danger: true })) if (await run(() => api('projects.deleteTime', { id: t.id }), 'Saisie supprimée.')) reload() } }]} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
      )}

      {tab === 'documents' && (
        <div className="tab-panel card" key="documents">
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
      )}

      {editing && <ProjectModal p={p} onClose={() => setEditing(false)} onDone={() => { setEditing(false); reload() }} />}
      {time && <TimeModal t={time} rate={p.hourly_rate} tasks={p.tasks} onClose={() => setTime(null)} onDone={() => { setTime(null); setTab('temps'); reload() }} />}
      {expense && <ExpenseModal e={expense} onClose={() => setExpense(null)} onDone={() => { setExpense(null); setTab('depenses'); reload() }} />}
      {receipt && <Modal title="Justificatif" wide onClose={() => setReceipt(null)}><img className="receipt-full" src={receipt} alt="Justificatif de la dépense" /></Modal>}
      {task && <TaskModal t={task} onClose={() => setTask(null)} onDone={() => { setTask(null); setTab('taches'); reload() }} />}
    </div>
  )
}

/** Tableau des tâches : glisser une carte d'une colonne à l'autre change son statut. */
function TaskBoard({ project, onEdit, reload }: { project: any; onEdit: (t: any) => void; reload: () => void }) {
  const [dragging, setDragging] = useState<number | null>(null)
  const [over, setOver] = useState<TaskStatus | null>(null)
  const today = todayISO()
  const move = async (id: number, status: TaskStatus) => {
    if (await run(() => api('projects.moveTask', { id, status }))) reload()
  }
  return (
    <div className="tab-panel">
      {project.tasks.length === 0 && <Empty>Aucune tâche. Découpez le projet en tâches et jalons pour suivre l'avancement et les retards.</Empty>}
      <div className="kanban task-board">
        {(Object.keys(TASK_STATUS) as TaskStatus[]).map((st) => {
          const tasks = project.tasks.filter((t: any) => t.status === st)
          return (
            <section
              key={st}
              className={`kanban-col ${over === st ? 'drop' : ''}`}
              aria-label={TASK_STATUS[st].label}
              onDragOver={(e) => { e.preventDefault(); setOver(st) }}
              onDragLeave={() => setOver(null)}
              onDrop={() => { if (dragging) move(dragging, st); setDragging(null); setOver(null) }}
            >
              <div className={`kanban-head tone-${TASK_STATUS[st].tone}`}><strong>{TASK_STATUS[st].label}</strong><span className="badge">{tasks.length}</span></div>
              <div className="kanban-list">
                {tasks.map((t: any) => (
                  <article key={t.id} className={`kanban-card ${dragging === t.id ? 'dragging' : ''} ${isLate(t, today) ? 'late' : ''}`} draggable onDragStart={() => setDragging(t.id)} onDragEnd={() => setDragging(null)}>
                    <button className="kanban-open" onClick={() => onEdit({ ...t, estimated_hours: String(t.estimated_hours), progress: String(t.progress) })}>
                      <strong>{t.milestone && <Flag size={15} weight="fill" className="milestone" aria-label="Jalon" />}{t.title}</strong>
                      {t.assignee_name && <span className="muted small">{t.assignee_name}</span>}
                      {t.status !== 'termine' && t.progress > 0 && <Progress value={t.progress} color="var(--c-primary)" label={`Avancement ${t.progress} %`} />}
                      <span className="row gap wrap small">
                        {t.due_date && <span className={`kanban-due ${isLate(t, today) ? 'late' : ''}`}><CalendarBlank size={14} aria-hidden="true" />{formatDate(t.due_date)}</span>}
                        {(t.estimated_hours > 0 || t.spent_hours > 0) && <span className="kanban-due"><Clock size={14} aria-hidden="true" />{formatNumber(t.spent_hours, 1)}{t.estimated_hours ? ` / ${formatNumber(t.estimated_hours)}` : ''} h</span>}
                      </span>
                    </button>
                    {st !== 'termine' && (
                      <button className="kanban-next" aria-label={`Terminer « ${t.title} »`} title="Marquer comme terminée" onClick={() => move(t.id, 'termine')}><CheckCircle size={18} aria-hidden="true" /></button>
                    )}
                  </article>
                ))}
                {tasks.length === 0 && <p className="kanban-empty">Déposez une tâche ici</p>}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

function TaskModal({ t, onClose, onDone }: { t: any; onClose: () => void; onDone: () => void }) {
  const { data: users } = useQuery<any[]>('projects.users')
  const f = useForm<any>({ title: '', description: '', status: 'a_faire', milestone: false, assignee_id: '', start_date: '', due_date: '', estimated_hours: '0', progress: '0', ...Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v === null ? '' : v])) })
  const save = async () => {
    if (await run(() => api('projects.saveTask', { ...f.values, estimated_hours: n(f.values.estimated_hours), progress: n(f.values.progress) }), 'Tâche enregistrée.')) onDone()
  }
  const remove = async () => {
    if (await confirmDialog(`Supprimer la tâche « ${t.title} » ?`, { danger: true })) if (await run(() => api('projects.deleteTask', { id: t.id }), 'Tâche supprimée.')) onDone()
  }
  return (
    <Modal title={t.id ? t.title : 'Nouvelle tâche'} wide onClose={onClose} footer={<>{t.id && <button className="btn btn-ghost" onClick={remove}><Trash size={18} aria-hidden="true" />Supprimer</button>}<span className="grow" /><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" onClick={save}>Enregistrer</button></>}>
      <div className="grid grid-4">
        <Field label="Intitulé de la tâche" span={3}><input autoFocus {...f.bind('title')} placeholder="Pose des câbles du bâtiment B" /></Field>
        <Field label="Statut"><select {...f.bind('status')}>{Object.entries(TASK_STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}</select></Field>
        <Field label="Responsable"><select {...f.bind('assignee_id')}><option value="">—</option>{(users ?? []).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></Field>
        <Field label="Début"><input type="date" {...f.bind('start_date')} /></Field>
        <Field label="Échéance"><input type="date" {...f.bind('due_date')} /></Field>
        <Field label="Heures estimées"><input inputMode="decimal" {...f.bind('estimated_hours')} /></Field>
        <Field label={`Avancement : ${f.values.progress || 0} %`} span={2}><input type="range" min={0} max={100} step={5} {...f.bind('progress')} /></Field>
        <Field label="Détails" span={2}><input {...f.bind('description')} /></Field>
      </div>
      <label className="inline check"><input type="checkbox" checked={!!f.values.milestone} onChange={(e) => f.set('milestone', e.target.checked)} /> Jalon (étape clé du projet)</label>
    </Modal>
  )
}

function ExpenseModal({ e, onClose, onDone }: { e: any; onClose: () => void; onDone: () => void }) {
  const { company } = useSession()
  const f = useForm<any>({ description: '', supplier: '', amount_ht: '', markup: '0', billable: false, receipt: '', ...e })
  const ttc = Math.round(n(f.values.amount_ht) * (1 + n(f.values.tva_rate) / 100))
  const pick = async () => {
    const img = await run(() => unwrap(window.erp.pickImage()))
    if (img) f.set('receipt', img)
  }
  const save = async () => {
    if (await run(() => api('projects.saveExpense', { ...f.values, amount_ht: n(f.values.amount_ht), tva_rate: n(f.values.tva_rate), markup: n(f.values.markup) }), 'Dépense enregistrée.')) onDone()
  }
  return (
    <Modal title={e.id ? 'Modifier la dépense' : 'Nouvelle dépense'} wide onClose={onClose} footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" onClick={save}>Enregistrer</button></>}>
      <div className="grid grid-4">
        <Field label="Date"><input type="date" {...f.bind('date')} /></Field>
        <Field label="Poste"><select {...f.bind('category')}>{Object.entries(EXPENSE_CATEGORIES).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}</select></Field>
        <Field label="Dépense" span={2}><input autoFocus {...f.bind('description')} placeholder="Ciment, 20 sacs" /></Field>
        <Field label="Fournisseur" span={2}><input {...f.bind('supplier')} /></Field>
        <Field label="Montant HT"><input inputMode="numeric" {...f.bind('amount_ht')} /></Field>
        <Field label="TVA (%)" hint={`Montant TTC : ${formatMoney(ttc)}`}><input inputMode="decimal" {...f.bind('tva_rate')} placeholder={String(company.default_tva)} /></Field>
        <label className="inline check"><input type="checkbox" checked={f.values.paid !== false} onChange={(ev) => f.set('paid', ev.target.checked)} /> Déjà payée</label>
        {f.values.paid !== false
          ? <Field label="Mode de paiement"><select {...f.bind('payment_method')}>{PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}</select></Field>
          : <p className="muted small span-1">Enregistrée en dette fournisseur (compte 401).</p>}
        <label className="inline check"><input type="checkbox" checked={!!f.values.billable} onChange={(ev) => f.set('billable', ev.target.checked)} /> Refacturable au client</label>
        {f.values.billable && <Field label="Marge de refacturation (%)"><input inputMode="decimal" {...f.bind('markup')} /></Field>}
      </div>
      <div className="receipt-row">
        <button type="button" className="btn" onClick={pick}><ImageIcon size={18} aria-hidden="true" />{f.values.receipt ? 'Changer le justificatif' : 'Joindre le justificatif (photo)'}</button>
        {f.values.receipt && <><img className="receipt-thumb" src={f.values.receipt} alt="Justificatif" /><button type="button" className="link-btn danger small" onClick={() => f.set('receipt', '')}>Retirer</button></>}
      </div>
    </Modal>
  )
}

function TimeModal({ t, rate, tasks, onClose, onDone }: { t: any; rate: number; tasks: any[]; onClose: () => void; onDone: () => void }) {
  const f = useForm<any>({ task_id: '', ...t })
  const save = async () => {
    if (await run(() => api('projects.saveTime', { ...f.values, hours: Number(String(f.values.hours).replace(',', '.')), rate: Number(f.values.rate) || 0, task_id: Number(f.values.task_id) || null }), 'Temps enregistré.')) onDone()
  }
  return (
    <Modal title="Saisir du temps" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" onClick={save}>Enregistrer</button></>}>
      <div className="grid grid-3">
        <Field label="Date"><input type="date" {...f.bind('date')} /></Field>
        <Field label="Heures"><input autoFocus inputMode="decimal" {...f.bind('hours')} placeholder="2,5" /></Field>
        <Field label="Taux horaire" hint={rate ? `Par défaut : ${formatMoney(rate)}` : undefined}><input inputMode="numeric" {...f.bind('rate')} /></Field>
        <Field label="Travail effectué" span={2}><input {...f.bind('description')} placeholder="Installation et configuration du routeur" /></Field>
        <Field label="Tâche"><select {...f.bind('task_id')}><option value="">—</option>{tasks.filter((k) => k.status !== 'termine').map((k) => <option key={k.id} value={k.id}>{k.title}</option>)}</select></Field>
      </div>
      <label className="inline check"><input type="checkbox" checked={!!f.values.billable} onChange={(e) => f.set('billable', e.target.checked)} /> Facturable au client</label>
    </Modal>
  )
}
