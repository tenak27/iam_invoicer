// Licences des applications IAM (base commune : source iam-erp/tools/socle, recopiée par sync.mjs ;
// ne pas modifier ici). La console d'IAM Technology vend les formules (Stripe ou Mobile Money) et pousse
// chaque licence dans socle_licences (agent.ts) ; ici, l'application :
//   • calcule l'état d'un espace client : essai (30 jours, sans limite), gratuit (limites réduites),
//     licence active (limites de la formule ; clé absente ou 0 = illimité), expirée, suspendue ;
//   • refuse une création au-delà des limites (enforce, appelé avant chaque appel de l'API) ;
//   • propose les formules et les coordonnées de vente de la console (moyens de paiement Mobile Money),
//     ouvre le paiement Stripe quand il est configuré, transmet les demandes de licence à la console ;
//   • signale le guide d'utilisation à montrer après le paiement (seen_guide).
//
//   GET  /api/socle/licence            état, consommation, formules, coordonnées de vente (session)
//   POST /api/socle/licence/checkout   { plan } → { url } de paiement Stripe (administrateur)
//   POST /api/socle/licence/request    { plan, months, phone, message } → demande de licence (paiement Mobile Money ou virement)
//   POST /api/socle/licence/guide      guide vu
//   GET  /api/socle/vendor             public (site de présentation) : coordonnées de vente, formules, Stripe prêt ou non
//   POST /api/socle/commande           public (site) : demande de licence d'un visiteur { customer, contact, email, phone, plan, months, message }

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
  /** Clé de l'application dans la console (btp, mails…) ; devinée d'après son nom sinon. */
  key?: string
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

/** Coordonnées de vente d'IAM Technology (console → Réglages → Coordonnées de vente). */
export interface Vendor {
  name: string
  legal_form: string
  rccm: string
  ifu: string
  address: string
  city: string
  country: string
  phone: string
  whatsapp: string
  whatsapp_link: string
  email: string
  website: string
  hours: string
  payments: { kind: string; label: string; number: string; name: string }[]
  pay_note: string
}

/** Sans console joignable : coordonnées connues d'IAM Technology, sans moyen de paiement affiché. */
export const FALLBACK_VENDOR: Vendor = {
  name: 'IAM Technology',
  legal_form: '',
  rccm: '',
  ifu: '',
  address: '',
  city: 'Ouagadougou',
  country: 'Burkina Faso',
  phone: '+226 05 14 23 23',
  whatsapp: '',
  whatsapp_link: '',
  email: 'info@iamtechnology.store',
  website: 'https://iamtechnology.store',
  hours: '',
  payments: [],
  pay_note: ''
}

interface Sales {
  offers: Offer[]
  vendor: Vendor
  stripe: boolean
  /** La console a répondu (formules et coordonnées à jour). */
  ok: boolean
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

const EMAIL = /^[^@ ]+@[^@ ]+[.][^@ ]+$/
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

/** Adresse du visiteur : la dernière ajoutée par nginx quand la connexion vient de lui. */
function visitorIp(req: IncomingMessage): string {
  const peer = req.socket.remoteAddress ?? ''
  if (/^(127[.]|10[.]|192[.]168[.]|172[.](1[6-9]|2[0-9]|3[01])[.]|::1$|::ffff:(127[.]|10[.]|192[.]168[.]))/i.test(peer)) {
    const chain = String(req.headers['x-forwarded-for'] ?? '').split(',').map((v) => v.trim()).filter(Boolean)
    const last = chain[chain.length - 1]
    if (last && /^[0-9a-fA-F.:]{3,45}$/.test(last)) return last
  }
  return peer
}

/** Clé de l'application dans la console d'après son nom affiché (« IAM ÉDUCATION » → education). */
export function guessAppKey(name: string): string {
  const flat = String(name ?? '').normalize('NFD').toLowerCase().replace(/[^a-z0-9 -]/g, '').trim()
  if (flat.includes('artisan')) return 'artisans'
  if (flat.includes('invoicer')) return 'invoicer'
  return flat.replace(/^iam[ -]*/, '').replace(/[ -]+/g, '-') || 'app'
}

export class LicenceService {
  private ready: Promise<unknown> | null = null
  private salesCache: { at: number; sales: Sales } | null = null
  private consoleUrl: string
  private consoleToken: string
  private hits = new Map<string, { n: number; since: number }>()

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

  private get appKey() {
    return this.opts.config.key ?? guessAppKey(this.opts.app)
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

  /** Appel de la console : avec le jeton de l'application, sinon les routes publiques (application installée sans jeton). */
  private async console(path: string, body?: unknown): Promise<any> {
    const pub = !this.consoleToken
    const url = `${this.consoleUrl}${pub ? path.replace('/api/agent/', '/api/public/') : path}${pub && path.endsWith('/vendor') ? `?app=${encodeURIComponent(this.appKey)}` : ''}`
    const r = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(pub ? {} : { Authorization: `Bearer ${this.consoleToken}` }), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(pub ? { ...(body as object), app: this.appKey } : body),
      signal: AbortSignal.timeout(body === undefined ? 8000 : 15_000)
    })
    return r.json()
  }

  /** Formules en vente, coordonnées de vente et Stripe prêt ou non (console d'IAM Technology), gardés 10 minutes. */
  async sales(): Promise<Sales> {
    if (this.salesCache && Date.now() - this.salesCache.at < 10 * 60_000) return this.salesCache.sales
    let sales: Sales = { offers: [], vendor: FALLBACK_VENDOR, stripe: false, ok: false }
    try {
      const j = await this.console('/api/agent/vendor')
      if (j?.ok && j.data) sales = { offers: j.data.prices ?? [], vendor: { ...FALLBACK_VENDOR, ...(j.data.vendor ?? {}) }, stripe: !!j.data.stripe, ok: true }
    } catch {
      /* console injoignable : coordonnées connues, pas de paiement en ligne pour le moment */
    }
    this.salesCache = { at: Date.now(), sales }
    return sales
  }

  /** Formules en vente (compatibilité). */
  async offers(): Promise<{ offers: Offer[]; ok: boolean }> {
    const s = await this.sales()
    return { offers: s.offers, ok: s.ok }
  }

  private async spaceRow(user: any) {
    const space = this.opts.config.spaceOf(user)
    if (space == null || space === '') this.fail('Aucun espace client pour ce compte.')
    if (!this.opts.config.canBuy(user)) this.fail('Seul l’administrateur de l’espace peut acheter une formule.')
    const s = await this.opts.db.one<{ name?: string; email?: string; phone?: string; demo?: boolean }>(`SELECT * FROM ${ident(this.opts.config.spaces)} WHERE id = $1`, [Number(space)]).catch(() => undefined)
    if (s?.demo) this.fail('La version de démonstration ne se paie pas : créez votre compte pour choisir une formule.')
    const email = [user?.email, user?.username, s?.email].find((v) => EMAIL.test(String(v ?? ''))) ?? ''
    return { space: String(space), s, email }
  }

  async checkout(user: any, plan: string, origin: string): Promise<{ url: string }> {
    const { space, s, email } = await this.spaceRow(user)
    const back = `${origin}/app/#/`
    let j: any
    try {
      j = await this.console('/api/agent/checkout', { space_id: space, plan, email, customer: s?.name ?? user?.company_name ?? user?.full_name ?? '', success_url: `${back}?licence=merci`, cancel_url: `${back}?licence=annule` })
    } catch {
      const v = (await this.sales()).vendor
      this.fail(`Le paiement en ligne est momentanément indisponible : réessayez plus tard ou contactez ${v.name} au ${v.phone}.`)
    }
    if (!j?.ok || !j.data?.url) this.fail(j?.error || 'Le paiement n’a pas pu être préparé : réessayez dans un instant.')
    return { url: j.data.url }
  }

  /** Demande de licence (paiement Mobile Money ou virement) : transmise à la console, qui répond les modalités de paiement. */
  async request(user: any, input: any) {
    const { space, s, email } = await this.spaceRow(user)
    const plan = String(input?.plan ?? '').slice(0, 40)
    const months = Math.min(60, Math.max(1, Number(input?.months) || 1))
    const phone = String(input?.phone ?? s?.phone ?? user?.phone ?? '').slice(0, 40)
    if (!email && !phone) this.fail('Indiquez un numéro de téléphone pour que nous puissions vous répondre.')
    let j: any
    try {
      j = await this.console('/api/agent/request', { space_id: space, customer: s?.name ?? user?.company_name ?? '', contact: user?.full_name ?? user?.username ?? '', email, phone, plan, months, message: String(input?.message ?? '').slice(0, 2000), source: 'app' })
    } catch {
      const v = (await this.sales()).vendor
      this.fail(`La demande n’a pas pu être transmise : réessayez plus tard ou contactez ${v.name} au ${v.phone}${v.email ? ` ou à ${v.email}` : ''}.`)
    }
    if (!j?.ok) this.fail(j?.error || 'La demande n’a pas pu être transmise : réessayez dans un instant.')
    return j.data
  }

  /** Demande d'un visiteur du site (bouton Commander) : limitée par adresse, transmise à la console. */
  async publicRequest(body: any, ip: string) {
    const h = this.hits.get(ip)
    const now = Date.now()
    if (h && now - h.since < 3_600_000 && h.n >= 6) this.fail('Trop de demandes depuis cette connexion : réessayez dans une heure.')
    this.hits.set(ip, h && now - h.since < 3_600_000 ? { n: h.n + 1, since: h.since } : { n: 1, since: now })
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (now - v.since > 3_600_000) this.hits.delete(k)
    if (String(body?.website ?? '')) return { id: 0 } // champ piège des robots
    let j: any
    try {
      j = await this.console('/api/agent/request', {
        customer: String(body?.customer ?? '').slice(0, 160),
        contact: String(body?.contact ?? '').slice(0, 120),
        email: String(body?.email ?? '').slice(0, 160),
        phone: String(body?.phone ?? '').slice(0, 40),
        plan: String(body?.plan ?? '').slice(0, 40),
        months: Math.min(60, Math.max(1, Number(body?.months) || 1)),
        message: String(body?.message ?? '').slice(0, 2000),
        source: 'site',
        ip
      })
    } catch {
      const v = (await this.sales()).vendor
      this.fail(`La demande n’a pas pu être transmise : appelez-nous au ${v.phone}${v.email ? ` ou écrivez à ${v.email}` : ''}.`)
    }
    if (!j?.ok) this.fail(j?.error || 'La demande n’a pas pu être transmise : réessayez dans un instant.')
    return j.data
  }

  async handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
    const isPublic = path === '/api/socle/vendor' || path === '/api/socle/commande'
    if (!path.startsWith('/api/socle/licence') && !isPublic) return false
    try {
      // ── Public (site de présentation) : coordonnées de vente et demandes des visiteurs ──
      if (isPublic) {
        if (req.method === 'GET' && path === '/api/socle/vendor') {
          const s = await this.sales()
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' })
          res.end(JSON.stringify({ ok: true, data: { app: this.opts.app, key: this.appKey, vendor: s.vendor, prices: s.offers, stripe: s.stripe, online: s.ok } }))
          return true
        }
        if (req.method === 'POST' && path === '/api/socle/commande') return json(res, 200, { ok: true, data: await this.publicRequest(await readJson(req), visitorIp(req)) }), true
        return json(res, 404, { ok: false, error: 'Ressource inconnue.' }), true
      }
      const token = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1] ?? ''
      const user = token ? await this.opts.resolveUser(token) : null
      if (!user) return json(res, 401, { ok: false, error: 'Session expirée, veuillez vous reconnecter.' }), true
      const space = this.opts.config.spaceOf(user)
      if (req.method === 'GET' && path === '/api/socle/licence') {
        if (space == null || space === '') return json(res, 200, { ok: true, data: { state: null, offers: [], can_buy: false, online: false, stripe: false, vendor: FALLBACK_VENDOR } }), true
        const [state, s] = await Promise.all([this.state(String(space)), this.sales()])
        return json(res, 200, { ok: true, data: { app: this.opts.app, state, offers: s.offers, online: s.ok, stripe: s.stripe, vendor: s.vendor, can_buy: this.opts.config.canBuy(user) && state.status !== 'demo' } }), true
      }
      if (req.method === 'POST' && path === '/api/socle/licence/checkout') {
        const b = await readJson(req)
        const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() || 'https'
        const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0].trim()
        return json(res, 200, { ok: true, data: await this.checkout(user, String(b?.plan ?? ''), `${proto === 'http' && !/^(localhost|127[.])/.test(host) ? 'https' : proto}://${host}`) }), true
      }
      if (req.method === 'POST' && path === '/api/socle/licence/request') return json(res, 200, { ok: true, data: await this.request(user, await readJson(req)) }), true
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
