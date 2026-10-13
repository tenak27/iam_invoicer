// Exercices comptables : ouverture, contrôles avant clôture, clôture et réouverture.

import { useState } from 'react'
import { ArrowCounterClockwise, CalendarCheck, CalendarPlus, CheckCircle, LockSimple, LockSimpleOpen, Trash, Warning, XCircle } from '@phosphor-icons/react'
import { formatDate, formatMoney, todayISO } from '@shared/format'
import { api, run, useQuery } from '../api'
import { KpiStrip } from '../components/KpiStrip'
import { confirmDialog, Empty, ErrorBox, Field, Loading, Modal, PageHeader, RowActions, useForm } from '../components/ui'
import { WfBadge } from '../components/Workflow'

interface Year { id: number; label: string; start_date: string; end_date: string; status: 'ouvert' | 'cloture'; result: number | null; closed_at: string | null; closed_by_name?: string | null }

/** Part de l'exercice déjà écoulée, de 0 à 1. */
function progress(y: Year): number {
  const a = Date.parse(y.start_date), b = Date.parse(y.end_date) + 86_400_000, n = Date.parse(todayISO())
  return Math.max(0, Math.min(1, (n - a) / (b - a)))
}

export function FiscalYearsPage() {
  const { data, error, loading, reload } = useQuery<any>('fiscal.list')
  const [opening, setOpening] = useState(false)
  const [closing, setClosing] = useState<Year | null>(null)
  const [reopening, setReopening] = useState<Year | null>(null)
  const years: Year[] = data?.years ?? []
  const rights = data?.rights ?? { close: false, reopen: false }
  const current = years.find((y) => y.id === data?.current) ?? null
  const closed = years.filter((y) => y.status === 'cloture')

  return (
    <div className="page">
      <PageHeader
        title="Exercices comptables"
        subtitle="Ouvrez un exercice, contrôlez-le puis clôturez-le : le résultat est déterminé et la période verrouillée."
        actions={rights.close && <button className="btn btn-primary" onClick={() => setOpening(true)}><CalendarPlus size={18} aria-hidden="true" />Ouvrir un exercice</button>}
      />
      <KpiStrip items={[
        { label: 'Exercices ouverts', value: years.filter((y) => y.status === 'ouvert').length, icon: LockSimpleOpen },
        { label: 'Exercices clôturés', value: closed.length, icon: LockSimple, tone: 'good' },
        { label: closed[0] ? `Résultat ${closed[0].label}` : 'Dernier résultat', value: closed[0]?.result ?? 0, icon: CalendarCheck, money: true, hidden: !closed.length }
      ]} />

      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Loading /> : (
        <>
          {current ? (
            <div className="card fy-current">
              <div className="row space-between wrap gap">
                <div>
                  <span className="muted small">Exercice en cours</span>
                  <h3>{current.label}</h3>
                  <p className="muted">Du {formatDate(current.start_date)} au {formatDate(current.end_date)}</p>
                </div>
                {rights.close && <button className="btn btn-primary" onClick={() => setClosing(current)}><LockSimple size={18} aria-hidden="true" />Contrôler et clôturer</button>}
              </div>
              <div className="fy-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress(current) * 100)} aria-label="Avancement de l'exercice"><span style={{ width: `${progress(current) * 100}%` }} /></div>
              <p className="muted small">{Math.round(progress(current) * 100)} % de l'exercice écoulé.{data.lockedUntil ? ` Écritures verrouillées jusqu'au ${formatDate(data.lockedUntil)}.` : ''}</p>
            </div>
          ) : (
            <div className="card">
              <h3>Aucun exercice ouvert</h3>
              <p className="muted">Sans exercice, les écritures sont acceptées à toute date postérieure au dernier exercice clôturé. Ouvrez un exercice pour suivre l'année et préparer sa clôture.</p>
            </div>
          )}

          {years.length === 0 ? <Empty>Aucun exercice. Cliquez sur « Ouvrir un exercice » : les dates proposées couvrent l'année civile en cours.</Empty> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Exercice</th><th>Période</th><th>État</th><th className="num">Résultat</th><th>Clôture</th><th className="actions-col">Actions</th></tr></thead>
                <tbody>
                  {years.map((y) => (
                    <tr key={y.id}>
                      <td className="strong">{y.label}</td>
                      <td>Du {formatDate(y.start_date)} au {formatDate(y.end_date)}</td>
                      <td><WfBadge label={y.status === 'cloture' ? 'Clôturé' : 'Ouvert'} tone={y.status === 'cloture' ? 'green' : 'blue'} /></td>
                      <td className="num money">{y.result === null ? '—' : <span className={y.result < 0 ? 'text-warn' : ''}>{formatMoney(y.result)}</span>}</td>
                      <td>{y.closed_at ? <>{formatDate(String(y.closed_at).slice(0, 10))}<div className="muted small">{y.closed_by_name}</div></> : '—'}</td>
                      <td className="actions-col">
                        <RowActions actions={[
                          { label: 'Contrôler et clôturer', icon: LockSimple, hidden: y.status !== 'ouvert' || !rights.close, onClick: () => setClosing(y) },
                          { label: 'Rouvrir', icon: ArrowCounterClockwise, hidden: y.status !== 'cloture' || !rights.reopen, onClick: () => setReopening(y) },
                          { label: 'Supprimer', icon: Trash, tone: 'danger', hidden: y.status !== 'ouvert' || !rights.close, onClick: async () => { if (await confirmDialog(`Supprimer l'exercice ${y.label} ?`, { detail: 'Possible seulement s’il ne contient aucune écriture.', danger: true })) if (await run(() => api('fiscal.delete', { id: y.id }), 'Exercice supprimé.')) reload() } }
                        ]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted small">La clôture passe une écriture au dernier jour de l'exercice : les comptes de charges et de produits sont soldés, et le résultat est porté au compte 131 (bénéfice) ou 139 (perte). L'affectation du résultat, décidée par les associés, se saisit ensuite en opérations diverses. Faites valider la clôture par votre comptable.</p>
        </>
      )}
      {opening && <OpenModal suggestion={data.suggestion} onClose={() => setOpening(false)} onDone={() => { setOpening(false); reload() }} />}
      {closing && <CloseModal year={closing} onClose={() => setClosing(null)} onDone={() => { setClosing(null); reload() }} />}
      {reopening && <ReopenModal year={reopening} onClose={() => setReopening(null)} onDone={() => { setReopening(null); reload() }} />}
    </div>
  )
}

function OpenModal({ suggestion, onClose, onDone }: { suggestion: { label: string; start_date: string; end_date: string }; onClose: () => void; onDone: () => void }) {
  const f = useForm<any>({ ...suggestion })
  const go = async () => { if (await run(() => api('fiscal.open', f.values), `Exercice ${f.values.label || ''} ouvert.`)) onDone() }
  return (
    <Modal title="Ouvrir un exercice" onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" onClick={go}><CalendarPlus size={18} aria-hidden="true" />Ouvrir l'exercice</button></>}>
      <div className="grid grid-2">
        <Field label="Nom de l'exercice" span={2} hint="Par exemple 2026, ou 2026-2027 pour un exercice à cheval sur deux années."><input autoFocus {...f.bind('label')} /></Field>
        <Field label="Premier jour"><input type="date" {...f.bind('start_date')} /></Field>
        <Field label="Dernier jour"><input type="date" {...f.bind('end_date')} /></Field>
      </div>
      <p className="muted small">Les exercices se suivent sans se chevaucher. Le premier exercice d'une société peut durer plus de douze mois.</p>
    </Modal>
  )
}

function CloseModal({ year, onClose, onDone }: { year: Year; onClose: () => void; onDone: () => void }) {
  const { data, error } = useQuery<any>('fiscal.preview', { id: year.id }, [year.id])
  const [confirm, setConfirm] = useState('')
  const [next, setNext] = useState(true)
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    const r = await run(() => api<any>('fiscal.close', { id: year.id, confirm, open_next: next }))
    setBusy(false)
    if (r) {
      onDone()
      await confirmDialog(`Exercice ${r.label} clôturé`, { detail: `Résultat de l'exercice : ${formatMoney(r.result)}.${r.next ? ` L'exercice ${r.next.label} est ouvert.` : ''}` })
    }
  }
  return (
    <Modal title={`Clôturer l'exercice ${year.label}`} onClose={onClose} wide footer={<>
      <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Annuler</button>
      <button className="btn btn-danger" onClick={go} disabled={busy || !data?.canClose || confirm.trim() !== year.label}><LockSimple size={18} aria-hidden="true" />Clôturer définitivement</button>
    </>}>
      {error ? <ErrorBox error={error} /> : !data ? <Loading /> : (
        <>
          <dl className="wf-facts">
            <div><dt>Produits</dt><dd>{formatMoney(data.produits)}</dd></div>
            <div><dt>Charges</dt><dd>{formatMoney(data.charges)}</dd></div>
            <div><dt>{data.result >= 0 ? 'Bénéfice' : 'Perte'}</dt><dd className="big">{formatMoney(data.result)}</dd></div>
          </dl>
          <h4 className="wf-h">Contrôles avant clôture</h4>
          <ul className="fy-checks">
            {data.checks.map((c: any) => (
              <li key={c.key} className={c.ok ? 'ok' : c.blocking ? 'bad' : 'warn'}>
                {c.ok ? <CheckCircle size={22} weight="fill" aria-hidden="true" /> : c.blocking ? <XCircle size={22} weight="fill" aria-hidden="true" /> : <Warning size={22} weight="fill" aria-hidden="true" />}
                <span>{c.label}{!c.ok && <small>{c.blocking ? 'Bloquant' : 'À vérifier, non bloquant'}</small>}</span>
              </li>
            ))}
          </ul>
          <p className="wf-reject"><strong>Après la clôture</strong>, plus aucune écriture ne pourra être passée, modifiée ou supprimée jusqu'au {formatDate(year.end_date)} : factures, règlements, dépenses et paies de cette période sont figés. {data.entries} écriture(s) concernée(s).</p>
          <div className="grid grid-2">
            <Field label={`Pour confirmer, saisissez « ${year.label} »`}><input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" disabled={!data.canClose} /></Field>
            <label className="check-row" style={{ alignSelf: 'end', minHeight: 44 }}><input type="checkbox" checked={next} onChange={(e) => setNext(e.target.checked)} /> Ouvrir l'exercice suivant dans la foulée</label>
          </div>
        </>
      )}
    </Modal>
  )
}

function ReopenModal({ year, onClose, onDone }: { year: Year; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const go = async () => { if (await run(() => api('fiscal.reopen', { id: year.id, reason }), `Exercice ${year.label} rouvert : l'écriture de clôture est retirée.`)) onDone() }
  return (
    <Modal title={`Rouvrir l'exercice ${year.label}`} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-danger" onClick={go}><ArrowCounterClockwise size={18} aria-hidden="true" />Rouvrir l'exercice</button></>}>
      <p className="muted">La période redevient modifiable et l'écriture de clôture est supprimée. À réserver à la correction d'une erreur, avant le dépôt des états financiers.</p>
      <Field label="Motif de la réouverture" hint="Inscrit au journal d'activité."><textarea rows={3} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </Modal>
  )
}
