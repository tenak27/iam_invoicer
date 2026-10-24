// Invitation « Installer l'application » dans le navigateur (base commune des applications IAM :
// source iam-erp/tools/socle, recopiée par sync.mjs ; ne pas modifier ici). Android et ordinateur :
// l'invite du navigateur (icône sur l'écran d'accueil, plein écran, rien à télécharger) ; iPhone : la
// marche à suivre (Partager puis « Sur l'écran d'accueil »). Jamais dans l'application installée ;
// une carte à la fois ; « Plus tard » : de nouveau dans un mois.
import { useEffect, useState } from 'react'

const LATER_KEY = 'iam.socle.install.later'

const laterUntil = () => {
  try {
    return Number(localStorage.getItem(LATER_KEY) || 0)
  } catch {
    return 0
  }
}
const postpone = () => {
  try {
    localStorage.setItem(LATER_KEY, String(Date.now() + 30 * 86_400_000))
  } catch {
    /* stockage indisponible : la proposition reviendra */
  }
}
/** Application installée (téléphone, ordinateur) ou déjà ouverte depuis l'écran d'accueil. */
const installedApp = () =>
  !!(window as any).Capacitor?.isNativePlatform?.() ||
  location.protocol === 'file:' ||
  /Electron/i.test(navigator.userAgent) ||
  matchMedia('(display-mode: standalone)').matches ||
  (navigator as any).standalone === true

/**
 * « eligible » : true pour proposer, false pour ne jamais proposer (démonstration), null pour revoir
 * plus tard (pas encore connecté).
 */
export function InstallPrompt({ app, eligible }: { app: string; eligible: () => Promise<boolean | null> | boolean | null }) {
  const [prompt, setPrompt] = useState<any>(null)
  const [ios, setIos] = useState(false)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (installedApp() || Date.now() < laterUntil()) return
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setPrompt(e)
    }
    const onInstalled = () => setPrompt(null)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    const iosSafari = /iPhone|iPad|iPod/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent)
    // Après quelques instants d'utilisation, et quand aucune autre carte n'est affichée
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const check = async () => {
      if (!alive) return
      const ok = document.querySelector('.socle-stack .socle-card') ? null : await eligible()
      if (!alive || ok === false) return
      if (ok === null) {
        timer = setTimeout(check, 30_000)
        return
      }
      setIos(iosSafari)
      setReady(true)
    }
    timer = setTimeout(check, 40_000)
    return () => {
      alive = false
      clearTimeout(timer)
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (!ready || (!prompt && !ios)) return null
  const later = () => {
    postpone()
    setPrompt(null)
    setIos(false)
  }
  const install = async () => {
    const p = prompt
    setPrompt(null)
    try {
      await p.prompt()
      const choice = await p.userChoice
      if (choice?.outcome !== 'accepted') postpone()
    } catch {
      /* invite refusée par le navigateur */
    }
  }
  return (
    <div className="socle-card socle-install" role="dialog" aria-label="Installer l’application">
      <div className="socle-update-head">
        <span className="socle-update-dot" aria-hidden="true" />
        <b>Installer {app} sur cet appareil ?</b>
      </div>
      {prompt ? (
        <p>Une icône sur l’écran d’accueil et l’application en plein écran, sans rien télécharger : elle se met à jour toute seule.</p>
      ) : (
        <p>Pour l’avoir sur l’écran d’accueil : touchez <b>Partager</b> (le carré avec une flèche), puis <b>« Sur l’écran d’accueil »</b>.</p>
      )}
      <div className="socle-update-actions">
        <button type="button" className="socle-btn" onClick={later}>{prompt ? 'Plus tard' : 'J’ai compris'}</button>
        {prompt && <button type="button" className="socle-btn socle-btn-primary" onClick={() => void install()}>Installer</button>}
      </div>
    </div>
  )
}
