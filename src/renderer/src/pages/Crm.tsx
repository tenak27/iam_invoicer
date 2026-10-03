import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarBlank, CaretRight, ChatsCircle, CheckCircle, Circle, FileText, Phone, Plus, Target, Trophy, UsersThree, type Icon } from '@phosphor-icons/react'
import { formatDate, formatMoney, formatNumber } from '@shared/format'
import { api, run, useQuery } from '../api'
import { Empty, ErrorBox, Field, Loading, Modal, PageHeader, SearchInput, useForm } from '../components/ui'
import { useCan } from '../session'

const STAGES: { id: string; label: string; tone: string }[] = [
  { id: 'nouveau', label: 'Nouveau', tone: 'secondary' },
  { id: 'qualifie', label: 'Qualifié', tone: 'info' },
  { id: 'proposition', label: 'Proposition', tone: 'primary' },
  { id: 'negociation', label: 'Négociation', tone: 'warning' },
  { id: 'gagne', label: 'Gagné', tone: 'success' },
  { id: 'perdu', label: 'Perdu', tone: 'danger' }
]
const ACTIVITY: Record<string, { label: string; icon: Icon }> = {
  appel: { label: 'Appel', icon: Phone },
  reunion: { label: 'Réunion', icon: UsersThree },
  email: { label: 'E-mail', icon: ChatsCircle },
  visite: { label: 'Visite', icon: Target },
  note: { label: 'Note', icon: FileText },
  tache: { label: 'Tâche', icon: CheckCircle }
}
const today = () => new Date().toISOString().slice(0, 10)

export function CrmPage() {
  const [search, setSearch] = useState('')
  const { data, error, loading, reload } = useQuery<any[]>('crm.list', { search })
  const { data: pipe, reload: reloadPipe } = useQuery<any>('crm.pipeline')
  const { data: agenda, reload: reloadAgenda } = useQuery<any[]>('crm.agenda', {})
  const [open, setOpen] = useState<any | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [losing, setLosing] = useState<number | null>(null)
  const refresh = () => {
    reload()
    reloadPipe()
    reloadAgenda()
  }
  const move = async (id: number, stage: string) => {
    if (stage === 'perdu') return setLosing(id)
    if (await run(() => api('crm.move', { id, stage }))) refresh()
  }
  const rows = data ?? []
  return (
    <div className="page">
      <PageHeader title="CRM" subtitle="Prospects, opportunités et suivi commercial."
        actions={<button className="btn btn-primary" onClick={() => setOpen({})}><Plus size={18} aria-hidden="true" />Nouvelle opportunité</button>} />
      {pipe && (
        <div className="kpi-row">
          <div className="mini-kpi"><span>Opportunités en cours</span><strong>{pipe.open.n}</strong></div>
          <div className="mini-kpi"><span>Montant en jeu</span><strong>{formatMoney(pipe.open.amount)}</strong></div>
          <div className="mini-kpi"><span>Prévision pondérée</span><strong>{formatMoney(pipe.open.weighted)}</strong></div>
          <div className="mini-kpi"><span>Taux de réussite</span><strong>{pipe.winRate === null ? '—' : `${pipe.winRate} %`}</strong></div>
        </div>
      )}
      <div className="toolbar"><SearchInput value={search} onChange={setSearch} placeholder="Opportunité, client, contact…" /></div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Loading /> : (
        <div className="kanban" role="list" aria-label="Pipeline commercial">
          {STAGES.map((s) => {
            const items = rows.filter((o) => o.stage === s.id)
            return (
              <section
                key={s.id}
                className={`kanban-col ${over === s.id ? 'drop' : ''}`}
                aria-label={s.label}
                onDragOver={(e) => { e.preventDefault(); setOver(s.id) }}
                onDragLeave={() => setOver(null)}
                onDrop={(e) => { e.preventDefault(); setOver(null); if (dragging) move(dragging, s.id); setDragging(null) }}
              >
                <header className={`kanban-head tone-${s.tone}`}>
                  <strong>{s.label}</strong><span className="pill">{items.length}</span>
                  <span className="muted small">{formatMoney(items.reduce((t, o) => t + o.amount, 0))}</span>
                </header>
                <div className="kanban-list">
                  {items.map((o) => {
                    const idx = STAGES.findIndex((x) => x.id === o.stage)
                    const next = STAGES[idx + 1]
                    return (
                      <article key={o.id} className={`kanban-card ${dragging === o.id ? 'dragging' : ''}`} draggable role="listitem"
                        onDragStart={() => setDragging(o.id)} onDragEnd={() => setDragging(null)}>
                        <button className="kanban-open" onClick={() => setOpen(o)}>
                          <strong>{o.title}</strong>
                          <span className="muted small">{o.party_name ?? o.prospect_name}{o.contact ? ` · ${o.contact}` : ''}</span>
                          <span className="kanban-amount">{formatMoney(o.amount)}<span className="muted small"> · {o.probability} %</span></span>
                          {o.next_due && <span className={`kanban-due ${o.next_due < today() ? 'late' : ''}`}><CalendarBlank size={14} aria-hidden="true" />{formatDate(o.next_due)}</span>}
                          {o.quote_number && <span className="muted small">Devis {o.quote_number}</span>}
                        </button>
                        {next && o.stage !== 'gagne' && o.stage !== 'perdu' && next.id !== 'perdu' && (
                          <button className="kanban-next" onClick={() => move(o.id, next.id)} aria-label={`Passer « ${o.title} » à l'étape ${next.label}`} title={`Passer à : ${next.label}`}><CaretRight size={16} aria-hidden="true" /></button>
                        )}
                      </article>
                    )
                  })}
                  {items.length === 0 && <p className="kanban-empty">Déposez une opportunité ici</p>}
                </div>
              </section>
            )
          })}
        </div>
      )}
      {agenda && agenda.length > 0 && (
        <div className="card">
          <h3>Agenda commercial</h3>
          <ul className="rows">
            {agenda.slice(0, 8).map((a) => {
              const A = ACTIVITY[a.kind]
              return (
                <li key={a.id} className="clickable" onClick={() => setOpen({ id: a.opportunity_id })}>
                  <span className={`tint tint-sm tint-${a.due_date < today() ? 'danger' : 'info'}`} aria-hidden="true"><A.icon size={18} weight="duotone" /></span>
                  <div className="grow"><b>{a.subject}</b><span>{a.opportunity_title} · {a.who}</span></div>
                  <strong className={a.due_date < today() ? 'text-danger' : ''}>{formatDate(a.due_date)}</strong>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {open && <OpportunityModal o={open} onClose={() => setOpen(null)} onChanged={refresh} />}
      {losing && <LostModal id={losing} onClose={() => setLosing(null)} onDone={() => { setLosing(null); refresh() }} />}
    </div>
  )
}

function LostModal({ id, onClose, onDone }: { id: number; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const save = async () => {
    if (await run(() => api('crm.move', { id, stage: 'perdu', lost_reason: reason }))) onDone()
  }
  return (
    <Modal title="Opportunité perdue" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-danger" onClick={save}>Marquer perdue</button></>}>
      <Field label="Raison" hint="Prix trop élevé, concurrent choisi, projet abandonné…"><input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </Modal>
  )
}

function OpportunityModal({ o, onClose, onChanged }: { o: any; onClose: () => void; onChanged: () => void }) {
  const nav = useNavigate()
  const canSales = useCan('sales')
  const { data: full, reload } = useQuery<any>(o.id ? 'crm.get' : 'crm.clients', o.id ? { id: o.id } : {})
  const { data: clients } = useQuery<any[]>('crm.clients')
  const current = o.id ? full : null
  const f = useForm<any>({})
  useEffect(() => {
    if (o.id && current) f.setValues({ ...current, party_id: current.party_id ?? '', amount: String(current.amount), probability: String(current.probability), expected_date: current.expected_date ?? '' })
    if (!o.id) f.setValues({ title: '', party_id: '', prospect_name: '', contact: '', phone: '', email: '', amount: '0', probability: '', stage: 'nouveau', expected_date: '', source: '', notes: '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.id, current?.id, current?.stage, current?.quote_id])
  const v = f.values
  const [act, setAct] = useState({ kind: 'appel', subject: '', due_date: today() })
  const save = async () => {
    const r = await run(() => api('crm.save', { ...v, id: o.id, amount: Number(String(v.amount).replace(/\s/g, '')) || 0, probability: v.probability === '' ? undefined : Number(v.probability) }), 'Opportunité enregistrée.')
    if (r) {
      onChanged()
      if (!o.id) onClose()
    }
  }
  const addActivity = async () => {
    if (await run(() => api('crm.saveActivity', { opportunity_id: o.id, ...act }), 'Activité ajoutée.')) {
      setAct({ ...act, subject: '' })
      reload()
      onChanged()
    }
  }
  const quote = async () => {
    const r = await run(() => api('crm.createQuote', { id: o.id }), 'Devis créé.')
    if (r) {
      onChanged()
      nav(`/doc/${r.documentId}`)
    }
  }
  if (o.id && !current) return <Modal title="Opportunité" onClose={onClose}><Loading /></Modal>
  return (
    <Modal title={o.id ? v.title : 'Nouvelle opportunité'} wide onClose={onClose} footer={<>
      {o.id && current?.stage !== 'gagne' && <button className="btn btn-tonal" onClick={async () => { if (await run(() => api('crm.move', { id: o.id, stage: 'gagne' }), 'Bravo, opportunité gagnée !')) { reload(); onChanged() } }}><Trophy size={18} aria-hidden="true" />Gagnée</button>}
      {o.id && canSales && !current?.quote_id && <button className="btn" onClick={quote}><FileText size={18} aria-hidden="true" />Créer le devis</button>}
      {current?.quote_id && <button className="btn" onClick={() => nav(`/doc/${current.quote_id}`)}>Voir le devis {current.quote_number ?? ''}</button>}
      <span className="grow" />
      <button className="btn" onClick={onClose}>Fermer</button>
      <button className="btn btn-primary" onClick={save}>Enregistrer</button>
    </>}>
      <div className="grid grid-4">
        <Field label="Intitulé" span={4}><input autoFocus={!o.id} {...f.bind('title')} placeholder="Vidéosurveillance du siège" /></Field>
        <Field label="Client existant" span={2}>
          <select {...f.bind('party_id')}><option value="">— Prospect (pas encore client) —</option>{(clients ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </Field>
        {!v.party_id && <Field label="Nom du prospect" span={2}><input {...f.bind('prospect_name')} /></Field>}
        <Field label="Contact"><input {...f.bind('contact')} /></Field>
        <Field label="Téléphone"><input type="tel" {...f.bind('phone')} /></Field>
        <Field label="E-mail"><input type="email" {...f.bind('email')} /></Field>
        <Field label="Source"><input {...f.bind('source')} placeholder="Recommandation, salon…" /></Field>
        <Field label="Montant TTC estimé"><input inputMode="numeric" {...f.bind('amount')} /></Field>
        <Field label="Étape"><select {...f.bind('stage')}>{STAGES.filter((s) => s.id !== 'perdu' || v.stage === 'perdu').map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></Field>
        <Field label="Probabilité (%)"><input inputMode="numeric" {...f.bind('probability')} placeholder="selon l'étape" /></Field>
        <Field label="Signature prévue"><input type="date" {...f.bind('expected_date')} /></Field>
        <Field label="Notes" span={4}><textarea rows={2} {...f.bind('notes')} /></Field>
      </div>
      {o.id && current && (
        <>
          <h3 className="section-title">Activités</h3>
          <div className="activity-add">
            <select value={act.kind} onChange={(e) => setAct({ ...act, kind: e.target.value })} aria-label="Type d'activité">{Object.entries(ACTIVITY).map(([k, a]) => <option key={k} value={k}>{a.label}</option>)}</select>
            <input value={act.subject} onChange={(e) => setAct({ ...act, subject: e.target.value })} placeholder="Rappeler pour fixer la visite technique…" aria-label="Description" />
            <input type="date" value={act.due_date} onChange={(e) => setAct({ ...act, due_date: e.target.value })} aria-label="Échéance" />
            <button className="btn btn-primary" onClick={addActivity} disabled={!act.subject.trim()}>Ajouter</button>
          </div>
          {current.activities.length === 0 ? <p className="muted">Aucune activité.</p> : (
            <ol className="timeline">
              {current.activities.map((a: any) => {
                const A = ACTIVITY[a.kind]
                return (
                  <li key={a.id} className={a.done ? 'done' : ''}>
                    <button className="tl-check" onClick={async () => { await run(() => api('crm.toggleActivity', { id: a.id })); reload(); onChanged() }} aria-label={a.done ? 'Marquer à faire' : 'Marquer comme fait'}>
                      {a.done ? <CheckCircle size={20} weight="fill" aria-hidden="true" /> : <Circle size={20} aria-hidden="true" />}
                    </button>
                    <div><strong><A.icon size={15} aria-hidden="true" /> {A.label}</strong> — {a.subject}<div className="muted small">{a.due_date ? `Échéance ${formatDate(a.due_date)} · ` : ''}{a.user_name ?? ''} · {formatDate(a.created_at)}</div></div>
                  </li>
                )
              })}
            </ol>
          )}
          {current.lost_reason && <p className="text-danger">Perdue : {current.lost_reason}</p>}
          <p className="muted small">Prévision pondérée : {formatMoney((current.amount * current.probability) / 100)} ({formatNumber(current.probability)} %)</p>
        </>
      )}
    </Modal>
  )
}
