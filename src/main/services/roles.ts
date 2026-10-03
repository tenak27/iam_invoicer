// Matrice des rôles et des droits : la société choisit les modules de chaque rôle.
// L'administrateur garde tous les droits (impossible de se retirer l'accès).

import { PERMISSIONS, ROLE_LABELS, setRolePermissions, type Module, type Role } from '@shared/domain'
import type { Db } from '../db'
import { audit, fail, type Ctx } from './context'

const KEY = 'role_permissions'
const cache = new WeakMap<Db, number>()

async function readOverrides(db: Db): Promise<Partial<Record<Role, Module[]>>> {
  const row = await db.one<{ value: string }>('SELECT value FROM settings WHERE key = $1', [KEY])
  try {
    return row ? JSON.parse(row.value) ?? {} : {}
  } catch {
    return {}
  }
}

/** Charge la matrice de la société (rafraîchie toutes les 5 secondes au plus). */
export async function loadRolePermissions(db: Db) {
  const at = cache.get(db)
  if (at && Date.now() - at < 5000) return
  setRolePermissions(await readOverrides(db))
  cache.set(db, Date.now())
}

export async function getRoles(ctx: Ctx) {
  const overrides = await readOverrides(ctx.db)
  const roles = Object.keys(PERMISSIONS) as Role[]
  return {
    defaults: PERMISSIONS,
    current: Object.fromEntries(roles.map((r) => [r, r === 'admin' ? PERMISSIONS.admin : overrides[r] ?? PERMISSIONS[r]])) as Record<Role, Module[]>,
    customized: Object.keys(overrides).length > 0
  }
}

export async function saveRoles(ctx: Ctx, input: { current: Partial<Record<Role, Module[]>> | null }) {
  const all = PERMISSIONS.admin
  const out: Partial<Record<Role, Module[]>> = {}
  if (input?.current) {
    for (const [role, modules] of Object.entries(input.current) as [Role, Module[]][]) {
      if (!(role in PERMISSIONS)) fail(`Rôle inconnu : ${role}`)
      if (role === 'admin') continue
      if (!Array.isArray(modules)) fail('Matrice invalide.')
      const clean = [...new Set(modules.filter((m) => all.includes(m)))]
      if (clean.length === 0) fail(`Le rôle « ${ROLE_LABELS[role]} » doit avoir au moins un module.`)
      out[role] = clean
    }
  }
  await ctx.db.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [KEY, JSON.stringify(out)])
  cache.delete(ctx.db)
  await loadRolePermissions(ctx.db)
  await audit(ctx.db, ctx, 'modification', 'roles', null, input?.current ? 'matrice personnalisée' : 'droits par défaut')
  return getRoles(ctx)
}
