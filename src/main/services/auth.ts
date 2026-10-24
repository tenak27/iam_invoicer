import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto'
import type { Role } from '@shared/domain'
import { ROLE_LABELS } from '@shared/domain'
import { VENDOR_ADMIN } from '@shared/licence'
import type { Db } from '../db'
import { audit, fail, str, type Ctx, type SessionUser } from './context'
import { checkUserQuota } from './licence'
import { saveSettings, type CompanySettings } from './settings'
import { revokeOthers, revokeUser } from './tokens'

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}

/** Même vérification sans bloquer le serveur pendant le calcul (connexions simultanées). */
function verifyPasswordAsync(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = String(stored ?? '').split(':')
  const expected = Buffer.from(hash ?? '', 'hex')
  if (!salt || !expected.length || typeof password !== 'string') return Promise.resolve(false)
  return new Promise((resolve) => scrypt(password, salt, expected.length, (err, actual) => resolve(!err && timingSafeEqual(expected, actual))))
}

// Identifiant inconnu : on calcule quand même, pour que le temps de réponse ne révèle pas quels comptes existent
const DUMMY_HASH = hashPassword(randomBytes(12).toString('hex'))
const COMMON = new Set(['password', 'motdepasse', '12345678', '123456789', '1234567890', 'azertyui', 'azertyuiop', 'qwertyui', 'qwertyuiop', '00000000', '11111111', 'admin123', 'admin1234', 'iaminvoicer'])

export function checkPassword(p: string): void {
  if (typeof p !== 'string' || p.length < 8) fail('Le mot de passe doit contenir au moins 8 caractères.')
  if (p.length > 200) fail('Mot de passe trop long (200 caractères au plus).')
  if (COMMON.has(p.toLowerCase())) fail('Ce mot de passe est trop courant : choisissez-en un autre.')
}

function checkRole(role: string): asserts role is Role {
  if (!(role in ROLE_LABELS)) fail('Rôle inconnu.')
}

/** Vérifie le mot de passe d'un compte actif (confirmation d'une opération sensible). */
export async function checkUserPassword(db: Db, userId: number, password: string): Promise<boolean> {
  const row = await db.one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1 AND active', [userId])
  return verifyPasswordAsync(String(password ?? '').slice(0, 1000), row?.password_hash ?? DUMMY_HASH).then((good) => good && !!row)
}

export async function needsSetup(db: Db): Promise<boolean> {
  const row = await db.one<{ n: number }>('SELECT COUNT(*)::int AS n FROM users')
  return (row?.n ?? 0) === 0
}

/** Première ouverture : informations société et compte administrateur. */
export async function setup(
  ctx: Ctx,
  input: { company: Partial<CompanySettings>; username: string; full_name: string; password: string }
): Promise<SessionUser> {
  if (!(await needsSetup(ctx.db))) fail("L'application est déjà configurée.")
  checkPassword(input.password)
  const username = str(input.username).toLowerCase()
  if (!username) fail("Nom d'utilisateur obligatoire.")
  const user = await ctx.db.one<SessionUser>(
    `INSERT INTO users (username, full_name, role, password_hash) VALUES ($1, $2, 'admin', $3)
     RETURNING id, username, full_name, role`,
    [username, str(input.full_name) || username, hashPassword(input.password)]
  )
  await saveSettings({ ...ctx, user: user! }, input.company)
  return user!
}

export async function login(db: Db, username: string, password: string): Promise<SessionUser> {
  const row = await db.one(
    'SELECT id, username, full_name, role, password_hash, active FROM users WHERE username = $1',
    [str(username).toLowerCase()]
  )
  const good = await verifyPasswordAsync(String(password ?? '').slice(0, 1000), row?.password_hash ?? DUMMY_HASH)
  if (!row || !good) fail('Identifiant ou mot de passe incorrect.')
  if (!row.active) fail('Ce compte est désactivé.')
  await audit(db, { db, user: row }, 'connexion', 'utilisateur', row.id)
  return { id: row.id, username: row.username, full_name: row.full_name, role: row.role }
}

export async function listUsers(ctx: Ctx) {
  return ctx.db.query('SELECT id, username, full_name, role, active, avatar, created_at FROM users ORDER BY username')
}

/** Profil de l'utilisateur connecté (photo comprise). */
export async function getProfile(ctx: Ctx) {
  if (!ctx.user) fail('Session expirée, veuillez vous reconnecter.')
  return ctx.db.one('SELECT id, username, full_name, role, avatar FROM users WHERE id = $1', [ctx.user.id])
}

const AVATAR_RE = /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/

/** Photo de profil : chaque utilisateur choisit la sienne (image réduite par l'application). */
export async function setAvatar(ctx: Ctx, input: { avatar: string }) {
  if (!ctx.user) fail('Session expirée, veuillez vous reconnecter.')
  const avatar = String(input?.avatar ?? '')
  if (avatar && !AVATAR_RE.test(avatar)) fail('Photo invalide : choisissez une image PNG, JPG ou WebP.')
  if (avatar.length > 400_000) fail('Photo trop lourde.')
  await ctx.db.query('UPDATE users SET avatar = $1 WHERE id = $2', [avatar, ctx.user.id])
  await audit(ctx.db, ctx, 'modification', 'photo_profil', ctx.user.id)
  return { avatar }
}

export async function saveUser(
  ctx: Ctx,
  input: { id?: number; username: string; full_name: string; role: string; password?: string; active?: boolean }
) {
  const username = str(input.username).toLowerCase()
  // L'adresse e-mail sert d'identifiant aux sociétés inscrites en ligne : « @ » et « + » admis
  if (!/^[a-z0-9._@+-]{2,80}$/.test(username)) fail("Nom d'utilisateur invalide (lettres, chiffres, . _ - @ ; 2 caractères minimum, sans espace).")
  checkRole(input.role)
  const isAdmin = ctx.user?.role === 'admin'
  if (!isAdmin && (input.role === 'admin' || input.role === 'licences')) fail('Seul un administrateur peut attribuer ce rôle.')
  // Licence : nombre d'utilisateurs actifs
  if (input.active !== false) await checkUserQuota(ctx.db, input.id)
  if (input.id) {
    if (input.id === ctx.user?.id && (input.role !== 'admin' || input.active === false))
      fail('Vous ne pouvez pas retirer vos propres droits administrateur.')
    // Compte de l'éditeur (attribution des licences) : modifiable par lui seul, identifiant fixe
    const target = await ctx.db.one<{ username: string; role: string }>('SELECT username, role FROM users WHERE id = $1', [input.id])
    if (!target) fail('Utilisateur introuvable.')
    if (!isAdmin && (target.role === 'admin' || target.role === 'licences')) fail('Seul un administrateur peut modifier ce compte.')
    if (target?.username === VENDOR_ADMIN) {
      if (input.id !== ctx.user?.id) fail(`Le compte « ${VENDOR_ADMIN} » ne peut être modifié que par son titulaire.`)
      if (username !== VENDOR_ADMIN) fail(`L'identifiant du compte « ${VENDOR_ADMIN} » ne peut pas être changé.`)
    }
    await ctx.db.query('UPDATE users SET username = $1, full_name = $2, role = $3, active = $4 WHERE id = $5', [
      username, str(input.full_name), input.role, input.active ?? true, input.id
    ])
    if (input.password) {
      checkPassword(input.password)
      await ctx.db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(input.password), input.id])
    }
    // Compte désactivé ou mot de passe réinitialisé : déconnexion de ses appareils.
    if ((input.active === false || input.password) && input.id !== ctx.user?.id) await revokeUser(ctx.db, input.id)
    await audit(ctx.db, ctx, 'modification', 'utilisateur', input.id, username)
    return { id: input.id }
  }
  if (!input.password) fail('Mot de passe obligatoire pour un nouvel utilisateur.')
  checkPassword(input.password)
  const exists = await ctx.db.one('SELECT 1 FROM users WHERE username = $1', [username])
  if (exists) fail("Ce nom d'utilisateur existe déjà.")
  const row = await ctx.db.one<{ id: number }>(
    'INSERT INTO users (username, full_name, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING id',
    [username, str(input.full_name) || username, input.role, hashPassword(input.password)]
  )
  await audit(ctx.db, ctx, 'creation', 'utilisateur', row!.id, username)
  return row!
}

export async function changeOwnPassword(ctx: Ctx, input: { current: string; next: string }) {
  const row = await ctx.db.one('SELECT password_hash FROM users WHERE id = $1', [ctx.user!.id])
  if (!row || !(await verifyPasswordAsync(String(input?.current ?? ''), row.password_hash))) fail('Mot de passe actuel incorrect.')
  checkPassword(input.next)
  await ctx.db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(input.next), ctx.user!.id])
  // Un mot de passe changé parce qu'il a fuité doit fermer les sessions ouvertes ailleurs
  await revokeOthers(ctx.db, ctx.user!.id, ctx.token)
  await audit(ctx.db, ctx, 'modification', 'mot_de_passe', ctx.user!.id)
  return true
}
