import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../src/main/db'
import { call } from '../src/main/router'
import { login } from '../src/main/services/auth'
import type { Ctx, SessionUser } from '../src/main/services/context'

let db: Db
let admin: Ctx
let commercial: Ctx
const ok = async <T = any>(ctx: Ctx, name: string, args?: unknown): Promise<T> => {
  const r = await call(ctx, name, args)
  if (!r.ok) throw new Error(r.error)
  return r.data as T
}

describe('Matrice des rôles et photo de profil', () => {
  beforeAll(async () => {
    db = await openDb({ mode: 'local' })
    const user = await ok<SessionUser>({ db, user: null }, 'auth.setup', { company: { name: 'Test' }, username: 'admin', full_name: 'Admin', password: 'secret123' })
    admin = { db, user }
    await ok(admin, 'users.save', { username: 'awa', full_name: 'Awa', role: 'commercial', password: 'secret123' })
    commercial = { db, user: await login(db, 'awa', 'secret123') }
  })
  afterAll(() => db?.close())

  it('droits par défaut, puis matrice personnalisée appliquée par le serveur', async () => {
    expect((await call(commercial, 'accounting.balance', {})).ok).toBe(false)
    const r = await ok(admin, 'roles.get')
    expect(r.customized).toBe(false)
    await ok(admin, 'roles.save', { current: { ...r.current, commercial: [...r.current.commercial, 'accounting'] } })
    expect((await call(commercial, 'accounting.balance', {})).ok).toBe(true)
    // Retrait d'un module
    await ok(admin, 'roles.save', { current: { commercial: ['dashboard', 'sales', 'clients', 'products'] } })
    expect((await call(commercial, 'payments.list', {})).ok).toBe(false)
    expect((await call(commercial, 'documents.list', { types: ['FAC'] })).ok).toBe(true)
  })

  it("l'administrateur garde tous les droits et seul lui modifie la matrice", async () => {
    await ok(admin, 'roles.save', { current: { admin: ['dashboard'] } })
    expect((await ok(admin, 'roles.get')).current.admin).toContain('users')
    expect((await call(admin, 'hr.employees', {})).ok).toBe(true)
    expect((await call(commercial, 'roles.save', { current: null })).ok).toBe(false)
    const empty = await call(admin, 'roles.save', { current: { caissier: [] } })
    expect(empty.ok).toBe(false)
    await ok(admin, 'roles.save', { current: null })
    expect((await ok(admin, 'roles.get')).customized).toBe(false)
  })

  it('chaque utilisateur choisit sa photo de profil', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
    await ok(commercial, 'auth.setAvatar', { avatar: png })
    expect((await ok(commercial, 'auth.profile')).avatar).toBe(png)
    expect((await ok<any[]>(admin, 'users.list')).find((u) => u.username === 'awa').avatar).toBe(png)
    expect((await call(commercial, 'auth.setAvatar', { avatar: 'javascript:alert(1)' })).ok).toBe(false)
    await ok(commercial, 'auth.setAvatar', { avatar: '' })
    expect((await ok(commercial, 'auth.profile')).avatar).toBe('')
  })
})
