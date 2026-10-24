// Agent de la console IAM Technology (base commune des applications IAM : source
// iam-erp/tools/socle, recopiée par sync.mjs ; ne pas modifier ici).
// La console (privée, réservée à IAM Technology) interroge chaque application avec le jeton
// CONSOLE_TOKEN de son fichier .env ; sans ce jeton, ces routes n'existent pas (404).
//
//   GET  /api/socle/console/metrics            état, version, performances, base de données, comptes
//   GET  /api/socle/console/activity?since=<n> journal d'activité (500 lignes au plus)
//   GET  /api/socle/console/spaces             espaces clients (entreprises, organisations ou comptes)
//   POST /api/socle/console/licence            licence d'un espace, décidée par la console (paiement, essai…)
//   GET  /api/socle/console/licences           licences enregistrées dans l'application
import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import type { SocleDb } from './notify'

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<any> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > 65_536) throw Object.assign(new Error('Requête trop volumineuse.'), { status: 413 })
    chunks.push(c as Buffer)
  }
  try {
    return size ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
  } catch {
    throw Object.assign(new Error('JSON invalide.'), { status: 400 })
  }
}

/** Compteurs des requêtes, remis à zéro à chaque relève de la console. */
class Counters {
  requests = 0
  errors = 0
  slow = 0
  totalMs = 0
  private samples: number[] = []
  record(ms: number, status: number) {
    this.requests++
    if (status >= 500) this.errors++
    if (ms > 2000) this.slow++
    this.totalMs += ms
    if (this.samples.length < 5000) this.samples.push(ms)
  }
  take() {
    const s = [...this.samples].sort((a, b) => a - b)
    const p = (q: number) => (s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))]) : 0)
    const out = { requests: this.requests, errors: this.errors, slow: this.slow, avg_ms: this.requests ? Math.round(this.totalMs / this.requests) : 0, p95_ms: p(0.95), p99_ms: p(0.99) }
    this.requests = this.errors = this.slow = this.totalMs = 0
    this.samples = []
    return out
  }
}

const LICENCE_TABLE = `CREATE TABLE IF NOT EXISTS socle_licences (
  space_id TEXT PRIMARY KEY,
  plan TEXT NOT NULL,
  status TEXT NOT NULL,
  limits JSONB NOT NULL DEFAULT '{}',
  ends_on DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  seen_guide BOOLEAN NOT NULL DEFAULT FALSE
)`

export interface AgentOptions {
  db: SocleDb
  app: string
  version: string
  token?: string
}

export class ConsoleAgent {
  private counters = new Counters()
  private loop = monitorEventLoopDelay({ resolution: 20 })
  private cpu = process.cpuUsage()
  private cpuAt = process.hrtime.bigint()
  private started = Date.now()
  private schema: Promise<{ spaces: string | null; activitySpace: boolean; userName: string; spaceDemo: boolean; userDemo: boolean; userSpace: string }> | null = null
  private key: Buffer | null

  constructor(private opts: AgentOptions) {
    this.key = opts.token && opts.token.length >= 32 ? createHash('sha256').update(opts.token).digest() : null
    this.loop.enable()
  }

  get enabled() {
    return !!this.key
  }

  /** Chaque requête de l'application : durée et statut (appelé par la base commune). */
  watch(res: ServerResponse) {
    const t0 = process.hrtime.bigint()
    res.once('finish', () => this.counters.record(Number(process.hrtime.bigint() - t0) / 1e6, res.statusCode))
  }

  private allowed(req: IncomingMessage): boolean {
    if (!this.key) return false
    const got = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1] ?? ''
    return timingSafeEqual(createHash('sha256').update(got).digest(), this.key)
  }

  /** Tables de l'application : espaces clients (entreprises, organisations) et nom des utilisateurs. */
  private detect() {
    this.schema ??= (async () => {
      const has = async (t: string) => !!(await this.opts.db.one<{ t: string | null }>('SELECT to_regclass($1)::text AS t', [t]))?.t
      const col = async (t: string, c: string) => !!(await this.opts.db.one('SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2', [t, c]))
      const spaces = (await has('companies')) ? 'companies' : (await has('orgs')) ? 'orgs' : null
      return {
        spaces,
        activitySpace: (await has('activity')) && (await col('activity', 'company_id')),
        userName: (await col('users', 'full_name')) ? 'full_name' : 'username',
        // Espaces et comptes de démonstration : jamais comptés (statistiques, journal, licences)
        spaceDemo: !!spaces && (await col(spaces, 'demo')),
        userDemo: await col('users', 'demo'),
        userSpace: spaces === 'orgs' ? 'org_id' : 'company_id'
      }
    })()
    this.schema.catch(() => (this.schema = null))
    return this.schema
  }

  async metrics() {
    const now = process.hrtime.bigint()
    const usage = process.cpuUsage(this.cpu)
    const elapsedUs = Number(now - this.cpuAt) / 1000
    this.cpu = process.cpuUsage()
    this.cpuAt = now
    const mem = process.memoryUsage()
    const lag = { mean_ms: Math.round(this.loop.mean / 1e6), max_ms: Math.round(this.loop.max / 1e6) }
    this.loop.reset()
    const db = this.opts.db
    const s = await this.detect()
    const one = async (sql: string) => Number((await db.one<{ n: string | number | null }>(sql).catch(() => null))?.n ?? 0)
    const realUser = this.realUserSql(s, 'u')
    const [size, users, active, spaces, tables] = await Promise.all([
      one('SELECT pg_database_size(current_database()) AS n'),
      one(`SELECT COUNT(*) AS n FROM users u WHERE ${realUser}`),
      one(`SELECT COUNT(DISTINCT x.user_id) AS n FROM auth_sessions x JOIN users u ON u.id = x.user_id WHERE x.created_at > now() - interval '1 day' AND ${realUser}`),
      s.spaces ? one(`SELECT COUNT(*) AS n FROM ${s.spaces}${s.spaceDemo ? ' WHERE NOT demo' : ''}`) : Promise.resolve(0),
      db.query<{ name: string; rows: string | number }>('SELECT relname AS name, n_live_tup AS rows FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 12').catch(() => [])
    ])
    return {
      app: this.opts.app,
      version: this.opts.version,
      node: process.version,
      uptime_s: Math.round((Date.now() - this.started) / 1000),
      cpu_pct: elapsedUs > 0 ? Math.round(((usage.user + usage.system) / elapsedUs) * 1000) / 10 : 0,
      mem_mb: Math.round(mem.rss / 1_048_576),
      heap_mb: Math.round(mem.heapUsed / 1_048_576),
      loop: lag,
      http: this.counters.take(),
      db: { size_mb: Math.round((size / 1_048_576) * 10) / 10, tables: tables.map((t) => ({ name: t.name, rows: Number(t.rows) })) },
      users,
      active_users_24h: active,
      spaces: s.spaces ? spaces : users
    }
  }

  async activity(since: number) {
    const s = await this.detect()
    const space = s.activitySpace && s.spaces ? `(SELECT name FROM ${s.spaces} WHERE id = a.company_id)` : "''"
    const rows = await this.opts.db.query<{ id: string | number; at: string; kind: string; details: string; user_name: string | null; space: string | null }>(
      `SELECT a.id, a.created_at AS at, a.kind, a.details, u.${s.userName} AS user_name, ${space} AS space
       FROM activity a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.id > $1 AND (u.id IS NULL OR ${this.realUserSql(s, 'u')})${s.activitySpace && s.spaceDemo ? ` AND (a.company_id IS NULL OR EXISTS (SELECT 1 FROM ${s.spaces} d WHERE d.id = a.company_id AND NOT d.demo))` : ''}
       ORDER BY a.id LIMIT 500`,
      [since]
    )
    return rows.map((r) => ({ ...r, id: Number(r.id), user_name: r.user_name ?? '', space: r.space ?? '' }))
  }

  async spaces() {
    const s = await this.detect()
    if (s.spaces)
      return this.opts.db.query(
        `SELECT c.id::text AS id, c.name, c.created_at, (SELECT COUNT(*)::int FROM users u WHERE u.${s.userSpace} = c.id) AS users FROM ${s.spaces} c${s.spaceDemo ? ' WHERE NOT c.demo' : ''} ORDER BY c.id`
      )
    // Applications sans entreprise (un compte = un client)
    return this.opts.db.query(`SELECT u.id::text AS id, u.${s.userName} AS name, u.created_at, 1 AS users FROM users u WHERE ${this.realUserSql(s, 'u')} ORDER BY u.id`)
  }

  /** Condition SQL « compte réel » (ni compte de démonstration, ni compte d'un espace de démonstration). */
  private realUserSql(s: { spaces: string | null; spaceDemo: boolean; userDemo: boolean; userSpace: string }, u: string): string {
    const parts = ['TRUE']
    if (s.userDemo) parts.push(`NOT ${u}.demo`)
    if (s.spaces && s.spaceDemo) parts.push(`NOT EXISTS (SELECT 1 FROM ${s.spaces} d WHERE d.id = ${u}.${s.userSpace} AND d.demo)`)
    return parts.join(' AND ')
  }

  async handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
    if (!path.startsWith('/api/socle/console/')) return false
    // Sans jeton configuré, la console n'existe pas pour ce serveur
    if (!this.allowed(req)) {
      json(res, 404, { ok: false, error: 'Ressource inconnue.' })
      return true
    }
    try {
      const url = new URL(req.url ?? '/', 'http://x')
      if (req.method === 'GET' && path === '/api/socle/console/metrics') json(res, 200, { ok: true, data: await this.metrics() })
      else if (req.method === 'GET' && path === '/api/socle/console/activity') json(res, 200, { ok: true, data: await this.activity(Math.max(0, Number(url.searchParams.get('since')) || 0)) })
      else if (req.method === 'GET' && path === '/api/socle/console/spaces') json(res, 200, { ok: true, data: await this.spaces() })
      else if (req.method === 'GET' && path === '/api/socle/console/licences') {
        await this.opts.db.query(LICENCE_TABLE)
        json(res, 200, { ok: true, data: await this.opts.db.query('SELECT * FROM socle_licences ORDER BY space_id') })
      } else if (req.method === 'POST' && path === '/api/socle/console/licence') {
        const b = await readJson(req)
        const space = String(b?.space_id ?? '').slice(0, 64)
        if (!space) throw Object.assign(new Error('Espace manquant.'), { status: 400 })
        await this.opts.db.query(LICENCE_TABLE)
        await this.opts.db.query(
          `INSERT INTO socle_licences (space_id, plan, status, limits, ends_on, updated_at) VALUES ($1, $2, $3, $4, $5, now())
           ON CONFLICT (space_id) DO UPDATE SET plan = EXCLUDED.plan, status = EXCLUDED.status, limits = EXCLUDED.limits, ends_on = EXCLUDED.ends_on, updated_at = now(),
             seen_guide = socle_licences.seen_guide AND socle_licences.status = EXCLUDED.status`,
          [space, String(b?.plan ?? 'essai').slice(0, 40), String(b?.status ?? 'active').slice(0, 20), JSON.stringify(b?.limits ?? {}), b?.ends_on ? String(b.ends_on).slice(0, 10) : null]
        )
        json(res, 200, { ok: true, data: true })
      } else json(res, 404, { ok: false, error: 'Ressource inconnue.' })
    } catch (e: any) {
      const status = Number(e?.status) || 500
      if (status === 500) console.error('[console]', e)
      json(res, status, { ok: false, error: status === 500 ? 'Erreur interne du serveur.' : String(e?.message ?? e) })
    }
    return true
  }
}
