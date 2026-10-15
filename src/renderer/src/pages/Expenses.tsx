// Dépenses de l'entreprise : saisie par chacun, approbation par le responsable, paiement par
// les finances (l'écriture comptable est passée au paiement).

import { useMemo, useState } from 'react'
import { CheckCircle, Coins, HourglassMedium, Paperclip, PaperPlaneTilt, PencilSimple, Plus, Printer, Receipt, Trash, Wallet, ArrowCounterClockwise, Eye } from '@phosphor-icons/react'
import { PAYMENT_METHODS } from '@shared/domain'
import { formatDate, formatMoney, todayISO } from '@shared/format'
import { EXPENSE_CATEGORIES, EXPENSE_STATUS, EXPENSE_STEPS, stepIndex, type ExpenseCategory, type ExpenseStatus } from '@shared/workflow'
import { api, run, unwrap, useQuery } from '../api'
import { BarList } from '../components/charts'
import { expenseHtml } from '../components/workflowPrint'
import { KpiStrip } from '../components/KpiStrip'
import { confirmDialog, Empty, ErrorBox, Field, Loading, Modal, PageHeader, RowActions, SearchInput, Tabs, useForm } from '../components/ui'
import { DecideModal, WfBadge, WfSteps, WfTimeline } from '../components/Workflow'
import { useSession } from '../session'

type Filter = '' | ExpenseStatus
const blank = () => ({ date: todayISO(), category: 'transport', label: '', amount: '', method: 'Espèces', beneficiary: '', notes: '', project_id: '', receipt: undefined as string | undefined })

export function ExpensesPage() {
  const { user } = useSession()
  const [status, setStatus] = useState<Filter>('')
  const [search, setSearch] = useState('')
  const { data, error, loading, reload } = useQuery<any>('expenses.list', { status, search }, [status, search])
  const [editing, setEditing] = useState<any | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const rows: any[] = data?.rows ?? []
  const rights = data?.rights ?? { approve: false, pay: false, all: false }
  const t = data?.totals ?? { paid_month: 0, to_approve: 0, n_approve: 0, to_pay: 0, n_pay: 0 }
  const cats = useMemo(() => (data?.byCategory ?? []).map((c: any) => ({ label: EXPENSE_CATEGORIES[c.category as ExpenseCategory]?.label ?? c.category, value: c.total })), [data])

  return (
    <div className="page">
      <PageHeader
        title="Dépenses"
        subtitle={rights.all ? 'Toutes les dépenses de l’entreprise : approbation, paiement, comptabilisation.' : 'Vos dépenses : saisissez-les, joignez le justificatif et suivez leur validation.'}
        actions={<button className="btn btn-primary" onClick={() => setEditing(blank())}><Plus size={18} aria-hidden="true" />Nouvelle dépense</button>}
      />
      <KpiStrip items={[
        { label: 'Payées ce mois', value: t.paid_month, icon: Coins, money: true },
        { label: 'À approuver', value: t.to_approve, icon: HourglassMedium, money: true, tone: 'bad', hint: `${t.n_approve} dépense(s)` },
        { label: 'À payer', value: t.to_pay, icon: Wallet, money: true, tone: 'bad', hint: `${t.n_pay} dépense(s)` },
        { label: 'Dépenses affichées', value: rows.length, icon: Receipt }
      ]} />
      {cats.length > 0 && (
        <div className="card">
          <h3>Dépenses payées de l'année, par catégorie</h3>
          <BarList items={cats} format={formatMoney} />
        </div>
      )}
      <div className="toolbar">
        <Tabs<Filter> value={status} onChange={setStatus} tabs={[{ value: '', label: 'Toutes' }, ...(Object.keys(EXPENSE_STATUS) as ExpenseStatus[]).map((s) => ({ value: s, label: EXPENSE_STATUS[s].label }))]} />
        <SearchInput value={search} onChange={setSearch} placeholder="Objet, bénéficiaire, numéro…" />
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Loading /> : rows.length === 0 ? (
        <Empty>Aucune dépense{status ? ' dans cet état' : ''}. Cliquez sur « Nouvelle dépense » pour en saisir une.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Dépense</th><th>Catégorie</th><th>Date</th>{rights.all && <th>Demandeur</th>}<th className="num">Montant</th><th>État</th><th className="actions-col">Actions</th></tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="clickable" onClick={() => setOpenId(e.id)}>
                  <td className="strong">{e.label}{e.has_receipt && <Paperclip size={15} aria-label="Justificatif joint" className="inline-icon" />}<div className="muted small">{e.number ?? 'Brouillon'}{e.beneficiary ? ` · ${e.beneficiary}` : ''}</div></td>
                  <td>{EXPENSE_CATEGORIES[e.category as ExpenseCategory]?.label ?? e.category}</td>
                  <td>{formatDate(e.date)}</td>
                  {rights.all && <td>{e.user_name}</td>}
                  <td className="num money">{formatMoney(e.amount)}</td>
                  <td><WfBadge {...EXPENSE_STATUS[e.status as ExpenseStatus]} /></td>
                  <td className="actions-col">
                    <RowActions actions={[
                      { label: 'Ouvrir', icon: Eye, onClick: () => setOpenId(e.id) },
                      { label: 'Modifier', icon: PencilSimple, hidden: !(e.user_id === user.id && (e.status === 'brouillon' || e.status === 'rejetee')), onClick: async () => setEditing(await api('expenses.get', { id: e.id })) },
                      { label: 'Supprimer', icon: Trash, tone: 'danger', hidden: !(e.user_id === user.id && (e.status === 'brouillon' || e.status === 'rejetee')), onClick: async () => { if (await confirmDialog(`Supprimer « ${e.label} » ?`, { danger: true })) if (await run(() => api('expenses.delete', { id: e.id }), 'Dépense supprimée.')) reload() } }
                    ]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <ExpenseForm initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
      {openId && <ExpenseDetail id={openId} rights={rights} onClose={() => setOpenId(null)} onChanged={reload} onEdit={(e) => { setOpenId(null); setEditing(e) }} />}
    </div>
  )
}

function ExpenseForm({ initial, onClose, onSaved }: { initial: any; onClose: () => void; onSaved: () => void }) {
  const f = useForm<any>({ ...blank(), ...initial, amount: initial.amount ? String(initial.amount) : '', project_id: initial.project_id ? String(initial.project_id) : '', receipt: undefined })
  const projects = useQuery<any[]>('projects.options')
  const [busy, setBusy] = useState(false)
  const hadReceipt = !!initial.receipt
  const attach = async () => {
    const img = await run(() => unwrap<string | null>(window.erp.pickImage()))
    if (img) f.set('receipt', img)
  }
  const save = async (submit: boolean) => {
    setBusy(true)
    const r = await run(() => api('expenses.save', { ...f.values, id: initial.id, project_id: f.values.project_id || null, submit }), submit ? 'Dépense envoyée en approbation.' : 'Dépense enregistrée en brouillon.')
    setBusy(false)
    if (r) onSaved()
  }
  return (
    <Modal title={initial.id ? 'Modifier la dépense' : 'Nouvelle dépense'} onClose={onClose} wide footer={<>
      <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Annuler</button>
      <button className="btn" onClick={() => save(false)} disabled={busy}>Enregistrer le brouillon</button>
      <button className="btn btn-primary" onClick={() => save(true)} disabled={busy}><PaperPlaneTilt size={18} aria-hidden="true" />Envoyer en approbation</button>
    </>}>
      {initial.status === 'rejetee' && initial.rejected_reason && <p className="wf-reject" role="alert"><strong>Rejetée :</strong> {initial.rejected_reason}. Corrigez puis renvoyez.</p>}
      <div className="grid grid-4">
        <Field label="Objet de la dépense" span={2}><input autoFocus {...f.bind('label')} placeholder="Taxi pour livraison client, recharge téléphone…" /></Field>
        <Field label="Catégorie"><select {...f.bind('category')}>{(Object.keys(EXPENSE_CATEGORIES) as ExpenseCategory[]).map((c) => <option key={c} value={c}>{EXPENSE_CATEGORIES[c].label}</option>)}</select></Field>
        <Field label="Date"><input type="date" {...f.bind('date')} /></Field>
        <Field label="Montant TTC"><input inputMode="decimal" {...f.bind('amount')} placeholder="0" /></Field>
        <Field label="Payée par"><select {...f.bind('method')}>{PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}</select></Field>
        <Field label="Bénéficiaire ou fournisseur" span={2}><input {...f.bind('beneficiary')} placeholder="Station Total, ONEA, SONABEL…" /></Field>
        <Field label="Projet ou chantier (facultatif)" span={2}><select {...f.bind('project_id')}><option value="">Aucun</option>{(projects.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code} · ` : ''}{p.name}</option>)}</select></Field>
        <Field label="Justificatif" span={2} hint="Photo du reçu ou de la facture (2 Mo au plus).">
          <div className="row gap wrap">
            <button type="button" className="btn" onClick={attach}><Paperclip size={18} aria-hidden="true" />{f.values.receipt || hadReceipt ? 'Remplacer le justificatif' : 'Joindre un justificatif'}</button>
            {(f.values.receipt || hadReceipt) && <span className="badge badge-valide">{f.values.receipt ? 'Nouveau justificatif prêt' : 'Justificatif joint'}</span>}
          </div>
        </Field>
        <Field label="Observations" span={4}><textarea rows={2} {...f.bind('notes')} /></Field>
      </div>
    </Modal>
  )
}

function ExpenseDetail({ id, rights, onClose, onChanged, onEdit }: { id: number; rights: { approve: boolean; pay: boolean }; onClose: () => void; onChanged: () => void; onEdit: (e: any) => void }) {
  const { user } = useSession()
  const { data: e, error, reload } = useQuery<any>('expenses.get', { id }, [id])
  const [deciding, setDeciding] = useState(false)
  const [paying, setPaying] = useState(false)
  const [pay, setPay] = useState({ date: todayISO(), method: '' })
  const [showReceipt, setShowReceipt] = useState(false)
  const { company } = useSession()
  const done = () => { reload(); onChanged() }
  if (error) return <Modal title="Dépense" onClose={onClose}><ErrorBox error={error} /></Modal>
  if (!e) return <Modal title="Dépense" onClose={onClose}><Loading /></Modal>
  const mine = e.user_id === user.id
  const editable = mine && (e.status === 'brouillon' || e.status === 'rejetee')
  const act = async (name: string, args: any, msg: string) => { if (await run(() => api(name, args), msg)) done() }
  return (
    <Modal title={`${e.number ?? 'Dépense en brouillon'} — ${e.label}`} onClose={onClose} wide footer={<>
      <button className="btn btn-ghost" onClick={onClose}>Fermer</button>
      {editable && <button className="btn" onClick={() => onEdit(e)}><PencilSimple size={18} aria-hidden="true" />Modifier</button>}
      {mine && e.status === 'brouillon' && <button className="btn btn-primary" onClick={() => act('expenses.submit', { id }, 'Dépense envoyée en approbation.')}><PaperPlaneTilt size={18} aria-hidden="true" />Envoyer en approbation</button>}
      <button className="btn" onClick={() => run(() => unwrap(window.erp.printHtml(expenseHtml(company, e), `Pièce de dépense ${e.number ?? 'brouillon'}`)))}><Printer size={18} aria-hidden="true" />Imprimer</button>
      {rights.approve && e.status === 'soumise' && <button className="btn btn-primary" onClick={() => setDeciding(true)}><CheckCircle size={18} aria-hidden="true" />Approuver ou rejeter</button>}
      {rights.pay && e.status === 'approuvee' && <button className="btn btn-primary" onClick={() => { setPay({ date: todayISO(), method: e.method }); setPaying(true) }}><Wallet size={18} aria-hidden="true" />Payer</button>}
      {user.role === 'admin' && e.status === 'payee' && <button className="btn" onClick={async () => { if (await confirmDialog('Annuler le paiement de cette dépense ?', { detail: "L'écriture comptable sera retirée et la dépense reviendra « à payer ».", danger: true })) act('expenses.unpay', { id }, 'Paiement annulé.') }}><ArrowCounterClockwise size={18} aria-hidden="true" />Annuler le paiement</button>}
    </>}>
      <WfSteps steps={EXPENSE_STEPS} current={e.status === 'payee' ? EXPENSE_STEPS.length : stepIndex(EXPENSE_STEPS, e.status)} rejected={e.status === 'rejetee'} />
      {e.status === 'rejetee' && <p className="wf-reject" role="alert"><strong>Rejetée :</strong> {e.rejected_reason}</p>}
      <dl className="wf-facts">
        <div><dt>Montant</dt><dd className="big">{formatMoney(e.amount)}</dd></div>
        <div><dt>État</dt><dd><WfBadge {...EXPENSE_STATUS[e.status as ExpenseStatus]} /></dd></div>
        <div><dt>Catégorie</dt><dd>{EXPENSE_CATEGORIES[e.category as ExpenseCategory]?.label ?? e.category}<small>Compte {EXPENSE_CATEGORIES[e.category as ExpenseCategory]?.account}</small></dd></div>
        <div><dt>Date</dt><dd>{formatDate(e.date)}</dd></div>
        <div><dt>Demandeur</dt><dd>{e.user_name}</dd></div>
        <div><dt>Mode de paiement</dt><dd>{e.method}{e.paid_at ? <small>Payée le {formatDate(e.paid_at)}</small> : null}</dd></div>
        {e.beneficiary && <div><dt>Bénéficiaire</dt><dd>{e.beneficiary}</dd></div>}
        {e.notes && <div className="wide"><dt>Observations</dt><dd>{e.notes}</dd></div>}
      </dl>
      {e.receipt && (
        <div className="wf-receipt">
          <button type="button" className="btn btn-sm" onClick={() => setShowReceipt(!showReceipt)}><Paperclip size={16} aria-hidden="true" />{showReceipt ? 'Masquer le justificatif' : 'Voir le justificatif'}</button>
          {showReceipt && (e.receipt.startsWith('data:image/') ? <img src={e.receipt} alt="Justificatif de la dépense" /> : <p className="muted small">Justificatif au format PDF joint.</p>)}
        </div>
      )}
      <h4 className="wf-h">Historique</h4>
      <WfTimeline events={e.events} />
      {deciding && <DecideModal title={`Dépense ${e.number}`} approveLabel="Approuver" onClose={() => setDeciding(false)} onDecide={async (approve, comment) => { if (await run(() => api('expenses.decide', { id, approve, comment }), approve ? 'Dépense approuvée : elle est à payer.' : 'Dépense rejetée.')) { setDeciding(false); done() } }} />}
      {paying && (
        <Modal title={`Payer ${e.number}`} onClose={() => setPaying(false)} footer={<><button className="btn btn-ghost" onClick={() => setPaying(false)}>Annuler</button><button className="btn btn-primary" onClick={async () => { if (await run(() => api('expenses.pay', { id, ...pay }), 'Dépense payée et comptabilisée.')) { setPaying(false); done() } }}>Confirmer le paiement de {formatMoney(e.amount)}</button></>}>
          <div className="grid grid-2">
            <Field label="Date du paiement"><input type="date" value={pay.date} onChange={(ev) => setPay({ ...pay, date: ev.target.value })} /></Field>
            <Field label="Mode de paiement"><select value={pay.method} onChange={(ev) => setPay({ ...pay, method: ev.target.value })}>{PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}</select></Field>
          </div>
          <p className="muted small">L'écriture est passée automatiquement : débit du compte de charge de la catégorie, crédit de la caisse, du mobile money ou de la banque.</p>
        </Modal>
      )}
    </Modal>
  )
}
