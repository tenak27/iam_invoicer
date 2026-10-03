import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { PAYMENT_STATE_LABELS, paymentState, type DocStatus } from '@shared/domain'
import { formatMoney, todayISO } from '@shared/format'

// ---------- Notifications ----------

type Toast = { id: number; text: string; kind: 'success' | 'error' | 'info' }
let pushToast: ((t: Toast) => void) | null = null
let toastId = 0

export function notify(text: string, kind: Toast['kind'] = 'info') {
  pushToast?.({ id: ++toastId, text, kind })
}

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([])
  useEffect(() => {
    pushToast = (t) => {
      setToasts((all) => [...all.slice(-3), t])
      setTimeout(() => setToasts((all) => all.filter((x) => x.id !== t.id)), t.kind === 'error' ? 6000 : 3000)
    }
    return () => {
      pushToast = null
    }
  }, [])
  return (
    <div className="toaster" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => setToasts((a) => a.filter((x) => x.id !== t.id))}>
          {t.text}
        </div>
      ))}
    </div>
  )
}

// ---------- Fenêtre modale et confirmation ----------

export function Modal(props: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props.onClose])
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className={`modal ${props.wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={props.title}>
        <div className="modal-head">
          <h2>{props.title}</h2>
          <button className="icon-btn" onClick={props.onClose} aria-label="Fermer">×</button>
        </div>
        <div className="modal-body">{props.children}</div>
        {props.footer && <div className="modal-foot">{props.footer}</div>}
      </div>
    </div>,
    document.body
  )
}

type ConfirmState = { message: string; detail?: string; danger?: boolean; resolve: (ok: boolean) => void } | null
let openConfirm: ((s: ConfirmState) => void) | null = null

export function confirmDialog(message: string, opts: { detail?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => openConfirm?.({ message, ...opts, resolve }))
}

export function ConfirmHost() {
  const [state, setState] = useState<ConfirmState>(null)
  useEffect(() => {
    openConfirm = setState
    return () => {
      openConfirm = null
    }
  }, [])
  if (!state) return null
  const close = (ok: boolean) => {
    state.resolve(ok)
    setState(null)
  }
  return (
    <Modal
      title="Confirmation"
      onClose={() => close(false)}
      footer={
        <>
          <button className="btn" onClick={() => close(false)}>Annuler</button>
          <button className={`btn ${state.danger ? 'btn-danger' : 'btn-primary'}`} autoFocus onClick={() => close(true)}>
            Confirmer
          </button>
        </>
      }
    >
      <p className="confirm-msg">{state.message}</p>
      {state.detail && <p className="muted">{state.detail}</p>}
    </Modal>
  )
}

// ---------- Formulaires ----------

export function Field(props: { label: string; children: ReactNode; hint?: string; span?: 1 | 2 | 3 | 4 }) {
  return (
    <label className={`field span-${props.span ?? 1}`}>
      <span className="field-label">{props.label}</span>
      {props.children}
      {props.hint && <span className="field-hint">{props.hint}</span>}
    </label>
  )
}

/** Petit gestionnaire d'état de formulaire. */
export function useForm<T extends Record<string, any>>(initial: T) {
  const [values, setValues] = useState<T>(initial)
  const bind = (key: keyof T) => ({
    value: values[key] ?? '',
    onChange: (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }))
  })
  const set = (key: keyof T, value: any) => setValues((v) => ({ ...v, [key]: value }))
  return { values, setValues, bind, set }
}

// ---------- Affichage ----------

export function PageHeader(props: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{props.title}</h1>
        {props.subtitle && <div className="page-subtitle">{props.subtitle}</div>}
      </div>
      {props.actions && <div className="page-actions">{props.actions}</div>}
    </div>
  )
}

export function Money({ value, className }: { value: number; className?: string }) {
  return <span className={`money ${value < 0 ? 'neg' : ''} ${className ?? ''}`}>{formatMoney(value)}</span>
}

const STATUS_LABELS: Record<DocStatus, string> = { brouillon: 'Brouillon', valide: 'Validé', annule: 'Annulé' }

export function StatusBadge({ status }: { status: DocStatus }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABELS[status]}</span>
}

export function PaymentBadge({ total, paid, dueDate }: { total: number; paid: number; dueDate: string | null }) {
  const s = paymentState(total, paid, dueDate, todayISO())
  return <span className={`badge pay-${s}`}>{PAYMENT_STATE_LABELS[s]}</span>
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

export function Loading() {
  return <div className="loading">Chargement…</div>
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="error-box">
      <span>{error}</span>
      {onRetry && <button className="btn btn-sm" onClick={onRetry}>Réessayer</button>}
    </div>
  )
}

export function SearchInput(props: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      className="search"
      type="search"
      placeholder={props.placeholder ?? 'Rechercher…'}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
    />
  )
}

export function Tabs<T extends string>(props: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string }[] }) {
  return (
    <div className="tabs" role="tablist">
      {props.tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={props.value === t.value} className={`tab ${props.value === t.value ? 'active' : ''}`} onClick={() => props.onChange(t.value)}>
          {t.label}
        </button>
      ))}
    </div>
  )
}
