// Jetons de connexion du serveur web (applications mobiles, navigateur, postes
// connectés à un domaine). Seule l'empreinte SHA-256 du jeton est stockée.

import { createHash, randomBytes } from 'node:crypto'
import type { Db } from '../db'
import type { SessionUser } from './context'

const TTL_DAYS = 30

const hash = (token: string) => createHash('sha256').update(token).digest('hex')

export async function createToken(db: Db, userId: number, device = ''): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await db.query(
    `INSERT INTO auth_sessions (token_hash, user_id, device, expires_at) VALUES ($1, $2, $3, now() + ($4 || ' days')::interval)`,
    [hash(token), userId, device.slice(0, 200), String(TTL_DAYS)]
  )
  // Ménage des jetons expirés.
  await db.query('DELETE FROM auth_sessions WHERE expires_at < now()')
  return token
}

export async function resolveToken(db: Db, token: string | null | undefined): Promise<SessionUser | null> {
  if (!token) return null
  const row = await db.one<SessionUser>(
    `SELECT u.id, u.username, u.full_name, u.role
     FROM auth_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active`,
    [hash(token)]
  )
  return row ?? null
}

export async function revokeToken(db: Db, token: string): Promise<void> {
  await db.query('DELETE FROM auth_sessions WHERE token_hash = $1', [hash(token)])
}

/** Déconnecte tous les appareils d'un utilisateur (mot de passe changé, compte désactivé). */
export async function revokeUser(db: Db, userId: number): Promise<void> {
  await db.query('DELETE FROM auth_sessions WHERE user_id = $1', [userId])
}
