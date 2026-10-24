// Avis de la base commune des applications IAM (source iam-erp/tools/socle ; ne pas modifier ici) :
// version de démonstration, mise à jour disponible, proposition d'activer les notifications et
// d'installer l'application depuis le navigateur, retour du paiement d'une licence et guide d'utilisation.
import { useEffect, useState } from 'react'
import { DemoBanner, demoStatus, installed } from './demo'
import { LicenceNotices, type GuideStep } from './licence'
import { UpdateNotice } from './update'
import { enableNotifications, notificationState, watchNotifications, type NotifOptions } from './notifications'

const LATER_KEY = 'iam.socle.notify.later'
const INSTALL_LATER_KEY = 'iam.socle.install.later'

const laterUntil = (key: string) => {
  try {
    return Number(localStorage.getItem(key) || 0)
  } catch {
    return 0
  }
}
const postpone = (key: string, days: number) => {
  try {
    localStorage.setItem(key, String(Date.now() + days * 86_400_000))
  } catch {
    /* stockage indisponible : la proposition reviendra */
  }
}

/**
 * Dans le navigateur, une fois connecté (jamais en démonstration ni dans l'application installée) :
 * proposer d'installer l'application sur l'appareil. Android et ordinateur : l'invite du navigateur
 * (icône sur l'écran d'accueil, plein écran, rien à télécharger) ; iPhone : la marche à suivre
 * (Partager puis « Sur l'écran d'accueil »). « Plus tard » : de nouveau dans un mois.
 */
export function InstallPrompt({ server, token, app }: { server: () => string; token: () => string | null; app: string }) {
  const [prompt, setPrompt] = useState<any>(null)
  const [ios, setIos] = useState(false)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true
    if (standalone || installed() || Date.now() < laterUntil(INSTALL_LATER_KEY)) return
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setPrompt(e)
    }
    const onInstalled = () => setPrompt(null)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    const iosSafari = /iPhone|iPad|iPod/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent)
    // Après quelques instants d'utilisation, seulement pour une vraie session (pas la démonstration),
    // et quand aucune autre carte n'est affichée (notifications, mise à jour) : une seule à la fois
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const check = async () => {
      const t = token()
      if (!alive) return
      if (!t || document.querySelector('.socle-stack .socle-card')) {
        timer = setTimeout(check, 30_000)
        return
      }
      const status = await demoStatus(server, t)
      if (!alive || status?.demo) return
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
    postpone(INSTALL_LATER_KEY, 30)
    setPrompt(null)
    setIos(false)
  }
  const install = async () => {
    const p = prompt
    setPrompt(null)
    try {
      await p.prompt()
      const choice = await p.userChoice
      if (choice?.outcome !== 'accepted') postpone(INSTALL_LATER_KEY, 30)
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

/** « Recevoir les notifications ? » : proposé une fois connecté, tant que l'appareil n'a pas répondu. */
export function NotifyPrompt(o: NotifOptions) {
  const [ask, setAsk] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const stop = watchNotifications(o)
    let alive = true
    const check = async () => {
      let later = 0
      try {
        later = Number(localStorage.getItem(LATER_KEY) || 0)
      } catch {
        /* stockage indisponible */
      }
      const s = o.token() && Date.now() >= later ? await notificationState() : 'unsupported'
      if (alive) setAsk(s === 'default')
    }
    // Après l'arrivée dans l'application, pour ne pas couper l'élan de l'ouverture
    const first = setTimeout(check, 12_000)
    const every = setInterval(check, 60_000)
    return () => {
      alive = false
      stop()
      clearTimeout(first)
      clearInterval(every)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (!ask) return null
  const later = () => {
    try {
      localStorage.setItem(LATER_KEY, String(Date.now() + 7 * 86_400_000))
    } catch {
      /* stockage indisponible : la proposition reviendra */
    }
    setAsk(false)
  }
  const enable = async () => {
    setBusy(true)
    const s = await enableNotifications(o).catch(() => 'default' as const)
    setBusy(false)
    if (s === 'granted' || s === 'denied') setAsk(false)
  }
  return (
    <div className="socle-card socle-notify" role="dialog" aria-label="Notifications">
      <div className="socle-update-head">
        <span className="socle-update-dot" aria-hidden="true" />
        <b>Recevoir les notifications ?</b>
      </div>
      <p>Soyez prévenu sur cet appareil de ce qui compte ({o.app}), même quand l’application est fermée.</p>
      <div className="socle-update-actions">
        <button type="button" className="socle-btn" onClick={later}>Plus tard</button>
        <button type="button" className="socle-btn socle-btn-primary" onClick={enable} disabled={busy}>{busy ? 'Un instant…' : 'Activer'}</button>
      </div>
    </div>
  )
}

export function SocleNotices(props: { server: () => string; open: (url: string) => unknown; token: () => string | null; setToken?: (t: string | null) => void; app: string; guide?: GuideStep[] }) {
  return (
    <div className="socle-stack">
      {props.setToken && <DemoBanner server={props.server} token={props.token} setToken={props.setToken} />}
      {props.guide && <LicenceNotices server={props.server} token={props.token} app={props.app} guide={props.guide} />}
      <NotifyPrompt server={props.server} token={props.token} app={props.app} />
      <InstallPrompt server={props.server} token={props.token} app={props.app} />
      <UpdateNotice server={props.server} open={props.open} />
    </div>
  )
}
