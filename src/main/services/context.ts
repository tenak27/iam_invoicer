import type { Db } from '../db'
import type { Role } from '@shared/domain'

export interface SessionUser {
  id: number
  username: string
  full_name: string
  role: Role
}

export interface Ctx {
  db: Db
  user: SessionUser | null
}

/** Erreur destinée à être affichée telle quelle à l'utilisateur. */
export class AppError extends Error {}

export function fail(message: string): never {
  throw new AppError(message)
}

export function requireUser(ctx: Ctx): SessionUser {
  if (!ctx.user) fail('Session expirée, veuillez vous reconnecter.')
  return ctx.user
}

export async function audit(db: Db, ctx: Ctx, action: string, entity: string, entityId: number | null, details = ''): Promise<void> {
  await db.query('INSERT INTO audit_log (user_id, action, entity, entity_id, details) VALUES ($1, $2, $3, $4, $5)', [
    ctx.user?.id ?? null,
    action,
    entity,
    entityId,
    details
  ])
}

export const str = (v: unknown): string => (v == null ? '' : String(v).trim())
export const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}
