// Notifications (base commune des applications IAM : source iam-erp/tools/socle, recopiée par
// sync.mjs ; ne pas modifier ici). Un fil par utilisateur, qui sert :
//   - aux navigateurs et applications installées depuis le navigateur : Web Push (VAPID), reçu même
//     onglet fermé ;
//   - aux applications installées (Windows, macOS, Linux, Android) : relève du fil en arrière-plan,
//     puis notification du système.
//
//   GET  /api/socle/notifications?since=<n>   notifications plus récentes que n (since=-1 : rien, seulement le dernier numéro)
//   GET  /api/socle/push/key                  clé publique VAPID
//   POST /api/socle/push/subscribe            { subscription, device }
//   POST /api/socle/push/unsubscribe          { endpoint }
// Toutes exigent le jeton de session (Authorization: Bearer …), sauf la clé publique.
import type { IncomingMessage, ServerResponse } from 'node:http'
import webpush from 'web-push'

export interface SocleDb {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>
  one<T = any>(sql: string, params?: unknown[]): Promise<T | undefined>
}

export interface Notice {
  title: string
  body?: string
  /** Écran à ouvrir dans l'application (adresse après #, ex. /commandes/12). */
  url?: string
  /** Notifications de même étiquette : la plus récente remplace la précédente sur l'appareil. */
  tag?: string
}

export interface NotifierOptions {
  db: SocleDb
  app: string
  /** Utilisateur d'un jeton de session (services/auth.ts : resolveToken). */
  resolveUser: (token: string) => Promise<{ id: number } | null | undefined>
  /** Web Push par ce module (faux quand l'application a déjà le sien : IAM CLOUD). */
  webPush?: boolean
}

const TABLES = [
  'CREATE TABLE IF NOT EXISTS socle_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  `CREATE TABLE IF NOT EXISTS socle_notifications (
    id BIGSERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    tag TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  'CREATE INDEX IF NOT EXISTS socle_notifications_user_idx ON socle_notifications(user_id, id)',
  `CREATE TABLE IF NOT EXISTS socle_push (
    id BIGSERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    device TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`
]

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<any> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > 16_384) throw Object.assign(new Error('Requête trop volumineuse.'), { status: 413 })
    chunks.push(c as Buffer)
  }
  try {
    return size ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
  } catch {
    throw Object.assign(new Error('JSON invalide.'), { status: 400 })
  }
}

export class Notifier {
  private ready: Promise<void> | null = null
  private publicKey = ''

  constructor(private opts: NotifierOptions) {}

  /** Tables et clés VAPID (créées au premier appel). */
  init(): Promise<void> {
    this.ready ??= (async () => {
      for (const sql of TABLES) await this.opts.db.query(sql)
      if (this.opts.webPush === false) return
      let keys = await this.opts.db.one<{ value: string }>("SELECT value FROM socle_kv WHERE key = 'vapid'")
      if (!keys) {
        const k = webpush.generateVAPIDKeys()
        await this.opts.db.query("INSERT INTO socle_kv (key, value) VALUES ('vapid', $1) ON CONFLICT (key) DO NOTHING", [JSON.stringify(k)])
        keys = await this.opts.db.one<{ value: string }>("SELECT value FROM socle_kv WHERE key = 'vapid'")
      }
      const { publicKey, privateKey } = JSON.parse(keys!.value)
      this.publicKey = publicKey
      webpush.setVapidDetails('https://iamtechnology.store', publicKey, privateKey)
    })()
    this.ready.catch(() => (this.ready = null))
    return this.ready
  }

  /** Notifie des utilisateurs : fil (applications installées) et Web Push (navigateurs abonnés). */
  async notify(userIds: number[], n: Notice): Promise<void> {
    const ids = [...new Set(userIds.filter((id) => Number.isInteger(id) && id > 0))]
    if (!ids.length || !n.title) return
    await this.init()
    const title = n.title.slice(0, 160)
    const body = (n.body ?? '').slice(0, 500)
    const url = (n.url ?? '').slice(0, 300)
    const tag = (n.tag ?? '').slice(0, 80)
    for (const id of ids) await this.opts.db.query('INSERT INTO socle_notifications (user_id, title, body, url, tag) VALUES ($1, $2, $3, $4, $5)', [id, title, body, url, tag])
    // Fil limité à 30 jours
    if (Math.random() < 0.05) await this.opts.db.query("DELETE FROM socle_notifications WHERE created_at < now() - interval '30 days'")
    if (this.opts.webPush === false) return
    const subs = await this.opts.db.query<{ endpoint: string; p256dh: string; auth: string }>('SELECT endpoint, p256dh, auth FROM socle_push WHERE user_id = ANY($1::int[])', [ids])
    const payload = JSON.stringify({ app: this.opts.app, title, body, url, tag })
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 24 * 3600, urgency: 'normal' })
        } catch (e: any) {
          // Abonnement expiré ou retiré par le navigateur
          if (e?.statusCode === 404 || e?.statusCode === 410) await this.opts.db.query('DELETE FROM socle_push WHERE endpoint = $1', [s.endpoint])
        }
      })
    )
  }

  /** Même chose sans attendre ni faire échouer l'action en cours. */
  notifyQuietly(userIds: number[], n: Notice) {
    void this.notify(userIds, n).catch((e) => console.warn(`Notification « ${n.title} » :`, e?.message ?? e))
  }

  /** Routes /api/socle/… ; faux si le chemin n'en fait pas partie. */
  async handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
    if (!path.startsWith('/api/socle/')) return false
    try {
      return await this.route(req, res, path)
    } catch (e: any) {
      const status = Number(e?.status) || 500
      if (status === 500) console.error(`[socle ${req.method} ${path}]`, e)
      if (!res.headersSent) json(res, status, { ok: false, error: status === 500 ? 'Erreur interne du serveur.' : String(e?.message ?? e) })
      return true
    }
  }

  private async route(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
    await this.init()
    if (req.method === 'GET' && path === '/api/socle/push/key') {
      json(res, 200, { ok: true, data: { key: this.opts.webPush === false ? '' : this.publicKey } })
      return true
    }
    const token = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1] ?? ''
    const user = token ? await this.opts.resolveUser(token) : null
    if (!user) {
      json(res, 401, { ok: false, error: 'Session expirée, veuillez vous reconnecter.' })
      return true
    }
    if (req.method === 'GET' && path === '/api/socle/notifications') {
      const since = Number(new URL(req.url ?? '/', 'http://x').searchParams.get('since') ?? -1)
      if (!(since >= 0)) {
        const r = await this.opts.db.one<{ last: string | null }>('SELECT MAX(id)::text AS last FROM socle_notifications WHERE user_id = $1', [user.id])
        json(res, 200, { ok: true, data: { items: [], last: Number(r?.last ?? 0) } })
        return true
      }
      const items = await this.opts.db.query<{ id: string; title: string; body: string; url: string; tag: string; created_at: string }>(
        "SELECT id::text, title, body, url, tag, created_at FROM socle_notifications WHERE user_id = $1 AND id > $2 AND created_at > now() - interval '3 days' ORDER BY id LIMIT 20",
        [user.id, since]
      )
      const last = items.length ? Number(items[items.length - 1].id) : since
      json(res, 200, { ok: true, data: { items: items.map((i) => ({ ...i, id: Number(i.id) })), last } })
      return true
    }
    if (req.method === 'POST' && path === '/api/socle/push/subscribe') {
      const body = await readJson(req)
      const s = body?.subscription
      const endpoint = String(s?.endpoint ?? '')
      if (!/^https:\/\//.test(endpoint) || !s?.keys?.p256dh || !s?.keys?.auth) {
        json(res, 400, { ok: false, error: 'Abonnement invalide.' })
        return true
      }
      await this.opts.db.query(
        `INSERT INTO socle_push (user_id, endpoint, p256dh, auth, device) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, device = EXCLUDED.device`,
        [user.id, endpoint.slice(0, 1000), String(s.keys.p256dh).slice(0, 200), String(s.keys.auth).slice(0, 100), String(body?.device ?? '').slice(0, 120)]
      )
      json(res, 200, { ok: true, data: true })
      return true
    }
    if (req.method === 'POST' && path === '/api/socle/push/unsubscribe') {
      const body = await readJson(req)
      await this.opts.db.query('DELETE FROM socle_push WHERE endpoint = $1 AND user_id = $2', [String(body?.endpoint ?? ''), user.id])
      json(res, 200, { ok: true, data: true })
      return true
    }
    json(res, 404, { ok: false, error: 'Ressource inconnue.' })
    return true
  }
}
