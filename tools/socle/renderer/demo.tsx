// Version de démonstration (base commune des applications IAM : source iam-erp/tools/socle ;
// ne pas modifier ici). Le bouton « Version démo » du site mène à /app/#/demo : dans le navigateur
// seulement, le serveur ouvre un espace fictif séparé des comptes réels (effacé après 24 heures)
// et l'interface s'y connecte. Les applications installées ne proposent pas de démonstration.
import { useEffect, useState } from 'react'

const PREVIOUS_KEY = 'iam.socle.demo.previous'
const ERROR_KEY = 'iam.socle.demo.error'
const FOLDED_KEY = 'iam.socle.demo.folded'

export interface DemoHooks {
  server: () => string
  token: () => string | null
  setToken: (t: string | null) => void
}

const installed = () => !!(window as any).Capacitor?.isNativePlatform?.() || location.protocol === 'file:' || /Electron/i.test(navigator.userAgent)

function read(store: Storage, k: string): string | null {
  try {
    return store.getItem(k)
  } catch {
    return null
  }
}

function write(store: Storage, k: string, v: string | null) {
  try {
    if (v === null) store.removeItem(k)
    else store.setItem(k, v)
  } catch {
    /* stockage indisponible */
  }
}

async function demoStatus(server: () => string, token: string): Promise<{ demo: boolean; expires_at: string | null } | null> {
  try {
    const res = await fetch(server() + '/api/socle/demo/status', { headers: { Authorization: `Bearer ${token}` } })
    const json = await res.json()
    return json?.ok ? json.data : null
  } catch {
    return null
  }
}

/** Au démarrage (main.tsx), avant le premier affichage : ouvre la démonstration demandée par #/demo. */
export async function startDemoIfAsked(h: DemoHooks): Promise<void> {
  let hash = location.hash
  try {
    hash = decodeURIComponent(hash)
  } catch {
    /* adresse mal formée : laissée telle quelle */
  }
  if (!/^#\/?d[ée]mo(nstration)?\/?$/i.test(hash)) return
  history.replaceState(null, '', location.pathname + location.search + '#/')
  if (installed()) return
  const root = document.getElementById('root')
  if (root) root.innerHTML = '<div class="socle-demo-boot"><span class="socle-update-dot"></span>Préparation de votre démonstration…</div>'
  try {
    const res = await fetch(h.server() + '/api/socle/demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const json = await res.json().catch(() => null)
    if (!json?.ok) throw new Error(json?.error || 'Démonstration indisponible pour le moment.')
    // Une vraie session déjà ouverte dans ce navigateur est mise de côté, puis rendue en quittant la démo
    const previous = h.token()
    if (previous && !(await demoStatus(h.server, previous))?.demo) write(localStorage, PREVIOUS_KEY, previous)
    h.setToken(json.data.token)
    write(sessionStorage, FOLDED_KEY, null)
  } catch (e: any) {
    write(sessionStorage, ERROR_KEY, e?.message || 'Démonstration indisponible pour le moment.')
  }
  if (root) root.innerHTML = ''
}

function hoursLeft(iso: string | null): string {
  if (!iso) return ''
  const h = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 3_600_000))
  return h <= 1 ? 'dans moins d’une heure' : `dans ${h} h`
}

/** Bandeau des espaces de démonstration : données fictives, durée restante, passage au vrai compte. */
export function DemoBanner(h: DemoHooks) {
  const [expires, setExpires] = useState<string | null | undefined>(undefined)
  const [error, setError] = useState(() => read(sessionStorage, ERROR_KEY))
  const [folded, setFolded] = useState(() => read(sessionStorage, FOLDED_KEY) === '1')
  useEffect(() => {
    let last: string | null | undefined
    let alive = true
    const check = async () => {
      const t = h.token()
      if (t === last) return
      last = t
      const st = t ? await demoStatus(h.server, t) : null
      if (alive) setExpires(st?.demo ? st.expires_at : undefined)
    }
    void check()
    const every = setInterval(check, 2000)
    return () => {
      alive = false
      clearInterval(every)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (error)
    return (
      <div className="socle-card socle-demo" role="alert">
        <div className="socle-update-head">
          <span className="socle-update-dot" aria-hidden="true" />
          <b>Démonstration indisponible</b>
        </div>
        <p>{error}</p>
        <div className="socle-update-actions">
          <button type="button" className="socle-btn" onClick={() => (write(sessionStorage, ERROR_KEY, null), setError(null))}>Fermer</button>
        </div>
      </div>
    )
  if (expires === undefined) return null

  const leave = (to: 'site' | 'inscription') => {
    const previous = read(localStorage, PREVIOUS_KEY)
    write(localStorage, PREVIOUS_KEY, null)
    write(sessionStorage, FOLDED_KEY, null)
    h.setToken(to === 'site' ? previous : null)
    if (to === 'site') location.href = '/'
    else {
      location.replace(location.pathname + location.search + '#/inscription')
      location.reload()
    }
  }
  const fold = (v: boolean) => {
    write(sessionStorage, FOLDED_KEY, v ? '1' : null)
    setFolded(v)
  }

  if (folded)
    return (
      <button type="button" className="socle-demo-pill" onClick={() => fold(false)} aria-label="Version de démonstration : afficher les détails">
        <span className="socle-update-dot" aria-hidden="true" />
        Démo
      </button>
    )
  return (
    <div className="socle-card socle-demo" role="status">
      <div className="socle-update-head">
        <span className="socle-update-dot" aria-hidden="true" />
        <b>Version de démonstration</b>
        <button type="button" className="socle-demo-fold" onClick={() => fold(true)} aria-label="Réduire">×</button>
      </div>
      <p>Données fictives, rien que pour vous : tout est effacé automatiquement {hoursLeft(expires)}. Pour travailler avec vos vraies données, créez votre compte.</p>
      <div className="socle-update-actions">
        <button type="button" className="socle-btn" onClick={() => leave('site')}>Quitter</button>
        <button type="button" className="socle-btn socle-btn-primary" onClick={() => leave('inscription')}>Créer mon vrai compte</button>
      </div>
    </div>
  )
}
