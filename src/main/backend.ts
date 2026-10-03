// Source des données de l'application de bureau :
//  - « local »  : base intégrée au poste (PGlite) ;
//  - « server » : serveur PostgreSQL du réseau local ;
//  - « remote » : serveur IAM INVOICER sur un domaine (synchronisation entre
//                 sites, postes et téléphones), joint en HTTPS.

import { openDb, type Db, type DbConfig } from './db'
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
  printable(id: number, format: PrintFormat): Promise<Printable>
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
  printable(id: number, format: PrintFormat) {
    if (!this.session) throw new AppError('Session expirée, veuillez vous reconnecter.')
    return printable({ db: this.db, user: this.session }, id, format, true)
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

export class RemoteBackend implements Backend {
  readonly mode = 'remote' as const
  readonly db = null
  private token: string | null = null
  private session: SessionUser | null = null
  readonly url: string

  constructor(url: string) {
    this.url = normalizeServerUrl(url)
  }

  private async request<T = any>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string; status?: number }> {
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
      const cause = e instanceof Error ? (e.name === 'TimeoutError' ? 'délai dépassé' : e.message) : String(e)
      return { ok: false, error: `Serveur ${this.url} injoignable (${cause}). Vérifiez la connexion Internet.` }
    }
    let json: any
    try {
      json = await res.json()
    } catch {
      return { ok: false, error: `Réponse inattendue du serveur (HTTP ${res.status}). Est-ce bien un serveur IAM INVOICER ?`, status: res.status }
    }
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
    const r = await this.request('POST', '/api/call', { name, args })
    return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error }
  }
  async login(username: string, password: string) {
    const r = await this.must<{ token: string; user: SessionUser }>('POST', '/api/login', { username, password, device: 'IAM INVOICER bureau' })
    this.token = r.token
    return (this.session = r.user)
  }
  async setup(input: any) {
    const r = await this.must<{ token: string; user: SessionUser }>('POST', '/api/setup', { ...input, device: 'IAM INVOICER bureau' })
    this.token = r.token
    return (this.session = r.user)
  }
  async logout() {
    if (this.token) await this.request('POST', '/api/logout').catch(() => {})
    this.token = null
    this.session = null
  }
  printable(id: number, format: PrintFormat) {
    return this.must<Printable>('GET', `/api/document/${id}?format=${format}&pdf=1`)
  }
  async close() {}
}

export async function openBackend(cfg: AppConfig): Promise<Backend> {
  if (cfg.mode === 'remote') {
    const b = new RemoteBackend(cfg.url)
    await b.ping()
    return b
  }
  return new DirectBackend(cfg.mode, await openDb(cfg))
}
