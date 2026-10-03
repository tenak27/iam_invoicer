// Pont vers les données hors d'Electron : navigateur et applications iOS/Android
// (Capacitor). L'application parle en HTTPS au serveur IAM INVOICER du domaine.
// Le jeton de connexion est conservé sur l'appareil pour rester connecté.

import { Capacitor } from '@capacitor/core'
import { createOfflineLayer } from './offline'

const URL_KEY = 'iam.serverUrl'
const TOKEN_KEY = 'iam.token'
const USER_KEY = 'iam.lastUser'

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem(k)
      else localStorage.setItem(k, v)
    } catch {
      /* stockage indisponible : la session durera le temps de la page */
    }
  }
}

type R<T = any> = { ok: true; data: T; offline?: boolean } | { ok: false; error: string; network?: boolean }

export function normalizeUrl(raw: string): string {
  let url = String(raw ?? '').trim()
  if (!url) throw new Error("Saisissez l'adresse du serveur (ex. facturation.iam.bf).")
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url
  const u = new URL(url)
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`
}

function createHttpBridge(): ErpBridge {
  const native = Capacitor.isNativePlatform()
  // Sur le web, l'application est servie par le serveur lui-même : même origine par défaut.
  const servedByServer = !native && /^https?:$/.test(location.protocol) && !import.meta.env.DEV
  const baseUrl = () => store.get(URL_KEY) ?? (servedByServer ? location.origin : null)
  let token = store.get(TOKEN_KEY)

  async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown, base = baseUrl()): Promise<R<T>> {
    if (!base) return { ok: false, error: 'Adresse du serveur non configurée.' }
    let res: Response
    try {
      res = await fetch(base + path, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: body !== undefined ? JSON.stringify(body) : undefined
      })
    } catch {
      return { ok: false, error: `Serveur ${base} injoignable. Vérifiez votre connexion Internet.`, network: true }
    }
    let json: any
    try {
      json = await res.json()
    } catch {
      // 502/503/504 : le proxy répond mais le serveur est arrêté → traité comme une coupure.
      return { ok: false, error: `Réponse inattendue du serveur (HTTP ${res.status}).`, network: res.status >= 502 && res.status <= 504 }
    }
    if (res.status === 401) {
      token = null
      store.set(TOKEN_KEY, null)
    }
    return json
  }

  const keepToken = (r: R<{ token: string; user: any }>): R => {
    if (!r.ok) return r
    token = r.data.token
    store.set(TOKEN_KEY, token)
    store.set(USER_KEY, JSON.stringify(r.data.user))
    return { ok: true, data: r.data.user }
  }

  const offline = createOfflineLayer(
    { getItem: store.get, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.set(k, null) },
    (name, args, opId) => request('POST', '/api/call', { name, args, opId }),
    () => window.dispatchEvent(new Event('iam-offline'))
  )
  const autoSync = () => {
    if (offline.pending().length) offline.sync()
  }
  window.addEventListener('online', autoSync)
  setInterval(autoSync, 30_000)

  const unavailable = (what: string): Promise<R> =>
    Promise.resolve({ ok: false, error: `${what} se fait sur le serveur (pg_dump) : demandez à votre administrateur.` })

  return {
    kind: native ? 'mobile' : 'web',
    call: (name, args) => offline.call(name, args),
    offline: {
      pending: () => offline.pending().length,
      failed: () => offline.failed(),
      sync: () => offline.sync(),
      clearFailed: () => offline.clearFailed()
    },

    async status() {
      const base = baseUrl()
      const st = { dbMode: 'remote' as const, serverUrl: base, version: '', platform: Capacitor.getPlatform() }
      if (!base) return { ...st, dbReady: false, dbError: null, user: null }
      const r = await request<any>('GET', '/api/status')
      if (!r.ok) {
        // Hors connexion avec une session déjà ouverte : on démarre sur les données de l'appareil.
        const last = store.get(USER_KEY)
        if (r.network && token && last) return { ...st, dbReady: true, dbError: null, user: JSON.parse(last), offline: true }
        return { ...st, dbReady: false, dbError: r.error, user: null }
      }
      if (r.data.user) store.set(USER_KEY, JSON.stringify(r.data.user))
      return { ...st, dbReady: true, dbError: null, version: r.data.version, user: r.data.user }
    },

    login: async (username, password) =>
      keepToken(await request('POST', '/api/login', { username, password, device: `IAM INVOICER ${Capacitor.getPlatform()}` })),
    setup: async (input) => keepToken(await request('POST', '/api/setup', { ...(input as object), device: `IAM INVOICER ${Capacitor.getPlatform()}` })),
    async logout() {
      await request('POST', '/api/logout', {})
      token = null
      store.set(TOKEN_KEY, null)
      store.set(USER_KEY, null)
      return { ok: true, data: true }
    },

    getDbConfig: async () => ({ mode: 'remote', url: baseUrl() ?? '' }),
    async testDbConfig(cfg: any) {
      try {
        const r = await request<any>('GET', '/api/status', undefined, normalizeUrl(cfg.url))
        if (!r.ok) return r
        if (r.data?.app !== 'IAM INVOICER') return { ok: false, error: "Ce serveur n'est pas un serveur IAM INVOICER." }
        return { ok: true, data: r.data.version }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
    async saveDbConfig(cfg: any) {
      const url = normalizeUrl(cfg.url)
      if (url !== baseUrl()) {
        token = null
        store.set(TOKEN_KEY, null)
      }
      store.set(URL_KEY, url)
      location.reload()
    },

    async pdf(id, _action, format = 'a4') {
      // La fenêtre est ouverte tout de suite (clic de l'utilisateur) pour ne pas être bloquée.
      const win = native ? null : window.open('about:blank', '_blank')
      const r = await request<{ url: string }>('POST', '/api/print', { id, format })
      if (!r.ok) {
        win?.close()
        return r
      }
      const url = baseUrl() + r.data.url
      if (native) {
        const { Browser } = await import('@capacitor/browser')
        await Browser.open({ url })
      } else if (win) win.location.href = url
      else location.href = url
      return { ok: true, data: true }
    },

    sendDocumentEmail: (input) => request('POST', '/api/call', { name: 'messages.sendDocument', args: input }),

    async printHtml(html, filename) {
      if (native) {
        const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')])
        const file = await Filesystem.writeFile({ path: filename + '.html', data: html, directory: Directory.Cache, encoding: Encoding.UTF8 })
        await Share.share({ title: filename, files: [file.uri] })
        return { ok: true, data: true }
      }
      // Cadre caché imprimé par l'application : aucune fenêtre surgissante, aucun script dans la page.
      const frame = document.createElement('iframe')
      frame.setAttribute('aria-hidden', 'true')
      frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
      frame.srcdoc = html
      frame.onload = () => {
        frame.contentWindow?.focus()
        frame.contentWindow?.print()
        setTimeout(() => frame.remove(), 60_000)
      }
      document.body.appendChild(frame)
      return { ok: true, data: true }
    },

    async saveText(name, content) {
      if (native) {
        const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')])
        const file = await Filesystem.writeFile({ path: name, data: '﻿' + content, directory: Directory.Cache, encoding: Encoding.UTF8 })
        await Share.share({ title: name, files: [file.uri] })
        return { ok: true, data: name }
      }
      const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = name
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
      return { ok: true, data: name }
    },

    pickImage: () =>
      new Promise<R<string | null>>((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'image/png,image/jpeg,image/svg+xml'
        input.onchange = () => {
          const file = input.files?.[0]
          if (!file) return resolve({ ok: true, data: null })
          if (file.size > 1_000_000) return resolve({ ok: false, error: 'Image trop lourde (1 Mo maximum).' })
          const reader = new FileReader()
          reader.onload = () => resolve({ ok: true, data: String(reader.result) })
          reader.onerror = () => resolve({ ok: false, error: "Lecture de l'image impossible." })
          reader.readAsDataURL(file)
        }
        input.click()
      }),

    backup: () => unavailable('La sauvegarde'),
    restore: () => unavailable('La restauration')
  }
}

/** Electron fournit window.erp via le preload ; ailleurs on installe le pont HTTP. */
export function installBridge(): void {
  if (!(window as any).erp) (window as any).erp = createHttpBridge()
}
