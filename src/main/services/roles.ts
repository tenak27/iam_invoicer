// Matrice des rôles et des droits : la société choisit les modules de chaque rôle.
// L'administrateur garde tous les droits (impossible de se retirer l'accès).

import { AsyncLocalStorage } from 'node:async_hooks'
import { PERMISSIONS, ROLE_LABELS, setPermissionResolver, type Module, type Role } from '@shared/domain'
import type { Db } from '../db'
import { audit, fail, type Ctx } from './context'

const KEY = 'role_permissions'
type Overrides = Partial<Record<Role, Module[]>>
const cache = new WeakMap<Db, { at: number; value: Overrides }>()
// Matrice de la requête en cours : chaque appel du routeur travaille avec celle de SA base
const scope = new AsyncLocalStorage<Overrides>()
setPermissionResolver(() => scope.getStore())

async function readOverrides(db: Db): Promise<Partial<Record<Role, Module[]>>> {
  const row = await db.one<{ value: string }>('SELECT value FROM settings WHERE key = $1', [KEY])
  try {
    return row ? JSON.parse(row.value) ?? {} : {}
  } catch {
    return {}
  }
}

/** Matrice de la société (relue toutes les 5 secondes au plus). */
async function overridesFor(db: Db): Promise<Overrides> {
  const hit = cache.get(db)
  if (hit && Date.now() - hit.at < 5000) return hit.value
  const value = await readOverrides(db)
  cache.set(db, { at: Date.now(), value })
  return value
}

/** Exécute fn avec les droits de la société de cette base, sans effet sur les autres requêtes. */
export async function withRolePermissions<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  return scope.run(await overridesFor(db), fn)
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
  // La matrice décide de ce que chacun peut faire : elle ne se modifie que par un administrateur
  if (ctx.user?.role !== 'admin') fail('Seul un administrateur peut modifier les droits des rôles.')
  const all = PERMISSIONS.admin
  const out: Partial<Record<Role, Module[]>> = {}
  if (input?.current) {
    for (const [role, modules] of Object.entries(input.current) as [Role, Module[]][]) {
      if (!Object.hasOwn(PERMISSIONS, role)) fail(`Rôle inconnu : ${role}`)
      if (role === 'admin') continue
      if (!Array.isArray(modules)) fail('Matrice invalide.')
      const clean = [...new Set(modules.filter((m) => all.includes(m)))]
      if (clean.length === 0) fail(`Le rôle « ${ROLE_LABELS[role]} » doit avoir au moins un module.`)
      out[role] = clean
    }
  }
  await ctx.db.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [KEY, JSON.stringify(out)])
  cache.delete(ctx.db)
  await audit(ctx.db, ctx, 'modification', 'roles', null, input?.current ? 'matrice personnalisée' : 'droits par défaut')
  return getRoles(ctx)
}
