// « Mot de passe oublié ? » d'IAM INVOICER, serveur web (base commune : tools/socle/server/recovery.ts).
// Chaque client hébergé a sa propre base : compte retrouvé par son nom d'utilisateur ou par l'e-mail /
// le numéro WhatsApp de récupération choisi dans « Mon compte » ; code envoyé par la console d'IAM
// Technology, nouveau mot de passe haché ici, sessions fermées. Jamais dans la société de démonstration.
import type { Db } from '../main/db'
import { audit, type SessionUser } from '../main/services/context'
import { checkPassword, checkUserPassword, hashPassword } from '../main/services/auth'
import { isDemoDb } from '../main/services/demoMode'
import type { RecoveryConfig, RecoveryUser } from '../../tools/socle/server/recovery'

export function recoveryConfig(db: Db): RecoveryConfig {
  return {
    findUser: async (identifier) => {
      if (await isDemoDb(db)) return null
      return (await db.one<{ id: number }>('SELECT id FROM users WHERE active AND lower(username) = lower($1)', [identifier]))?.id ?? null
    },
    user: async (id) => {
      if (await isDemoDb(db)) return null
      return (await db.one<RecoveryUser>('SELECT id, full_name AS name FROM users WHERE active AND id = $1', [id])) ?? null
    },
    setPassword: async (id, password) => {
      await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [id, hashPassword(password)])
      await db.query('DELETE FROM auth_sessions WHERE user_id = $1', [id])
    },
    checkPassword: (id, password) => checkUserPassword(db, id, password),
    minLength: 8,
    validatePassword: (password) => checkPassword(password),
    log: async (id, details) => {
      const user = (await db.one<SessionUser>('SELECT id, username, full_name, role FROM users WHERE id = $1', [id])) ?? null
      await audit(db, { db, user }, 'recuperation', 'utilisateur', id, details)
    }
  }
}
