// Bandeau de la version de démonstration : société fictive du site (/t/demonstration/), partagée par
// les visiteurs et remise à neuf toutes les 3 heures (server/demo.ts). Mêmes styles que les autres
// applications IAM (socle/socle.css).
import { useState } from 'react'

const SLUG = 'demonstration'
const FOLDED = 'iam.demo.folded'

function read(k: string): string | null {
  try {
    return sessionStorage.getItem(k)
  } catch {
    return null
  }
}

export function DemoNotice() {
  const [folded, setFolded] = useState(() => read(FOLDED) === '1')
  if (typeof location === 'undefined' || !location.pathname.startsWith(`/t/${SLUG}/`)) return null
  const fold = (v: boolean) => {
    try {
      if (v) sessionStorage.setItem(FOLDED, '1')
      else sessionStorage.removeItem(FOLDED)
    } catch {
      /* stockage indisponible */
    }
    setFolded(v)
  }
  const leave = (to: string) => {
    try {
      localStorage.removeItem(`t:${SLUG}:iam.token`)
    } catch {
      /* stockage indisponible */
    }
    location.href = to
  }
  return (
    <div className="socle-stack">
      {folded ? (
        <button type="button" className="socle-demo-pill" onClick={() => fold(false)} aria-label="Version de démonstration : afficher les détails">
          <span className="socle-update-dot" aria-hidden="true" />
          Démo
        </button>
      ) : (
        <div className="socle-card socle-demo" role="status">
          <div className="socle-update-head">
            <span className="socle-update-dot" aria-hidden="true" />
            <b>Version de démonstration</b>
            <button type="button" className="socle-demo-fold" onClick={() => fold(true)} aria-label="Réduire">×</button>
          </div>
          <p>Société fictive, partagée avec les autres visiteurs et remise à neuf toutes les 3 heures : aucun e-mail ni SMS n’en part. Pour vos vraies factures, créez votre compte.</p>
          <div className="socle-update-actions">
            <button type="button" className="socle-btn" onClick={() => leave('/')}>Quitter</button>
            <button type="button" className="socle-btn socle-btn-primary" onClick={() => leave('/#inscription')}>Créer mon vrai compte</button>
          </div>
        </div>
      )}
    </div>
  )
}
