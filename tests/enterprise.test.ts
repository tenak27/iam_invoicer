import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TIERS, type LicencePayload } from '../src/shared/licence'
import { openDb, type Db } from '../src/main/db'
import { Enterprise } from '../src/main/enterprise'
import { mirrorEndpoint, pushMirror } from '../src/main/mirror'
import { useTestLicenceKey } from '../src/main/services/licence'
import { createHandler } from '../src/server/app'
import { createCloudHandler } from '../src/server/cloud'
import { TenantManager, type Provisioner } from '../src/server/tenants'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
useTestLicenceKey(publicKey.export({ type: 'spki', format: 'pem' }) as string)
const licenceKey = (p: Partial<LicencePayload>) => {
  const payload: LicencePayload = { v: 1, id: 'LIC-T-9', company: 'Vista Énergie SARL', tier: 'pro', modules: TIERS.pro.modules, users: 0, issued: '2026-01-01', expires: null, whiteLabel: false, ...p }
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${data}.${sign(null, Buffer.from(data), privateKey).toString('base64url')}`
}

const servers: Server[] = []
const listen = async (handler: Parameters<typeof createServer>[1]) => {
  const s = createServer(handler)
  servers.push(s)
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
  return `http://127.0.0.1:${(s.address() as { port: number }).port}`
}
const http = async (base: string, method: string, path: string, body?: unknown, token = '') => {
  const r = await fetch(base + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, json: await r.json().catch(() => null) }
}

// ── Serveur de l'entreprise : une base locale partagée sur le réseau ──
let local: Db
let lan = ''
let adminToken = ''
const rpc = (token: string, name: string, args?: unknown) => http(lan, 'POST', '/api/call', { name, args }, token)

beforeAll(async () => {
  local = await openDb({ mode: 'local' })
  lan = await listen(createHandler({ db: local, version: 't' }))
  const s = await http(lan, 'POST', '/api/setup', { company: { name: 'Vista Énergie SARL' }, username: 'admin', full_name: 'Gérant', password: 'secret123', device: 'PC du gérant', device_id: 'poste-gerant-01' })
  adminToken = s.json.data.token
})
afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))))
  await local?.close()
})

describe('Licence au nombre de postes', () => {
  const login = (username: string, device: string, device_id?: string) => http(lan, 'POST', '/api/login', { username, password: 'secret123', device, device_id })

  it('sans limite de postes : tout appareil se connecte', async () => {
    await rpc(adminToken, 'licence.activate', { key: licenceKey({}) })
    await rpc(adminToken, 'users.save', { username: 'awa', full_name: 'Awa', role: 'commercial', password: 'secret123', active: true })
    await rpc(adminToken, 'users.save', { username: 'ali', full_name: 'Ali', role: 'caissier', password: 'secret123', active: true })
    expect((await login('awa', 'Tablette', 'tablette-0001')).json.ok).toBe(true)
    const st = (await rpc(adminToken, 'licence.status')).json.data
    expect(st).toMatchObject({ seats: 0 })
    expect(st.seatsUsed).toBeUndefined()
  })

  it('licence de 2 postes : le troisième appareil est refusé, un poste connu se reconnecte', async () => {
    await rpc(adminToken, 'licence.activate', { key: licenceKey({ id: 'LIC-T-10', seats: 2 }) })
    expect((await rpc(adminToken, 'licence.status')).json.data).toMatchObject({ seats: 2, seatsUsed: 2 })
    // Deux postes pris : PC du gérant et tablette
    const refused = await login('ali', 'Téléphone de la caisse', 'telephone-0001')
    expect(refused.json.ok).toBe(false)
    expect(refused.json.error).toMatch(/autorise 2 poste\(s\)/)
    // Même appareil, autre utilisateur : toujours un seul poste
    expect((await login('ali', 'Tablette', 'tablette-0001')).json.ok).toBe(true)
    expect((await rpc(adminToken, 'users.devices')).json.data).toHaveLength(2)
  })

  it('un administrateur entre toujours, déconnecte un poste et libère sa place', async () => {
    const admin2 = await login('admin', 'Portable du gérant', 'portable-0001')
    expect(admin2.json.ok).toBe(true)
    const devices = (await rpc(adminToken, 'users.devices')).json.data
    expect(devices.map((d: any) => d.label).sort()).toEqual(['PC du gérant', 'Portable du gérant', 'Tablette'])
    expect(devices.find((d: any) => d.label === 'Tablette')).toMatchObject({ sessions: 2 })
    // Un caissier ne gère pas les postes
    const ali = (await login('ali', 'Tablette', 'tablette-0001')).json.data.token
    expect((await rpc(ali, 'users.devices')).json.error).toMatch(/droits/)
    await rpc(adminToken, 'users.revokeDevice', { key: 'tablette-0001' })
    await rpc(adminToken, 'users.revokeDevice', { key: 'portable-0001' })
    expect((await rpc(ali, 'licence.status')).status).toBe(401) // session fermée
    expect((await login('ali', 'Téléphone de la caisse', 'telephone-0001')).json.ok).toBe(true)
  })
})

describe('Partage sur le réseau de l’entreprise', () => {
  it('démarre, annonce ses adresses, refuse un port pris et s’arrête', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'iam-ent-'))
    const ent = new Enterprise({ configPath: join(dir, 'serveur.json'), db: () => local, version: 't', webRoot: dir })
    expect(ent.state()).toMatchObject({ serve: false, listening: false, addresses: [] })
    await expect(ent.save({ port: 80 })).rejects.toThrow(/Port invalide/)
    const port = 20000 + Math.floor(Math.random() * 20000)
    const on = await ent.save({ serve: true, port })
    expect(on).toMatchObject({ serve: true, listening: true, port, error: null })
    // Les autres postes y trouvent bien IAM INVOICER
    expect((await http(`http://127.0.0.1:${port}`, 'GET', '/api/status')).json.data).toMatchObject({ app: 'IAM INVOICER', needsSetup: false })
    // Réglages relus au redémarrage ; port déjà pris : message clair, pas de plantage
    const other = new Enterprise({ configPath: join(dir, 'serveur.json'), db: () => local, version: 't', webRoot: dir })
    await other.start()
    expect(other.state()).toMatchObject({ serve: true, listening: false })
    expect(other.state().error).toMatch(/déjà utilisé/)
    await other.stop()
    expect(await ent.save({ serve: false })).toMatchObject({ listening: false, addresses: [] })
    await ent.stop()
  })
})

describe('Copie en ligne du serveur de l’entreprise', () => {
  let cloud = ''
  let manager: TenantManager
  let control: Db
  let syncKey = ''
  const ADMIN = 'a'.repeat(40)
  const dbs = new Map<string, Db>()

  beforeAll(async () => {
    const prov: Provisioner = {
      endpoint: () => ({ host: 'db', port: 5432 }),
      protectDatabase: async () => {},
      createDatabase: async () => {},
      setPassword: async () => {},
      dropDatabase: async () => {},
      databaseSize: async () => 1,
      async open(name) {
        if (!dbs.has(name)) dbs.set(name, await openDb({ mode: 'local' }))
        return { ...dbs.get(name)!, close: async () => {} }
      }
    }
    control = await openDb({ mode: 'local' })
    manager = new TenantManager(control, prov)
    await manager.init()
    cloud = await listen(createCloudHandler({ root: createHandler({ db: control, version: 't' }), manager, adminToken: ADMIN, rootDb: control, shared: { version: 't' } }))
  })
  afterAll(async () => {
    await manager.closeAll()
    await control.close()
    await Promise.all([...dbs.values()].map((d) => d.close()))
  })

  it('adresse de la base en ligne contrôlée', () => {
    expect(mirrorEndpoint('invoice.exemple.bf/t/vista_energie/')).toBe('https://invoice.exemple.bf/t/vista_energie/api/mirror')
    expect(() => mirrorEndpoint('https://invoice.exemple.bf')).toThrow(/se terminer par \/t\//)
    expect(() => mirrorEndpoint('')).toThrow(/Saisissez/)
  })

  it('clé de synchronisation créée par l’éditeur, jamais relue', async () => {
    const created = await http(cloud, 'POST', '/api/admin/tenants', { name: 'Vista Énergie SARL' }, ADMIN)
    expect(created.json.data.slug).toBe('vista_energie')
    // Sans clé : aucune copie acceptée
    await expect(pushMirror(local, `${cloud}/t/vista_energie`, 'x'.repeat(43))).rejects.toThrow(/refusée/)
    const k = await http(cloud, 'POST', '/api/admin/tenants/vista_energie/sync-key', {}, ADMIN)
    syncKey = k.json.data.sync_key
    expect(syncKey.length).toBeGreaterThan(40)
    const info = (await http(cloud, 'GET', '/api/admin/tenants/vista_energie', undefined, ADMIN)).json.data
    expect(info).toMatchObject({ has_sync_key: true, mirrored_at: null })
    expect(JSON.stringify(info)).not.toContain('sync_key_hash')
    expect(JSON.stringify((await http(cloud, 'GET', '/api/admin/tenants', undefined, ADMIN)).json.data)).not.toMatch(/sync_key_hash":"/)
  })

  it('la base du serveur est recopiée en ligne ; rien n’est renvoyé si rien n’a changé', async () => {
    const client = (await rpc(adminToken, 'parties.save', { kind: 'client', name: 'Davycas International' })).json.data
    await rpc(adminToken, 'documents.save', { type: 'FAC', party_id: client.id, validate: true, taxes: [], lines: [{ description: 'Abonnement', quantity: 1, unit_price: 75000, tva_rate: 18 }] })
    const first = await pushMirror(local, `${cloud}/t/vista_energie`, syncKey)
    expect(first).toMatchObject({ sent: true })
    expect(first.rows).toBeGreaterThan(40)
    expect(await pushMirror(local, `${cloud}/t/vista_energie`, syncKey, first.hash)).toMatchObject({ sent: false })
    expect((await http(cloud, 'GET', '/api/admin/tenants/vista_energie', undefined, ADMIN)).json.data).toMatchObject({ configured: true, company: 'Vista Énergie SARL', documents: 1, licence: { state: 'active' } })
  })

  it('la copie en ligne se consulte avec les mêmes comptes, sans pouvoir y saisir', async () => {
    const t = `${cloud}/t/vista_energie`
    const s = await http(t, 'POST', '/api/login', { username: 'admin', password: 'secret123', device: 'Téléphone', device_id: 'telephone-gerant' })
    expect(s.json.ok).toBe(true)
    const token = s.json.data.token
    const call = (name: string, args?: unknown) => http(t, 'POST', '/api/call', { name, args }, token)
    expect((await call('documents.list', { types: ['FAC'] })).json.data).toHaveLength(1)
    expect((await call('licence.status')).json.data.mirror).toMatch(/^\d{4}-/)
    expect((await call('parties.save', { kind: 'client', name: 'Saisie en ligne' })).json.error).toMatch(/copie en ligne du serveur de votre entreprise/)
    expect((await call('settings.save', { name: 'Autre' })).json.error).toMatch(/copie en ligne/)

    // Nouvelle saisie sur le serveur, nouvel envoi : la copie suit, la session du téléphone reste ouverte
    const p = (await rpc(adminToken, 'parties.save', { kind: 'client', name: 'Eco Food' })).json.data
    expect(p.id).toBeGreaterThan(0)
    await pushMirror(local, t, syncKey)
    expect((await call('parties.list', { kind: 'client' })).json.data.map((c: any) => c.name)).toEqual(['Davycas International', 'Eco Food'])
  })

  it('mauvaise clé refusée, puis bloquée après trop d’essais', async () => {
    const bad = () => fetch(`${cloud}/t/vista_energie/api/mirror`, { method: 'POST', headers: { Authorization: 'Bearer ' + 'z'.repeat(43), 'Content-Type': 'application/json' }, body: '{}' })
    expect((await bad()).status).toBe(401)
    for (let i = 0; i < 10; i++) await bad()
    expect((await bad()).status).toBe(429)
  })
})
