// Éléments communs aux circuits de validation : fil des étapes, pastille d'état, historique,
// fenêtre de décision (approuver ou rejeter avec un motif).

import { useState } from 'react'
import { Check, X } from '@phosphor-icons/react'
import { Field, Modal, notify } from './ui'

const when = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export function WfBadge({ label, tone }: { label: string; tone: string }) {
  return <span className={`wf-badge wf-${tone}`}><i aria-hidden="true" />{label}</span>
}

/** Fil des étapes : passées (cochées), en cours (mise en avant), à venir ; rejet signalé à l'étape atteinte. */
export function WfSteps({ steps, current, rejected }: { steps: { label: string; who: string }[]; current: number; rejected?: boolean }) {
  return (
    <ol className={`wf-steps${rejected ? ' is-rejected' : ''}`} aria-label="Avancement">
      {steps.map((s, i) => {
        const state = rejected ? (i === 0 ? 'now' : 'todo') : i < current ? 'done' : i === current ? 'now' : 'todo'
        return (
          <li key={s.label} className={`wf-step ${state}`} aria-current={state === 'now' ? 'step' : undefined} style={{ animationDelay: `${i * 70}ms` }}>
            <span className="wf-dot" aria-hidden="true">{state === 'done' ? <Check size={15} weight="bold" /> : rejected && i === 0 ? <X size={15} weight="bold" /> : i + 1}</span>
            <span className="wf-step-text"><strong>{s.label}</strong><small>{s.who}</small></span>
          </li>
        )
      })}
    </ol>
  )
}

const ACTIONS: Record<string, string> = {
  creation: 'a créé la demande', soumission: 'a envoyé en validation', approbation: 'a approuvé', visa: 'a donné son visa', validation_financiere: 'a validé (finances)',
  rejet: 'a rejeté', paiement: 'a payé', annulation_paiement: 'a annulé le paiement', commande: 'a passé la commande', cloture: 'a clôturé'
}

export function WfTimeline({ events }: { events: { action: string; comment: string; at: string; user_name: string | null }[] }) {
  if (!events?.length) return null
  return (
    <ul className="wf-timeline">
      {events.map((e, i) => (
        <li key={i} className={e.action === 'rejet' ? 'bad' : ''}>
          <span><strong>{e.user_name ?? 'Utilisateur supprimé'}</strong> {ACTIONS[e.action] ?? e.action}{e.comment ? <> — <em>{e.comment}</em></> : null}</span>
          <time dateTime={e.at}>{when(e.at)}</time>
        </li>
      ))}
    </ul>
  )
}

/** Approuver (commentaire facultatif) ou rejeter (motif obligatoire). */
export function DecideModal({ title, approveLabel, onDecide, onClose }: { title: string; approveLabel: string; onDecide: (approve: boolean, comment: string) => Promise<unknown>; onClose: () => void }) {
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const go = async (approve: boolean) => {
    if (!approve && !comment.trim()) return notify('Indiquez le motif du rejet : il sera transmis au demandeur.', 'error')
    setBusy(true)
    await onDecide(approve, comment.trim())
    setBusy(false)
  }
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Fermer</button>
      <button className="btn btn-danger" onClick={() => go(false)} disabled={busy}><X size={18} aria-hidden="true" />Rejeter</button>
      <button className="btn btn-primary" onClick={() => go(true)} disabled={busy}><Check size={18} aria-hidden="true" />{approveLabel}</button>
    </>}>
      <Field label="Commentaire" hint="Obligatoire pour un rejet : le demandeur le lira et pourra corriger sa demande.">
        <textarea rows={3} autoFocus value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
    </Modal>
  )
}
