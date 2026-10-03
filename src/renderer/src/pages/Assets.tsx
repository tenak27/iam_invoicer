import { useState } from 'react'
import { Buildings, Calculator, HandCoins, ListNumbers, PencilSimple, Plus } from '@phosphor-icons/react'
import { PAYMENT_METHODS } from '@shared/domain'
import { formatDate, formatMoney, todayISO } from '@shared/format'
import { api, exportCsv, run, useQuery } from '../api'
import { Progress } from '../components/charts'
import { confirmDialog, Empty, ErrorBox, Field, Loading, Modal, PageHeader, RowActions, SearchInput, Tabs, useForm } from '../components/ui'

export function AssetsPage() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('actif')
  const { data, error, loading, reload } = useQuery<any[]>('assets.list', { search, status })
  const [editing, setEditing] = useState<any | null>(null)
  const [plan, setPlan] = useState<any | null>(null)
  const [disposing, setDisposing] = useState<any | null>(null)
  const rows = data ?? []
  const year = new Date().getFullYear()
  const totals = rows.reduce((t, a) => ({ value: t.value + a.value, net: t.net + a.net_value, dot: t.dot + a.dotation_year }), { value: 0, net: 0, dot: 0 })
  const postYear = async () => {
    if (!(await confirmDialog(`Comptabiliser les dotations aux amortissements de ${year} ?`, { detail: 'Une écriture 681 / 28xx est passée pour chaque bien non encore amorti sur cet exercice.' }))) return
    const r = await run(() => api('assets.postYear', { year }))
    if (r) {
      reload()
      await confirmDialog(`Dotations ${year} comptabilisées : ${r.count} bien(s), ${formatMoney(r.total)}.`)
    }
  }
  return (
    <div className="page">
      <PageHeader title="Immobilisations" subtitle="Registre des biens, amortissements linéaires et cessions (SYSCOHADA)."
        actions={<>
          <button className="btn" onClick={() => exportCsv('Immobilisations.csv', [
            { label: 'Code', value: (a) => a.code }, { label: 'Désignation', value: (a) => a.name }, { label: 'Compte', value: (a) => a.account },
            { label: 'Acquisition', value: (a) => formatDate(a.acquisition_date) }, { label: 'Valeur', value: (a) => a.value }, { label: 'Durée (ans)', value: (a) => a.duration_years },
            { label: `Dotation ${year}`, value: (a) => a.dotation_year }, { label: 'Amortissements cumulés', value: (a) => a.cumulated }, { label: 'Valeur nette', value: (a) => a.net_value }
          ], rows)}>Exporter (Excel)</button>
          <button className="btn" onClick={postYear}><Calculator size={18} aria-hidden="true" />Dotations {year}</button>
          <button className="btn btn-primary" onClick={() => setEditing({ account: '2444', acquisition_date: todayISO(), duration_years: '3' })}><Plus size={18} aria-hidden="true" />Nouveau bien</button>
        </>} />
      <div className="kpi-row">
        <div className="mini-kpi"><span>Valeur brute</span><strong>{formatMoney(totals.value)}</strong></div>
        <div className="mini-kpi"><span>Valeur nette comptable</span><strong>{formatMoney(totals.net)}</strong></div>
        <div className="mini-kpi"><span>Dotation {year}</span><strong>{formatMoney(totals.dot)}</strong></div>
      </div>
      <div className="toolbar">
        <Tabs value={status} onChange={setStatus} tabs={[{ value: 'actif', label: 'En service' }, { value: 'cede', label: 'Cédés' }, { value: 'rebut', label: 'Au rebut' }, { value: '', label: 'Tous' }]} />
        <SearchInput value={search} onChange={setSearch} placeholder="Désignation, code…" />
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Loading /> : rows.length === 0 ? <Empty>Aucun bien. Enregistrez vos véhicules, ordinateurs, mobilier… pour calculer leurs amortissements.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Bien</th><th>Compte</th><th>Acquisition</th><th className="num">Valeur</th><th>Amortissement</th><th className="num">VNC</th><th className="actions-col">Actions</th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td><span className="who"><span className="tint tint-sm tint-info" aria-hidden="true"><Buildings size={18} weight="duotone" /></span><span><span className="strong">{a.name}</span><div className="muted small">{a.code}{a.location ? ` · ${a.location}` : ''}</div></span></span></td>
                  <td>{a.account}<div className="muted small">{a.account_label}</div></td>
                  <td>{formatDate(a.acquisition_date)}<div className="muted small">{a.duration_years} an(s)</div></td>
                  <td className="num money">{formatMoney(a.value)}</td>
                  <td style={{ minWidth: 150 }}><Progress value={(a.cumulated / (a.value - a.residual)) * 100} color="var(--c-info)" label="Part amortie" /><div className="muted small">{formatMoney(a.cumulated)} amortis fin {year}</div></td>
                  <td className="num money strong">{formatMoney(a.net_value)}</td>
                  <td className="actions-col">
                    <RowActions actions={[
                      { label: "Plan d'amortissement", icon: ListNumbers, onClick: () => setPlan(a) },
                      { label: 'Modifier', icon: PencilSimple, tone: 'primary', onClick: () => setEditing(a) },
                      { label: 'Céder ou mettre au rebut', icon: HandCoins, tone: 'warning', hidden: a.status !== 'actif', onClick: () => setDisposing(a) }
                    ]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <AssetModal a={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload() }} />}
      {plan && (
        <Modal title={`Plan d'amortissement — ${plan.name}`} onClose={() => setPlan(null)}>
          <table className="table compact">
            <thead><tr><th>Exercice</th><th className="num">Dotation</th><th className="num">Cumul</th><th className="num">VNC fin d'exercice</th></tr></thead>
            <tbody>{plan.schedule.map((r: any) => <tr key={r.year}><td>{r.year}</td><td className="num money">{formatMoney(r.dotation)}</td><td className="num money">{formatMoney(r.cumulated)}</td><td className="num money">{formatMoney(r.net)}</td></tr>)}</tbody>
          </table>
          <p className="muted small">Linéaire, première année au prorata temporis (base 360 jours).</p>
        </Modal>
      )}
      {disposing && <DisposeModal a={disposing} onClose={() => setDisposing(null)} onDone={() => { setDisposing(null); reload() }} />}
    </div>
  )
}

function AssetModal({ a, onClose, onDone }: { a: any; onClose: () => void; onDone: () => void }) {
  const { data: accounts } = useQuery<any[]>('assets.accounts')
  const f = useForm<any>({ name: '', account: '2444', acquisition_date: todayISO(), value: '', residual: '0', duration_years: '3', supplier: '', location: '', notes: '', post_acquisition: '', ...Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v === null ? '' : typeof v === 'number' ? String(v) : v])) })
  const save = async () => {
    if (await run(() => api('assets.save', { ...f.values, id: a.id }), 'Bien enregistré.')) onDone()
  }
  return (
    <Modal title={a.id ? a.name : 'Nouveau bien'} wide onClose={onClose} footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" onClick={save}>Enregistrer</button></>}>
      <div className="grid grid-4">
        <Field label="Désignation" span={2}><input autoFocus {...f.bind('name')} placeholder="Véhicule Toyota Hilux" /></Field>
        <Field label="Compte" span={2}><select {...f.bind('account')}>{(accounts ?? []).map((x) => <option key={x.number} value={x.number}>{x.number} — {x.label}</option>)}</select></Field>
        <Field label="Date d'acquisition"><input type="date" {...f.bind('acquisition_date')} /></Field>
        <Field label="Valeur HT"><input inputMode="numeric" {...f.bind('value')} /></Field>
        <Field label="Durée (années)" hint="Informatique 3, véhicule 4 à 5, mobilier 10"><input inputMode="numeric" {...f.bind('duration_years')} /></Field>
        <Field label="Valeur résiduelle"><input inputMode="numeric" {...f.bind('residual')} /></Field>
        <Field label="Fournisseur"><input {...f.bind('supplier')} /></Field>
        <Field label="Emplacement / affectation"><input {...f.bind('location')} /></Field>
        <Field label="Notes" span={2}><input {...f.bind('notes')} /></Field>
        {!a.id && (
          <Field label="Comptabiliser l'acquisition" span={4} hint="Laissez « Non » si la facture d'achat a déjà été passée en 2xxx.">
            <select {...f.bind('post_acquisition')}>
              <option value="">Non, déjà comptabilisée</option>
              <option value="481">Oui, à payer au fournisseur (481)</option>
              {PAYMENT_METHODS.filter((m) => m !== 'Autre').map((m) => <option key={m} value={m}>Oui, payée par {m}</option>)}
            </select>
          </Field>
        )}
      </div>
    </Modal>
  )
}

function DisposeModal({ a, onClose, onDone }: { a: any; onClose: () => void; onDone: () => void }) {
  const f = useForm<any>({ date: todayISO(), price: '0', method: 'Virement', scrap: false })
  const save = async () => {
    const r = await run(() => api('assets.dispose', { id: a.id, ...f.values, price: Number(f.values.price) || 0 }))
    if (r) {
      onDone()
      await confirmDialog(`${f.values.scrap ? 'Mise au rebut' : 'Cession'} enregistrée. Valeur nette ${formatMoney(r.net)}, résultat ${formatMoney(r.result)}.`)
    }
  }
  return (
    <Modal title={`Sortie de ${a.name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" onClick={save}>Enregistrer la sortie</button></>}>
      <label className="inline check"><input type="checkbox" checked={f.values.scrap} onChange={(e) => f.set('scrap', e.target.checked)} /> Mise au rebut (sans prix de vente)</label>
      <div className="grid grid-3">
        <Field label="Date"><input type="date" {...f.bind('date')} /></Field>
        {!f.values.scrap && <Field label="Prix de cession"><input inputMode="numeric" {...f.bind('price')} /></Field>}
        {!f.values.scrap && <Field label="Encaissé par"><select {...f.bind('method')}>{PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}</select></Field>}
      </div>
      <p className="muted small">L'application passe la dotation complémentaire jusqu'à la date de sortie, sort le bien du bilan (812 / 28xx / 2xxx) et enregistre le prix de cession en 822.</p>
    </Modal>
  )
}
