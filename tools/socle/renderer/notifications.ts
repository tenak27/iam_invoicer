// Notifications de l'appareil (base commune des applications IAM : source iam-erp/tools/socle,
// recopiée par sync.mjs ; ne pas modifier ici).
// - Navigateur (et application ajoutée à l'écran d'accueil) : Web Push par le service worker
//   « socle/sw.js », de portée réduite pour ne pas remplacer celui de l'application ; reçues même
//   onglet fermé.
// - Android (application installée) : service natif SocleNotif, qui relève le fil toutes les
//   15 minutes, application fermée.
// - Windows, macOS, Linux : la relève est faite par l'application de bureau (desktop/socle.ts).
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

interface SocleNotifPlugin {
  configure(o: { server: string; token: string; app: string }): Promise<void>
  stop(): Promise<void>
  check(): Promise<{ granted: boolean }>
  requestPermission(): Promise<{ granted: boolean }>
  launchUrl(): Promise<{ url: string }>
  addListener(event: 'open', fn: (e: { url: string }) => void): Promise<PluginListenerHandle>
}
const Native = registerPlugin<SocleNotifPlugin>('SocleNotif')

export type NotifState = 'unsupported' | 'denied' | 'default' | 'granted'
export interface NotifOptions {
  server: () => string
  token: () => string | null
  app: string
}

const android = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
const desktop = () => location.protocol === 'file:' || /Electron/i.test(navigator.userAgent)
const webPushable = () => !Capacitor.isNativePlatform() && !desktop() && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

export async function notificationState(): Promise<NotifState> {
  if (android()) return (await Native.check().catch(() => null))?.granted ? 'granted' : 'default'
  if (!webPushable()) return 'unsupported'
  return Notification.permission as NotifState
}

function keyBytes(base64url: string): Uint8Array {
  const b64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

async function subscribeWeb(o: NotifOptions, token: string) {
  const reg = await navigator.serviceWorker.register('./socle/sw.js', { scope: './socle/' })
  const key = (await (await fetch(o.server() + '/api/socle/push/key')).json())?.data?.key
  if (!key) return
  let sub = await reg.pushManager.getSubscription()
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) as BufferSource })
  await fetch(o.server() + '/api/socle/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ subscription: sub.toJSON(), device: navigator.userAgent.slice(0, 120) })
  })
}

/** Demandée par un geste de l'utilisateur (bouton « Activer ») : autorisation puis abonnement. */
export async function enableNotifications(o: NotifOptions): Promise<NotifState> {
  const token = o.token()
  if (!token) return 'default'
  if (android()) {
    const r = await Native.requestPermission().catch(() => ({ granted: false }))
    if (r.granted) await Native.configure({ server: o.server(), token, app: o.app }).catch(() => {})
    return r.granted ? 'granted' : 'denied'
  }
  if (!webPushable()) return 'unsupported'
  const p = await Notification.requestPermission()
  if (p === 'granted') await subscribeWeb(o, token).catch((e) => console.warn('Notifications :', e))
  return p as NotifState
}

let synced = ''
/**
 * Suit la session : abonnement de l'appareil quand un utilisateur est connecté (si les
 * notifications sont déjà autorisées), désabonnement à la déconnexion (appareil partagé).
 */
export function watchNotifications(o: NotifOptions): () => void {
  const check = async () => {
    const token = o.token()
    const key = token ? `${o.server()}|${token}` : ''
    if (key === synced) return
    const was = synced
    synced = key
    try {
      if (android()) {
        if (token) await Native.configure({ server: o.server(), token, app: o.app })
        else if (was) await Native.stop()
        return
      }
      if (!webPushable()) return
      if (token && Notification.permission === 'granted') await subscribeWeb(o, token)
      else if (!token && was) {
        const reg = await navigator.serviceWorker.getRegistration('./socle/')
        await (await reg?.pushManager.getSubscription())?.unsubscribe()
      }
    } catch (e) {
      synced = was // nouvel essai au prochain contrôle
      console.warn('Notifications :', e)
    }
  }
  void check()
  const timer = setInterval(() => void check(), 15_000)
  const back = () => document.visibilityState === 'visible' && void check()
  document.addEventListener('visibilitychange', back)
  // Notification touchée : écran concerné
  const go = (url: string) => {
    if (url) location.hash = url.startsWith('#') ? url : '#' + url
  }
  let listener: PluginListenerHandle | null = null
  if (android()) {
    void Native.launchUrl().then((r) => go(r.url)).catch(() => {})
    void Native.addListener('open', (e) => go(e.url)).then((h) => (listener = h)).catch(() => {})
  } else if (webPushable()) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'socle-open') go(String(e.data.url ?? ''))
    })
  }
  return () => {
    clearInterval(timer)
    document.removeEventListener('visibilitychange', back)
    void listener?.remove()
  }
}
