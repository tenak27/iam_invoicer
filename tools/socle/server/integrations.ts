// Intégrations des applications IAM (base commune : source iam-erp/tools/socle, recopiée par sync.mjs ;
// ne pas modifier ici) : clés d'API et webhooks d'un espace client, et leur verrouillage.
//   • Clé d'API : iak_<8 caractères visibles>_<secret> ; seule l'empreinte est gardée, la clé n'est
//     montrée qu'une fois. Elle agit au nom de l'administrateur qui l'a créée (tant qu'il reste
//     administrateur actif), en lecture seule ou en lecture et écriture ; jamais sur les comptes, la
//     sécurité, les réglages ni les intégrations elles-mêmes.
//   • Webhook : POST JSON signé (X-IAM-Signature: sha256=HMAC du corps avec le secret du webhook),
//     3 essais, vers une adresse publique en https seulement ; journal des 100 derniers envois.
//   • Verrouillage : une fois verrouillées par l'administrateur, clés et webhooks ne se modifient
//     qu'après avoir redonné son mot de passe, et le code de double authentification s'il l'a activée
//     (5 essais par quart d'heure) ; la fenêtre dure 15 minutes, elle est inscrite au journal et
//     signalée aux autres administrateurs de l'espace.
//
//   GET  /api/socle/integrations                  état, clés, webhooks, événements (administrateur)
//   POST /api/socle/integrations/key              { name, scope } → { key }
//   POST /api/socle/integrations/key/revoke       { id }
//   POST /api/socle/integrations/webhook          { id?, url, events, active } → { id, secret? }
//   POST /api/socle/integrations/webhook/remove   { id }
//   POST /api/socle/integrations/webhook/secret   { id } → { secret }
//   POST /api/socle/integrations/webhook/test     { id }
//   POST /api/socle/integrations/lock             verrouiller
//   POST /api/socle/integrations/unlock           { password, code? } → modifications possibles 15 minutes
//   GET|POST /api/v1/<appel>                      API des logiciels tiers (Authorization: Bearer iak_…)

import { createHash, createHmac, randomBytes } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isIP } from 'node:net'
import type { Notice, SocleDb } from './notify'

/** Événement pour les webhooks : [nom, données]. */
export type Trigger = [string, unknown]
type TriggerResult = Trigger | Trigger[] | null | undefined | false

export interface IntegrationsConfig {
  /** Espace client de l'utilisateur (entreprise, organisation, compte). */
  spaceOf: (user: any) => string | number | null | undefined
  /** Table des espaces (colonne demo : pas d'intégration depuis une démonstration). */
  spaces?: string
  /** Espace de démonstration ? (à défaut : colonne demo de la table des espaces) */
  demo?: (user: any, space: string) => boolean | Promise<boolean>
  isAdmin: (user: any) => boolean
  /** Utilisateur actif d'après son numéro, comme une session (une clé agit au nom de son auteur). */
  userById: (id: number, space?: string) => Promise<any>
  /** Condition du déverrouillage : le mot de passe de l'administrateur. */
  checkPassword: (user: any, password: string) => Promise<boolean>
  /** Double authentification du compte : vérificateur du code à 6 chiffres, ou null si elle n'est pas activée. */
  twoFactor?: (user: any) => Promise<((code: string) => boolean) | null>
  /** Faux : clés en lecture seule uniquement (IAM SANTÉ). */
  writable?: boolean
  /** Appel de l'API de l'application, avec les mêmes règles que l'interface (et les limites de la licence). */
  dispatch: (user: any, name: string, args: unknown, req: IncomingMessage) => Promise<{ ok: boolean; data?: unknown; error?: string }>
  /** Événements transmis aux webhooks (clé → libellé). */
  events: Record<string, string>
  /** Événements tirés des appels réussis : nom de l'appel → [événement, données] (ou plusieurs), ou rien ; peut lire la base. */
  triggers?: Record<string, (args: any, data: any, user: any) => TriggerResult | Promise<TriggerResult>>
  /** Administrateurs de l'espace (prévenus d'un déverrouillage). */
  adminIds?: (space: string) => Promise<number[]>
  /** Journal d'activité de l'application. */
  log?: (user: any, details: string) => Promise<void>
  /** Appels permis à une clé en lecture seule (par défaut : .list, .get, .stats…). */
  read?: RegExp
  /** Appels interdits à toute clé, en plus des comptes, de la sécurité et des réglages. */
  forbidden?: RegExp
  /** Exemples montrés dans « Comment utiliser l'API » (ex. « GET sites.list »). */
  examples?: string[]
  /** Écran des paramètres dans l'application (lien de la notification). */
  settingsUrl?: string
  fail: (message: string) => never
}

export interface LockState {
  locked: boolean
  /** Modifications possibles : pas de verrou, ou fenêtre de déverrouillage ouverte. */
  editable: boolean
  locked_at: string | null
  locked_by: number | null
  unlocked_until: string | null
}

const READ = /\.(list|get|one|stats|search|summary|dashboard|board|history|report|reports|status|counts|recent|catalog|journal|calendar|export|month|day|week|balances|alerts|overview|detail|details|find)$/
const FORBIDDEN = /^(team|users|auth|account|security|sessions|twofa|roles|company|settings|admin|platform|apikeys|webhooks|integrations|notify|notifications|demo|licence|backup|setup)\./
const UNLOCK_MINUTES = 15

const LOCK_TABLE = `CREATE TABLE IF NOT EXISTS socle_integration_lock (
  space_id TEXT PRIMARY KEY,
  locked BOOLEAN NOT NULL DEFAULT FALSE,
  locked_by INT,
  locked_at TIMESTAMPTZ,
  unlocked_by INT,
  unlocked_until TIMESTAMPTZ
)`

const TABLES = [
  `CREATE TABLE IF NOT EXISTS socle_api_keys (
    id SERIAL PRIMARY KEY,
    space_id TEXT NOT NULL,
    name TEXT NOT NULL,
    prefix TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    scope TEXT NOT NULL DEFAULT 'lecture',
    created_by INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ,
    revoked BOOLEAN NOT NULL DEFAULT FALSE
  )`,
  'CREATE INDEX IF NOT EXISTS socle_api_keys_space_idx ON socle_api_keys(space_id)',
  `CREATE TABLE IF NOT EXISTS socle_webhooks (
    id SERIAL PRIMARY KEY,
    space_id TEXT NOT NULL,
    url TEXT NOT NULL,
    events TEXT[] NOT NULL DEFAULT '{}',
    secret TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  'CREATE INDEX IF NOT EXISTS socle_webhooks_space_idx ON socle_webhooks(space_id)',
  `CREATE TABLE IF NOT EXISTS socle_webhook_deliveries (
    id BIGSERIAL PRIMARY KEY,
    webhook_id INT NOT NULL REFERENCES socle_webhooks(id) ON DELETE CASCADE,
    event TEXT NOT NULL,
    status TEXT NOT NULL,
    code INT NOT NULL DEFAULT 0,
    error TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  LOCK_TABLE
]

const ident = (name: string) => '"' + name.replace(/"/g, '""') + '"'
const keyHash = (k: string) => createHash('sha256').update(k).digest('hex')
const nameOf = (u: any) => String(u?.full_name || u?.name || u?.username || u?.email || '')
const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status })

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > 2 * 1024 * 1024) throw httpError(413, 'Requête trop volumineuse.')
    chunks.push(c as Buffer)
  }
  try {
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
  } catch {
    throw httpError(400, 'JSON invalide.')
  }
}

function internalIp(ip: string): boolean {
  if (ip.includes(':')) {
    const v = ip.toLowerCase()
    if (v.startsWith('::ffff:')) return internalIp(v.slice(7))
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')
  }
  const [a, b] = ip.split('.').map(Number)
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
}

/** Refus des adresses du réseau interne : le serveur ne sert jamais de relais vers lui-même. */
async function assertPublic(url: string) {
  if (process.env.WEBHOOK_ALLOW_PRIVATE) return
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '')
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true })).map((x) => x.address)
  if (!ips.length || ips.some(internalIp)) throw new Error('adresse interne refusée')
}

/** Limite simple : au plus `max` passages par clé dans la fenêtre. */
class Window {
  private hits = new Map<string, number[]>()
  constructor(private max: number, private ms: number) {}
  take(key: string): boolean {
    const now = Date.now()
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.ms)
    const ok = list.length < this.max
    if (ok) list.push(now)
    this.hits.set(key, list)
    return ok
  }
}

/** Verrou des intégrations d'un espace (servi aussi aux applications qui ont leurs propres clés : IAM EDUCATION). */
export class IntegrationLock {
  private ready: Promise<unknown> | null = null
  private tries = new Window(5, 15 * 60_000)
  constructor(private db: SocleDb) {}

  init() {
    this.ready ??= this.db.query(LOCK_TABLE).catch((e) => {
      this.ready = null
      throw e
    })
    return this.ready
  }

  async state(space: string): Promise<LockState> {
    await this.init()
    const r = await this.db.one<{ locked: boolean; locked_at: string | null; locked_by: number | null; open: boolean; unlocked_until: string | null }>(
      'SELECT locked, locked_at, locked_by, unlocked_until, COALESCE(unlocked_until > now(), FALSE) AS open FROM socle_integration_lock WHERE space_id = $1',
      [space]
    )
    const open = !!r?.open
    return { locked: !!r?.locked, editable: !r?.locked || open, locked_at: r?.locked_at ?? null, locked_by: r?.locked_by ?? null, unlocked_until: open ? r!.unlocked_until : null }
  }

  async lock(userId: number, space: string): Promise<LockState> {
    await this.init()
    await this.db.query(
      `INSERT INTO socle_integration_lock (space_id, locked, locked_by, locked_at, unlocked_until) VALUES ($1, TRUE, $2, now(), NULL)
       ON CONFLICT (space_id) DO UPDATE SET locked = TRUE, locked_by = $2, locked_at = now(), unlocked_until = NULL`,
      [space, userId]
    )
    return this.state(space)
  }

  /** Fenêtre de 15 minutes si le mot de passe est confirmé ; 5 essais par quart d'heure et par utilisateur. */
  async unlock(userId: number, space: string, confirmed: () => Promise<boolean>): Promise<'ok' | 'refuse' | 'bloque'> {
    await this.init()
    if (!this.tries.take(`${space}:${userId}`)) return 'bloque'
    if (!(await confirmed())) return 'refuse'
    await this.db.query(`UPDATE socle_integration_lock SET unlocked_by = $2, unlocked_until = now() + interval '${UNLOCK_MINUTES} minutes' WHERE space_id = $1 AND locked`, [space, userId])
    return 'ok'
  }

  async editable(space: string): Promise<boolean> {
    return (await this.state(space)).editable
  }
}

export const LOCKED_MESSAGE = 'Les intégrations sont verrouillées : déverrouillez-les avec votre mot de passe pour les modifier.'
export const UNLOCK_REFUSED = 'Mot de passe incorrect : les intégrations restent verrouillées.'
export const UNLOCK_REFUSED_CODE = 'Mot de passe ou code de vérification incorrect : les intégrations restent verrouillées.'
export const UNLOCK_BLOCKED = 'Trop d’essais : réessayez dans un quart d’heure.'

let current: IntegrationsService | null = null

/** Événement transmis aux webhooks de l'espace (en arrière-plan, sans bloquer l'appel ; sans effet en test). */
export function emitEvent(space: string | number | null | undefined, event: string, data: unknown): void {
  if (space == null || space === '') return
  current?.emit(String(space), event, data)
}

export class IntegrationsService {
  private ready: Promise<unknown> | null = null
  private perKey = new Window(120, 60_000)
  readonly lockOf: IntegrationLock

  constructor(
    private opts: {
      db: SocleDb
      app: string
      config: IntegrationsConfig
      resolveUser: (token: string) => Promise<any>
      notify?: (userIds: number[], n: Notice) => void
      /** Limites de la licence, appliquées aussi aux appels des clés d'API. */
      enforce?: (user: any, name: string, args: unknown) => Promise<void>
      /** Préfixe public du serveur (client hébergé d'IAM INVOICER : « /t/<client> »), pour l'adresse de l'API affichée. */
      publicPath?: string
    }
  ) {
    this.lockOf = new IntegrationLock(opts.db)
    current = this
  }

  private init() {
    this.ready ??= (async () => {
      for (const t of TABLES) await this.opts.db.query(t)
    })().catch((e) => {
      this.ready = null
      throw e
    })
    return this.ready
  }

  private fail(message: string): never {
    try {
      this.opts.config.fail(message)
    } catch (e: any) {
      if (e && typeof e === 'object') e.status ??= 400
      throw e
    }
    throw httpError(400, message)
  }

  private admin(user: any) {
    if (!this.opts.config.isAdmin(user)) this.fail('Réservé à l’administrateur.')
  }

  private async isDemo(user: any, space: string): Promise<boolean> {
    const { demo, spaces } = this.opts.config
    if (demo) return !!(await demo(user, space))
    if (!spaces) return false
    const s = await this.opts.db.one<{ demo?: boolean }>(`SELECT * FROM ${ident(spaces)} WHERE id = $1`, [Number(space)]).catch(() => undefined)
    return !!s?.demo
  }

  /** Modifications : administrateur, hors démonstration, intégrations déverrouillées. */
  private async editable(user: any, space: string) {
    this.admin(user)
    await this.init()
    if (await this.isDemo(user, space)) this.fail('La version de démonstration ne relie pas de logiciel extérieur : créez votre compte pour configurer API et webhooks.')
    if (!(await this.lockOf.editable(space))) this.fail(LOCKED_MESSAGE)
  }

  async overview(user: any, space: string, baseUrl: string) {
    this.admin(user)
    await this.init()
    const db = this.opts.db
    const lock = await this.lockOf.state(space)
    const demo = await this.isDemo(user, space)
    const by = lock.locked_by ? await this.opts.config.userById(lock.locked_by).catch(() => null) : null
    const keys = await db.query<any>('SELECT id, name, prefix, scope, created_by, created_at, last_used_at, revoked FROM socle_api_keys WHERE space_id = $1 ORDER BY revoked, id DESC', [space])
    const names = new Map<number, string>()
    for (const k of keys) {
      if (!names.has(k.created_by)) names.set(k.created_by, nameOf(await this.opts.config.userById(k.created_by).catch(() => null)))
      k.created_by_name = names.get(k.created_by)
    }
    const hooks = await db.query<any>('SELECT id, url, events, active, created_at FROM socle_webhooks WHERE space_id = $1 ORDER BY id', [space])
    for (const h of hooks) h.deliveries = await db.query('SELECT id, event, status, code, error, created_at FROM socle_webhook_deliveries WHERE webhook_id = $1 ORDER BY id DESC LIMIT 8', [h.id])
    return {
      demo,
      lock: { ...lock, locked_by_name: nameOf(by), needs_code: !!(await this.opts.config.twoFactor?.(user)) },
      writable: this.opts.config.writable !== false,
      keys,
      webhooks: hooks,
      events: this.opts.config.events,
      api: `${baseUrl}/api/v1/`,
      examples: this.opts.config.examples ?? []
    }
  }

  async createKey(user: any, space: string, input: any) {
    await this.editable(user, space)
    const name = String(input?.name ?? '').trim().slice(0, 80)
    if (!name) this.fail('Nommez la clé (ex. logiciel de comptabilité).')
    const scope = input?.scope === 'ecriture' && this.opts.config.writable !== false ? 'ecriture' : 'lecture'
    const prefix = randomBytes(6).toString('base64url').slice(0, 8)
    const key = `iak_${prefix}_${randomBytes(24).toString('base64url')}`
    await this.opts.db.query('INSERT INTO socle_api_keys (space_id, name, prefix, key_hash, scope, created_by) VALUES ($1, $2, $3, $4, $5, $6)', [space, name, prefix, keyHash(key), scope, user.id])
    await this.opts.config.log?.(user, `Clé d'API créée : ${name} (${scope === 'ecriture' ? 'lecture et écriture' : 'lecture seule'})`)
    return { key }
  }

  async revokeKey(user: any, space: string, input: any) {
    await this.editable(user, space)
    const r = await this.opts.db.query<{ name: string }>('UPDATE socle_api_keys SET revoked = TRUE WHERE id = $1 AND space_id = $2 RETURNING name', [Number(input?.id) || 0, space])
    if (!r.length) this.fail('Clé introuvable.')
    await this.opts.config.log?.(user, `Clé d'API révoquée : ${r[0].name}`)
    return true
  }

  async saveWebhook(user: any, space: string, input: any) {
    await this.editable(user, space)
    const url = String(input?.url ?? '').trim().slice(0, 500)
    let u: URL | null = null
    try {
      u = new URL(url)
    } catch {
      this.fail('Adresse invalide (https://…).')
    }
    if (u!.protocol !== 'https:' && !(process.env.WEBHOOK_ALLOW_PRIVATE && u!.protocol === 'http:')) this.fail("L'adresse doit commencer par https://.")
    const asked: string[] = (Array.isArray(input?.events) ? input.events : []).map(String)
    const events = [...new Set(asked)].filter((e) => e === '*' || e in this.opts.config.events)
    if (!events.length) this.fail('Choisissez au moins un événement.')
    const id = Number(input?.id) || 0
    if (id) {
      const r = await this.opts.db.query('UPDATE socle_webhooks SET url = $3, events = $4, active = $5 WHERE id = $1 AND space_id = $2 RETURNING id', [id, space, url, events, input?.active !== false])
      if (!r.length) this.fail('Webhook introuvable.')
      await this.opts.config.log?.(user, `Webhook modifié : ${u!.host}${input?.active === false ? ' (en pause)' : ''}`)
      return { id }
    }
    const secret = `whsec_${randomBytes(24).toString('base64url')}`
    const r = await this.opts.db.one<{ id: number }>('INSERT INTO socle_webhooks (space_id, url, events, secret) VALUES ($1, $2, $3, $4) RETURNING id', [space, url, events, secret])
    await this.opts.config.log?.(user, `Webhook ajouté : ${u!.host}`)
    return { id: r!.id, secret }
  }

  async removeWebhook(user: any, space: string, input: any) {
    await this.editable(user, space)
    const r = await this.opts.db.query<{ url: string }>('DELETE FROM socle_webhooks WHERE id = $1 AND space_id = $2 RETURNING url', [Number(input?.id) || 0, space])
    if (!r.length) this.fail('Webhook introuvable.')
    await this.opts.config.log?.(user, `Webhook supprimé : ${new URL(r[0].url).host}`)
    return true
  }

  /** Secret de signature : visible seulement quand les intégrations sont modifiables. */
  async webhookSecret(user: any, space: string, input: any) {
    await this.editable(user, space)
    const r = await this.opts.db.one<{ secret: string }>('SELECT secret FROM socle_webhooks WHERE id = $1 AND space_id = $2', [Number(input?.id) || 0, space])
    if (!r) this.fail('Webhook introuvable.')
    return r
  }

  async testWebhook(user: any, space: string, input: any) {
    this.admin(user)
    await this.init()
    const h = await this.opts.db.one<any>('SELECT id, url, secret FROM socle_webhooks WHERE id = $1 AND space_id = $2', [Number(input?.id) || 0, space])
    if (!h) this.fail('Webhook introuvable.')
    return this.deliver(h, space, 'ping', { message: `Essai depuis ${this.opts.app}` }, 1)
  }

  async lock(user: any, space: string) {
    this.admin(user)
    const s = await this.lockOf.lock(user.id, space)
    await this.opts.config.log?.(user, 'Intégrations (API et webhooks) verrouillées')
    return s
  }

  async unlock(user: any, space: string, input: any) {
    this.admin(user)
    // Double authentification activée sur le compte : son code est exigé en plus du mot de passe
    const code = await this.opts.config.twoFactor?.(user)
    const r = await this.lockOf.unlock(user.id, space, async () => (await this.opts.config.checkPassword(user, String(input?.password ?? ''))) && (!code || code(String(input?.code ?? ''))))
    if (r === 'bloque') this.fail(UNLOCK_BLOCKED)
    if (r === 'refuse') {
      await this.opts.config.log?.(user, `Déverrouillage des intégrations refusé (${code ? 'mot de passe ou code incorrect' : 'mot de passe incorrect'})`)
      this.fail(code ? UNLOCK_REFUSED_CODE : UNLOCK_REFUSED)
    }
    await this.opts.config.log?.(user, `Intégrations déverrouillées pour ${UNLOCK_MINUTES} minutes`)
    try {
      const ids = ((await this.opts.config.adminIds?.(space)) ?? []).filter((id) => id !== user.id)
      if (ids.length)
        this.opts.notify?.(ids, { title: 'Intégrations déverrouillées', body: `${nameOf(user) || 'Un administrateur'} peut modifier les clés d’API et les webhooks pendant ${UNLOCK_MINUTES} minutes.`, url: this.opts.config.settingsUrl ?? '/parametres', tag: 'socle-integrations' })
    } catch {
      /* notification facultative */
    }
    return this.lockOf.state(space)
  }

  /** Clé d'API → administrateur qui l'a créée, avec la portée de la clé. */
  async userForKey(key: string): Promise<{ user: any; scope: 'lecture' | 'ecriture' } | null> {
    if (!/^iak_[\w-]{8}_[\w-]{20,}$/.test(key)) return null
    await this.init()
    const k = await this.opts.db.one<{ id: number; scope: 'lecture' | 'ecriture'; created_by: number; space_id: string }>('SELECT id, scope, created_by, space_id FROM socle_api_keys WHERE key_hash = $1 AND NOT revoked', [keyHash(key)])
    if (!k) return null
    const user = await this.opts.config.userById(k.created_by, k.space_id).catch(() => null)
    // L'auteur doit être encore administrateur actif de l'espace de la clé
    if (!user || !this.opts.config.isAdmin(user) || String(this.opts.config.spaceOf(user)) !== k.space_id) return null
    await this.opts.db.query('UPDATE socle_api_keys SET last_used_at = now() WHERE id = $1', [k.id])
    return { user, scope: k.scope }
  }

  /** Appel permis à une clé de cette portée ? (message de refus sinon) */
  refusal(name: string, scope: 'lecture' | 'ecriture'): string | null {
    if (FORBIDDEN.test(name) || this.opts.config.forbidden?.test(name)) return 'Cet appel n’est pas ouvert aux clés d’API (comptes, sécurité, réglages).'
    if (scope === 'lecture' && !(this.opts.config.read ?? READ).test(name)) return 'Clé en lecture seule : cet appel modifie des données.'
    return null
  }

  /** Après un appel réussi (interface ou API) : événement éventuel pour les webhooks (en arrière-plan). */
  after(user: any, name: string, args: unknown, data: unknown) {
    const t = this.opts.config.triggers?.[name]
    // Appels sans compte (recherche publique de Faso Artisans…) : pas d'espace, pas d'événement
    if (!t || !user) return
    let space: string | number | null | undefined
    try {
      space = this.opts.config.spaceOf(user)
    } catch {
      return
    }
    if (space == null || space === '') return
    void Promise.resolve()
      .then(() => t(args ?? {}, data, user))
      .then((out) => {
        if (!out) return
        // Par ce service (et non emitEvent) : un serveur qui héberge plusieurs bases (IAM INVOICER) a un service par base
        for (const [event, payload] of Array.isArray(out[0]) ? (out as Trigger[]) : [out as Trigger]) if (event) this.emit(String(space), event, payload)
      })
      .catch((e: any) => console.error('[webhook]', name, e?.message ?? e))
  }

  /** Appel d'un logiciel tiers : /api/v1/<appel> (GET : arguments dans l'adresse ; POST : corps JSON). */
  private async api(req: IncomingMessage, res: ServerResponse, path: string) {
    if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { ok: false, error: 'Méthode non autorisée.' })
    const key = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1] ?? String(req.headers['x-api-key'] ?? '')
    const who = key ? await this.userForKey(key) : null
    if (!who) return json(res, 401, { ok: false, error: 'Clé d’API absente, invalide ou révoquée.' })
    if (!this.perKey.take(keyHash(key))) {
      res.setHeader('Retry-After', '60')
      return json(res, 429, { ok: false, error: 'Trop d’appels : 120 par minute au plus.' })
    }
    let name = ''
    try {
      name = decodeURIComponent(path.slice('/api/v1/'.length))
    } catch {
      /* adresse illisible */
    }
    if (!/^[a-zA-Z]\w*\.[a-zA-Z]\w*$/.test(name)) return json(res, 404, { ok: false, error: 'Appel inconnu.' })
    const refused = this.refusal(name, who.scope)
    if (refused) return json(res, 403, { ok: false, error: refused })
    let args: any = {}
    if (req.method === 'GET') {
      // Nombres et booléens reconnus ; un code à zéro initial (« 0042 ») reste du texte
      for (const [k, v] of new URL(req.url ?? '/', 'http://x').searchParams) args[k] = /^-?(0|[1-9]\d*)(\.\d+)?$/.test(v) && v.length < 16 ? Number(v) : v === 'true' ? true : v === 'false' ? false : v
    } else args = await readJson(req)
    await this.opts.enforce?.(who.user, name, args)
    const out = await this.opts.config.dispatch(who.user, name, args, req)
    if (out?.ok) this.after(who.user, name, args, out.data)
    return json(res, out?.ok ? 200 : 400, out)
  }

  emit(space: string, event: string, data: unknown) {
    void (async () => {
      // Aucun webhook encore configuré sur ce serveur : rien à envoyer, et pas de tables créées pour rien
      if (!this.ready && !(await this.opts.db.one<{ t: string | null }>("SELECT to_regclass('socle_webhooks')::text AS t"))?.t) return
      await this.init()
      const hooks = await this.opts.db.query<any>("SELECT id, url, secret FROM socle_webhooks WHERE space_id = $1 AND active AND ($2 = ANY(events) OR '*' = ANY(events))", [space, event])
      await Promise.all(hooks.map((h) => this.deliver(h, space, event, data)))
    })().catch((e) => console.error('[webhook]', e?.message ?? e))
  }

  private async deliver(h: { id: number; url: string; secret: string }, space: string, event: string, data: unknown, attempts = 3) {
    const body = JSON.stringify({ id: randomBytes(8).toString('hex'), app: this.opts.app, event, created_at: new Date().toISOString(), space_id: space, data })
    const sig = createHmac('sha256', h.secret).update(body).digest('hex')
    let last = { status: 'echec', code: 0, error: '' }
    for (let i = 0; i < attempts; i++) {
      if (i) await new Promise((r) => setTimeout(r, i * 5000))
      try {
        await assertPublic(h.url)
        const r = await fetch(h.url, {
          method: 'POST',
          redirect: 'manual',
          signal: AbortSignal.timeout(8000),
          headers: { 'Content-Type': 'application/json', 'User-Agent': `IAM-Webhook/1 (${this.opts.app})`, 'X-IAM-Event': event, 'X-IAM-Signature': `sha256=${sig}` },
          body
        })
        last = { status: r.ok ? 'ok' : 'echec', code: r.status, error: r.ok ? '' : `HTTP ${r.status}` }
        if (r.ok) break
      } catch (e: any) {
        last = { status: 'echec', code: 0, error: String(e?.message ?? e).slice(0, 200) }
      }
    }
    await this.opts.db.query('INSERT INTO socle_webhook_deliveries (webhook_id, event, status, code, error) VALUES ($1, $2, $3, $4, $5)', [h.id, event, last.status, last.code, last.error]).catch(() => {})
    await this.opts.db
      .query('DELETE FROM socle_webhook_deliveries WHERE webhook_id = $1 AND id < (SELECT MIN(id) FROM (SELECT id FROM socle_webhook_deliveries WHERE webhook_id = $1 ORDER BY id DESC LIMIT 100) x)', [h.id])
      .catch(() => {})
    return last
  }

  async handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
    const isApi = path.startsWith('/api/v1/')
    if (!isApi && path !== '/api/socle/integrations' && !path.startsWith('/api/socle/integrations/')) return false
    try {
      if (isApi) {
        await this.api(req, res, path)
        return true
      }
      const token = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1] ?? ''
      const user = token ? await this.opts.resolveUser(token) : null
      if (!user) return json(res, 401, { ok: false, error: 'Session expirée, veuillez vous reconnecter.' }), true
      const space = this.opts.config.spaceOf(user)
      if (space == null || space === '') return json(res, 403, { ok: false, error: 'Aucun espace client pour ce compte.' }), true
      const s = String(space)
      if (req.method === 'GET' && path === '/api/socle/integrations') {
        const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0].trim()
        const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() || (/^(localhost|127\.|\[::1\])/.test(host) ? 'http' : 'https')
        return json(res, 200, { ok: true, data: await this.overview(user, s, `${proto}://${host}${this.opts.publicPath ?? ''}`) }), true
      }
      if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Méthode non autorisée.' }), true
      const b = await readJson(req)
      const routes: Record<string, () => Promise<unknown>> = {
        '/api/socle/integrations/key': () => this.createKey(user, s, b),
        '/api/socle/integrations/key/revoke': () => this.revokeKey(user, s, b),
        '/api/socle/integrations/webhook': () => this.saveWebhook(user, s, b),
        '/api/socle/integrations/webhook/remove': () => this.removeWebhook(user, s, b),
        '/api/socle/integrations/webhook/secret': () => this.webhookSecret(user, s, b),
        '/api/socle/integrations/webhook/test': () => this.testWebhook(user, s, b),
        '/api/socle/integrations/lock': () => this.lock(user, s),
        '/api/socle/integrations/unlock': () => this.unlock(user, s, b)
      }
      const fn = routes[path]
      if (!fn) return json(res, 404, { ok: false, error: 'Ressource inconnue.' }), true
      return json(res, 200, { ok: true, data: await fn() }), true
    } catch (e: any) {
      const status = Number(e?.status) || 500
      if (status >= 500) console.error('[intégrations]', e)
      if (!res.headersSent) json(res, status, { ok: false, error: status >= 500 ? 'Erreur interne du serveur.' : String(e?.message ?? e) })
      return true
    }
  }
}
