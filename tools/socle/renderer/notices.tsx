// Avis de la base commune des applications IAM (source iam-erp/tools/socle ; ne pas modifier ici) :
// mise à jour disponible, et proposition d'activer les notifications sur l'appareil.
import { useEffect, useState } from 'react'
import { UpdateNotice } from './update'
import { enableNotifications, notificationState, watchNotifications, type NotifOptions } from './notifications'

const LATER_KEY = 'iam.socle.notify.later'

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

export function SocleNotices(props: { server: () => string; open: (url: string) => unknown; token: () => string | null; app: string }) {
  return (
    <div className="socle-stack">
      <NotifyPrompt server={props.server} token={props.token} app={props.app} />
      <UpdateNotice server={props.server} open={props.open} />
    </div>
  )
}
