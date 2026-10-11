// Fenêtre « mise à jour disponible » : proposée à l'ouverture puis toutes les six heures.
// Rien ne s'installe sans l'accord de l'utilisateur ; « Plus tard » la fait taire une journée
// pour cette version.

import { useEffect, useState } from 'react'
import { ArrowRight, RocketLaunch } from '@phosphor-icons/react'
import { Modal } from './ui'

type Update = { current: string; latest: string; url: string | null; reload?: boolean }

const SNOOZE_KEY = 'iam.update.snooze'
const snoozed = (version: string) => {
  try {
    const s = JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? 'null')
    return s?.version === version && Date.now() < s.until
  } catch {
    return false
  }
}

export function UpdatePrompt() {
  const [update, setUpdate] = useState<Update | null>(null)

  useEffect(() => {
    if (!window.erp.checkUpdate) return
    let stopped = false
    const check = async () => {
      const u = await window.erp.checkUpdate!().catch(() => null)
      if (!stopped && u && !snoozed(u.latest)) setUpdate(u)
    }
    // Après l'arrivée sur le tableau de bord, pour ne pas couper l'élan de l'ouverture
    const first = setTimeout(check, 5000)
    const every = setInterval(check, 6 * 3600_000)
    return () => {
      stopped = true
      clearTimeout(first)
      clearInterval(every)
    }
  }, [])

  if (!update) return null
  const later = () => {
    try {
      localStorage.setItem(SNOOZE_KEY, JSON.stringify({ version: update.latest, until: Date.now() + 24 * 3600_000 }))
    } catch {
      /* stockage indisponible : la fenêtre reviendra au prochain contrôle */
    }
    setUpdate(null)
  }
  const go = () => {
    if (update.reload) return location.reload()
    if (update.url) void window.erp.openExternal?.(update.url)
    later()
  }
  const mobile = window.erp.kind === 'mobile'
  return (
    <Modal
      title="Mise à jour disponible"
      onClose={later}
      footer={
        <>
          <button className="btn" onClick={later}>Plus tard</button>
          {(update.reload || update.url) && <button className="btn btn-primary" autoFocus onClick={go}>{update.reload ? 'Recharger maintenant' : 'Télécharger la mise à jour'}</button>}
        </>
      }
    >
      <div className="update-pop">
        <span className="update-art" aria-hidden="true"><RocketLaunch size={44} weight="duotone" /></span>
        <div className="update-versions" aria-label={`Version ${update.current} vers version ${update.latest}`}>
          <span className="update-v old">{update.current}</span>
          <ArrowRight size={22} aria-hidden="true" />
          <span className="update-v new">{update.latest}</span>
        </div>
        <p>
          {update.reload
            ? 'Une nouvelle version de l’application est en ligne. Rechargez la page pour en profiter : vos données ne sont pas concernées.'
            : mobile
              ? 'Une nouvelle version est prête. Le téléchargement s’ouvre dans le navigateur ; installez-la par-dessus l’application actuelle, vos données sont conservées.'
              : 'Une nouvelle version est prête. L’installateur se télécharge dans votre navigateur ; fermez l’application puis lancez-le, vos données sont conservées.'}
        </p>
        {!update.reload && !update.url && <p className="muted small">Aucun installateur trouvé pour cet appareil : demandez-le à votre administrateur.</p>}
      </div>
    </Modal>
  )
}
