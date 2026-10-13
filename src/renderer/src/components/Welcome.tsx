// Écran de bienvenue : affiché quand une base vient d'être connectée, puis à l'ouverture de
// session. Nom et logo de la société, quelques secondes, puis il s'efface (un clic le ferme).

import { useEffect, useState, type CSSProperties } from 'react'
import { CheckCircle } from '@phosphor-icons/react'

export interface WelcomeInfo {
  name: string
  logo?: string
  color?: string
  /** Ligne sous le nom : « Base en ligne connectée », « Bonjour Awa »… */
  line?: string
  /** Base tout juste connectée : coche de confirmation. */
  connected?: boolean
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'IAM'

export function WelcomeSplash({ info, onDone }: { info: WelcomeInfo; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const out = setTimeout(() => setLeaving(true), reduced ? 1400 : 2700)
    const done = setTimeout(onDone, reduced ? 1600 : 3200)
    const key = (e: KeyboardEvent) => (e.key === 'Escape' || e.key === 'Enter') && onDone()
    window.addEventListener('keydown', key)
    return () => {
      clearTimeout(out)
      clearTimeout(done)
      window.removeEventListener('keydown', key)
    }
  }, [onDone])
  const name = info.name || 'votre société'
  return (
    <div className={`welcome ${leaving ? 'leaving' : ''}`} role="status" aria-live="polite" onClick={onDone} style={info.color ? ({ '--welcome': info.color } as CSSProperties) : undefined}>
      <div className="welcome-glow" aria-hidden="true"><i /><i /><i /></div>
      <div className="welcome-sparks" aria-hidden="true">{Array.from({ length: 14 }, (_, i) => <b key={i} style={{ '--i': i } as CSSProperties} />)}</div>
      <div className="welcome-body">
        <div className="welcome-logo">
          <span className="welcome-ring" aria-hidden="true" />
          <span className="welcome-ring r2" aria-hidden="true" />
          {info.logo ? <img src={info.logo} alt="" /> : <span className="welcome-initials">{initials(name)}</span>}
          {info.connected && <span className="welcome-check" aria-hidden="true"><CheckCircle size={30} weight="fill" /></span>}
        </div>
        <p className="welcome-kicker">Bienvenue dans</p>
        <h1 className="welcome-name" aria-label={name}>
          {name.split(' ').map((word, w) => (
            <span key={w} className="welcome-word" style={{ '--w': w } as CSSProperties} aria-hidden="true">{word}</span>
          ))}
        </h1>
        {info.line && <p className="welcome-line">{info.line}</p>}
        <div className="welcome-bar" aria-hidden="true"><i /></div>
      </div>
      <span className="sr-only">Bienvenue dans {name}. {info.line}</span>
    </div>
  )
}
