// « Mise à jour disponible » (base commune des applications IAM : la source est
// iam-erp/tools/socle, recopiée dans chaque application par sync.mjs ; ne pas modifier ici).
//
// - Application installée (Windows, macOS, Linux, Android) : le serveur propose un installateur
//   plus récent (/api/downloads) → bouton « Télécharger la mise à jour ».
// - Navigateur : le serveur est passé à une version plus récente que la page ouverte → « Recharger ».
// Contrôle quelques secondes après l'ouverture, au retour dans l'application (une fois par heure
// au plus) et toutes les six heures. « Plus tard » fait taire cette version pendant un jour.
import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { compareVersions, pickFile } from './versions'

declare const __APP_VERSION__: string

export interface Update {
  current: string
  latest: string
  /** Installateur pour cet appareil ; null : la page se recharge simplement. */
  url: string | null
  reload: boolean
  size?: number
}

const isDesktop = () => location.protocol === 'file:' || /Electron/i.test(navigator.userAgent)

async function device(): Promise<{ platform: 'web' | 'windows' | 'macos' | 'linux' | 'android' | 'ios'; arch: 'arm64' | 'x64' | null }> {
  if (Capacitor.isNativePlatform()) return { platform: Capacitor.getPlatform() === 'ios' ? 'ios' : 'android', arch: null }
  if (!isDesktop()) return { platform: 'web', arch: null }
  const ua = navigator.userAgent
  let arch: 'arm64' | 'x64' = 'x64'
  try {
    const h = await (navigator as any).userAgentData?.getHighEntropyValues?.(['architecture'])
    if (h?.architecture === 'arm') arch = 'arm64'
  } catch {
    /* processeur inconnu : version Intel */
  }
  return { platform: /Mac/i.test(ua) ? 'macos' : /Linux/i.test(ua) ? 'linux' : 'windows', arch }
}

export async function checkUpdate(server: string): Promise<Update | null> {
  const current = __APP_VERSION__
  const d = await device()
  const get = async (path: string) => {
    const r = await fetch(server + path, { cache: 'no-store' })
    return r.ok ? (await r.json())?.data : null
  }
  if (d.platform === 'web') {
    const latest = (await get('/api/status'))?.version
    return latest && compareVersions(latest, current) > 0 ? { current, latest, url: null, reload: true } : null
  }
  // iPhone : une application ne s'installe pas hors de l'App Store ou de TestFlight
  if (d.platform === 'ios') return null
  const data = await get('/api/downloads')
  const file = pickFile(data?.files ?? [], d.platform, d.arch)
  if (!file?.version || compareVersions(file.version, current) <= 0) return null
  return { current, latest: file.version, url: new URL(file.url, server + '/').href, reload: false, size: file.size }
}

const SNOOZE_KEY = 'iam.socle.update.snooze'
const snoozed = (version: string) => {
  try {
    const s = JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? 'null')
    return s?.version === version && Date.now() < s.until
  } catch {
    return false
  }
}

const mb = (n?: number) => (n ? ` (${Math.max(1, Math.round(n / 1_048_576))} Mo)` : '')

export function UpdateNotice({ server, open }: { server: () => string; open: (url: string) => unknown }) {
  const [update, setUpdate] = useState<Update | null>(null)

  useEffect(() => {
    if (import.meta.env.DEV) return
    let stopped = false
    let last = 0
    const run = async () => {
      last = Date.now()
      const u = await checkUpdate(server()).catch(() => null)
      if (!stopped && u && !snoozed(u.latest)) setUpdate(u)
    }
    const first = setTimeout(run, 6000)
    const every = setInterval(run, 6 * 3600_000)
    const back = () => {
      if (document.visibilityState === 'visible' && Date.now() - last > 3600_000) void run()
    }
    document.addEventListener('visibilitychange', back)
    return () => {
      stopped = true
      clearTimeout(first)
      clearInterval(every)
      document.removeEventListener('visibilitychange', back)
    }
  }, [server])

  if (!update) return null
  const later = () => {
    try {
      localStorage.setItem(SNOOZE_KEY, JSON.stringify({ version: update.latest, until: Date.now() + 24 * 3600_000 }))
    } catch {
      /* stockage indisponible : l'avis reviendra au prochain contrôle */
    }
    setUpdate(null)
  }
  const go = () => {
    if (update.reload) return location.reload()
    if (update.url) void open(update.url)
    later()
  }
  const android = Capacitor.getPlatform() === 'android'
  return (
    <div className="socle-card socle-update" role="dialog" aria-live="polite" aria-label="Mise à jour disponible">
      <div className="socle-update-head">
        <span className="socle-update-dot" aria-hidden="true" />
        <b>Mise à jour disponible</b>
        <span className="socle-update-v">
          {update.current} → <strong>{update.latest}</strong>
        </span>
      </div>
      <p>
        {update.reload
          ? 'Une nouvelle version est en ligne : rechargez pour en profiter. Vos données ne sont pas concernées.'
          : android
            ? `La nouvelle version se télécharge${mb(update.size)} : ouvrez le fichier et installez-la par-dessus l'application. Vos données sont conservées.`
            : `L'installateur se télécharge${mb(update.size)} : fermez l'application puis lancez-le. Vos données sont conservées.`}
      </p>
      <div className="socle-update-actions">
        <button type="button" className="socle-btn" onClick={later}>Plus tard</button>
        <button type="button" className="socle-btn socle-btn-primary" onClick={go} autoFocus>
          {update.reload ? 'Recharger' : 'Télécharger'}
        </button>
      </div>
    </div>
  )
}
