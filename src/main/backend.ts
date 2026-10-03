// Source des données de l'application de bureau :
//  - « local »  : base intégrée au poste (PGlite) ;
//  - « server » : serveur PostgreSQL du réseau local ;
//  - « remote » : serveur IAM INVOICER sur un domaine (synchronisation entre
//                 sites, postes et téléphones), joint en HTTPS, avec une base
//                 locale de travail pour continuer sans réseau (synchronisation
//                 automatique au retour de la connexion).

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { join } from 'node:path'
import { createOfflineLayer, type CallResult as OfflineCallResult, type OfflineLayer, type QueuedOp } from '../shared/offline'
import { openDb, type Db, type DbConfig } from './db'
import { createFileStore, type FileStore } from './localStore'
import { printable, type Printable, type PrintFormat } from './printing'
import { call, type CallResult } from './router'
import { login, setup } from './services/auth'
import { AppError, type SessionUser } from './services/context'

export type AppConfig = DbConfig | { mode: 'remote'; url: string }

export interface Backend {
  readonly mode: AppConfig['mode']
  /** Base directe (modes local et serveur) : sauvegarde, restauration. */
  readonly db: Db | null
  user(): SessionUser | null
  call(name: string, args: unknown): Promise<CallResult>
  login(username: string, password: string): Promise<SessionUser>
  setup(input: unknown): Promise<SessionUser>
  logout(): Promise<void>
  printable(id: number, format: PrintFormat, forPdf?: boolean): Promise<Printable>
  close(): Promise<void>
}

class DirectBackend implements Backend {
  private session: SessionUser | null = null
  constructor(readonly mode: 'local' | 'server', readonly db: Db) {}
  user() {
    return this.session
  }
  call(name: string, args: unknown) {
    return call({ db: this.db, user: this.session }, name, args)
  }
  async login(username: string, password: string) {
    return (this.session = await login(this.db, username, password))
  }
  async setup(input: any) {
    return (this.session = await setup({ db: this.db, user: null }, input))
  }
  async logout() {
    this.session = null
  }
  printable(id: number, format: PrintFormat, forPdf = true) {
    if (!this.session) throw new AppError('Session expirée, veuillez vous reconnecter.')
    return printable({ db: this.db, user: this.session }, id, format, forPdf)
  }
  close() {
    return this.db.close()
  }
}

/** Adresse saisie par l'utilisateur → URL de base sans « / » final. */
export function normalizeServerUrl(raw: string): string {
  let url = String(raw ?? '').trim()
  if (!url) throw new AppError("Saisissez l'adresse du serveur (ex. facturation.iam.bf).")
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`
  } catch {
    throw new AppError('Adresse du serveur invalide.')
  }
}

/** Dernière connexion en ligne réussie d'un utilisateur sur ce poste (connexion sans réseau). */
export interface SavedLogin {
  url: string
  username: string
  user: SessionUser
  /** Jeton du serveur ; absent après une déconnexion (il faudra se reconnecter en ligne pour envoyer). */
  token: string | null
  salt: string
  hash: string
  at: string
}

/** Coffre des connexions mémorisées (chiffré par le système sur le poste). */
export interface SessionVault {
  get(url: string, username: string): SavedLogin | null
  put(login: SavedLogin): void
}

export interface RemoteOptions {
  /** Dossier de la base locale de travail ; absent = pas de travail hors ligne. */
  dataDir?: string
  vault?: SessionVault
  /** Appelé à chaque changement de l'état de synchronisation. */
  onChange?: () => void
  /** Nombre de jours pendant lesquels on peut se connecter hors ligne après la dernière connexion en ligne. */
  offlineDays?: number
}

export interface SyncState {
  /** Le serveur a répondu à la dernière requête. */
  reachable: boolean
  pending: number
  failed: (QueuedOp & { error: string })[]
  lastSync: string | null
  lastPrefetch: string | null
  localBytes: number
  /** Le serveur a refusé le jeton : se reconnecter en ligne pour envoyer les saisies. */
  needsLogin: boolean
}

/**
 * Lectures préchargées dans la base locale pour pouvoir vendre et consulter sans réseau.
 * Les arguments reprennent exactement ceux des écrans : la clé du cache doit être identique.
 */
const PREFETCH: [string, unknown][] = [
  ['settings.get', undefined],
  ['reports.dashboard', undefined],
  ['cash.current', undefined],
  ['cash.options', undefined],
  ['products.list', {}],
  ['products.list', { kind: 'produit' }],
  ['products.list', { search: '', kind: '', includeInactive: false }],
  ['products.categories', undefined],
  ['parties.options', { kind: 'client' }],
  ['parties.options', { kind: 'supplier' }],
  ['parties.list', { kind: 'client', search: '', includeInactive: false }],
  ['parties.list', { kind: 'supplier', search: '', includeInactive: false }],
  ['warehouses.options', undefined],
  ['projects.options', undefined],
  ...['FAC', 'DEV', 'BL', 'AV', 'BC', 'FF'].map((t): [string, unknown] => ['documents.list', { types: [t], search: '', status: '', from: '', to: '', unpaidOnly: false }]),
  ['crm.pipeline', undefined],
  ['hr.employees', {}]
]

/** Dates de dernière synchronisation, gardées dans la base locale. */
const META_KEY = 'iam.sync.meta'

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 32).toString('hex')
}

function samePassword(password: string, saved: SavedLogin): boolean {
  const a = Buffer.from(hashPassword(password, saved.salt), 'hex')
  const b = Buffer.from(saved.hash, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

type Reply<T> = { ok: true; data: T } | { ok: false; error: string; status?: number; network?: boolean }

/**
 * Serveur IAM INVOICER en ligne, avec une base locale de travail sur le poste :
 * les écrans consultés et les données préchargées restent disponibles sans réseau,
 * les ventes, règlements et autres saisies courantes sont mises en file d'attente
 * puis envoyées automatiquement, une seule fois, au retour du réseau.
 */
export class RemoteBackend implements Backend {
  readonly mode = 'remote' as const
  readonly db = null
  private token: string | null = null
  private session: SessionUser | null = null
  private username = ''
  private store: FileStore | null = null
  private layer: OfflineLayer | null = null
  private inSync = false
  private lastSync: string | null = null
  private lastPrefetch: string | null = null
  private needsLogin = false
  private prefetching: Promise<number> | null = null
  reachable = true
  readonly url: string

  constructor(url: string, private readonly opts: RemoteOptions = {}) {
    this.url = normalizeServerUrl(url)
  }

  private notify() {
    this.opts.onChange?.()
  }

  private setReachable(v: boolean) {
    if (v === this.reachable) return
    this.reachable = v
    this.notify()
    // Retour du serveur : envoi des saisies en attente puis rafraîchissement de la base locale.
    if (v && this.layer) void this.sync().then(() => this.prefetch())
  }

  private async request<T = any>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Reply<T>> {
    let res: Response
    try {
      res = await fetch(this.url + path, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {})
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000)
      })
    } catch (e) {
      this.setReachable(false)
      const cause = e instanceof Error ? (e.name === 'TimeoutError' ? 'délai dépassé' : e.message) : String(e)
      return { ok: false, error: `Serveur ${this.url} injoignable (${cause}). Vérifiez la connexion Internet.`, network: true }
    }
    let json: any
    try {
      json = await res.json()
    } catch {
      // 502 à 504 : le proxy HTTPS répond mais le serveur IAM INVOICER est arrêté ou en redémarrage.
      if (res.status >= 502 && res.status <= 504) {
        this.setReachable(false)
        return { ok: false, error: `Serveur ${this.url} momentanément indisponible (HTTP ${res.status}).`, status: res.status, network: true }
      }
      return { ok: false, error: `Réponse inattendue du serveur (HTTP ${res.status}). Est-ce bien un serveur IAM INVOICER ?`, status: res.status }
    }
    this.setReachable(true)
    if (res.status === 401) {
      this.token = null
      this.session = null
    }
    return { ...json, status: res.status }
  }

  private async must<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const r = await this.request<T>(method, path, body)
    if (!r.ok) throw new AppError(r.error)
    return r.data
  }

  /** Envoi d'un appel pour la couche hors ligne (avec identifiant d'opération). */
  private send = async (name: string, args: unknown, opId?: string): Promise<OfflineCallResult> => {
    const r = await this.request('POST', '/api/call', { name, args, opId })
    if (r.ok) return { ok: true, data: r.data }
    if (r.status === 401) {
      this.needsLogin = true
      this.notify()
      // Pendant la synchronisation, un jeton refusé ne doit pas faire échouer les saisies : on s'arrête et on garde la file.
      return { ok: false, error: r.error, network: this.inSync }
    }
    return { ok: false, error: r.error, network: r.network }
  }

  /** Vérifie que le serveur répond et qu'il s'agit bien d'IAM INVOICER. */
  async ping(): Promise<{ app: string; version: string }> {
    const s = await this.must<any>('GET', '/api/status')
    if (s?.app !== 'IAM INVOICER') throw new AppError("Ce serveur n'est pas un serveur IAM INVOICER.")
    return s
  }

  user() {
    return this.session
  }

  async call(name: string, args: unknown): Promise<CallResult> {
    if (!this.layer) {
      const r = await this.request('POST', '/api/call', { name, args })
      return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error }
    }
    const r = await this.layer.call(name, args)
    if (r.ok && !r.offline && this.layer.pending().length) void this.sync()
    return r.ok ? r : { ok: false, error: r.error }
  }

  /** Ouvre la base locale de l'utilisateur connecté (un fichier par serveur et par utilisateur). */
  private attach(user: SessionUser) {
    if (!this.opts.dataDir) return
    const host = new URL(this.url).host.replace(/[^A-Za-z0-9.-]/g, '_')
    this.store = createFileStore(join(this.opts.dataDir, `${host}-${user.id}.json`))
    this.layer = createOfflineLayer(this.store, this.send, () => this.notify())
    try {
      const meta = JSON.parse(this.store.getItem(META_KEY) ?? '{}')
      this.lastSync = meta.lastSync ?? null
      this.lastPrefetch = meta.lastPrefetch ?? null
    } catch {
      /* dates inconnues */
    }
    this.notify()
  }

  private detach() {
    this.store?.flush()
    this.store = null
    this.layer = null
    this.notify()
  }

  async login(username: string, password: string) {
    const r = await this.request<{ token: string; user: SessionUser }>('POST', '/api/login', { username, password, device: 'IAM INVOICER bureau' })
    if (r.ok) {
      this.token = r.data.token
      this.session = r.data.user
      this.username = username
      this.needsLogin = false
      if (this.opts.vault && this.opts.dataDir) {
        const salt = randomBytes(16).toString('hex')
        this.opts.vault.put({ url: this.url, username, user: r.data.user, token: r.data.token, salt, hash: hashPassword(password, salt), at: new Date().toISOString() })
      }
      this.attach(r.data.user)
      void this.sync().then(() => this.prefetch())
      return r.data.user
    }
    if (!r.network) throw new AppError(r.error)
    // Serveur injoignable : connexion sur la base locale si cet utilisateur s'est déjà connecté en ligne ici.
    const saved = this.opts.dataDir ? this.opts.vault?.get(this.url, username) : null
    if (!saved) throw new AppError(`${r.error} Pour travailler hors connexion, connectez-vous d'abord une fois avec Internet sur ce poste.`)
    const days = this.opts.offlineDays ?? 30
    if (Date.now() - Date.parse(saved.at) > days * 86_400_000) throw new AppError(`Dernière connexion en ligne il y a plus de ${days} jours : reconnectez-vous avec Internet.`)
    if (!samePassword(password, saved)) throw new AppError('Identifiant ou mot de passe incorrect.')
    this.token = saved.token
    this.session = saved.user
    this.username = username
    this.needsLogin = !saved.token
    this.attach(saved.user)
    return saved.user
  }

  async setup(input: any) {
    const r = await this.must<{ token: string; user: SessionUser }>('POST', '/api/setup', { ...input, device: 'IAM INVOICER bureau' })
    this.token = r.token
    this.username = String(input?.username ?? '')
    this.session = r.user
    this.attach(r.user)
    return r.user
  }

  async logout() {
    if (this.token) {
      const r = await this.request('POST', '/api/logout').catch(() => null)
      // Jeton révoqué : on l'oublie, le mot de passe reste vérifiable pour une connexion hors ligne.
      // Sans réseau, le jeton reste valable et servira à envoyer les saisies en attente.
      const saved = r?.ok ? this.opts.vault?.get(this.url, this.username) : null
      if (saved) this.opts.vault!.put({ ...saved, token: null })
    }
    this.detach()
    this.token = null
    this.session = null
  }

  printable(id: number, format: PrintFormat, forPdf = true) {
    return this.must<Printable>('GET', `/api/document/${id}?format=${format}&pdf=${forPdf ? 1 : 0}`)
  }

  /** Envoie les saisies en attente, dans l'ordre ; s'arrête à la première coupure. */
  async sync(): Promise<{ sent: number; failed: number }> {
    if (!this.layer) return { sent: 0, failed: 0 }
    this.inSync = true
    try {
      const r = await this.layer.sync()
      if (this.layer && this.layer.pending().length === 0 && this.reachable && !this.needsLogin) {
        this.lastSync = new Date().toISOString()
        this.saveMeta()
      }
      return r
    } finally {
      this.inSync = false
      this.notify()
    }
  }

  /** Recharge dans la base locale les données utiles au travail hors ligne. */
  prefetch(): Promise<number> {
    // Un seul préchargement à la fois (reconnexion, minuterie et connexion peuvent coïncider).
    this.prefetching ??= this.loadLocal().finally(() => {
      this.prefetching = null
    })
    return this.prefetching
  }

  private async loadLocal(): Promise<number> {
    if (!this.layer || !this.session) return 0
    let loaded = 0
    for (const [name, args] of PREFETCH) {
      const layer = this.layer
      if (!layer) break
      const r = await layer.call(name, args)
      if (r.ok && !r.offline) loaded++
      else if (!r.ok && r.network) break
    }
    if (loaded) {
      this.lastPrefetch = new Date().toISOString()
      this.saveMeta()
    }
    this.store?.flush()
    this.notify()
    return loaded
  }

  private saveMeta() {
    this.store?.setItem(META_KEY, JSON.stringify({ lastSync: this.lastSync, lastPrefetch: this.lastPrefetch }))
  }

  state(): SyncState {
    return {
      reachable: this.reachable,
      pending: this.layer?.pending().length ?? 0,
      failed: this.layer?.failed() ?? [],
      lastSync: this.lastSync,
      lastPrefetch: this.lastPrefetch,
      localBytes: this.store?.size() ?? 0,
      needsLogin: this.needsLogin
    }
  }

  clearFailed() {
    this.layer?.clearFailed()
  }

  /** Vide les données consultées de la base locale (les saisies en attente sont gardées). */
  clearCache() {
    this.store?.clearCache()
    this.lastPrefetch = null
    this.notify()
  }

  async close() {
    this.store?.flush()
  }
}

export async function openBackend(cfg: AppConfig, remote: RemoteOptions = {}): Promise<Backend> {
  if (cfg.mode === 'remote') {
    const b = new RemoteBackend(cfg.url, remote)
    try {
      await b.ping()
    } catch (e) {
      // Sans réseau, on démarre quand même sur la base locale si elle est activée.
      if (b.reachable || !remote.dataDir) throw e
    }
    return b
  }
  return new DirectBackend(cfg.mode, await openDb(cfg))
}
