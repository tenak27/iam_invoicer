// Verrou de sécurité des exercices comptables.
//
// Ouvrir, clôturer, rouvrir ou supprimer un exercice engage toute la comptabilité : une session
// restée ouverte sur un poste ne doit pas suffire. Chaque opération redemande donc le mot de passe
// de la personne connectée et, selon le réglage choisi par l'administrateur, un second facteur :
//   - « email » : un code à usage unique envoyé à l'adresse de sécurité (souvent celle du dirigeant,
//     qui garde ainsi la main sur la clôture) ;
//   - « totp »  : le code à six chiffres d'une application d'authentification, utilisable sans Internet.
// Après cinq essais manqués, les opérations sont suspendues un quart d'heure pour ce compte.
// Tout est inscrit au journal d'activité, refus compris.

import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { can } from '@shared/domain'
import type { Db } from '../db'
import { seal, unseal } from '../secretbox'
import { audit, fail, str, type Ctx } from './context'

export type GuardMode = 'password' | 'email' | 'totp'
export type GuardAction = 'open' | 'close' | 'reopen' | 'delete' | 'config'
export interface GuardAuth { password?: string; code?: string }

const ACTIONS: GuardAction[] = ['open', 'close', 'reopen', 'delete', 'config']
const ACTION_LABELS: Record<GuardAction, string> = { open: "l'ouverture d'un exercice", close: "la clôture d'un exercice", reopen: "la réouverture d'un exercice", delete: "la suppression d'un exercice", config: 'la modification de la protection des exercices' }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_FAILS = 5
const CODE_MINUTES = 10

// ---------- Réglage (hors des paramètres généraux : seul un administrateur authentifié le modifie) ----------

async function kvGet<T>(db: Db, key: string, fallback: T): Promise<T> {
  const row = await db.one<{ value: string }>('SELECT value FROM settings WHERE key = $1', [key])
  try { return row ? (JSON.parse(row.value) as T) : fallback } catch { return fallback }
}
async function kvSet(db: Db, key: string, value: unknown) {
  await db.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, JSON.stringify(value)])
}
async function secretGet(db: Db, key: string): Promise<string> {
  return unseal((await db.one<{ value: string }>('SELECT value FROM secrets WHERE key = $1', [key]))?.value)
}
async function secretSet(db: Db, key: string, value: string) {
  await db.query('INSERT INTO secrets (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, value ? seal(value) : ''])
}

async function readGuard(db: Db): Promise<{ mode: GuardMode; email: string }> {
  const g = await kvGet<{ mode?: string; email?: string }>(db, 'fiscal_guard', {})
  const mode: GuardMode = g.mode === 'email' || g.mode === 'totp' ? g.mode : 'password'
  return { mode, email: str(g.email) }
}

const mask = (email: string) => email.replace(/^(.{1,2})[^@]*(@.*)$/, '$1•••$2')

export async function getGuard(ctx: Ctx) {
  const g = await readGuard(ctx.db)
  const admin = ctx.user!.role === 'admin'
  const { getSettings } = await import('./settings')
  const s = await getSettings(ctx.db)
  return {
    mode: g.mode,
    email: admin ? g.email : mask(g.email),
    totp: !!(await secretGet(ctx.db, 'fiscal_totp')),
    smtp: !!s.smtp_host,
    admin,
    code_minutes: CODE_MINUTES
  }
}

// ---------- Codes d'application d'authentification (RFC 6238 : HMAC-SHA1, 30 secondes, 6 chiffres) ----------

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
function base32(buf: Buffer): string {
  let bits = 0, value = 0, out = ''
  for (const b of buf) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5 }
  }
  return bits ? out + B32[(value << (5 - bits)) & 31] : out
}
function unbase32(s: string): Buffer {
  let bits = 0, value = 0
  const out: number[] = []
  for (const c of s.toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    value = (value << 5) | B32.indexOf(c)
    bits += 5
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8 }
  }
  return Buffer.from(out)
}
export function totpCode(secret: string, step: number): string {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(step))
  const h = createHmac('sha1', unbase32(secret)).update(msg).digest()
  const o = h[h.length - 1] & 15
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
/** Pas de temps correspondant au code (fenêtre de ± 30 secondes), ou null. */
function totpMatch(secret: string, code: string, now = Date.now()): number | null {
  const step = Math.floor(now / 30_000)
  for (const d of [0, -1, 1]) if (same(totpCode(secret, step + d), code)) return step + d
  return null
}

/** Prépare l'association d'une application d'authentification : la clé n'est retenue qu'une fois un code vérifié. */
export async function totpStart(ctx: Ctx) {
  if (ctx.user!.role !== 'admin') fail('Seul un administrateur règle la protection des exercices.')
  const secret = base32(randomBytes(20))
  await secretSet(ctx.db, 'fiscal_totp_pending', secret)
  const { getSettings } = await import('./settings')
  const company = (await getSettings(ctx.db)).name || 'Société'
  const uri = `otpauth://totp/${encodeURIComponent('IAM INVOICER:' + company)}?secret=${secret}&issuer=${encodeURIComponent('IAM INVOICER')}&digits=6&period=30`
  const QRCode = (await import('qrcode')).default
  return { secret: secret.replace(/(.{4})/g, '$1 ').trim(), uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) }
}

// ---------- Essais manqués ----------

async function blocked(db: Db, userId: number): Promise<boolean> {
  const r = await db.one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM fiscal_auth_failures WHERE user_id = $1 AND at > now() - interval '15 minutes'`, [userId])
  return (r?.n ?? 0) >= MAX_FAILS
}
async function refuse(ctx: Ctx, action: GuardAction, why: string, message: string): Promise<never> {
  await ctx.db.query('INSERT INTO fiscal_auth_failures (user_id) VALUES ($1)', [ctx.user!.id])
  await audit(ctx.db, ctx, 'refus', 'verrou_exercice', null, `${action} : ${why}`)
  if (await blocked(ctx.db, ctx.user!.id)) fail(`${message} Trop d'essais manqués : les opérations sur les exercices sont suspendues 15 minutes pour votre compte.`)
  return fail(message)
}

// ---------- Codes envoyés par e-mail ----------

const hashCode = (salt: string, code: string) => createHash('sha256').update(salt + ':' + code).digest('hex')
const cleanCode = (v: unknown) => String(v ?? '').replace(/\D/g, '').slice(0, 8)

function mayDo(ctx: Ctx, action: GuardAction): boolean {
  return action === 'config' || action === 'reopen' ? ctx.user!.role === 'admin' : can(ctx.user!.role, 'finance')
}

/**
 * Demande un code pour une opération. En mode « email », le code part à l'adresse de sécurité.
 * Avec `email` (action « config »), il part à cette nouvelle adresse, pour prouver qu'elle reçoit bien les codes.
 */
export async function challenge(ctx: Ctx, args: { action: GuardAction; id?: number; email?: string }) {
  const action = ACTIONS.includes(args?.action) ? args.action : fail('Opération inconnue.')
  if (!mayDo(ctx, action)) fail("Vous n'avez pas le droit de réaliser cette opération.")
  const g = await readGuard(ctx.db)
  const fresh = action === 'config' ? str(args.email).toLowerCase() : ''
  if (fresh && !EMAIL_RE.test(fresh)) fail('Adresse e-mail de sécurité invalide.')
  if (!fresh && g.mode !== 'email') return { mode: g.mode, sent: false }
  const to = fresh || g.email
  const ref = fresh ? 'new:' + fresh : refOf(action, args.id)
  const userId = ctx.user!.id
  if (await blocked(ctx.db, userId)) fail("Trop d'essais manqués : réessayez dans 15 minutes.")
  const recent = await ctx.db.one<{ last: number; hour: number }>(
    `SELECT COUNT(*) FILTER (WHERE created_at > now() - interval '30 seconds')::int AS last, COUNT(*)::int AS hour
     FROM fiscal_challenges WHERE user_id = $1 AND created_at > now() - interval '1 hour'`, [userId])
  if (recent?.last) fail('Un code vient de vous être envoyé : patientez 30 secondes avant d’en demander un autre.')
  if ((recent?.hour ?? 0) >= 10) fail('Trop de codes demandés : réessayez dans une heure.')
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const salt = randomBytes(12).toString('hex')
  await ctx.db.query('UPDATE fiscal_challenges SET used_at = now() WHERE user_id = $1 AND action = $2 AND ref = $3 AND used_at IS NULL', [userId, action, ref])
  const row = await ctx.db.one<{ id: number }>(
    `INSERT INTO fiscal_challenges (user_id, action, ref, code_hash, expires_at) VALUES ($1, $2, $3, $4, now() + interval '${CODE_MINUTES} minutes') RETURNING id`,
    [userId, action, ref, `${salt}:${hashCode(salt, code)}`]
  )
  const { sendSecurityEmail } = await import('./messaging')
  try {
    await sendSecurityEmail(ctx, to, `Code de sécurité : ${code}`,
      `Bonjour,\n\n${ctx.user!.full_name} demande ${ACTION_LABELS[action]} dans IAM INVOICER.\n\nCode de sécurité : ${code}\n\nCe code est valable ${CODE_MINUTES} minutes et ne sert qu'une fois. Si cette demande ne vient pas de vous ou d'une personne autorisée, ne communiquez pas ce code et changez les mots de passe concernés.`)
  } catch (e) {
    await ctx.db.query('DELETE FROM fiscal_challenges WHERE id = $1', [row!.id])
    throw e
  }
  await audit(ctx.db, ctx, 'code_envoye', 'verrou_exercice', null, `${action} → ${mask(to)}`)
  return { mode: 'email' as const, sent: true, to: mask(to), minutes: CODE_MINUTES }
}

const refOf = (action: GuardAction, id?: unknown) => (action === 'config' ? 'config' : action === 'open' ? '' : String(Number(id) || 0))

async function checkEmailCode(ctx: Ctx, action: GuardAction, ref: string, raw: unknown) {
  const code = cleanCode(raw)
  if (code.length !== 6) fail('Saisissez le code à six chiffres reçu par e-mail (bouton « Recevoir un code »).')
  const row = await ctx.db.one<{ id: number; code_hash: string; attempts: number }>(
    `SELECT id, code_hash, attempts FROM fiscal_challenges WHERE user_id = $1 AND action = $2 AND ref = $3 AND used_at IS NULL AND expires_at > now() ORDER BY id DESC LIMIT 1`,
    [ctx.user!.id, action, ref]
  )
  if (!row) fail('Aucun code valable pour cette opération : demandez-en un nouveau.')
  if (row.attempts >= MAX_FAILS) fail('Ce code a été bloqué après plusieurs essais : demandez-en un nouveau.')
  const [salt, hash] = row.code_hash.split(':')
  if (!same(hashCode(salt, code), hash)) {
    await ctx.db.query('UPDATE fiscal_challenges SET attempts = attempts + 1 WHERE id = $1', [row.id])
    await refuse(ctx, action, 'code e-mail incorrect', 'Code incorrect.')
  }
  await ctx.db.query('UPDATE fiscal_challenges SET used_at = now() WHERE id = $1', [row.id])
}

async function checkTotp(ctx: Ctx, action: GuardAction, raw: unknown) {
  const secret = await secretGet(ctx.db, 'fiscal_totp')
  if (!secret) fail("Aucune application d'authentification n'est associée : un administrateur doit régler la protection des exercices.")
  const code = cleanCode(raw)
  if (code.length !== 6) fail("Saisissez le code à six chiffres affiché par votre application d'authentification.")
  const step = totpMatch(secret, code)
  if (step === null) await refuse(ctx, action, 'code d’application incorrect', "Code incorrect. Vérifiez l'heure de votre téléphone et saisissez le code affiché.")
  // Un code ne sert qu'une fois, même pendant ses trente secondes de validité
  const last = await kvGet<number>(ctx.db, 'fiscal_totp_step', 0)
  if (step! <= last) fail('Ce code a déjà servi : attendez le suivant (30 secondes).')
  await kvSet(ctx.db, 'fiscal_totp_step', step)
}

/**
 * Vérifie le mot de passe de la personne connectée puis le second facteur exigé.
 * À appeler hors transaction : les essais manqués doivent rester inscrits même si l'opération échoue.
 */
export async function assertFiscalAuth(ctx: Ctx, action: GuardAction, id: unknown, auth: GuardAuth | undefined) {
  const user = ctx.user!
  if (await blocked(ctx.db, user.id)) fail("Trop d'essais manqués : les opérations sur les exercices sont suspendues 15 minutes pour votre compte.")
  const password = String(auth?.password ?? '').slice(0, 1000)
  if (!password) fail('Saisissez votre mot de passe pour confirmer cette opération.')
  const { checkUserPassword } = await import('./auth')
  if (!(await checkUserPassword(ctx.db, user.id, password))) await refuse(ctx, action, 'mot de passe incorrect', 'Mot de passe incorrect.')
  const g = await readGuard(ctx.db)
  if (g.mode === 'email') await checkEmailCode(ctx, action, refOf(action, id), auth?.code)
  else if (g.mode === 'totp') await checkTotp(ctx, action, auth?.code)
}

/** Réglage de la protection (administrateur) : la protection en place doit d'abord être franchie. */
export async function saveGuard(ctx: Ctx, input: { mode: GuardMode; email?: string; password?: string; code?: string; new_code?: string }) {
  if (ctx.user!.role !== 'admin') fail('Seul un administrateur règle la protection des exercices.')
  const mode: GuardMode = input?.mode === 'email' || input?.mode === 'totp' || input?.mode === 'password' ? input.mode : fail('Protection inconnue.')
  const current = await readGuard(ctx.db)
  const email = mode === 'email' ? str(input.email).toLowerCase() : current.email
  let pending = ''
  if (mode === 'email') {
    if (!EMAIL_RE.test(email)) fail('Adresse e-mail de sécurité invalide.')
    const { getSettings } = await import('./settings')
    if (!(await getSettings(ctx.db)).smtp_host) fail("Configurez d'abord l'envoi des e-mails (Société et paramètres → E-mail d’envoi) : sans lui, aucun code ne peut être envoyé.")
  }
  if (mode === 'totp' && current.mode !== 'totp') {
    pending = await secretGet(ctx.db, 'fiscal_totp_pending')
    if (!pending) fail("Affichez d'abord le code QR et scannez-le avec votre application d'authentification.")
  }
  await assertFiscalAuth(ctx, 'config', null, input)
  // Le nouveau facteur doit avoir fait ses preuves avant d'être exigé : sinon plus personne ne pourrait clôturer
  if (mode === 'email' && (current.mode !== 'email' || current.email !== email)) await checkEmailCode(ctx, 'config', 'new:' + email, input.new_code)
  if (pending) {
    const code = cleanCode(input.new_code)
    if (code.length !== 6 || totpMatch(pending, code) === null) await refuse(ctx, 'config', 'code d’association incorrect', "Le code de l'application ne correspond pas : scannez de nouveau le code QR et saisissez le code affiché.")
    await secretSet(ctx.db, 'fiscal_totp', pending)
    await secretSet(ctx.db, 'fiscal_totp_pending', '')
    await kvSet(ctx.db, 'fiscal_totp_step', 0)
  }
  await kvSet(ctx.db, 'fiscal_guard', { mode, email })
  await audit(ctx.db, ctx, 'modification', 'verrou_exercice', null, mode === 'email' ? `code par e-mail → ${mask(email)}` : mode === 'totp' ? "application d'authentification" : 'mot de passe seul')
  return getGuard(ctx)
}
