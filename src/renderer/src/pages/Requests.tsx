// Expressions de besoin : un collaborateur exprime un besoin d'achat ; il est visé par son
// responsable, validé par les finances, puis transformé en bon de commande par les achats.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle, ClipboardText, Eye, FlagBanner, HourglassMedium, PaperPlaneTilt, PencilSimple, Plus, ShoppingCart, Trash, X, SealCheck } from '@phosphor-icons/react'
import { formatDate, formatMoney, todayISO } from '@shared/format'
import { REQUEST_PRIORITIES, REQUEST_STATUS, REQUEST_STEPS, stepIndex, type RequestPriority, type RequestStatus } from '@shared/workflow'
import { api, run, useQuery } from '../api'
import { KpiStrip } from '../components/KpiStrip'
import { confirmDialog, Empty, ErrorBox, Field, Loading, Modal, PageHeader, RowActions, SearchInput, Tabs, useForm } from '../components/ui'
import { DecideModal, WfBadge, WfSteps, WfTimeline } from '../components/Workflow'
import { useSession } from '../session'

type Filter = '' | RequestStatus
const emptyLine = () => ({ product_id: '', description: '', quantity: '1', unit: '', unit_price: '' })
const blank = () => ({ title: '', department: '', priority: 'normale', needed_by: '', justification: '', lines: [emptyLine()] })
const n = (v: unknown) => Number(String(v ?? '').replace(/\s/g, '').replace(',', '.')) || 0

export function RequestsPage() {
  const { user } = useSession()
  const [status, setStatus] = useState<Filter>('')
  const [search, setSearch] = useState('')
  const { data, error, loading, reload } = useQuery<any>('requests.list', { status, search }, [status, search])
  const [editing, setEditing] = useState<any | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const rows: any[] = data?.rows ?? []
  const rights = data?.rights ?? { approve: false, finance: false, order: false, all: false }
  const count = (s: RequestStatus) => data?.counts?.find((c: any) => c.status === s) ?? { n: 0, total: 0 }
  const waiting = count('soumise').n + count('approuvee').n

  return (
    <div className="page">
      <PageHeader
        title="Expressions de besoin"
        subtitle={rights.all ? 'Demandes d’achat de l’entreprise : visa du responsable, validation financière, commande.' : 'Exprimez un besoin d’achat et suivez sa validation jusqu’à la commande.'}
        actions={<button className="btn btn-primary" onClick={() => setEditing(blank())}><Plus size={18} aria-hidden="true" />Nouvelle expression de besoin</button>}
      />
      <KpiStrip items={[
        { label: 'En attente de validation', value: waiting, icon: HourglassMedium, tone: 'bad' },
        { label: 'À commander', value: count('validee').n, icon: ShoppingCart, hint: formatMoney(count('validee').total) },
        { label: 'Commandées', value: count('commandee').n, icon: ClipboardText },
        { label: 'Clôturées', value: count('cloturee').n, icon: SealCheck, tone: 'good' }
      ]} />
      <div className="toolbar">
        <Tabs<Filter> value={status} onChange={setStatus} tabs={[{ value: '', label: 'Toutes' }, ...(Object.keys(REQUEST_STATUS) as RequestStatus[]).map((s) => ({ value: s, label: REQUEST_STATUS[s].label }))]} />
        <SearchInput value={search} onChange={setSearch} placeholder="Objet, service, numéro…" />
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Loading /> : rows.length === 0 ? (
        <Empty>Aucune expression de besoin{status ? ' dans cet état' : ''}. Cliquez sur « Nouvelle expression de besoin ».</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Besoin</th><th>Service</th><th>Priorité</th><th>Souhaité pour le</th><th className="num">Estimation</th><th>État</th><th className="actions-col">Actions</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => setOpenId(r.id)}>
                  <td className="strong">{r.title}<div className="muted small">{r.number ?? 'Brouillon'} · {r.user_name} · {r.lines} ligne(s){r.document_number ? ` · ${r.document_number}` : ''}</div></td>
                  <td>{r.department || '—'}</td>
                  <td><span className={`wf-prio p-${r.priority}`}><FlagBanner size={15} weight="fill" aria-hidden="true" />{REQUEST_PRIORITIES[r.priority as RequestPriority] ?? r.priority}</span></td>
                  <td className={r.needed_by && r.needed_by < todayISO() && !['cloturee', 'rejetee', 'commandee'].includes(r.status) ? 'text-warn strong' : ''}>{r.needed_by ? formatDate(r.needed_by) : '—'}</td>
                  <td className="num money">{r.total ? formatMoney(r.total) : '—'}</td>
                  <td><WfBadge {...REQUEST_STATUS[r.status as RequestStatus]} /></td>
                  <td className="actions-col">
                    <RowActions actions={[
                      { label: 'Ouvrir', icon: Eye, onClick: () => setOpenId(r.id) },
                      { label: 'Modifier', icon: PencilSimple, hidden: !(r.user_id === user.id && (r.status === 'brouillon' || r.status === 'rejetee')), onClick: async () => setEditing(await api('requests.get', { id: r.id })) },
                      { label: 'Supprimer', icon: Trash, tone: 'danger', hidden: !(r.user_id === user.id && (r.status === 'brouillon' || r.status === 'rejetee')), onClick: async () => { if (await confirmDialog(`Supprimer « ${r.title} » ?`, { danger: true })) if (await run(() => api('requests.delete', { id: r.id }), 'Demande supprimée.')) reload() } }
                    ]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <RequestForm initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
      {openId && <RequestDetail id={openId} onClose={() => setOpenId(null)} onChanged={reload} onEdit={(r) => { setOpenId(null); setEditing(r) }} />}
    </div>
  )
}

function RequestForm({ initial, onClose, onSaved }: { initial: any; onClose: () => void; onSaved: () => void }) {
  const f = useForm<any>({ ...blank(), ...initial, needed_by: initial.needed_by ?? '' })
  const [lines, setLines] = useState<any[]>((initial.lines?.length ? initial.lines : [emptyLine()]).map((l: any) => ({ ...l, product_id: l.product_id ? String(l.product_id) : '', quantity: String(l.quantity ?? '1'), unit_price: l.unit_price ? String(l.unit_price) : '' })))
  const products = useQuery<any[]>('products.list', {})
  const [busy, setBusy] = useState(false)
  const setLine = (i: number, patch: any) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)))
  const pick = (i: number, id: string) => {
    const p = products.data?.find((x) => String(x.id) === id)
    setLine(i, p ? { product_id: id, description: p.name, unit: p.unit ?? '', unit_price: String(p.purchase_price || '') } : { product_id: '' })
  }
  const total = lines.reduce((s, l) => s + n(l.quantity) * n(l.unit_price), 0)
  const save = async (submit: boolean) => {
    setBusy(true)
    const r = await run(() => api('requests.save', { ...f.values, id: initial.id, lines, submit }), submit ? 'Expression de besoin envoyée à votre responsable.' : 'Brouillon enregistré.')
    setBusy(false)
    if (r) onSaved()
  }
  return (
    <Modal title={initial.id ? 'Modifier l’expression de besoin' : 'Nouvelle expression de besoin'} onClose={onClose} wide footer={<>
      <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Annuler</button>
      <button className="btn" onClick={() => save(false)} disabled={busy}>Enregistrer le brouillon</button>
      <button className="btn btn-primary" onClick={() => save(true)} disabled={busy}><PaperPlaneTilt size={18} aria-hidden="true" />Envoyer pour visa</button>
    </>}>
      {initial.status === 'rejetee' && initial.rejected_reason && <p className="wf-reject" role="alert"><strong>Rejetée :</strong> {initial.rejected_reason}. Corrigez puis renvoyez.</p>}
      <div className="grid grid-4">
        <Field label="Objet du besoin" span={2}><input autoFocus {...f.bind('title')} placeholder="Ordinateurs pour le service commercial" /></Field>
        <Field label="Service demandeur"><input {...f.bind('department')} placeholder="Commercial, Technique…" /></Field>
        <Field label="Priorité"><select {...f.bind('priority')}>{(Object.keys(REQUEST_PRIORITIES) as RequestPriority[]).map((p) => <option key={p} value={p}>{REQUEST_PRIORITIES[p]}</option>)}</select></Field>
        <Field label="Souhaité pour le"><input type="date" {...f.bind('needed_by')} /></Field>
        <Field label="Justification" span={3} hint="Pourquoi ce besoin ? Le responsable et les finances le liront avant de décider."><textarea rows={2} {...f.bind('justification')} /></Field>
      </div>
      <div className="table-wrap wf-lines">
        <table className="table compact">
          <thead><tr><th style={{ width: '24%' }}>Article (facultatif)</th><th>Désignation</th><th className="num" style={{ width: 90 }}>Qté</th><th style={{ width: 90 }}>Unité</th><th className="num" style={{ width: 130 }}>Prix estimé</th><th className="num" style={{ width: 120 }}>Total</th><th style={{ width: 44 }}></th></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td><select value={l.product_id} onChange={(e) => pick(i, e.target.value)} aria-label="Article"><option value="">Ligne libre</option>{(products.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></td>
                <td><input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} aria-label="Désignation" /></td>
                <td><input className="num" inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} aria-label="Quantité" /></td>
                <td><input value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} aria-label="Unité" /></td>
                <td><input className="num" inputMode="decimal" value={l.unit_price} onChange={(e) => setLine(i, { unit_price: e.target.value })} aria-label="Prix unitaire estimé" /></td>
                <td className="num money">{formatMoney(n(l.quantity) * n(l.unit_price))}</td>
                <td><button type="button" className="ra-btn ra-danger" aria-label="Retirer la ligne" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}><X size={16} aria-hidden="true" /></button></td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={5}><button type="button" className="btn btn-sm" onClick={() => setLines((ls) => [...ls, emptyLine()])}>+ Ajouter une ligne</button></td><td className="num strong">{formatMoney(total)}</td><td></td></tr></tfoot>
        </table>
      </div>
    </Modal>
  )
}

function RequestDetail({ id, onClose, onChanged, onEdit }: { id: number; onClose: () => void; onChanged: () => void; onEdit: (r: any) => void }) {
  const { user } = useSession()
  const nav = useNavigate()
  const { data: r, error, reload } = useQuery<any>('requests.get', { id }, [id])
  const [deciding, setDeciding] = useState(false)
  const [ordering, setOrdering] = useState(false)
  const done = () => { reload(); onChanged() }
  if (error) return <Modal title="Expression de besoin" onClose={onClose}><ErrorBox error={error} /></Modal>
  if (!r) return <Modal title="Expression de besoin" onClose={onClose}><Loading /></Modal>
  const mine = r.user_id === user.id
  const editable = mine && (r.status === 'brouillon' || r.status === 'rejetee')
  const canDecide = (r.status === 'soumise' && r.rights.approve) || (r.status === 'approuvee' && r.rights.finance)
  const act = async (name: string, args: any, msg: string) => { if (await run(() => api(name, args), msg)) done() }
  return (
    <Modal title={`${r.number ?? 'Brouillon'} — ${r.title}`} onClose={onClose} wide footer={<>
      <button className="btn btn-ghost" onClick={onClose}>Fermer</button>
      {editable && <button className="btn" onClick={() => onEdit(r)}><PencilSimple size={18} aria-hidden="true" />Modifier</button>}
      {mine && r.status === 'brouillon' && <button className="btn btn-primary" onClick={() => act('requests.submit', { id }, 'Expression de besoin envoyée à votre responsable.')}><PaperPlaneTilt size={18} aria-hidden="true" />Envoyer pour visa</button>}
      {canDecide && <button className="btn btn-primary" onClick={() => setDeciding(true)}><CheckCircle size={18} aria-hidden="true" />{r.status === 'soumise' ? 'Viser ou rejeter' : 'Valider ou rejeter'}</button>}
      {r.rights.order && r.status === 'validee' && <button className="btn btn-primary" onClick={() => setOrdering(true)}><ShoppingCart size={18} aria-hidden="true" />Créer le bon de commande</button>}
      {r.document && <button className="btn" onClick={() => nav(`/doc/${r.document.id}`)}><ClipboardText size={18} aria-hidden="true" />Ouvrir {r.document.number ?? 'le bon de commande'}</button>}
      {r.rights.order && r.status === 'commandee' && <button className="btn btn-primary" onClick={async () => { if (await confirmDialog('Clôturer cette demande ?', { detail: 'À faire quand la commande est reçue : le besoin est satisfait.' })) act('requests.close', { id }, 'Demande clôturée.') }}><SealCheck size={18} aria-hidden="true" />Clôturer</button>}
    </>}>
      <WfSteps steps={REQUEST_STEPS} current={r.status === 'cloturee' ? REQUEST_STEPS.length : stepIndex(REQUEST_STEPS, r.status)} rejected={r.status === 'rejetee'} />
      {r.status === 'rejetee' && <p className="wf-reject" role="alert"><strong>Rejetée :</strong> {r.rejected_reason}</p>}
      <dl className="wf-facts">
        <div><dt>Estimation</dt><dd className="big">{r.total ? formatMoney(r.total) : 'Non chiffrée'}</dd></div>
        <div><dt>État</dt><dd><WfBadge {...REQUEST_STATUS[r.status as RequestStatus]} /></dd></div>
        <div><dt>Demandeur</dt><dd>{r.user_name}{r.department ? <small>{r.department}</small> : null}</dd></div>
        <div><dt>Priorité</dt><dd><span className={`wf-prio p-${r.priority}`}><FlagBanner size={15} weight="fill" aria-hidden="true" />{REQUEST_PRIORITIES[r.priority as RequestPriority] ?? r.priority}</span></dd></div>
        <div><dt>Demandée le</dt><dd>{formatDate(r.date)}</dd></div>
        <div><dt>Souhaitée pour le</dt><dd>{r.needed_by ? formatDate(r.needed_by) : '—'}</dd></div>
        {r.justification && <div className="wide"><dt>Justification</dt><dd>{r.justification}</dd></div>}
      </dl>
      <div className="table-wrap">
        <table className="table compact">
          <thead><tr><th>Désignation</th><th className="num">Qté</th><th>Unité</th><th className="num">Prix estimé</th><th className="num">Total</th></tr></thead>
          <tbody>{r.lines.map((l: any, i: number) => <tr key={i}><td>{l.description}</td><td className="num">{l.quantity}</td><td>{l.unit}</td><td className="num">{l.unit_price ? formatMoney(l.unit_price) : '—'}</td><td className="num money">{formatMoney(l.quantity * l.unit_price)}</td></tr>)}</tbody>
        </table>
      </div>
      <h4 className="wf-h">Historique</h4>
      <WfTimeline events={r.events} />
      {deciding && <DecideModal title={`${r.number} — ${r.status === 'soumise' ? 'visa du responsable' : 'validation financière'}`} approveLabel={r.status === 'soumise' ? 'Donner mon visa' : 'Valider'} onClose={() => setDeciding(false)}
        onDecide={async (approve, comment) => { if (await run(() => api('requests.decide', { id, approve, comment }), approve ? (r.status === 'soumise' ? 'Visa donné : la demande passe aux finances.' : 'Demande validée : elle est à commander.') : 'Demande rejetée.')) { setDeciding(false); done() } }} />}
      {ordering && <OrderModal id={id} number={r.number} onClose={() => setOrdering(false)} onDone={(docId) => { setOrdering(false); done(); nav(`/doc/${docId}`) }} />}
    </Modal>
  )
}

function OrderModal({ id, number, onClose, onDone }: { id: number; number: string; onClose: () => void; onDone: (docId: number) => void }) {
  const suppliers = useQuery<any[]>('requests.suppliers')
  const [supplier, setSupplier] = useState('')
  const go = async () => {
    const r = await run(() => api<{ document_id: number }>('requests.order', { id, supplier_id: Number(supplier) }), 'Bon de commande créé en brouillon : complétez les prix puis validez-le.')
    if (r) onDone(r.document_id)
  }
  return (
    <Modal title={`Commander ${number}`} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={!supplier} onClick={go}><ShoppingCart size={18} aria-hidden="true" />Créer le bon de commande</button></>}>
      <Field label="Fournisseur" hint="Les lignes de la demande sont reprises dans un bon de commande en brouillon, que vous complétez avant de le valider.">
        <select autoFocus value={supplier} onChange={(e) => setSupplier(e.target.value)}><option value="">Choisir…</option>{(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      </Field>
      {suppliers.data?.length === 0 && <p className="muted small">Aucun fournisseur : créez-le d'abord dans Achats → Fournisseurs.</p>}
    </Modal>
  )
}
