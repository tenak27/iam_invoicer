// Licences des applications IAM (base commune : source iam-erp/tools/socle, recopiée par sync.mjs ;
// ne pas modifier ici). La console d'IAM Technology vend les formules (Stripe) et pousse chaque
// licence dans socle_licences (agent.ts) ; ici, l'application :
//   • calcule l'état d'un espace client : essai (30 jours, sans limite), gratuit (limites réduites),
//     licence active (limites de la formule ; clé absente ou 0 = illimité), expirée, suspendue ;
//   • refuse une création au-delà des limites (enforce, appelé avant chaque appel de l'API) ;
//   • propose les formules de la console et ouvre le paiement Stripe ;
//   • signale le guide d'utilisation à montrer après le paiement (seen_guide).
//
//   GET  /api/socle/licence            état, consommation et formules (session)
//   POST /api/socle/licence/checkout   { plan } → { url } de paiement Stripe (administrateur)
//   POST /api/socle/licence/guide      guide vu

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SocleDb } from './notify'

export interface QuotaDef {
  label: string
  /** Nombre actuel dans l'espace : requête avec $1 = identifiant de l'espace. */
  sql: string
}

export interface LicenceConfig {
  /** Espace client de l'utilisateur (entreprise, organisation, compte) ; null : pas de licence (ex. administration). */
  spaceOf: (user: any) => string | number | null | undefined
  /** L'utilisateur peut acheter une formule (administrateur de l'espace). */
  canBuy: (user: any) => boolean
  /** Table des espaces (date de création pour l'essai, nom, marque demo). */
  spaces: string
  quotas: Record<string, QuotaDef>
  /** Limites sans licence, après l'essai. */
  free: Record<string, number>
  /** Appels de l'API qui créent quelque chose de compté (when : création, pas modification). */
  calls: Record<string, { quota: string; when?: (args: any) => boolean; add?: (args: any) => number }>
  /** Erreur affichée telle quelle par l'application (son fail). */
  fail: (message: string) => never
  trialDays?: number
}

export interface LicenceState {
  status: 'demo' | 'essai' | 'gratuit' | 'active' | 'expiree' | 'suspendue' | 'aucune'
  plan: string
  label: string
  ends_on: string | null
  trial_left: number | null
  usage: { key: string; label: string; used: number; limit: number | null }[]
  seen_guide: boolean
}

interface Offer {
  plan: string
  label: string
  amount: number
  currency: string
  period: string
  limits: Record<string, number>
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

const ident = (name: string) => '"' + name.replace(/"/g, '""') + '"'
const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}
async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > 64 * 1024) throw Object.assign(new Error('Requête trop volumineuse.'), { status: 413 })
    chunks.push(c as Buffer)
  }
  try {
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
  } catch {
    throw Object.assign(new Error('JSON invalide.'), { status: 400 })
  }
}

export class LicenceService {
  private ready: Promise<unknown> | null = null
  private offersCache: { at: number; offers: Offer[]; ok: boolean } | null = null
  private consoleUrl: string
  private consoleToken: string

  constructor(private opts: { db: SocleDb; app: string; config: LicenceConfig; resolveUser: (token: string) => Promise<any> }) {
    this.consoleUrl = (process.env.CONSOLE_URL || 'https://pilotage.iamtechnology.store').replace(/\/+$/, '')
    this.consoleToken = process.env.CONSOLE_TOKEN ?? ''
  }

  /** Erreur de l'application (affichée telle quelle), marquée 400 pour les routes de ce module. */
  private fail(message: string): never {
    try {
      this.opts.config.fail(message)
    } catch (e: any) {
      if (e && typeof e === 'object') e.status ??= 400
      throw e
    }
    throw Object.assign(new Error(message), { status: 400 })
  }

  private init() {
    this.ready ??= this.opts.db.query(LICENCE_TABLE).catch((e) => {
      this.ready = null
      throw e
    })
    return this.ready
  }

  /** État de la licence d'un espace, avec la consommation de chaque limite. */
  async state(spaceId: string): Promise<LicenceState> {
    await this.init()
    const { db, config } = this.opts
    const row = await db.one<{ plan: string; status: string; limits: Record<string, number>; ends_on: string | null; seen_guide: boolean }>(
      'SELECT plan, status, limits, ends_on::text AS ends_on, seen_guide FROM socle_licences WHERE space_id = $1',
      [spaceId]
    )
    const space = await db.one<{ created_at: string; demo?: boolean }>(`SELECT * FROM ${ident(config.spaces)} WHERE id = $1`, [Number(spaceId)]).catch(() => undefined)
    const today = new Date().toISOString().slice(0, 10)
    const trialEnd = space ? new Date(new Date(space.created_at).getTime() + (config.trialDays ?? 30) * 86_400_000) : null
    const trialLeft = trialEnd ? Math.ceil((trialEnd.getTime() - Date.now()) / 86_400_000) : null
    let status: LicenceState['status']
    let limits: Record<string, number> | null
    if (space?.demo) [status, limits] = ['demo', null]
    else if (row?.status === 'active' && (!row.ends_on || row.ends_on >= today)) [status, limits] = ['active', row.limits ?? {}]
    else if (row?.status === 'suspendue') [status, limits] = ['suspendue', config.free]
    else if (trialLeft != null && trialLeft > 0) [status, limits] = ['essai', null]
    else if (row?.status === 'active' || row?.status === 'expiree') [status, limits] = ['expiree', config.free]
    else [status, limits] = ['gratuit', config.free]
    const usage = []
    for (const [key, q] of Object.entries(config.quotas)) {
      const used = Number((await db.one<{ n: number }>(q.sql, [Number(spaceId)]))?.n ?? 0)
      const limit = limits ? Number(limits[key]) || 0 : 0
      usage.push({ key, label: q.label, used, limit: limit > 0 ? limit : null })
    }
    const labels: Record<LicenceState['status'], string> = {
      demo: 'Démonstration',
      essai: 'Essai gratuit',
      gratuit: 'Version gratuite',
      active: row?.plan ?? 'Licence',
      expiree: 'Licence expirée',
      suspendue: 'Licence suspendue',
      aucune: 'Sans licence'
    }
    return { status, plan: row?.plan ?? '', label: labels[status], ends_on: row?.ends_on ?? null, trial_left: status === 'essai' ? trialLeft : null, usage, seen_guide: !!row?.seen_guide }
  }

  /** Refuse une création au-delà des limites de l'espace (appelé avant chaque appel de l'API). */
  async enforce(user: any, call: string, args: unknown): Promise<void> {
    const rule = this.opts.config.calls[call]
    if (!rule || !user) return
    if (rule.when && !rule.when(args)) return
    const space = this.opts.config.spaceOf(user)
    if (space == null || space === '') return
    const st = await this.state(String(space))
    const u = st.usage.find((x) => x.key === rule.quota)
    if (!u || u.limit == null) return
    const add = rule.add ? Math.max(1, rule.add(args)) : 1
    if (u.used + add > u.limit) {
      const why = st.status === 'active' ? `Votre formule « ${st.plan} »` : st.status === 'expiree' ? 'Votre licence a expiré : la version gratuite' : 'La version gratuite'
      this.fail(`${why} est limitée à ${u.limit} ${u.label} (${u.used} déjà). Choisissez une formule dans Paramètres → Licence pour continuer.`)
    }
  }

  /** Formules en vente (console d'IAM Technology), gardées 10 minutes. */
  async offers(): Promise<{ offers: Offer[]; ok: boolean }> {
    if (this.offersCache && Date.now() - this.offersCache.at < 10 * 60_000) return this.offersCache
    let offers: Offer[] = []
    let ok = false
    if (this.consoleToken) {
      try {
        const r = await fetch(`${this.consoleUrl}/api/agent/prices`, { headers: { Authorization: `Bearer ${this.consoleToken}` }, signal: AbortSignal.timeout(8000) })
        const j = await r.json()
        if (j?.ok) {
          offers = j.data
          ok = true
        }
      } catch {
        /* console injoignable : achat en ligne indisponible pour le moment */
      }
    }
    this.offersCache = { at: Date.now(), offers, ok }
    return this.offersCache
  }

  async checkout(user: any, plan: string, origin: string): Promise<{ url: string }> {
    const space = this.opts.config.spaceOf(user)
    if (space == null || space === '') this.fail('Aucun espace client pour ce compte.')
    if (!this.opts.config.canBuy(user)) this.fail('Seul l’administrateur de l’espace peut acheter une formule.')
    const s = await this.opts.db.one<{ name?: string; email?: string }>(`SELECT * FROM ${ident(this.opts.config.spaces)} WHERE id = $1`, [Number(space)]).catch(() => undefined)
    if ((s as any)?.demo) this.fail('La version de démonstration ne se paie pas : créez votre compte pour choisir une formule.')
    const email = [user?.email, user?.username, s?.email].find((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v ?? ''))) ?? ''
    const back = `${origin}/app/#/`
    let r: Response
    try {
      r = await fetch(`${this.consoleUrl}/api/agent/checkout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.consoleToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ space_id: String(space), plan, email, customer: s?.name ?? user?.company_name ?? user?.full_name ?? '', success_url: `${back}?licence=merci`, cancel_url: `${back}?licence=annule` }),
        signal: AbortSignal.timeout(15_000)
      })
    } catch {
      this.fail('Le paiement en ligne est momentanément indisponible : réessayez plus tard ou contactez IAM Technology au +226 05 14 23 23.')
    }
    const j = await r!.json().catch(() => null)
    if (!j?.ok || !j.data?.url) this.fail(j?.error || 'Le paiement n’a pas pu être préparé : réessayez dans un instant.')
    return { url: j.data.url }
  }

  async handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
    if (!path.startsWith('/api/socle/licence')) return false
    try {
      const token = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1] ?? ''
      const user = token ? await this.opts.resolveUser(token) : null
      if (!user) return json(res, 401, { ok: false, error: 'Session expirée, veuillez vous reconnecter.' }), true
      const space = this.opts.config.spaceOf(user)
      if (req.method === 'GET' && path === '/api/socle/licence') {
        if (space == null || space === '') return json(res, 200, { ok: true, data: { state: null, offers: [], can_buy: false, online: false } }), true
        const [state, o] = await Promise.all([this.state(String(space)), this.offers()])
        return json(res, 200, { ok: true, data: { app: this.opts.app, state, offers: o.offers, online: o.ok, can_buy: this.opts.config.canBuy(user) && state.status !== 'demo' } }), true
      }
      if (req.method === 'POST' && path === '/api/socle/licence/checkout') {
        const b = await readJson(req)
        const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() || 'https'
        const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0].trim()
        return json(res, 200, { ok: true, data: await this.checkout(user, String(b?.plan ?? ''), `${proto === 'http' && !/^(localhost|127\.)/.test(host) ? 'https' : proto}://${host}`) }), true
      }
      if (req.method === 'POST' && path === '/api/socle/licence/guide') {
        if (space != null && space !== '') {
          await this.init()
          await this.opts.db.query('UPDATE socle_licences SET seen_guide = TRUE WHERE space_id = $1', [String(space)])
        }
        return json(res, 200, { ok: true, data: true }), true
      }
      return json(res, 404, { ok: false, error: 'Ressource inconnue.' }), true
    } catch (e: any) {
      const status = Number(e?.status) || 500
      if (status === 500) console.error('[licence]', e)
      return json(res, status, { ok: false, error: status === 500 ? 'Erreur interne du serveur.' : String(e?.message ?? e) }), true
    }
  }
}
