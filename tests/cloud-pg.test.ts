// Hébergement multi-clients sur un vrai PostgreSQL (lancé sur GitHub avec un service postgres).
// Localement : PG_ADMIN_URL=postgres://postgres:motdepasse@localhost:5432/postgres npx vitest run tests/cloud-pg.test.ts
import pg from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../src/main/db'
import { pgProvisioner, TenantManager, type CreatedTenant } from '../src/server/tenants'

const ADMIN = process.env.PG_ADMIN_URL
const tryConnect = async (database: string, user: string, password: string) => {
  const u = new URL(ADMIN!)
  const c = new pg.Client({ host: u.hostname, port: Number(u.port || 5432), database, user, password })
  try {
    await c.connect()
    await c.query('SELECT 1')
    return 'ok'
  } catch (e: any) {
    return String(e?.message ?? e)
  } finally {
    await c.end().catch(() => {})
  }
}

describe.skipIf(!ADMIN)('PostgreSQL réel : une base par client', () => {
  let control: Db
  let manager: TenantManager
  const made: CreatedTenant[] = []

  afterAll(async () => {
    for (const t of made) await manager.remove(t.slug).catch(() => {})
    await manager?.closeAll()
    await control?.close()
  })

  it('création de deux clients, chacun isolé', async () => {
    const u = new URL(ADMIN!)
    control = await openDb({ mode: 'server', host: u.hostname, port: Number(u.port || 5432), database: u.pathname.slice(1) || 'postgres', user: decodeURIComponent(u.username), password: decodeURIComponent(u.password) })
    const prov = pgProvisioner(ADMIN!)
    manager = new TenantManager(control, prov)
    await manager.init()
    const suffix = Date.now().toString(36)
    const a = await manager.create({ name: 'Client A', slug: `a_${suffix}`, licence_key: 'x.y' })
    const b = await manager.create({ name: 'Client B', slug: `b_${suffix}` })
    made.push(a, b)

    // Chaque client se connecte à sa base avec son utilisateur et son mot de passe…
    expect(await tryConnect(a.db_name, a.db_user, a.db_password)).toBe('ok')
    // … mais ni à la base d'un autre client, ni avec un mauvais mot de passe
    expect(await tryConnect(b.db_name, a.db_user, a.db_password)).toMatch(/permission denied|not permitted|privilege/i)
    expect(await tryConnect(a.db_name, a.db_user, 'mauvais')).toMatch(/password authentication failed/i)

    // Les tables de l'application existent et appartiennent au client
    const t = (await manager.get(a.slug))!
    const db = await manager.db(t)
    expect((await db.one<{ v: number }>('SELECT MAX(version)::int AS v FROM schema_version'))!.v).toBeGreaterThan(5)
    expect((await db.one("SELECT value FROM settings WHERE key = 'licence_key'"))?.value).toBe('"x.y"')
    expect((await manager.list()).find((x) => x.slug === a.slug)!.size).toBeGreaterThan(1_000_000)
  })

  it('nouveau mot de passe : l’ancien ne fonctionne plus', async () => {
    const [a] = made
    const { db_password } = await manager.resetPassword(a.slug)
    expect(await tryConnect(a.db_name, a.db_user, a.db_password)).toMatch(/password authentication failed/i)
    expect(await tryConnect(a.db_name, a.db_user, db_password)).toBe('ok')
    const db = await manager.db((await manager.get(a.slug))!)
    expect((await db.one<{ n: number }>('SELECT COUNT(*)::int AS n FROM users'))!.n).toBe(0)
  })

  it('suppression : base et utilisateur effacés', async () => {
    const b = made.pop()!
    await manager.remove(b.slug)
    expect(await tryConnect(b.db_name, b.db_user, b.db_password)).toMatch(/does not exist|authentication failed/i)
    expect(await manager.get(b.slug)).toBeNull()
  })
})
