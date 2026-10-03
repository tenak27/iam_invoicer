import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { Role } from '@shared/domain'
import { ROLE_LABELS } from '@shared/domain'
import type { Db } from '../db'
import { audit, fail, str, type Ctx, type SessionUser } from './context'
import { checkUserQuota } from './licence'
import { saveSettings, type CompanySettings } from './settings'
import { revokeUser } from './tokens'

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const expected = Buffer.from(hash, 'hex')
  const actual = scryptSync(password, salt, expected.length)
  return timingSafeEqual(expected, actual)
}

function checkPassword(p: string): void {
  if (p.length < 6) fail('Le mot de passe doit contenir au moins 6 caractères.')
}

function checkRole(role: string): asserts role is Role {
  if (!(role in ROLE_LABELS)) fail('Rôle inconnu.')
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
  if (!row || !verifyPassword(password, row.password_hash)) fail('Identifiant ou mot de passe incorrect.')
  if (!row.active) fail('Ce compte est désactivé.')
  await audit(db, { db, user: row }, 'connexion', 'utilisateur', row.id)
  return { id: row.id, username: row.username, full_name: row.full_name, role: row.role }
}

export async function listUsers(ctx: Ctx) {
  return ctx.db.query('SELECT id, username, full_name, role, active, created_at FROM users ORDER BY username')
}

export async function saveUser(
  ctx: Ctx,
  input: { id?: number; username: string; full_name: string; role: string; password?: string; active?: boolean }
) {
  const username = str(input.username).toLowerCase()
  if (!/^[a-z0-9._-]{2,}$/.test(username)) fail("Nom d'utilisateur invalide (lettres, chiffres, . _ - ; 2 caractères minimum).")
  checkRole(input.role)
  // Licence : nombre d'utilisateurs actifs
  if (input.active !== false) await checkUserQuota(ctx.db, input.id)
  if (input.id) {
    if (input.id === ctx.user?.id && (input.role !== 'admin' || input.active === false))
      fail('Vous ne pouvez pas retirer vos propres droits administrateur.')
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
  if (!row || !verifyPassword(input.current, row.password_hash)) fail('Mot de passe actuel incorrect.')
  checkPassword(input.next)
  await ctx.db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(input.next), ctx.user!.id])
  return true
}
