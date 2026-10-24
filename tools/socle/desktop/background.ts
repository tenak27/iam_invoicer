// Application de bureau en arrière-plan (base commune des applications IAM : source
// iam-erp/tools/socle, recopiée par sync.mjs ; ne pas modifier ici).
// - Fermer la fenêtre la range près de l'horloge (zone de notification) : l'application continue de
//   recevoir les notifications. « Quitter » dans le menu de l'icône l'arrête vraiment.
// - « Lancer au démarrage de l'ordinateur » : ouverture discrète à la connexion (sans fenêtre).
// - Relève du fil de notifications du serveur chaque minute, notifications du système ; un clic
//   ouvre l'écran concerné.
import { app, BrowserWindow, Menu, Notification, Tray, nativeImage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface BackgroundOptions {
  name: string
  /** Icône (PNG) de la zone de notification et des notifications. */
  icon: string
  /** Clés du stockage de l'interface : jeton de session et adresse du serveur. */
  tokenKey: string
  serverKey: string
  defaultServer: string
}

const HIDDEN_FLAG = '--en-arriere-plan'
let quitting = false

/** Lancement à l'ouverture de session : la fenêtre reste cachée. */
export const startedHidden = () => process.argv.includes(HIDDEN_FLAG)

export function runInBackground(win: BrowserWindow, opts: BackgroundOptions) {
  app.on('before-quit', () => (quitting = true))
  win.on('close', (e) => {
    if (quitting) return
    e.preventDefault()
    win.hide()
  })
  const show = () => {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
  const image = existsSync(opts.icon) ? nativeImage.createFromPath(opts.icon) : nativeImage.createEmpty()
  const tray = new Tray(image.isEmpty() ? image : image.resize({ width: 16, height: 16 }))
  const menu = () =>
    Menu.buildFromTemplate([
      { label: `Ouvrir ${opts.name}`, click: show },
      {
        label: "Lancer au démarrage de l'ordinateur",
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => {
          app.setLoginItemSettings({ openAtLogin: item.checked, args: [HIDDEN_FLAG] })
          tray.setContextMenu(menu())
        }
      },
      { type: 'separator' },
      { label: 'Quitter', click: () => { quitting = true; app.quit() } }
    ])
  tray.setToolTip(opts.name)
  tray.setContextMenu(menu())
  tray.on('click', show)
  tray.on('double-click', show)
  startPolling(win, opts, show)
  return { show, tray }
}

function startPolling(win: BrowserWindow, opts: BackgroundOptions, show: () => void) {
  const stateFile = join(app.getPath('userData'), 'socle-notifications.json')
  let state: { key: string; last: number } = { key: '', last: -1 }
  try {
    state = JSON.parse(readFileSync(stateFile, 'utf8'))
  } catch {
    /* première relève */
  }
  const save = () => {
    try {
      writeFileSync(stateFile, JSON.stringify(state))
    } catch {
      /* dossier en lecture seule : relève quand même */
    }
  }
  const icon = existsSync(opts.icon) ? nativeImage.createFromPath(opts.icon) : undefined
  const poll = async () => {
    if (win.isDestroyed() || !Notification.isSupported()) return
    // Session et serveur de l'interface (mêmes clés que l'application)
    const read = `(() => { try { return [localStorage.getItem(${JSON.stringify(opts.tokenKey)}), localStorage.getItem(${JSON.stringify(opts.serverKey)})] } catch (e) { return [null, null] } })()`
    const [token, stored] = (await win.webContents.executeJavaScript(read, true).catch(() => [null, null])) as [string | null, string | null]
    if (!token) return
    const server = (stored || opts.defaultServer).replace(/\/+$/, '')
    // Autre compte ou autre serveur : on part du dernier numéro (rien d'ancien n'est rejoué)
    const key = `${server}|${token.slice(0, 12)}`
    if (key !== state.key) state = { key, last: -1 }
    const r = await fetch(`${server}/api/socle/notifications?since=${state.last}`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null)
    if (!r?.ok) return
    const data = (await r.json().catch(() => null))?.data
    if (!data) return
    for (const n of data.items ?? []) {
      const note = new Notification({ title: n.title, body: n.body, icon, silent: false })
      note.on('click', () => {
        show()
        void win.webContents.executeJavaScript(`location.hash = ${JSON.stringify('#' + (n.url || '/'))}`).catch(() => {})
      })
      note.show()
    }
    if (typeof data.last === 'number') {
      state.last = data.last
      save()
    }
  }
  setTimeout(() => void poll(), 8_000)
  setInterval(() => void poll(), 60_000)
}
