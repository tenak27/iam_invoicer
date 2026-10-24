// Version de démonstration d'IAM INVOICER : société fictive partagée, remise à neuf toutes les 3 heures,
// sans envoi réel ni certification fiscale réelle ; une vraie société n'est jamais touchée.
import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../src/main/db'
import { createHandler } from '../src/server/app'
import { createCloudHandler } from '../src/server/cloud'
import { DEMO_SLUG, InvoicerDemo } from '../src/server/demo'
import { TenantManager, type Provisioner } from '../src/server/tenants'

// PostgreSQL simulé : une base intégrée par client, mot de passe vérifié à l'ouverture.
// (Le vrai PostgreSQL est testé par tests/cloud-pg.test.ts sur GitHub.)
function fakeProvisioner() {
  const dbs = new Map<string, { password: string; db: Db | null }>()
  const prov: Provisioner = {
    endpoint: () => ({ host: 'db', port: 5432 }),
    protectDatabase: async () => {},
    async createDatabase(name, password) {
      if (dbs.has(name)) throw new Error('existe déjà')
      dbs.set(name, { password, db: null })
    },
    async setPassword(name, password) {
      dbs.get(name)!.password = password
    },
    async dropDatabase(name) {
      await dbs.get(name)?.db?.close()
      dbs.delete(name)
    },
    async databaseSize(name) {
      return dbs.has(name) ? 8_000_000 : null
    },
    async open(name, password) {
      const e = dbs.get(name)
      if (!e) throw new Error(`base ${name} absente`)
      if (e.password !== password) throw new Error('authentification refusée')
      e.db ??= await openDb({ mode: 'local' })
      // La base simulée survit aux fermetures, mais une connexion fermée ne répond plus (comme un vrai pool)
      const real = e.db
      let closed = false
      const guard = <F extends (...a: any[]) => any>(fn: F) => ((...a: any[]) => (closed ? Promise.reject(new Error('connexion fermée')) : fn(...a))) as F
      return { ...real, query: guard(real.query), one: guard(real.one), tx: guard(real.tx), close: async () => void (closed = true) }
    }
  }
  return { prov, dbs }
}

let control: Db
let manager: TenantManager
let server: Server
let base = ''
const fake = fakeProvisioner()

const http = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const r = await fetch(base + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, json: await r.json().catch(() => null) }
}
const call = (token: string, name: string, args?: unknown) => http('POST', `/t/${DEMO_SLUG}/api/call`, { name, args }, { Authorization: `Bearer ${token}` })

beforeAll(async () => {
  control = await openDb({ mode: 'local' })
  manager = new TenantManager(control, fake.prov)
  await manager.init()
  const root = createHandler({ db: control, version: 't' })
  server = createServer(createCloudHandler({ root, manager, rootDb: control, demo: true, shared: { version: 't' } }))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterAll(async () => {
  await new Promise((r) => server.close(r))
  await manager.closeAll()
  await control.close()
})

describe('IAM INVOICER : version de démonstration', () => {
  let token = ''

  it('le site ouvre une session dans la société fictive, remplie et sans quotas', async () => {
    const r = await http('POST', '/api/demo')
    expect(r.json.ok).toBe(true)
    expect(r.json.data.slug).toBe(DEMO_SLUG)
    token = r.json.data.token
    const st = await http('GET', `/t/${DEMO_SLUG}/api/status`, undefined, { Authorization: `Bearer ${token}` })
    expect(st.json.data.user).toMatchObject({ role: 'admin' })
    const docs = await call(token, 'documents.list', { types: ['FAC'] })
    expect(docs.json.ok).toBe(true)
    expect(JSON.stringify(docs.json.data)).toMatch(/FAC/)
    const lic = await call(token, 'licence.status')
    expect(lic.json.data).toMatchObject({ state: 'active', label: 'Démonstration', canWrite: true })
    // Création libre (pas de quota d'évaluation), envois refusés
    const client = await call(token, 'parties.save', { kind: 'client', name: 'Client du visiteur' })
    expect(client.json.ok).toBe(true)
    expect((await call(token, 'messages.sendEmail', { to: 'quelquun@exemple.bf', subject: 'Essai', body: 'Bonjour' })).json.error).toMatch(/démonstration/)
    expect((await call(token, 'messages.sendSms', { to: '70000000', body: 'Bonjour' })).json.error).toMatch(/démonstration/)
    // Deuxième visiteur : même société, sa propre session
    const r2 = await http('POST', '/api/demo')
    expect(r2.json.data.token).not.toBe(token)
  }, 120_000)

  it('remise à neuf : la société est recréée, une vraie société du même nom n’est jamais touchée', async () => {
    const demo = new InvoicerDemo(manager, () => {})
    await demo.refresh(true)
    const s = await demo.session('test')
    expect((await call(s.token, 'parties.list', { kind: 'client', search: 'Client du visiteur' })).json.data).toEqual([])
    // Une base qui n'est pas la démonstration (marque absente) n'est jamais effacée
    await manager.remove(DEMO_SLUG)
    await manager.create({ name: 'Vraie société', slug: DEMO_SLUG })
    await expect(demo.refresh(true)).rejects.toThrow(/pas la démonstration/)
    expect((await manager.get(DEMO_SLUG))!.name).toBe('Vraie société')
  }, 120_000)
})
