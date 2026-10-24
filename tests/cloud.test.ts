import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../src/main/db'
import { useTestLicenceKey } from '../src/main/services/licence'
import { configureVendorKey, useTestVendorPublicKey } from '../src/main/services/licensing'
import { createHandler } from '../src/server/app'
import { createCloudHandler } from '../src/server/cloud'
import { slugify, TenantManager, type Provisioner } from '../src/server/tenants'

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

const TOKEN = 'a'.repeat(40)
let control: Db
let mainDb: Db
let manager: TenantManager
let server: Server
let base = ''
const fake = fakeProvisioner()

const http = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const r = await fetch(base + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' })
  const text = await r.text()
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {
    /* page */
  }
  return { status: r.status, json, text, location: r.headers.get('location') }
}
const adminH = { Authorization: `Bearer ${TOKEN}` }
const call = (slug: string, token: string, name: string, args?: unknown) =>
  http('POST', `/t/${slug}/api/call`, { name, args }, { Authorization: `Bearer ${token}` })

beforeAll(async () => {
  control = await openDb({ mode: 'local' })
  mainDb = control
  manager = new TenantManager(control, fake.prov)
  await manager.init()
  const root = createHandler({ db: mainDb, version: 't' })
  server = createServer(createCloudHandler({ root, manager, adminToken: TOKEN, rootDb: mainDb, selfSignup: true, shared: { version: 't' } }))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterAll(async () => {
  await new Promise((r) => server.close(r))
  await manager.closeAll()
  await control.close()
})

describe('Hébergement de plusieurs clients (une base chacun)', () => {
  let pharma: any
  let garage: any
  let pharmaToken = ''

  it('identifiant d’adresse déduit de la raison sociale', () => {
    expect(slugify('Pharmacie du Progrès SARL')).toBe('pharmacie_du_progres')
    expect(slugify('ETS Kaboré & Fils')).toBe('kabore_fils')
    expect(slugify('2iE Formation')).toBe('c_2ie_formation')
  })

  it('administration : jeton obligatoire', async () => {
    expect((await http('GET', '/api/admin/tenants')).status).toBe(401)
    expect((await http('GET', '/api/admin/tenants', undefined, { Authorization: 'Bearer ' + 'b'.repeat(40) })).status).toBe(401)
    expect((await http('GET', '/api/admin/tenants', undefined, adminH)).json).toEqual({ ok: true, data: [] })
  })

  it('création : base, utilisateur et mot de passe propres au client, code d’activation', async () => {
    const r = await http('POST', '/api/admin/tenants', { name: 'Pharmacie du Progrès SARL', contact: '70 00 00 00', licence_key: 'abc.def' }, adminH)
    expect(r.status).toBe(200)
    pharma = r.json.data
    expect(pharma).toMatchObject({ slug: 'pharmacie_du_progres', path: '/t/pharmacie_du_progres', db_name: 'iam_pharmacie_du_progres', db_user: 'iam_pharmacie_du_progres', db_host: 'db', db_port: 5432 })
    expect(pharma.db_password).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(pharma.setup_code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
    // Même nom : identifiant suffixé ; identifiant imposé déjà pris : refus
    garage = (await http('POST', '/api/admin/tenants', { name: 'Pharmacie du Progrès', slug: 'garage_bon' }, adminH)).json.data
    expect(garage.slug).toBe('garage_bon')
    expect((await http('POST', '/api/admin/tenants', { name: 'XYZ', slug: 'garage_bon' }, adminH)).json.error).toMatch(/déjà utilisé/)
    const homonyme = (await http('POST', '/api/admin/tenants', { name: 'Pharmacie du Progrès' }, adminH)).json.data
    expect(homonyme.slug).toBe('pharmacie_du_progres_2')
    // La liste ne montre jamais les mots de passe des bases
    const list = (await http('GET', '/api/admin/tenants', undefined, adminH)).json.data
    expect(list).toHaveLength(3)
    expect(JSON.stringify(list)).not.toContain(pharma.db_password)
    expect(list[0].size).toBe(8_000_000)
    // Clé de licence préinstallée dans la base du client
    const db = await fake.prov.open(pharma.db_name, pharma.db_password)
    expect((await db.one("SELECT value FROM settings WHERE key = 'licence_key'"))?.value).toBe('"abc.def"')
  })

  it('première configuration protégée par le code d’activation', async () => {
    const st = await http('GET', `/t/${pharma.slug}/api/status`)
    expect(st.json.data).toMatchObject({ app: 'IAM INVOICER', needsSetup: true, setupCode: true })
    const input = { company: { name: 'Pharmacie du Progrès SARL' }, username: 'admin', full_name: 'Dr Ouédraogo', password: 'secret123' }
    expect((await http('POST', `/t/${pharma.slug}/api/setup`, input)).status).toBe(403)
    expect((await http('POST', `/t/${pharma.slug}/api/setup`, { ...input, setup_code: 'AAAA-BBBB-CCCC' })).json.error).toMatch(/incorrect/)
    // Saisie tolérante : minuscules et espaces acceptés
    const ok = await http('POST', `/t/${pharma.slug}/api/setup`, { ...input, setup_code: ' ' + pharma.setup_code.toLowerCase().replace(/-/g, ' ') })
    expect(ok.status).toBe(200)
    pharmaToken = ok.json.data.token
    expect((await http('GET', `/t/${pharma.slug}/api/status`)).json.data).toMatchObject({ needsSetup: false, setupCode: false })
  })

  it('chaque client ne voit que sa base', async () => {
    expect((await call(pharma.slug, pharmaToken, 'parties.save', { kind: 'client', name: 'Clinique Yalgado' })).json.ok).toBe(true)
    const gSetup = await http('POST', `/t/${garage.slug}/api/setup`, { company: { name: 'Garage Bon' }, username: 'admin', full_name: 'Garage', password: 'secret123', setup_code: garage.setup_code })
    const garageToken = gSetup.json.data.token
    const gList = await call(garage.slug, garageToken, 'parties.list', { kind: 'client' })
    expect(gList.json.data).toEqual([])
    // Le jeton d'un client n'ouvre pas la base d'un autre
    expect((await call(garage.slug, pharmaToken, 'parties.list', { kind: 'client' })).status).toBe(401)
    const pList = await call(pharma.slug, pharmaToken, 'parties.list', { kind: 'client' })
    expect(pList.json.data.map((p: any) => p.name)).toEqual(['Clinique Yalgado'])
  })

  it('adresses : inconnue, suspendue, redirection, base principale intacte', async () => {
    expect((await http('GET', '/t/inconnu/api/status')).status).toBe(404)
    expect((await http('GET', '/t/AB/api/status')).status).toBe(404)
    const redirect = await http('GET', `/t/${pharma.slug}`)
    expect(redirect.status).toBe(301)
    expect(redirect.location).toBe(`/t/${pharma.slug}/`)
    expect((await http('POST', `/api/admin/tenants/${pharma.slug}/suspend`, {}, adminH)).status).toBe(200)
    const suspended = await call(pharma.slug, pharmaToken, 'parties.list', { kind: 'client' })
    expect(suspended.status).toBe(403)
    expect(suspended.json.error).toMatch(/suspendu/)
    await http('POST', `/api/admin/tenants/${pharma.slug}/resume`, {}, adminH)
    expect((await call(pharma.slug, pharmaToken, 'parties.list', { kind: 'client' })).json.ok).toBe(true)
    // La racine reste le serveur principal
    expect((await http('GET', '/api/status')).json.data).toMatchObject({ app: 'IAM INVOICER', needsSetup: true })
  })

  it('nouveau mot de passe de base : les applications continuent de fonctionner', async () => {
    const r = await http('POST', `/api/admin/tenants/${pharma.slug}/password`, {}, adminH)
    expect(r.json.data.db_password).not.toBe(pharma.db_password)
    expect(fake.dbs.get(pharma.db_name)!.password).toBe(r.json.data.db_password)
    expect((await call(pharma.slug, pharmaToken, 'parties.list', { kind: 'client' })).json.data).toHaveLength(1)
  })

  it('fiche du client : activité de la base', async () => {
    const r = await http('GET', `/api/admin/tenants/${pharma.slug}`, undefined, adminH)
    expect(r.json.data).toMatchObject({ slug: pharma.slug, users: 1, configured: true, company: 'Pharmacie du Progrès SARL' })
    expect(r.json.data.db_password).toBeUndefined()
  })

  it('suppression : confirmation obligatoire', async () => {
    expect((await http('DELETE', `/api/admin/tenants/${garage.slug}`, undefined, adminH)).status).toBe(400)
    expect((await http('DELETE', `/api/admin/tenants/${garage.slug}?confirm=${garage.slug}`, undefined, adminH)).status).toBe(200)
    expect(fake.dbs.has(garage.db_name)).toBe(false)
    expect((await http('GET', `/t/${garage.slug}/api/status`)).status).toBe(404)
  })

  it('base fermée pour inactivité : rouverte à la requête suivante', async () => {
    expect((await call(pharma.slug, pharmaToken, 'parties.list', { kind: 'client' })).json.ok).toBe(true)
    ;(manager as any).idleMs = -1
    await (manager as any).sweep()
    ;(manager as any).idleMs = 30 * 60_000
    const r = await call(pharma.slug, pharmaToken, 'parties.list', { kind: 'client' })
    expect(r.status).toBe(200)
    expect(r.json.data).toHaveLength(1)
  })
})

describe('Console de l’éditeur', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' }) as string
  let vendor: Record<string, string>
  let slug = ''

  beforeAll(async () => {
    useTestLicenceKey(pubPem)
    useTestVendorPublicKey(pubPem)
    const dir = mkdtempSync(join(tmpdir(), 'iam-console-'))
    writeFileSync(join(dir, 'licence-private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }) as string)
    configureVendorKey(join(dir, 'licence-private.pem'))
    // Base principale : le compte de l'éditeur et un autre administrateur
    const setup = await http('POST', '/api/setup', { company: { name: 'IAM Technology' }, username: 'tenak27', full_name: 'Éditeur', password: 'secret123' })
    vendor = { Authorization: `Bearer ${setup.json.data.token}` }
    await http('POST', '/api/call', { name: 'users.save', args: { username: 'autre', full_name: 'Autre Admin', role: 'admin', password: 'secret123', active: true } }, vendor)
  })
  afterAll(() => configureVendorKey(null))

  it('page servie, verrouillée, sans donnée', async () => {
    expect((await http('GET', '/admin')).location).toBe('/admin/')
    const page = await http('GET', '/admin/')
    expect(page.status).toBe(200)
    expect(page.text).toContain('Console éditeur')
    expect(page.text).not.toContain(TOKEN)
  })

  it('connexion par le compte de l’éditeur uniquement', async () => {
    const me = await http('GET', '/api/admin/me', undefined, vendor)
    expect(me.json.data).toMatchObject({ by: 'compte', name: 'Éditeur', canIssue: true })
    expect((await http('GET', '/api/admin/me', undefined, adminH)).json.data.by).toBe('jeton')
    const other = (await http('POST', '/api/login', { username: 'autre', password: 'secret123' })).json.data.token
    expect((await http('GET', '/api/admin/tenants', undefined, { Authorization: `Bearer ${other}` })).status).toBe(401)
    // Le jeton d'un utilisateur d'une société hébergée n'ouvre pas la console
    expect((await http('GET', '/api/admin/me')).status).toBe(401)
  })

  it('société créée, licence émise puis attribuée', async () => {
    const created = await http('POST', '/api/admin/tenants', { name: 'Vista Énergie SARL', contact: '70 11 22 33' }, vendor)
    slug = created.json.data.slug
    expect(slug).toBe('vista_energie')
    const lic = await http('POST', '/api/admin/licences', { company: 'Vista Énergie SARL', tier: 'pro', expires: '2099-01-31' }, vendor)
    expect(lic.json.data.number).toMatch(/^LIC-\d{4}-\d{4}$/)
    expect((await http('GET', '/api/admin/licences', undefined, vendor)).json.data[0]).toMatchObject({ company: 'Vista Énergie SARL', issued_by_name: 'Éditeur' })
    // Clé refusée si elle n'est pas signée par l'éditeur
    expect((await http('POST', `/api/admin/tenants/${slug}/licence`, { licence_key: 'abc.def' }, vendor)).json.error).toMatch(/invalide/)
    const set = await http('POST', `/api/admin/tenants/${slug}/licence`, { licence_id: lic.json.data.id }, vendor)
    expect(set.json.data).toMatchObject({ number: lic.json.data.number, tier: 'pro', expires: '2099-01-31' })
    // La société se configure : sa licence est active d'emblée
    const s = await http('POST', `/t/${slug}/api/setup`, { company: { name: 'Vista Énergie SARL' }, username: 'admin', full_name: 'Vista', password: 'secret123', setup_code: created.json.data.setup_code })
    expect(s.status).toBe(200)
    const info = (await http('GET', `/api/admin/tenants/${slug}`, undefined, vendor)).json.data
    expect(info).toMatchObject({ licence_number: lic.json.data.number, configured: true, licence: { state: 'active', label: 'Pro', number: lic.json.data.number } })
  })

  it('licence du registre préinstallée à la création', async () => {
    const lic = await http('POST', '/api/admin/licences', { company: 'Eco Food', tier: 'essentiel' }, vendor)
    const created = await http('POST', '/api/admin/tenants', { name: 'Eco Food', licence_id: lic.json.data.id }, vendor)
    const list = (await http('GET', '/api/admin/tenants', undefined, vendor)).json.data
    expect(list.find((t: any) => t.slug === created.json.data.slug).licence_number).toBe(lic.json.data.number)
    expect((await http('POST', '/api/admin/tenants', { name: 'Sans Licence', licence_id: 9999 }, vendor)).json.error).toMatch(/introuvable/)
  })
})

describe('Inscription libre depuis le site', () => {
  const form = { company: 'Boutique Wend-Kuni', full_name: 'Awa Ouédraogo', email: 'Awa.Ouedraogo@exemple.bf', phone: '+226 70 11 22 33', password: 'Ouaga-2026-Faso!' }

  it('crée la société, son administrateur, et ouvre une session', async () => {
    const r = await http('POST', '/api/inscription', form)
    expect(r.status).toBe(200)
    const d = r.json.data
    expect(d).toMatchObject({ slug: 'boutique_wend_kuni', path: '/t/boutique_wend_kuni', name: 'Boutique Wend-Kuni', user: { username: 'awa.ouedraogo@exemple.bf', role: 'admin' } })
    // La session ouvre directement la société, déjà configurée (plus de code d'activation)
    const st = await http('GET', '/t/boutique_wend_kuni/api/status', undefined, { Authorization: `Bearer ${d.token}` })
    expect(st.json.data).toMatchObject({ needsSetup: false, user: { username: 'awa.ouedraogo@exemple.bf' } })
    const t = await manager.get('boutique_wend_kuni')
    expect(t?.setup_code).toBeNull()
    expect(t?.contact).toContain('awa.ouedraogo@exemple.bf')
    // Raison sociale reprise sur les documents ; connexion avec l'adresse e-mail
    expect((await call('boutique_wend_kuni', d.token, 'settings.get')).json.data.name).toBe('Boutique Wend-Kuni')
    const login = await http('POST', '/t/boutique_wend_kuni/api/login', { username: 'awa.ouedraogo@exemple.bf', password: form.password })
    expect(login.json.data.user.role).toBe('admin')
  })

  it('même nom : une autre adresse ; champs invalides refusés sans créer de base', async () => {
    const again = await http('POST', '/api/inscription', { ...form, email: 'awa2@exemple.bf' })
    expect(again.json.data.slug).toBe('boutique_wend_kuni_2')
    const before = (await manager.list()).length
    expect((await http('POST', '/api/inscription', { ...form, email: 'pas-une-adresse' })).json.error).toMatch(/e-mail/)
    expect((await http('POST', '/api/inscription', { ...form, password: 'court' })).json.error).toMatch(/10 caractères/)
    expect((await http('POST', '/api/inscription', { ...form, company: 'x' })).json.error).toMatch(/société/)
    expect((await manager.list()).length).toBe(before)
  })

  it('trois inscriptions par heure et par adresse au plus', async () => {
    const r = await http('POST', '/api/inscription', { ...form, company: 'Quatrième Société', email: 'q@exemple.bf' })
    expect(r.status).toBe(200)
    const blocked = await http('POST', '/api/inscription', { ...form, company: 'Cinquième Société', email: 'c@exemple.bf' })
    expect(blocked.status).toBe(429)
  })
})
