import { useMemo, useState } from 'react'
import { ArrowCounterClockwise, CalendarCheck, CheckCircle, Eye, Money as MoneyIcon, PencilSimple, Printer, Prohibit, Trash, UserPlus, Users, XCircle } from '@phosphor-icons/react'
import { computePayslip, DEFAULT_PAYROLL_PARAMS, workingDays, type PayrollParams } from '@shared/payroll'
import { PAYMENT_METHODS } from '@shared/domain'
import { formatDate, formatMoney, formatNumber, todayISO } from '@shared/format'
import { api, exportCsv, run, unwrap, useQuery } from '../api'
import { confirmDialog, Empty, ErrorBox, Field, Loading, Modal, PageHeader, RowActions, SearchInput, Tabs, useForm } from '../components/ui'

type Tab = 'salaries' | 'paie' | 'conges' | 'parametres'
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const periodLabel = (p: string) => `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`
const LEAVE_LABELS: Record<string, string> = { conge_paye: 'Congé payé', maladie: 'Maladie', sans_solde: 'Sans solde', autre: 'Autre absence' }

export function HrPage() {
  const [tab, setTab] = useState<Tab>('salaries')
  return (
    <div className="page">
      <PageHeader title="Ressources humaines" subtitle="Salariés, paie mensuelle (CNSS, IUTS), congés." />
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'salaries', label: 'Salariés' },
        { value: 'paie', label: 'Paie' },
        { value: 'conges', label: 'Congés' },
        { value: 'parametres', label: 'Paramètres de paie' }
      ]} />
      <div className="tab-panel" key={tab}>
        {tab === 'salaries' && <Employees />}
        {tab === 'paie' && <Payroll />}
        {tab === 'conges' && <Leaves />}
        {tab === 'parametres' && <Params />}
      </div>
    </div>
  )
}

function Employees() {
  const [search, setSearch] = useState('')
  const { data, error, loading, reload } = useQuery<any[]>('hr.employees', { search, includeInactive: true })
  const [editing, setEditing] = useState<any | null>(null)
  const rows = data ?? []
  const mass = rows.filter((e) => e.active).reduce((s, e) => s + e.base_salary + e.housing + e.transport + e.function_allowance + e.other_allowances, 0)
  return (
    <>
      <div className="toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder="Nom, matricule, emploi…" />
        <span className="chip"><Users size={16} aria-hidden="true" />{rows.filter((e) => e.active).length} actif(s) · masse brute <strong>{formatMoney(mass)}</strong></span>
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setEditing({ category: 'non_cadre', hire_date: todayISO(), payment_method: 'Virement' })}><UserPlus size={18} aria-hidden="true" />Nouveau salarié</button>
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Loading /> : rows.length === 0 ? <Empty>Aucun salarié. Ajoutez votre premier salarié pour préparer la paie.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Salarié</th><th>Emploi</th><th>Catégorie</th><th>Embauche</th><th className="num">Salaire de base</th><th className="num">Brut mensuel</th><th className="num">Congés dispo.</th><th className="actions-col">Actions</th></tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className={`clickable ${e.active ? '' : 'inactive'}`} onClick={() => setEditing(e)}>
                  <td><span className="who"><span className="initials hue-2" aria-hidden="true">{e.first_name[0]}{e.last_name[0]}</span><span><span className="strong">{e.first_name} {e.last_name}</span><div className="muted small">{e.matricule}</div></span></span></td>
                  <td>{e.job}<div className="muted small">{e.department}</div></td>
                  <td>{e.category === 'cadre' ? 'Cadre' : 'Non-cadre'}</td>
                  <td>{formatDate(e.hire_date)}</td>
                  <td className="num money">{formatMoney(e.base_salary)}</td>
                  <td className="num money">{formatMoney(e.base_salary + e.housing + e.transport + e.function_allowance + e.other_allowances)}</td>
                  <td className="num">{formatNumber(e.leave_balance, 1)} j</td>
                  <td className="actions-col">
                    <RowActions actions={[
                      { label: 'Modifier', icon: PencilSimple, tone: 'primary', onClick: () => setEditing(e) },
                      e.active
                        ? {
                            label: 'Désactiver', icon: Prohibit, tone: 'danger',
                            onClick: async () => {
                              if (await confirmDialog(`Désactiver ${e.first_name} ${e.last_name} ?`, { detail: 'Le salarié ne sera plus inclus dans les prochaines paies. Ses bulletins sont conservés.' }))
                                if (await run(() => api('hr.saveEmployee', { ...e, active: false }), 'Salarié désactivé.')) reload()
                            }
                          }
                        : { label: 'Réactiver', icon: ArrowCounterClockwise, tone: 'warning', onClick: async () => { if (await run(() => api('hr.saveEmployee', { ...e, active: true }), 'Salarié réactivé.')) reload() } }
                    ]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <EmployeeModal e={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload() }} />}
    </>
  )
}

function EmployeeModal({ e, onClose, onDone }: { e: any; onClose: () => void; onDone: () => void }) {
  const { data: params } = useQuery<PayrollParams>('hr.params')
  const f = useForm<any>(Object.fromEntries(Object.entries({ first_name: '', last_name: '', job: '', department: '', category: 'non_cadre', hire_date: todayISO(), exit_date: '', base_salary: '', housing: '0', transport: '0', function_allowance: '0', other_allowances: '0', family_charges: '0', cnss_number: '', payment_method: 'Virement', bank_account: '', phone: '', email: '', leave_adjust: '0', active: true, ...e }).map(([k, v]) => [k, v === null ? '' : typeof v === 'number' ? String(v) : v])))
  const v = f.values
  const n = (x: string) => Number(String(x).replace(/\s/g, '').replace(',', '.')) || 0
  const preview = useMemo(() => computePayslip({ category: v.category, base_salary: n(v.base_salary), housing: n(v.housing), transport: n(v.transport), function_allowance: n(v.function_allowance), other_allowances: n(v.other_allowances), family_charges: n(v.family_charges) }, params ?? DEFAULT_PAYROLL_PARAMS), [v, params])
  const save = async () => {
    if (await run(() => api('hr.saveEmployee', { ...v, id: e.id }), 'Salarié enregistré.')) onDone()
  }
  return (
    <Modal title={e.id ? `${e.first_name} ${e.last_name}` : 'Nouveau salarié'} wide onClose={onClose} footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" onClick={save}>Enregistrer</button></>}>
      <div className="grid grid-4">
        <Field label="Prénom"><input autoFocus {...f.bind('first_name')} /></Field>
        <Field label="Nom"><input {...f.bind('last_name')} /></Field>
        <Field label="Emploi"><input {...f.bind('job')} /></Field>
        <Field label="Service"><input {...f.bind('department')} /></Field>
        <Field label="Catégorie"><select {...f.bind('category')}><option value="non_cadre">Non-cadre</option><option value="cadre">Cadre</option></select></Field>
        <Field label="Date d'embauche"><input type="date" {...f.bind('hire_date')} /></Field>
        <Field label="Date de sortie"><input type="date" {...f.bind('exit_date')} /></Field>
        <Field label="Charges de famille" hint="Enfants et conjoint à charge"><input inputMode="numeric" {...f.bind('family_charges')} /></Field>
      </div>
      <h3 className="section-title">Rémunération mensuelle</h3>
      <div className="grid grid-4">
        <Field label="Salaire de base"><input inputMode="numeric" {...f.bind('base_salary')} /></Field>
        <Field label="Indemnité de logement"><input inputMode="numeric" {...f.bind('housing')} /></Field>
        <Field label="Indemnité de transport"><input inputMode="numeric" {...f.bind('transport')} /></Field>
        <Field label="Indemnité de fonction"><input inputMode="numeric" {...f.bind('function_allowance')} /></Field>
        <Field label="Autres indemnités"><input inputMode="numeric" {...f.bind('other_allowances')} /></Field>
        <Field label="N° CNSS"><input {...f.bind('cnss_number')} /></Field>
        <Field label="Mode de paiement"><select {...f.bind('payment_method')}>{PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}</select></Field>
        <Field label="Compte / numéro"><input {...f.bind('bank_account')} placeholder="RIB ou numéro mobile money" /></Field>
        <Field label="Téléphone"><input type="tel" {...f.bind('phone')} /></Field>
        <Field label="E-mail"><input type="email" {...f.bind('email')} /></Field>
        <Field label="Ajustement congés (jours)" hint="Report d'un ancien système, ±"><input inputMode="decimal" {...f.bind('leave_adjust')} /></Field>
        {e.id && <label className="inline check" style={{ alignSelf: 'end' }}><input type="checkbox" checked={!!v.active} onChange={(ev) => f.set('active', ev.target.checked)} /> En activité</label>}
      </div>
      <div className="pay-preview">
        <div><span>Brut</span><strong>{formatMoney(preview.gross)}</strong></div>
        <div><span>CNSS salarié</span><strong>−{formatMoney(preview.cnssEmployee)}</strong></div>
        <div><span>IUTS</span><strong>−{formatMoney(preview.iuts)}</strong></div>
        <div className="net"><span>Net estimé</span><strong>{formatMoney(preview.net)}</strong></div>
        <div><span>Coût employeur</span><strong>{formatMoney(preview.employerCost)}</strong></div>
      </div>
    </Modal>
  )
}

function Payroll() {
  const { data, error, loading, reload } = useQuery<any[]>('hr.runs')
  const [open, setOpen] = useState<number | null>(null)
  const [period, setPeriod] = useState(todayISO().slice(0, 7))
  const prepare = async () => {
    const r = await run(() => api('hr.prepareRun', { period }), `Paie de ${periodLabel(period)} préparée.`)
    if (r) {
      reload()
      setOpen(r.id)
    }
  }
  if (open) return <RunDetail id={open} onBack={() => { setOpen(null); reload() }} />
  return (
    <>
      <div className="toolbar">
        <label className="inline">Mois <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></label>
        <button className="btn btn-primary" onClick={prepare}><MoneyIcon size={18} aria-hidden="true" />Préparer la paie</button>
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Loading /> : data!.length === 0 ? <Empty>Aucune paie. Choisissez un mois et cliquez sur « Préparer la paie ».</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Période</th><th>Salariés</th><th className="num">Brut</th><th className="num">Net à payer</th><th className="num">Coût employeur</th><th>État</th><th className="actions-col">Actions</th></tr></thead>
            <tbody>
              {data!.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => setOpen(r.id)}>
                  <td className="strong">{periodLabel(r.period)}</td><td>{r.employees}</td>
                  <td className="num money">{formatMoney(r.gross)}</td><td className="num money">{formatMoney(r.net)}</td><td className="num money">{formatMoney(r.employer_cost)}</td>
                  <td><span className={`badge ${r.status === 'brouillon' ? 'badge-brouillon' : r.paid ? 'pay-payee' : 'badge-valide'}`}>{r.status === 'brouillon' ? 'Brouillon' : r.paid ? 'Payée' : 'Validée'}</span></td>
                  <td className="actions-col">
                    <RowActions actions={[
                      { label: 'Ouvrir la paie', icon: Eye, onClick: () => setOpen(r.id) },
                      {
                        label: 'Supprimer la paie', icon: Trash, tone: 'danger', hidden: r.status !== 'brouillon',
                        onClick: async () => {
                          if (await confirmDialog(`Supprimer la paie de ${periodLabel(r.period)} ?`, { danger: true }))
                            if (await run(() => api('hr.deleteRun', { id: r.id }), 'Paie supprimée.')) reload()
                        }
                      }
                    ]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function RunDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const { data: r, error, loading, reload } = useQuery<any>('hr.run', { id })
  const [vars, setVars] = useState<any | null>(null)
  const [pay, setPay] = useState(false)
  if (error) return <ErrorBox error={error} onRetry={reload} />
  if (loading && !r) return <Loading />
  const draft = r.status === 'brouillon'
  const print = async (employeeId?: number) => {
    const html = await run(() => api<string>('hr.payslipsHtml', { runId: id, employeeId }))
    if (html) await run(() => unwrap(window.erp.printHtml(html, `Bulletins ${r.period}`)))
  }
  const exportCnss = async () => {
    const d = await run(() => api('hr.declaration', { runId: id }))
    if (d) exportCsv(`Declaration-CNSS-IUTS-${r.period}.csv`, [
      { label: 'Matricule', value: (x) => x.matricule }, { label: 'Nom', value: (x) => x.name }, { label: 'N° CNSS', value: (x) => x.cnss_number },
      { label: 'Salaire brut', value: (x) => x.gross }, { label: 'Base CNSS', value: (x) => x.cnss_base }, { label: 'CNSS salarié', value: (x) => x.cnss_employee },
      { label: 'CNSS employeur', value: (x) => x.cnss_employer }, { label: 'Base IUTS', value: (x) => x.taxable }, { label: 'IUTS', value: (x) => x.iuts }, { label: 'Net', value: (x) => x.net }
    ], d.rows)
  }
  return (
    <>
      <div className="row gap wrap" style={{ marginBottom: 16 }}>
        <button className="link-btn" onClick={onBack}>← Toutes les paies</button>
        <h2 className="grow" style={{ fontSize: 19 }}>Paie de {periodLabel(r.period)} <span className={`badge ${draft ? 'badge-brouillon' : 'badge-valide'}`}>{draft ? 'Brouillon' : r.paid ? 'Payée' : 'Validée'}</span></h2>
        <button className="btn" onClick={() => print()}><Printer size={18} aria-hidden="true" />Bulletins</button>
        <button className="btn" onClick={exportCnss}>Déclaration CNSS / IUTS</button>
        {draft && <button className="btn" onClick={async () => { if (await run(() => api('hr.prepareRun', { period: r.period }), 'Paie recalculée.')) reload() }}>Recalculer</button>}
        {draft && <button className="btn btn-ghost" onClick={async () => { if (await confirmDialog('Supprimer cette paie en brouillon ?', { danger: true })) if (await run(() => api('hr.deleteRun', { id }), 'Paie supprimée.')) onBack() }}>Supprimer</button>}
        {draft && <button className="btn btn-primary" onClick={async () => { if (await confirmDialog(`Valider la paie de ${periodLabel(r.period)} ?`, { detail: "Les bulletins seront figés et l'écriture de paie passée en comptabilité." })) if (await run(() => api('hr.validateRun', { id }), 'Paie validée.')) reload() }}>Valider la paie</button>}
        {!draft && !r.paid && <button className="btn btn-primary" onClick={() => setPay(true)}>Payer les salaires</button>}
      </div>
      <div className="kpi-row">
        <div className="mini-kpi"><span>Brut</span><strong>{formatMoney(r.gross)}</strong></div>
        <div className="mini-kpi"><span>Net à payer</span><strong>{formatMoney(r.net)}</strong></div>
        <div className="mini-kpi"><span>CNSS (total)</span><strong>{formatMoney(r.payslips.reduce((s: number, p: any) => s + p.cnss_employee + p.cnss_employer, 0))}</strong></div>
        <div className="mini-kpi"><span>IUTS</span><strong>{formatMoney(r.payslips.reduce((s: number, p: any) => s + p.iuts, 0))}</strong></div>
        <div className="mini-kpi"><span>Coût employeur</span><strong>{formatMoney(r.employer_cost)}</strong></div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Salarié</th><th className="num">Brut</th><th className="num">CNSS</th><th className="num">Base IUTS</th><th className="num">IUTS</th><th className="num">Retenues</th><th className="num">Net</th><th /></tr></thead>
          <tbody>
            {r.payslips.map((p: any) => (
              <tr key={p.id}>
                <td><span className="strong">{p.first_name} {p.last_name}</span><div className="muted small">{p.matricule} · {p.job}</div></td>
                <td className="num money">{formatNumber(p.gross)}</td><td className="num money">{formatNumber(p.cnss_employee)}</td>
                <td className="num money">{formatNumber(p.taxable)}</td><td className="num money">{formatNumber(p.iuts)}</td>
                <td className="num money">{formatNumber(p.other_deductions)}</td><td className="num money strong">{formatNumber(p.net)}</td>
                <td className="num nowrap">
                  {draft && <button className="btn btn-sm btn-tonal" onClick={() => setVars(p)}>Variables</button>}{' '}
                  <button className="btn btn-sm" onClick={() => print(p.employee_id)} aria-label={`Bulletin de ${p.first_name} ${p.last_name}`}><Printer size={16} aria-hidden="true" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {vars && <VariablesModal runId={id} slip={vars} onClose={() => setVars(null)} onDone={() => { setVars(null); reload() }} />}
      {pay && <PayModal run={r} onClose={() => setPay(false)} onDone={() => { setPay(false); reload() }} />}
    </>
  )
}

function VariablesModal({ runId, slip, onClose, onDone }: { runId: number; slip: any; onClose: () => void; onDone: () => void }) {
  const v0 = slip.detail.variables ?? {}
  const f = useForm({ bonus: String(v0.bonus ?? 0), overtime: String(v0.overtime ?? 0), absence_days: String(v0.absence_days ?? 0), advance: String(v0.advance ?? 0), other_deductions: String(v0.other_deductions ?? 0) })
  const save = async () => {
    const variables = Object.fromEntries(Object.entries(f.values).map(([k, x]) => [k, Number(String(x).replace(/\s/g, '').replace(',', '.')) || 0]))
    if (await run(() => api('hr.setVariables', { runId, employeeId: slip.employee_id, variables }), 'Bulletin recalculé.')) onDone()
  }
  return (
    <Modal title={`Éléments variables — ${slip.first_name} ${slip.last_name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" onClick={save}>Recalculer le bulletin</button></>}>
      <div className="grid grid-2">
        <Field label="Primes (imposables)"><input autoFocus inputMode="numeric" {...f.bind('bonus')} /></Field>
        <Field label="Heures supplémentaires (montant)"><input inputMode="numeric" {...f.bind('overtime')} /></Field>
        <Field label="Jours d'absence non payés" hint="Base 30 jours"><input inputMode="decimal" {...f.bind('absence_days')} /></Field>
        <Field label="Avance sur salaire à retenir"><input inputMode="numeric" {...f.bind('advance')} /></Field>
        <Field label="Autres retenues (prêt, saisie…)" span={2}><input inputMode="numeric" {...f.bind('other_deductions')} /></Field>
      </div>
    </Modal>
  )
}

function PayModal({ run: r, onClose, onDone }: { run: any; onClose: () => void; onDone: () => void }) {
  const [method, setMethod] = useState('Virement')
  const [date, setDate] = useState(todayISO())
  const save = async () => {
    if (await run(() => api('hr.payRun', { id: r.id, method, date }), 'Paiement des salaires enregistré.')) onDone()
  }
  return (
    <Modal title={`Payer les salaires — ${formatMoney(r.net)}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" onClick={save}>Enregistrer le paiement</button></>}>
      <div className="grid grid-2">
        <Field label="Mode de paiement"><select value={method} onChange={(e) => setMethod(e.target.value)}>{PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}</select></Field>
        <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}

function Leaves() {
  const [status, setStatus] = useState('')
  const { data, error, loading, reload } = useQuery<any[]>('hr.leaves', { status })
  const { data: employees } = useQuery<any[]>('hr.employees', {})
  const [adding, setAdding] = useState(false)
  const decide = async (id: number, approve: boolean) => {
    if (await run(() => api('hr.decideLeave', { id, approve }), approve ? 'Congé approuvé.' : 'Demande refusée.')) reload()
  }
  return (
    <>
      <div className="toolbar">
        <Tabs value={status} onChange={setStatus} tabs={[{ value: '', label: 'Toutes' }, { value: 'demande', label: 'À traiter' }, { value: 'approuve', label: 'Approuvées' }, { value: 'refuse', label: 'Refusées' }]} />
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setAdding(true)}><CalendarCheck size={18} aria-hidden="true" />Nouvelle absence</button>
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Loading /> : data!.length === 0 ? <Empty>Aucune absence.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Salarié</th><th>Type</th><th>Du</th><th>Au</th><th className="num">Jours</th><th>État</th><th /></tr></thead>
            <tbody>
              {data!.map((l) => (
                <tr key={l.id}>
                  <td className="strong">{l.first_name} {l.last_name}{l.note && <div className="muted small">{l.note}</div>}</td>
                  <td>{LEAVE_LABELS[l.kind]}</td><td>{formatDate(l.start_date)}</td><td>{formatDate(l.end_date)}</td><td className="num">{formatNumber(l.days, 1)}</td>
                  <td><span className={`badge ${l.status === 'approuve' ? 'pay-payee' : l.status === 'refuse' ? 'pay-en_retard' : 'pay-partielle'}`}>{l.status === 'approuve' ? 'Approuvé' : l.status === 'refuse' ? 'Refusé' : 'En attente'}</span></td>
                  <td className="num nowrap">{l.status === 'demande' && <>
                    <button className="btn btn-sm btn-tonal" onClick={() => decide(l.id, true)}><CheckCircle size={16} aria-hidden="true" />Approuver</button>{' '}
                    <button className="btn btn-sm" onClick={() => decide(l.id, false)}><XCircle size={16} aria-hidden="true" />Refuser</button>
                  </>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && <LeaveModal employees={employees ?? []} onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload() }} />}
    </>
  )
}

function LeaveModal({ employees, onClose, onDone }: { employees: any[]; onClose: () => void; onDone: () => void }) {
  const f = useForm({ employee_id: '', kind: 'conge_paye', start_date: todayISO(), end_date: todayISO(), note: '' })
  const v = f.values
  const days = v.start_date && v.end_date ? workingDays(v.start_date, v.end_date) : 0
  const emp = employees.find((e) => String(e.id) === v.employee_id)
  const save = async () => {
    if (await run(() => api('hr.saveLeave', { ...v, employee_id: Number(v.employee_id) }), 'Absence enregistrée.')) onDone()
  }
  return (
    <Modal title="Nouvelle absence" onClose={onClose} footer={<><span className="grow muted small">{days} jour(s) ouvrable(s){emp && v.kind === 'conge_paye' ? ` · solde ${formatNumber(emp.leave_balance, 1)} j` : ''}</span><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" onClick={save}>Enregistrer</button></>}>
      <div className="grid grid-2">
        <Field label="Salarié" span={2}><select autoFocus {...f.bind('employee_id')}><option value="">Choisir…</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}</select></Field>
        <Field label="Type" span={2}><select {...f.bind('kind')}>{Object.entries(LEAVE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Du"><input type="date" {...f.bind('start_date')} /></Field>
        <Field label="Au"><input type="date" {...f.bind('end_date')} /></Field>
        <Field label="Commentaire" span={2}><input {...f.bind('note')} /></Field>
      </div>
    </Modal>
  )
}

function Params() {
  const { data, error, loading, reload } = useQuery<PayrollParams>('hr.params')
  const [p, setP] = useState<PayrollParams | null>(null)
  const cur = p ?? data
  if (error) return <ErrorBox error={error} onRetry={reload} />
  if (loading || !cur) return <Loading />
  const set = (k: keyof PayrollParams, v: any) => setP({ ...cur, [k]: v })
  const numField = (k: keyof PayrollParams, label: string, hint?: string) => (
    <Field label={label} hint={hint}><input inputMode="decimal" value={String(cur[k])} onChange={(e) => set(k, Number(e.target.value.replace(',', '.')) || 0)} /></Field>
  )
  const save = async () => {
    if (await run(() => api('hr.saveParams', cur), 'Paramètres de paie enregistrés.')) {
      setP(null)
      reload()
    }
  }
  return (
    <>
      <div className="info-box"><span>Ces taux sont des valeurs par défaut. <strong>Faites-les vérifier par votre comptable ou auprès de la DGI et de la CNSS</strong> avant d'établir des bulletins réels : la réglementation évolue.</span></div>
      <div className="card">
        <h3>Sécurité sociale (CNSS) et taxes sur salaires</h3>
        <div className="grid grid-4">
          {numField('cnss_employee_rate', 'CNSS salarié — pension (%)')}
          {numField('cnss_ceiling', 'Plafond mensuel de la base CNSS')}
          {numField('tpa_rate', "Taxe patronale d'apprentissage (%)", '0 si non applicable')}
          <div />
          {numField('cnss_employer_family', 'Employeur — prestations familiales (%)')}
          {numField('cnss_employer_risk', 'Employeur — risques professionnels (%)', "Selon le secteur d'activité")}
          {numField('cnss_employer_pension', 'Employeur — pension (%)')}
          <Field label="Total part patronale CNSS"><div className="readonly strong">{formatNumber((cur.cnss_employer_family ?? 0) + (cur.cnss_employer_risk ?? 0) + (cur.cnss_employer_pension ?? 0), 2)} %</div></Field>
        </div>
      </div>
      <div className="card">
        <div className="row space-between wrap gap">
          <h3>Autres cotisations et retenues</h3>
          <div className="row gap wrap">
            <button className="btn btn-sm" onClick={() => set('contributions', [...(cur.contributions ?? []), { code: 'AMU', label: 'Assurance maladie universelle', base: 'gross', employee_rate: 0, employer_rate: 0, ceiling: 0, deductible: true, account: '438', active: false }])}>+ Assurance maladie</button>
            <button className="btn btn-sm" onClick={() => set('contributions', [...(cur.contributions ?? []), { code: 'MUT', label: 'Mutuelle santé', base: 'gross', employee_rate: 0, employer_rate: 0, ceiling: 0, deductible: false, account: '438', active: true }])}>+ Mutuelle</button>
            <button className="btn btn-sm" onClick={() => set('contributions', [...(cur.contributions ?? []), { code: 'COT' + ((cur.contributions ?? []).length + 1), label: '', base: 'gross', employee_rate: 0, employer_rate: 0, ceiling: 0, deductible: false, account: '438', active: true }])}>+ Autre cotisation</button>
          </div>
        </div>
        <p className="muted small">Retraite complémentaire, assurance maladie, mutuelle, cotisation syndicale… Part salariale retenue sur le net, part patronale ajoutée au coût employeur, comptabilisées au compte indiqué.</p>
        {(cur.contributions ?? []).length === 0 ? <p className="muted">Aucune cotisation supplémentaire.</p> : (
          <div className="table-wrap">
            <table className="table compact contrib-table">
              <thead><tr><th>Libellé</th><th>Base</th><th>Salarié %</th><th>Employeur %</th><th>Plafond</th><th>Déductible IUTS</th><th>Compte</th><th>Active</th><th /></tr></thead>
              <tbody>
                {(cur.contributions ?? []).map((c, i) => {
                  const up = (patch: any) => set('contributions', (cur.contributions ?? []).map((x, j) => (j === i ? { ...x, ...patch } : x)))
                  return (
                    <tr key={i}>
                      <td><input aria-label="Libellé" value={c.label} onChange={(e) => up({ label: e.target.value })} /></td>
                      <td><select aria-label="Base" value={c.base} onChange={(e) => up({ base: e.target.value })}><option value="gross">Brut</option><option value="cnss_base">Base CNSS</option><option value="base_salary">Salaire de base</option></select></td>
                      <td><input aria-label="Taux salarié" inputMode="decimal" value={c.employee_rate} onChange={(e) => up({ employee_rate: Number(e.target.value.replace(',', '.')) || 0 })} /></td>
                      <td><input aria-label="Taux employeur" inputMode="decimal" value={c.employer_rate} onChange={(e) => up({ employer_rate: Number(e.target.value.replace(',', '.')) || 0 })} /></td>
                      <td><input aria-label="Plafond" inputMode="numeric" value={c.ceiling} onChange={(e) => up({ ceiling: Number(e.target.value) || 0 })} /></td>
                      <td><input aria-label="Déductible de l'IUTS" type="checkbox" checked={c.deductible} onChange={(e) => up({ deductible: e.target.checked })} /></td>
                      <td><input aria-label="Compte" value={c.account} onChange={(e) => up({ account: e.target.value })} style={{ width: 80 }} /></td>
                      <td><input aria-label="Active" type="checkbox" checked={c.active} onChange={(e) => up({ active: e.target.checked })} /></td>
                      <td><button className="icon-btn" aria-label="Supprimer" onClick={() => set('contributions', (cur.contributions ?? []).filter((_, j) => j !== i))}>×</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="card">
        <h3>IUTS : abattements et exonérations</h3>
        <div className="grid grid-4">
          {numField('abatement_non_cadre', 'Abattement non-cadres (%)')}
          {numField('abatement_cadre', 'Abattement cadres (%)')}
          {numField('housing_exempt_rate', 'Logement exonéré (% du base)')}
          {numField('housing_exempt_cap', 'Plafond logement')}
          {numField('transport_exempt_rate', 'Transport exonéré (%)')}
          {numField('transport_exempt_cap', 'Plafond transport')}
          {numField('function_exempt_rate', 'Fonction exonérée (%)')}
          {numField('function_exempt_cap', 'Plafond fonction')}
          {numField('leave_days_per_month', 'Congés acquis par mois (jours)')}
          <Field label="Réduction pour charges de famille (%)" span={3} hint="Par nombre de charges : 0, 1, 2, 3, 4 et plus">
            <input value={cur.family_reductions.join(' ; ')} onChange={(e) => set('family_reductions', e.target.value.split(/[;,]/).map((x) => Number(x.trim()) || 0))} />
          </Field>
        </div>
      </div>
      <div className="card">
        <h3>Barème progressif mensuel de l'IUTS</h3>
        <table className="table compact" style={{ maxWidth: 520 }}>
          <thead><tr><th>Jusqu'à (FCFA)</th><th>Taux (%)</th></tr></thead>
          <tbody>
            {cur.iuts_brackets.map((b, i) => (
              <tr key={i}>
                <td>{b.upTo === null ? <span className="muted">au-delà</span> : <input inputMode="numeric" value={b.upTo} aria-label={`Tranche ${i + 1}, plafond`} onChange={(e) => set('iuts_brackets', cur.iuts_brackets.map((x, j) => (j === i ? { ...x, upTo: Number(e.target.value) || 0 } : x)))} />}</td>
                <td><input inputMode="decimal" value={b.rate} aria-label={`Tranche ${i + 1}, taux`} onChange={(e) => set('iuts_brackets', cur.iuts_brackets.map((x, j) => (j === i ? { ...x, rate: Number(e.target.value.replace(',', '.')) || 0 } : x)))} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="form-actions"><button className="btn" onClick={() => setP(DEFAULT_PAYROLL_PARAMS)}>Rétablir les valeurs par défaut</button><button className="btn btn-primary" onClick={save} disabled={!p}>Enregistrer</button></div>
    </>
  )
}
