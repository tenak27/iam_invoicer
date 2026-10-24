// Base commune des applications IAM : la source est iam-erp/tools/socle, recopiée dans chaque
// application par sync.mjs. Ne pas modifier ici.
//
// Saisie courte dans une fenêtre de l'application, à la place de window.prompt() : celui-ci n'existe pas
// dans les applications de bureau (Electron le refuse) et ne ressemble pas au reste de l'interface.
//   const nom = await ask({ title: 'Nouveau dossier', label: 'Nom du dossier', ok: 'Créer' })  // null si annulé
//   const mode = await ask({ title: 'Payer', label: 'Mode de paiement', choices: [{ value: 'especes', label: 'Espèces' }, …] })
// La fenêtre reprend les classes des fenêtres de l'application (modal, field, btn) : même allure, même thème.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'

export type AskOptions = {
  title: string
  label: string
  value?: string
  placeholder?: string
  hint?: string
  /** Texte du bouton de validation (« Valider » par défaut) */
  ok?: string
  danger?: boolean
  /** Texte libre (par défaut), adresse web, ou code chiffré (clavier numérique sur téléphone) */
  kind?: 'text' | 'url' | 'code'
  /** Choix parmi des valeurs fixes, présentés en boutons, au lieu d'un champ */
  choices?: { value: string; label: string }[]
  /** Réponse obligatoire : le bouton reste inactif tant que le champ est vide (vrai par défaut) */
  required?: boolean
  multiline?: boolean
}

const EXIT_MS = 160
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Ouvre la fenêtre et rend la réponse, ou null si l'utilisateur annule. */
export function ask(opts: AskOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const done = (v: string | null) => {
      resolve(v)
      setTimeout(() => {
        root.unmount()
        host.remove()
      }, 0)
    }
    root.render(<AskDialog opts={opts} onDone={done} />)
  })
}

function AskDialog({ opts, onDone }: { opts: AskOptions; onDone: (v: string | null) => void }) {
  const [value, setValue] = useState(opts.value ?? opts.choices?.[0]?.value ?? '')
  const [closing, setClosing] = useState(false)
  const leaving = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const finish = (v: string | null) => {
    if (leaving.current) return
    leaving.current = true
    if (reduced()) return onDone(v)
    setClosing(true)
    setTimeout(() => onDone(v), EXIT_MS)
  }
  const finishRef = useRef(finish)
  finishRef.current = finish
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    const field = input.current ?? area.current
    field?.focus()
    field?.select()
    // Échap ferme cette fenêtre seulement (pas celle qui l'a ouverte) : écoute en capture, puis arrêt
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      finishRef.current(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      before?.focus?.()
    }
  }, [])
  const required = opts.required ?? true
  const empty = !value.trim()
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (required && empty) return
    finish(opts.kind === 'code' ? value.replace(/\s+/g, '') : value.trim())
  }
  return (
    <div className={`modal-backdrop${closing ? ' closing' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && finish(null)}>
      <form className="modal ask" role="dialog" aria-modal="true" aria-label={opts.title} onSubmit={submit}>
        <div className="modal-head">
          <h2>{opts.title}</h2>
          <button type="button" className="icon-btn" onClick={() => finish(null)} aria-label="Fermer">×</button>
        </div>
        <div className="modal-body">
          {opts.choices ? (
            <div className="field">
              <span className="field-label">{opts.label}</span>
              <div className="ask-choices" role="radiogroup" aria-label={opts.label}>
                {opts.choices.map((c) => (
                  <button key={c.value} type="button" role="radio" aria-checked={value === c.value} className={`btn${value === c.value ? ' btn-primary' : ''}`} onClick={() => setValue(c.value)}>
                    {c.label}
                  </button>
                ))}
              </div>
              {opts.hint && <span className="field-hint">{opts.hint}</span>}
            </div>
          ) : (
            <label className="field">
              <span className="field-label">{opts.label}</span>
              {opts.multiline ? (
                <textarea ref={area} rows={3} value={value} placeholder={opts.placeholder} onChange={(e) => setValue(e.target.value)} />
              ) : (
                <input
                  ref={input}
                  value={value}
                  placeholder={opts.placeholder}
                  onChange={(e) => setValue(e.target.value)}
                  type={opts.kind === 'url' ? 'url' : 'text'}
                  inputMode={opts.kind === 'code' ? 'numeric' : opts.kind === 'url' ? 'url' : undefined}
                  autoComplete={opts.kind === 'code' ? 'one-time-code' : 'off'}
                  maxLength={opts.kind === 'code' ? 8 : undefined}
                />
              )}
              {opts.hint && <span className="field-hint">{opts.hint}</span>}
            </label>
          )}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={() => finish(null)}>
            Annuler
          </button>
          <button type="submit" className={`btn ${opts.danger ? 'btn-danger' : 'btn-primary'}`} disabled={required && empty}>
            {opts.ok ?? 'Valider'}
          </button>
        </div>
      </form>
    </div>
  )
}
