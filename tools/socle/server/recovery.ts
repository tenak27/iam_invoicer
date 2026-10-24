// Récupération des comptes (base commune des applications IAM : source iam-erp/tools/socle, recopiée par
// sync.mjs ; ne pas modifier ici) : « Mot de passe oublié ? ». L'application ne détient ni serveur
// d'envoi ni accès WhatsApp : elle demande à la console d'IAM Technology (CONSOLE_URL, jeton
// CONSOLE_TOKEN) d'envoyer un code à 6 chiffres à l'e-mail et au numéro WhatsApp de récupération du
// compte. Les API et webhooks de chaque application restent réglés par ses administrateurs (integrations.ts).
//   • Code valable 15 minutes, 5 essais, un seul code en cours par compte ; seule son empreinte est gardée.
//   • Même réponse que le compte existe ou non ; 5 demandes par heure et par adresse IP, 3 par compte.
//   • Nouveau mot de passe : sessions du compte fermées (setPassword), journal, notification.
//   • Coordonnées de récupération choisies par chacun dans ses paramètres, avec son mot de passe ; à défaut,
//     l'e-mail et le téléphone connus du compte.
//
//   GET  /api/socle/recovery            moyens d'envoi prêts { email, whatsapp, min_length } (pour proposer le lien)
//   POST /api/socle/recovery/request    { identifier } → { sent: true } (toujours)
//   POST /api/socle/recovery/reset      { identifier, code, password } → mot de passe changé
//   GET  /api/socle/recovery/contacts   coordonnées de récupération du compte connecté
//   POST /api/socle/recovery/contacts   { email, phone, password } → enregistrées

import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Notice, SocleDb } from './notify'

export interface RecoveryUser {
  id: number
  name: string
  /** E-mail et téléphone connus de l'application (utilisés à défaut de coordonnées de récupération). */
  email?: string | null
  phone?: string | null
}

export interface RecoveryConfig {
  /** Compte actif (jamais de démonstration) d'après l'identifiant saisi : identifiant de connexion, e-mail ou téléphone. */
  findUser: (identifier: string) => Promise<number | null | undefined>
  /** Compte actif (jamais de démonstration) d'après son numéro. */
  user: (id: number) => Promise<RecoveryUser | null | undefined>
  /** Nouveau mot de passe, haché par l'application ; toutes les sessions du compte sont fermées. */
  setPassword: (id: number, password: string) => Promise<void>
  /** Mot de passe actuel (exigé pour changer les coordonnées de récupération). */
  checkPassword: (id: number, password: string) => Promise<boolean>
  /** Longueur minimale du nouveau mot de passe (8 par défaut). */
  minLength?: number
  /** Règle de mot de passe de l'application (trop court, trop courant…) : lève une erreur au message lisible. */
  validatePassword?: (password: string) => void
  /** Journal d'activité de l'application. */
  log?: (id: number, details: string) => Promise<void>
}

const TABLES = [
  `CREATE TABLE IF NOT EXISTS socle_recovery_contacts (
    user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS socle_recovery_codes (
    user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`
]

const MINUTES = 15
const MAX_ATTEMPTS = 5
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const GENERIC = 'Code incorrect ou expiré : vérifiez-le, ou demandez-en un nouveau.'

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
    if (size > 64 * 1024) throw httpError(413, 'Requête trop volumineuse.')
    chunks.push(c as Buffer)
  }
  try {
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
  } catch {
    throw httpError(400, 'JSON invalide.')
  }
}

/** Numéro WhatsApp au format international sans « + » (8 chiffres burkinabè : indicatif 226 ajouté). */
export function whatsappNumber(raw: unknown): string | null {
  let d = String(raw ?? '').trim().replace(/[^\d+]/g, '')
  if (d.startsWith('+')) d = d.slice(1)
  else if (d.startsWith('00')) d = d.slice(2)
  else if (/^\d{8}$/.test(d)) d = `226${d}`
  d = d.replace(/\D/g, '')
  return /^\d{10,15}$/.test(d) ? d : null
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
    if (this.hits.size > 20_000) this.hits.delete(this.hits.keys().next().value!)
    return ok
  }
}

export class RecoveryService {
  private ready: Promise<unknown> | null = null
  private perIp = new Window(5, 60 * 60_000)
  private perAccount = new Window(3, 60 * 60_000)
  private resetsPerIp = new Window(20, 60 * 60_000)
  private consoleUrl = (process.env.CONSOLE_URL || 'https://pilotage.iamtechnology.store').replace(/\/+$/, '')
  private consoleToken = process.env.CONSOLE_TOKEN ?? ''
  private pepper = process.env.SECRETS_KEY || process.env.CONSOLE_TOKEN || 'iam-socle'
  private cache: { at: number; value: { email: boolean; whatsapp: boolean } } | null = null

  constructor(private opts: { db: SocleDb; app: string; config: RecoveryConfig; resolveUser: (token: string) => Promise<any>; notify?: (userIds: number[], n: Notice) => void }) {}

  private init() {
    this.ready ??= (async () => {
      for (const t of TABLES) await this.opts.db.query(t)
    })().catch((e) => {
      this.ready = null
      throw e
    })
    return this.ready
  }

  private hash(userId: number, code: string) {
    return createHmac('sha256', this.pepper).update(`${userId}:${code}`).digest('hex')
  }

  /** Moyens d'envoi prêts dans la console (gardés 5 minutes). */
  async channels(): Promise<{ email: boolean; whatsapp: boolean }> {
    if (this.cache && Date.now() - this.cache.at < 5 * 60_000) return this.cache.value
    let value = { email: false, whatsapp: false }
    if (this.consoleToken) {
      try {
        const r = await fetch(`${this.consoleUrl}/api/agent/recovery`, { headers: { Authorization: `Bearer ${this.consoleToken}` }, signal: AbortSignal.timeout(6000) })
        const j: any = await r.json().catch(() => null)
        if (j?.ok) value = { email: !!j.data?.email, whatsapp: !!j.data?.whatsapp }
      } catch {
        /* console injoignable : récupération indisponible pour le moment */
      }
    }
    this.cache = { at: Date.now(), value }
    return value
  }

  /** Compte d'après l'identifiant : celui de l'application, sinon l'e-mail ou le numéro de récupération (s'il est unique). */
  private async find(identifier: string): Promise<RecoveryUser | null> {
    const raw = identifier.trim().slice(0, 160)
    if (!raw) return null
    await this.init()
    let id = (await this.opts.config.findUser(raw)) ?? null
    if (!id && EMAIL.test(raw)) {
      const rows = await this.opts.db.query<{ user_id: number }>("SELECT user_id FROM socle_recovery_contacts WHERE lower(email) = lower($1) AND email <> ''", [raw])
      if (rows.length === 1) id = rows[0].user_id
    }
    const digits = raw.replace(/\D/g, '')
    if (!id && digits.length >= 8 && !/[a-z@]/i.test(raw)) {
      const rows = await this.opts.db.query<{ user_id: number }>("SELECT user_id FROM socle_recovery_contacts WHERE right(regexp_replace(phone, '\\D', '', 'g'), 8) = $1", [digits.slice(-8)])
      if (rows.length === 1) id = rows[0].user_id
    }
    if (!id) return null
    return (await this.opts.config.user(id)) ?? null
  }

  private async contactsOf(u: RecoveryUser) {
    const c = await this.opts.db.one<{ email: string; phone: string }>('SELECT email, phone FROM socle_recovery_contacts WHERE user_id = $1', [u.id])
    const email = [c?.email, u.email].map((e) => String(e ?? '').trim()).find((e) => EMAIL.test(e)) ?? ''
    const phone = [c?.phone, u.phone].map((p) => whatsappNumber(p)).find(Boolean) ?? ''
    return { email, phone }
  }

  private async relay(channel: 'email' | 'whatsapp', to: string, u: RecoveryUser, code: string): Promise<boolean> {
    try {
      const r = await fetch(`${this.consoleUrl}/api/agent/recovery`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.consoleToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, to, code, name: u.name, minutes: MINUTES, app: this.opts.app }),
        signal: AbortSignal.timeout(25_000)
      })
      const j: any = await r.json().catch(() => null)
      if (!j?.ok) console.warn(`[récupération] envoi ${channel} refusé : ${j?.error ?? r.status}`)
      return !!j?.ok
    } catch (e: any) {
      console.warn(`[récupération] console injoignable : ${e?.message ?? e}`)
      return false
    }
  }

  /** Demande de code : même réponse, et aussi vite, que le compte existe ou non (l'envoi se fait ensuite). */
  async request(identifier: string, ip: string) {
    if (!this.perIp.take(ip)) throw httpError(429, 'Trop de demandes depuis cet appareil : réessayez dans une heure.')
    this.pending = this.deliver(String(identifier ?? '')).catch((e) => console.error('[récupération]', e?.message ?? e))
    return { sent: true }
  }

  /** Dernier envoi lancé (attendu par les tests). */
  pending: Promise<unknown> = Promise.resolve()

  private async deliver(identifier: string) {
    const u = await this.find(identifier)
    if (!u || !this.perAccount.take(String(u.id))) return
    const { email, phone } = await this.contactsOf(u)
    const ready = await this.channels()
    const ways = [...(email && ready.email ? (['email'] as const) : []), ...(phone && ready.whatsapp ? (['whatsapp'] as const) : [])]
    if (!ways.length) {
      await this.opts.config.log?.(u.id, 'Mot de passe oublié : aucun moyen d’envoyer un code (coordonnées de récupération ou envoi non configurés)').catch(() => {})
      return
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    await this.opts.db.query(
      `INSERT INTO socle_recovery_codes (user_id, code_hash, expires_at, attempts, created_at) VALUES ($1, $2, now() + interval '${MINUTES} minutes', 0, now())
       ON CONFLICT (user_id) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = 0, created_at = now()`,
      [u.id, this.hash(u.id, code)]
    )
    const sent: string[] = []
    for (const w of ways) if (await this.relay(w, w === 'email' ? email : phone, u, code)) sent.push(w === 'email' ? 'e-mail' : 'WhatsApp')
    if (!sent.length) await this.opts.db.query('DELETE FROM socle_recovery_codes WHERE user_id = $1', [u.id])
    await this.opts.config.log?.(u.id, sent.length ? `Mot de passe oublié : code envoyé par ${sent.join(' et ')}` : 'Mot de passe oublié : envoi du code impossible (console injoignable)').catch(() => {})
  }

  /** Nouveau mot de passe avec le code reçu. */
  async reset(input: any, ip: string) {
    if (!this.resetsPerIp.take(ip)) throw httpError(429, 'Trop d’essais depuis cet appareil : réessayez dans une heure.')
    const min = this.opts.config.minLength ?? 8
    const password = String(input?.password ?? '')
    const code = String(input?.code ?? '').replace(/\s/g, '')
    if (!/^\d{6}$/.test(code)) throw httpError(400, 'Saisissez le code à 6 chiffres reçu.')
    if (password.length < min) throw httpError(400, `Mot de passe trop court : ${min} caractères au moins.`)
    if (password.length > 200) throw httpError(400, 'Mot de passe trop long.')
    // Règle de l'application vérifiée avant le code : un mot de passe refusé ne consomme pas d'essai
    try {
      this.opts.config.validatePassword?.(password)
    } catch (e: any) {
      throw httpError(400, String(e?.message ?? e))
    }
    const u = await this.find(String(input?.identifier ?? ''))
    if (!u) throw httpError(400, GENERIC)
    const row = await this.opts.db.one<{ code_hash: string; attempts: number; valid: boolean }>('SELECT code_hash, attempts, expires_at > now() AS valid FROM socle_recovery_codes WHERE user_id = $1', [u.id])
    if (!row || !row.valid) throw httpError(400, GENERIC)
    if (row.attempts >= MAX_ATTEMPTS) {
      await this.opts.db.query('DELETE FROM socle_recovery_codes WHERE user_id = $1', [u.id])
      throw httpError(400, 'Trop d’essais avec ce code : demandez-en un nouveau.')
    }
    const expected = Buffer.from(row.code_hash, 'hex')
    const got = Buffer.from(this.hash(u.id, code), 'hex')
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) {
      await this.opts.db.query('UPDATE socle_recovery_codes SET attempts = attempts + 1 WHERE user_id = $1', [u.id])
      throw httpError(400, row.attempts + 1 >= MAX_ATTEMPTS ? 'Trop d’essais avec ce code : demandez-en un nouveau.' : GENERIC)
    }
    await this.opts.db.query('DELETE FROM socle_recovery_codes WHERE user_id = $1', [u.id])
    await this.opts.config.setPassword(u.id, password)
    await this.opts.config.log?.(u.id, 'Mot de passe réinitialisé avec un code de récupération (sessions fermées)').catch(() => {})
    try {
      this.opts.notify?.([u.id], { title: 'Mot de passe changé', body: 'Votre mot de passe vient d’être réinitialisé. Si ce n’est pas vous, prévenez l’administrateur de votre espace.', tag: 'socle-recovery' })
    } catch {
      /* notification facultative */
    }
    return { reset: true }
  }

  async contacts(user: any) {
    await this.init()
    const u = await this.opts.config.user(user.id)
    const c = await this.opts.db.one<{ email: string; phone: string }>('SELECT email, phone FROM socle_recovery_contacts WHERE user_id = $1', [user.id])
    return {
      email: c?.email ?? '',
      phone: c?.phone ?? '',
      account_email: String(u?.email ?? ''),
      account_phone: String(u?.phone ?? ''),
      demo: !u,
      channels: await this.channels(),
      min_length: this.opts.config.minLength ?? 8
    }
  }

  async saveContacts(user: any, input: any) {
    await this.init()
    if (!(await this.opts.config.user(user.id))) throw httpError(400, 'La version de démonstration n’a pas de coordonnées de récupération.')
    if (!(await this.opts.config.checkPassword(user.id, String(input?.password ?? '')))) throw httpError(400, 'Mot de passe incorrect.')
    const email = String(input?.email ?? '').trim().toLowerCase().slice(0, 160)
    const rawPhone = String(input?.phone ?? '').trim().slice(0, 40)
    if (email && !EMAIL.test(email)) throw httpError(400, 'Adresse e-mail invalide.')
    if (rawPhone && !whatsappNumber(rawPhone)) throw httpError(400, 'Numéro WhatsApp invalide (ex. +226 70 00 00 00).')
    await this.opts.db.query(
      `INSERT INTO socle_recovery_contacts (user_id, email, phone, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, phone = EXCLUDED.phone, updated_at = now()`,
      [user.id, email, rawPhone]
    )
    await this.opts.config.log?.(user.id, 'Coordonnées de récupération du mot de passe modifiées').catch(() => {})
    return this.contacts(user)
  }

  async handle(req: IncomingMessage, res: ServerResponse, path: string, ip: string): Promise<boolean> {
    if (path !== '/api/socle/recovery' && !path.startsWith('/api/socle/recovery/')) return false
    try {
      if (path === '/api/socle/recovery' && req.method === 'GET') return json(res, 200, { ok: true, data: { ...(await this.channels()), min_length: this.opts.config.minLength ?? 8 } }), true
      if (path === '/api/socle/recovery/request' && req.method === 'POST') {
        const b = await readJson(req)
        return json(res, 200, { ok: true, data: await this.request(String(b.identifier ?? ''), ip) }), true
      }
      if (path === '/api/socle/recovery/reset' && req.method === 'POST') return json(res, 200, { ok: true, data: await this.reset(await readJson(req), ip) }), true
      if (path === '/api/socle/recovery/contacts') {
        const token = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1] ?? ''
        const user = token ? await this.opts.resolveUser(token) : null
        if (!user) return json(res, 401, { ok: false, error: 'Session expirée, veuillez vous reconnecter.' }), true
        if (req.method === 'GET') return json(res, 200, { ok: true, data: await this.contacts(user) }), true
        if (req.method === 'POST') return json(res, 200, { ok: true, data: await this.saveContacts(user, await readJson(req)) }), true
      }
      return json(res, 404, { ok: false, error: 'Ressource inconnue.' }), true
    } catch (e: any) {
      const status = Number(e?.status) || 500
      if (status >= 500) console.error('[récupération]', e)
      if (!res.headersSent) json(res, status, { ok: false, error: status >= 500 ? 'Erreur interne du serveur.' : String(e?.message ?? e) })
      return true
    }
  }
}
