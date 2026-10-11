import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Tray, type Icon } from '@phosphor-icons/react'
import { PageContext } from './pageContext'
import { createPortal } from 'react-dom'
import { PAYMENT_STATE_LABELS, paymentState, type DocStatus } from '@shared/domain'
import { formatMoney, todayISO } from '@shared/format'

// ---------- Notifications ----------

type Toast = { id: number; text: string; kind: 'success' | 'error' | 'info'; leaving?: boolean }

/** Durée des sorties (fenêtres, notifications) : plus courte que l'entrée, voir --t-exit. */
const EXIT_MS = 160
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
let pushToast: ((t: Toast) => void) | null = null
let toastId = 0

export function notify(text: string, kind: Toast['kind'] = 'info') {
  pushToast?.({ id: ++toastId, text, kind })
}

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([])
  // Sortie en deux temps : la notification s'efface, puis quitte la liste. L'état final ne
  // dépend que du minuteur, jamais d'un événement de fin d'animation.
  const dismiss = useCallback((id: number) => {
    setToasts((all) => all.map((x) => (x.id === id ? { ...x, leaving: true } : x)))
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), reducedMotion() ? 0 : EXIT_MS)
  }, [])
  useEffect(() => {
    pushToast = (t) => {
      setToasts((all) => [...all.slice(-3), t])
      setTimeout(() => dismiss(t.id), t.kind === 'error' ? 6000 : 3000)
    }
    return () => {
      pushToast = null
    }
  }, [dismiss])
  return (
    <div className="toaster" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}${t.leaving ? ' leaving' : ''}`} onClick={() => dismiss(t.id)}>
          <svg className="toast-ic" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            {t.kind === 'success' ? <path d="M7.5 12.5l3 3 6-6.5" /> : t.kind === 'error' ? <path d="M12 7v6M12 16.5v.5" /> : <path d="M12 11v6M12 7.5v.5" />}
          </svg>
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  )
}

// ---------- Fenêtre modale et confirmation ----------

export function Modal(props: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const [closing, setClosing] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const onCloseRef = useRef(props.onClose)
  onCloseRef.current = props.onClose
  const close = useCallback(() => {
    if (timer.current !== undefined) return // fermeture déjà en cours
    if (reducedMotion()) return onCloseRef.current()
    setClosing(true)
    timer.current = setTimeout(() => onCloseRef.current(), EXIT_MS)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])
  return createPortal(
    <div className={`modal-backdrop${closing ? ' closing' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className={`modal ${props.wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={props.title}>
        <div className="modal-head">
          <h2>{props.title}</h2>
          <button className="icon-btn" onClick={close} aria-label="Fermer">×</button>
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

// ---------- Actions sur une ligne de tableau ----------

export type RowAction = {
  label: string
  icon: Icon
  onClick: () => void
  tone?: 'primary' | 'success' | 'warning' | 'danger'
  hidden?: boolean
  disabled?: boolean
}

/** Boutons d'action d'une ligne (voir, modifier, dupliquer, supprimer…). Le clic ne déclenche pas celui de la ligne. */
export function RowActions({ actions }: { actions: RowAction[] }) {
  const visible = actions.filter((a) => !a.hidden)
  if (!visible.length) return null
  return (
    <div className="row-actions" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      {visible.map((a) => (
        <button
          key={a.label}
          type="button"
          className={`ra-btn${a.tone ? ' ra-' + a.tone : ''}`}
          aria-label={a.label}
          data-tip={a.label}
          disabled={a.disabled}
          onClick={a.onClick}
        >
          <a.icon size={18} weight="duotone" aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}

/** En-tête de page : bandeau coloré à la teinte de la section, avec l'icône de l'écran. */
export function PageHeader(props: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  const { icon: PageIcon } = useContext(PageContext)
  return (
    <div className="page-header page-hero">
      <div className="hero-main">
        {PageIcon && (
          <span className="hero-icon" aria-hidden="true">
            <PageIcon size={26} weight="duotone" />
          </span>
        )}
        <div>
          <h1>{props.title}</h1>
          {props.subtitle && <div className="page-subtitle">{props.subtitle}</div>}
        </div>
      </div>
      {props.actions && <div className="page-actions">{props.actions}</div>}
      <span className="hero-weave" aria-hidden="true" />
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
  return (
    <div className="empty">
      <span className="empty-art" aria-hidden="true"><Tray size={30} weight="duotone" /></span>
      <div>{children}</div>
    </div>
  )
}

export function Loading() {
  return (
    <div className="loading" role="status">
      <span className="loading-label">Chargement…</span>
      <div className="loading-skel" aria-hidden="true">
        <i /><i /><i />
      </div>
    </div>
  )
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
  const ref = useRef<HTMLDivElement>(null)
  const [ind, setInd] = useState<{ x: number; y: number; w: number; h: number; ready: boolean } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const a = el.querySelector<HTMLElement>('.tab.active')
      if (a) setInd((prev) => ({ x: a.offsetLeft, y: a.offsetTop, w: a.offsetWidth, h: a.offsetHeight, ready: !!prev }))
    }
    measure()
    // Les libellés peuvent changer de largeur (police chargée, fenêtre redimensionnée)
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [props.value, props.tabs.length])
  return (
    <div className={`tabs${ind ? ' has-ind' : ''}`} role="tablist" ref={ref}>
      {ind && <span className={`tab-ind${ind.ready ? ' ready' : ''}`} aria-hidden="true" style={{ transform: `translate(${ind.x}px, ${ind.y}px)`, width: ind.w, height: ind.h }} />}
      {props.tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={props.value === t.value} className={`tab ${props.value === t.value ? 'active' : ''}`} onClick={() => props.onChange(t.value)}>
          {t.label}
        </button>
      ))}
    </div>
  )
}
