// Tests d'intrusion rejoués à chaque version : le serveur multi-sociétés est démarré en local
// (deux sociétés hébergées + la base principale) puis attaqué par HTTP comme le ferait un tiers.

import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PERMISSIONS, type Module } from '../src/shared/domain'
import { TIERS } from '../src/shared/licence'
import { useTestLicenceKey } from '../src/main/services/licence'
import { openDb, type Db } from '../src/main/db'
import { routes } from '../src/main/router'
import { configureSecretKey, isSealed } from '../src/main/secretbox'
import { assertPublicHost, isInternalAddress, restrictOutbound } from '../src/main/outbound'
import { exportSnapshot } from '../src/main/snapshot'
import { createHandler } from '../src/server/app'
import { createCloudHandler } from '../src/server/cloud'
import { clientIp, contentSecurityPolicy, Limiter } from '../src/server/security'
import { TenantManager, type Provisioner } from '../src/server/tenants'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
useTestLicenceKey(publicKey.export({ type: 'spki', format: 'pem' }) as string)
const licenceKey = (company: string) => {
  const data = Buffer.from(JSON.stringify({ v: 1, id: 'LIC-SEC', company, tier: 'entreprise', modules: TIERS.entreprise.modules, users: 0, issued: '2026-01-01', expires: null, whiteLabel: false })).toString('base64url')
  return `${data}.${sign(null, Buffer.from(data), privateKey).toString('base64url')}`
}

const ADMIN = 'k'.repeat(48)
const PASS = 'Tr3s-solide!'
const servers: Server[] = []
const dbs = new Map<string, Db>()
let control: Db
let manager: TenantManager
let cloud = ''
const webRoot = join(tmpdir(), `iam-sec-web-${process.pid}`)

const listen = async (handler: Parameters<typeof createServer>[1]) => {
  const s = createServer(handler)
  servers.push(s)
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
  return `http://127.0.0.1:${(s.address() as { port: number }).port}`
}
const http = async (url: string, init: { method?: string; body?: unknown; token?: string; headers?: Record<string, string>; raw?: string } = {}) => {
  const r = await fetch(url, {
    method: init.method ?? (init.body !== undefined || init.raw !== undefined ? 'POST' : 'GET'),
    headers: { ...(init.body !== undefined || init.raw !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), ...init.headers },
    body: init.raw ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
    redirect: 'manual'
  })
  const text = await r.text()
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {}
  return { status: r.status, text, json, headers: r.headers }
}

interface Site { base: string; admin: string; tokens: Record<string, string> }
const sites: Record<'a' | 'b', Site> = { a: { base: '', admin: '', tokens: {} }, b: { base: '', admin: '', tokens: {} } }
const call = (s: Site, token: string, name: string, args?: unknown) => http(`${s.base}/api/call`, { body: { name, args }, token })
const must = async (s: Site, token: string, name: string, args?: unknown) => {
  const r = await call(s, token, name, args)
  if (!r.json?.ok) throw new Error(`${name} : ${r.json?.error ?? r.status}`)
  return r.json.data
}

beforeAll(async () => {
  configureSecretKey('a'.repeat(64))
  mkdirSync(join(webRoot, 'assets'), { recursive: true })
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>IAM INVOICER</title><script>window.x=1</script><script type="module" src="./assets/app.js"></script>')
  writeFileSync(join(webRoot, 'assets', 'app.js'), 'console.log(1)')
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
  cloud = await listen(createCloudHandler({ root: createHandler({ db: control, version: 't', webRoot, ratePerMinute: 1_000_000 }), manager, adminToken: ADMIN, rootDb: control, shared: { version: 't', webRoot, trustProxy: true, ratePerMinute: 1_000_000 } }))

  // Base principale : un administrateur ordinaire (pas le compte de l'éditeur)
  await http(`${cloud}/api/setup`, { body: { company: { name: 'Éditeur' }, username: 'gerant', full_name: 'Gérant', password: PASS } })

  for (const [k, name] of [['a', 'Alpha Négoce'], ['b', 'Bravo Services']] as const) {
    const created = await http(`${cloud}/api/admin/tenants`, { body: { name }, token: ADMIN })
    const s = sites[k]
    s.base = `${cloud}/t/${created.json.data.slug}`
    const setup = await http(`${s.base}/api/setup`, { body: { company: { name }, username: 'admin', full_name: 'Admin', password: PASS, setup_code: created.json.data.setup_code } })
    s.admin = setup.json.data.token
    await must(s, s.admin, 'licence.activate', { key: licenceKey(name) })
    for (const role of ['commercial', 'caissier', 'magasinier', 'comptable', 'rh']) {
      await must(s, s.admin, 'users.save', { username: role, full_name: role, role, password: PASS, active: true })
      s.tokens[role] = (await http(`${s.base}/api/login`, { body: { username: role, password: PASS, device: role, device_id: `poste-${role}-${k}1` } })).json.data.token
    }
  }
}, 120_000)

afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))))
  await manager.closeAll()
  await control.close()
  await Promise.all([...dbs.values()].map((d) => d.close()))
  configureSecretKey(null)
  restrictOutbound(false)
})

describe('Authentification', () => {
  it('aucune action métier sans session, ni avec un jeton inventé ou altéré', async () => {
    const s = sites.a
    for (const name of Object.keys(routes).filter((n) => n !== 'auth.needsSetup')) {
      for (const token of ['', 'x'.repeat(43), s.admin.slice(0, -2) + 'zz']) {
        const r = await call(s, token, name, {})
        expect(r.status, `${name} avec jeton « ${token.slice(0, 6)} »`).toBe(401)
      }
    }
    for (const path of ['/api/document/1', '/api/print']) expect((await http(s.base + path, path === '/api/print' ? { body: { id: 1 } } : {})).status).toBe(401)
  }, 120_000)

  it("le jeton d'une société ne vaut rien chez une autre, ni sur la base principale", async () => {
    expect((await call(sites.b, sites.a.admin, 'users.list')).status).toBe(401)
    expect((await http(`${cloud}/api/call`, { body: { name: 'users.list' }, token: sites.a.admin })).status).toBe(401)
    expect((await http(`${cloud}/api/admin/tenants`, { token: sites.a.admin })).status).toBe(401)
  })

  it('configuration initiale impossible une seconde fois, ou sans le code d’activation', async () => {
    const again = await http(`${sites.a.base}/api/setup`, { body: { company: { name: 'Pirate' }, username: 'pirate', full_name: 'P', password: PASS } })
    expect(again.json.ok).toBe(false)
    expect((await call(sites.a, '', 'auth.setup', { company: { name: 'P' }, username: 'pirate', password: PASS })).status).toBe(401)
    const fresh = await http(`${cloud}/api/admin/tenants`, { body: { name: 'Charlie Transit' }, token: ADMIN })
    const t = `${cloud}/t/${fresh.json.data.slug}`
    expect((await http(`${t}/api/setup`, { body: { company: { name: 'P' }, username: 'pirate', full_name: 'P', password: PASS } })).status).toBe(403)
    expect((await http(`${t}/api/setup`, { body: { company: { name: 'P' }, username: 'pirate', full_name: 'P', password: PASS, setup_code: 'AAAA-BBBB-CCCC' } })).status).toBe(403)
    expect((await http(`${t}/api/status`)).json.data.needsSetup).toBe(true)
  })

  it('déconnexion, mot de passe changé, compte désactivé : les sessions tombent', async () => {
    const s = sites.a
    await must(s, s.admin, 'users.save', { username: 'temp', full_name: 'Temp', role: 'commercial', password: PASS, active: true })
    const login = async (password = PASS) => (await http(`${s.base}/api/login`, { body: { username: 'temp', password, device: 'x', device_id: 'poste-temp-0001' } })).json
    const t1 = (await login()).data.token
    const t2 = (await login()).data.token
    // Changement de mot de passe depuis t1 : t2 (autre appareil) est fermé, t1 reste
    await must(s, t1, 'auth.changePassword', { current: PASS, next: 'Nouveau-secret-42' })
    expect((await call(s, t2, 'licence.status')).status).toBe(401)
    expect((await call(s, t1, 'licence.status')).status).toBe(200)
    expect((await login()).ok).toBe(false)
    await http(`${s.base}/api/logout`, { body: {}, token: t1 })
    expect((await call(s, t1, 'licence.status')).status).toBe(401)
    const t3 = (await login('Nouveau-secret-42')).data.token
    const id = (await must(s, s.admin, 'users.list')).find((u: any) => u.username === 'temp').id
    await must(s, s.admin, 'users.save', { id, username: 'temp', full_name: 'Temp', role: 'commercial', active: false })
    expect((await call(s, t3, 'licence.status')).status).toBe(401)
  })

  it('mots de passe faibles refusés', async () => {
    for (const password of ['court', '1234567', 'motdepasse', 'Password']) {
      const r = await call(sites.a, sites.a.admin, 'users.save', { username: 'faible', full_name: 'F', role: 'caissier', password, active: true })
      expect(r.json.ok, password).toBe(false)
    }
  })
})

describe('Force brute', () => {
  it('une adresse est bloquée après 10 échecs, même en falsifiant X-Forwarded-For', async () => {
    const db = await openDb({ mode: 'local' })
    for (const trustProxy of [false, true]) {
      const base = await listen(createHandler({ db, version: 't', trustProxy }))
      if (!trustProxy) await http(`${base}/api/setup`, { body: { company: { name: 'X' }, username: 'admin', full_name: 'A', password: PASS } })
      let last = 0
      for (let i = 0; i < 12; i++) {
        // L'attaquant change d'adresse déclarée à chaque essai ; derrière un proxy, celui-ci ajoute la vraie adresse à la fin
        const xff = trustProxy ? `10.9.${i}.1, 203.0.113.7` : `10.9.${i}.1`
        last = (await http(`${base}/api/login`, { body: { username: 'admin', password: 'faux-' + i }, headers: { 'X-Forwarded-For': xff } })).status
      }
      expect(last, trustProxy ? 'derrière un proxy' : 'accès direct').toBe(429)
      // Le bon mot de passe ne passe plus depuis cette adresse pendant le blocage
      expect((await http(`${base}/api/login`, { body: { username: 'admin', password: PASS }, headers: { 'X-Forwarded-For': trustProxy ? '8.8.8.8, 203.0.113.7' : '8.8.8.8' } })).status).toBe(429)
      // Derrière un proxy, un autre visiteur n'est pas pénalisé
      if (trustProxy) expect((await http(`${base}/api/login`, { body: { username: 'admin', password: PASS }, headers: { 'X-Forwarded-For': '198.51.100.9' } })).json.ok).toBe(true)
    }
    await db.close()
  })

  it('un compte visé depuis de nombreuses adresses est verrouillé', async () => {
    const db = await openDb({ mode: 'local' })
    const base = await listen(createHandler({ db, version: 't', trustProxy: true }))
    await http(`${base}/api/setup`, { body: { company: { name: 'X' }, username: 'admin', full_name: 'A', password: PASS } })
    let last = 0
    for (let i = 0; i < 32; i++) last = (await http(`${base}/api/login`, { body: { username: 'Admin ', password: 'faux' }, headers: { 'X-Forwarded-For': `203.0.113.${i + 1}` } })).status
    expect(last).toBe(429)
    await db.close()
  })

  it('adresse du visiteur et compteur à mémoire bornée', () => {
    const req = (peer: string, xff?: string) => ({ socket: { remoteAddress: peer }, headers: xff ? { 'x-forwarded-for': xff } : {} }) as any
    expect(clientIp(req('203.0.113.5', '1.2.3.4'), true)).toBe('203.0.113.5') // connexion directe : en-tête ignoré
    expect(clientIp(req('127.0.0.1', '1.2.3.4, 9.9.9.9'), true)).toBe('9.9.9.9')
    expect(clientIp(req('172.18.0.1', 'pas une adresse'), true)).toBe('172.18.0.1')
    expect(clientIp(req('127.0.0.1', '9.9.9.9'), false)).toBe('127.0.0.1')
    const l = new Limiter(3, 60_000, 100)
    for (let i = 0; i < 5000; i++) l.hit('ip' + i)
    expect((l as any).hits.size).toBeLessThanOrEqual(100)
  })

  it("console de l'éditeur : jeton faux refusé puis bloqué, administrateur ordinaire refusé", async () => {
    const gerant = (await http(`${cloud}/api/login`, { body: { username: 'gerant', password: PASS } })).json.data.token
    expect((await http(`${cloud}/api/admin/tenants`, { token: gerant, headers: { 'X-Forwarded-For': '1.1.1.1' } })).status).toBe(401)
    expect((await http(`${cloud}/api/admin/tenants`)).status).toBe(401)
    let last = 0
    for (let i = 0; i < 12; i++) last = (await http(`${cloud}/api/admin/tenants`, { token: 'z'.repeat(48), headers: { 'X-Forwarded-For': '9.9.9.9' } })).status
    expect(last).toBe(429)
  })
})

describe('Cloisonnement', () => {
  it('chaque rôle est refusé hors de ses modules, sur toutes les actions', async () => {
    const s = sites.a
    const holes: string[] = []
    for (const [role, token] of Object.entries(s.tokens)) {
      const allowed = PERMISSIONS[role as keyof typeof PERMISSIONS]
      for (const [name, route] of Object.entries(routes)) {
        if (typeof route.access !== 'string' || route.access === 'public' || route.access === 'user') continue
        if (allowed.includes(route.access as Module)) continue
        const r = await call(s, token, name, { id: 1, kind: 'client', types: ['FAC'] })
        if (r.json?.ok !== false || !/droits|réservée/.test(r.json.error)) holes.push(`${role} → ${name} : ${JSON.stringify(r.json).slice(0, 80)}`)
      }
    }
    expect(holes).toEqual([])
  }, 180_000)

  it('ventes et achats, clients et fournisseurs ne se contournent pas', async () => {
    const s = sites.a
    const supplier = await must(s, s.admin, 'parties.save', { kind: 'supplier', name: 'Fournisseur Secret' })
    const client = await must(s, s.admin, 'parties.save', { kind: 'client', name: 'Client Connu' })
    await must(s, s.admin, 'documents.save', { type: 'BC', party_id: supplier.id, lines: [{ description: 'Achat confidentiel', quantity: 1, unit_price: 900000, tva_rate: 18 }], taxes: [] })
    const com = s.tokens.commercial // ventes et clients, ni achats ni fournisseurs
    expect((await call(s, com, 'documents.list', { types: ['BC'] })).json.ok).toBe(false)
    expect((await call(s, com, 'documents.list', { types: ['FAC', 'BC'] })).json.ok).toBe(false)
    expect((await call(s, com, 'documents.list', { types: ['FAC', '__proto__'] })).json.ok).toBe(false)
    expect((await call(s, com, 'documents.list', { types: [] })).json.ok).toBe(false)
    expect((await call(s, com, 'documents.get', { id: 1 })).json.ok).toBe(false)
    expect((await call(s, com, 'documents.preview', { id: 1 })).json.ok).toBe(false)
    expect((await call(s, com, 'parties.get', { id: supplier.id })).json.ok).toBe(false)
    expect((await call(s, com, 'parties.list', { kind: 'supplier' })).json.ok).toBe(false)
    // Fiche fournisseur présentée comme une fiche client : refusée, rien n'est modifié
    expect((await call(s, com, 'parties.save', { id: supplier.id, kind: 'client', name: 'Piraté' })).json.ok).toBe(false)
    expect((await must(s, s.admin, 'parties.get', { id: supplier.id })).party.name).toBe('Fournisseur Secret')
    expect((await call(s, com, 'parties.save', { id: client.id, kind: 'client', name: 'Client Connu SARL' })).json.ok).toBe(true)
  })

  it('personne ne se donne des droits : rôle, licence, compte éditeur', async () => {
    const s = sites.a
    const com = s.tokens.commercial
    const me = (await must(s, s.admin, 'users.list')).find((u: any) => u.username === 'commercial')
    expect((await call(s, com, 'users.save', { id: me.id, username: 'commercial', full_name: 'x', role: 'admin' })).json.ok).toBe(false)
    expect((await call(s, com, 'roles.save', { current: { commercial: PERMISSIONS.admin } })).json.ok).toBe(false)
    expect((await call(s, com, 'settings.save', { name: 'Piraté' })).json.ok).toBe(false)
    expect((await call(s, com, 'settings.saveSecrets', { smtp_password: 'x' })).json.ok).toBe(false)
    // Un administrateur de société n'émet pas de licences et ne force pas la sienne
    expect((await call(s, s.admin, 'licensing.issue', { company: 'Alpha', tier: 'entreprise' })).json.ok).toBe(false)
    await must(s, s.admin, 'settings.save', { licence_key: 'fausse', trial_start: '2000-01-01' } as any)
    // La licence installée n'est pas remplacée par un simple réglage
    expect(await must(s, s.admin, 'licence.status')).toMatchObject({ state: 'active', label: 'Entreprise' })
    const forged = Buffer.from(JSON.stringify({ v: 1, id: 'LIC-X', company: 'Alpha Négoce', tier: 'entreprise', modules: PERMISSIONS.admin, users: 0, issued: '2026-01-01', expires: null })).toString('base64url') + '.' + Buffer.alloc(64, 7).toString('base64url')
    expect((await call(s, s.admin, 'licence.activate', { key: forged })).json.ok).toBe(false)
  })

  it("la matrice des droits d'une société ne déborde jamais sur une autre", async () => {
    const { a, b } = sites
    // Alpha ouvre tout à ses caissiers ; chez Bravo, le caissier doit rester limité à la caisse
    await must(a, a.admin, 'roles.save', { current: { caissier: PERMISSIONS.admin.filter((m) => m !== 'licensing') } })
    expect((await call(a, a.tokens.caissier, 'users.list')).json.ok).toBe(true)
    const results = await Promise.all(
      Array.from({ length: 60 }, (_, i) => (i % 2 ? call(a, a.tokens.caissier, 'users.list') : call(b, b.tokens.caissier, 'users.list')))
    )
    results.forEach((r, i) => expect(r.json.ok, i % 2 ? 'Alpha' : 'Bravo').toBe(i % 2 === 1))
    expect((await call(b, b.tokens.caissier, 'settings.save', { name: 'Piraté' })).json.ok).toBe(false)
    await must(a, a.admin, 'roles.save', { current: null })
    expect((await call(a, a.tokens.caissier, 'users.list')).json.ok).toBe(false)
  })

  it("une opération hors ligne rejouée ne livre pas le résultat d'un autre utilisateur", async () => {
    const s = sites.a
    const opId = 'op-partagee-0001'
    const first = await http(`${s.base}/api/call`, { body: { name: 'users.list', opId }, token: s.admin })
    expect(first.json.ok).toBe(true)
    const other = await http(`${s.base}/api/call`, { body: { name: 'users.list', opId }, token: s.tokens.caissier })
    expect(other.json.ok).toBe(false)
  })
})

describe('Injections', () => {
  const NASTY = ["' OR '1'='1", "1; DROP TABLE users; --", "'); DELETE FROM documents; --", '%', '\\', '${7*7}', '<script>alert(1)</script>', '../../etc/passwd', '\u0000', 'x'.repeat(5000)]

  it('SQL : les saisies hostiles sont traitées comme du texte, la base reste intacte', async () => {
    const s = sites.a
    const before = (await must(s, s.admin, 'users.list')).length
    for (const v of NASTY) {
      for (const [name, args] of [
        ['documents.list', { types: ['FAC'], search: v, status: v, from: v, to: v }],
        ['parties.list', { kind: 'client', search: v }],
        ['products.list', { search: v, category: v }],
        ['documents.get', { id: v }],
        ['parties.get', { id: v }],
        ['reports.sales', { from: v, to: v }],
        ['analytics.values', { dataset: v, dimension: v }],
        ['analytics.run', { dataset: 'ventes', rows: v, measures: [v], filters: { [v]: [v] }, grain: v }],
        ['accounting.ledger', { account: v, from: v, to: v }],
        ['stock.movements', { productId: v, search: v }],
        ['parties.save', { kind: 'client', name: v || 'x', email: v, notes: v }]
      ] as const) {
        const r = await call(s, s.admin, name, args)
        expect(r.status, `${name} ← ${v.slice(0, 20)}`).toBe(200)
      }
    }
    const login = await http(`${s.base}/api/login`, { body: { username: "admin' --", password: "' OR 1=1 --" }, headers: {} })
    expect(login.json.ok).toBe(false)
    expect((await must(s, s.admin, 'users.list')).length).toBe(before)
    expect((await must(s, s.admin, 'documents.list', { types: ['BC'] })).length).toBe(1)
  }, 120_000)

  it('arguments malformés : le serveur répond, sans divulguer de détail interne ni polluer les objets', async () => {
    const s = sites.a
    const weird: unknown[] = [null, 42, 'texte', [], [[[]]], { __proto__: { role: 'admin' } }, JSON.parse('{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":1}}}'), { id: { $gt: 0 } }, { id: [1, 2] }, { id: -1 }, { id: 1e308 }]
    let technical = 0
    for (const name of [...Object.keys(routes), '__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      // Actions sans effet extérieur uniquement (pas d'envoi de message ni de suppression de compte)
      if (/^(messages\.(send|remind|test)|licensing\.cloud|users\.revokeDevice|auth\.changePassword)/.test(name)) continue
      for (const args of weird.slice(0, name.includes('.') ? weird.length : 2)) {
        const r = await call(s, s.admin, name, args)
        expect(r.status, name).toBe(200)
        expect(r.json.ok === true || typeof r.json.error === 'string', name).toBe(true)
        if (r.json.ok === false) {
          if (/Erreur technique/.test(r.json.error)) technical++
          // Ni requête SQL, ni chemin de fichier, ni pile d'appels dans la réponse
          expect(r.json.error, name).not.toMatch(/SELECT |INSERT |syntax error|relation "|node_modules|\.ts:\d|at \w+ \(/i)
        }
      }
    }
    expect(({} as any).polluted).toBeUndefined()
    expect((await call(s, s.tokens.caissier, 'users.list')).json.ok).toBe(false)
    expect((await must(s, s.admin, 'users.list')).length).toBeGreaterThan(4)
    console.log(`Arguments malformés : ${technical} réponse(s) « Erreur technique » (sans détail interne).`)
  }, 240_000)

  it('XSS : rien de ce que saisit un utilisateur ne devient du code dans les pages servies', async () => {
    const s = sites.a
    const X = '"><script>alert(1)</script><img src=x onerror=alert(2)>'
    await must(s, s.admin, 'settings.save', { name: `Alpha ${X}`, address: X, invoice_footer: X, doc_terms: X, doc_color: `red}</style>${X}`, signatory_name: X, public_url: `javascript:alert(1)//${X}` })
    expect((await call(s, s.admin, 'settings.save', { logo: `data:text/html,${X}` })).json.ok).toBe(false)
    const party = await must(s, s.admin, 'parties.save', { kind: 'client', name: `Client ${X}`, address: X })
    const doc = await must(s, s.admin, 'documents.save', { type: 'FAC', party_id: party.id, validate: true, reference: X, notes: X, taxes: [], lines: [{ description: X, quantity: 1, unit_price: 1000, tva_rate: 18 }] })
    const pages: string[] = []
    for (const format of ['a4', 'ticket']) pages.push((await must(s, s.admin, 'documents.preview', { id: doc.id, format })).html)
    const ticket = (await http(`${s.base}/api/print`, { body: { id: doc.id }, token: s.admin })).json.data.url
    const printed = await http(s.base + ticket)
    pages.push(printed.text)
    const full = await must(s, s.admin, 'documents.get', { id: doc.id })
    const code = String(full.auth_code ?? '')
    const verify = await http(`${s.base}/verify/${code}`)
    expect(verify.text).toContain('authentique')
    pages.push(verify.text, (await http(`${s.base}/verify?code=${encodeURIComponent(X)}`)).text)
    for (const html of pages) {
      expect(html).not.toMatch(/<script>alert\(1\)/)
      expect(html).not.toMatch(/<img src=x onerror/)
      expect(html).not.toMatch(/href="javascript:/i)
    }
    // Lien d'impression : usage unique, et la page n'exécute que son propre script
    expect((await http(s.base + ticket)).status).toBe(410)
    expect(printed.headers.get('content-security-policy')).toMatch(/script-src 'self' 'sha256-/)
    await must(s, s.admin, 'settings.save', { name: 'Alpha Négoce', address: '', invoice_footer: '', doc_terms: '', doc_color: '#1d6fd6', signatory_name: '', public_url: '' })
  })

  it('fichiers : aucun chemin ne sort du dossier servi', async () => {
    writeFileSync(join(tmpdir(), `iam-sec-secret-${process.pid}.txt`), 'TOP-SECRET')
    const secret = `iam-sec-secret-${process.pid}.txt`
    for (const p of [
      `/../${secret}`, `/..%2f${secret}`, `/%2e%2e/${secret}`, `/..%5c${secret}`, `/assets/..%2f..%2f${secret}`, `/%252e%252e/${secret}`, `//${secret}`, `/app/..%2f..%2f${secret}`,
      `/telechargements/..%2f${secret}`, `/telechargements/%2e%2e%2f%2e%2e%2f${secret}`, `/t/alpha_negoce/..%2f..%2f${secret}`, `/t/..%2f${secret}`, `/assets/app.js%00.html`, '/%'
    ]) {
      for (const base of [cloud, sites.a.base]) {
        const r = await http(base + p)
        expect(r.text, p).not.toContain('TOP-SECRET')
        expect([200, 301, 400, 403, 404], p).toContain(r.status)
      }
    }
    expect((await http(`${cloud}/t/inconnue_xyz/api/status`)).status).toBe(404)
    expect((await http(`${cloud}/t/Alpha_Negoce/api/status`)).status).toBe(404)
  })

  it('requêtes anormales : trop grosses, illisibles, méthodes inattendues', async () => {
    const s = sites.a
    expect((await http(`${s.base}/api/call`, { raw: '{"name":', token: s.admin })).status).toBe(400)
    // Refus dès la limite dépassée : réponse 413, ou connexion coupée si l'envoi n'était pas terminé
    const big = (url: string, raw: string, token: string) => http(url, { raw, token }).then((r) => r.status, () => 413)
    expect(await big(`${s.base}/api/call`, JSON.stringify({ name: 'users.list', args: { x: 'a'.repeat(5 * 1024 * 1024) } }), s.admin)).toBe(413)
    expect(await big(`${cloud}/api/admin/tenants`, JSON.stringify({ name: 'x'.repeat(300 * 1024) }), ADMIN)).toBe(413)
    expect((await must(s, s.admin, 'users.list')).length).toBeGreaterThan(4)
    for (const method of ['PUT', 'DELETE', 'PATCH']) expect((await http(`${s.base}/api/call`, { method, token: s.admin })).status).toBe(404)
    expect((await http(`${s.base}/index.html`, { method: 'DELETE' })).status).toBe(405)
    // En-tête d'hôte fantaisiste : jamais repris dans un lien
    const r = await http(`${s.base}/api/call`, { body: { name: 'documents.preview', args: { id: 2 } }, token: s.admin, headers: { 'X-Forwarded-Host': 'evil.example"><script>', 'X-Forwarded-Proto': 'javascript' } })
    expect(JSON.stringify(r.json)).not.toContain('evil.example')
  })
})

describe('En-têtes et pages', () => {
  it('politique de contenu, anti-cadre et HTTPS strict', async () => {
    const page = await http(`${sites.a.base}/`, { headers: { 'X-Forwarded-Proto': 'https' } })
    const csp = page.headers.get('content-security-policy') ?? ''
    expect(csp).toMatch(/default-src 'self'/)
    expect(csp).toMatch(/script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/)
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/)
    expect(csp).toMatch(/object-src 'none'/)
    expect(csp).toMatch(/frame-ancestors 'self'/)
    expect(page.headers.get('x-frame-options')).toBe('SAMEORIGIN')
    expect(page.headers.get('x-content-type-options')).toBe('nosniff')
    expect(page.headers.get('strict-transport-security')).toMatch(/max-age=31536000/)
    expect((await http(`${sites.a.base}/`)).headers.get('strict-transport-security')).toBeNull()
    const api = await http(`${sites.a.base}/api/status`)
    expect(api.headers.get('cache-control')).toBe('no-store')
    expect(api.headers.get('x-content-type-options')).toBe('nosniff')
    const admin = await http(`${cloud}/admin/`)
    expect(admin.headers.get('x-frame-options')).toBe('DENY')
    expect(admin.headers.get('content-security-policy')).toMatch(/default-src 'none'/)
    // Un script injecté dans une page ne correspond à aucune empreinte
    const policy = contentSecurityPolicy('<script>ok()</script>')
    expect(contentSecurityPolicy('<script>ok()</script><script>vol()</script>')).not.toBe(policy)
  })

  it('une erreur interne ne révèle rien', async () => {
    const broken = await listen(createCloudHandler({ root: async () => { throw new Error('connexion postgres://iam:motdepasse@db refusée') }, manager, adminToken: ADMIN, shared: { version: 't' } }))
    const r = await http(`${broken}/quelque-part`)
    expect(r.status).toBe(500)
    expect(r.text).not.toMatch(/postgres|motdepasse/)
  })
})

describe('Secrets', () => {
  it('chiffrés dans la base, jamais renvoyés, absents des copies', async () => {
    const s = sites.a
    await must(s, s.admin, 'settings.saveSecrets', { smtp_password: 'mdp-smtp-ultra-secret', sms_secret: 'cle-sms-123456' })
    const db = [...dbs.values()][0]
    const rows = await db.query<{ key: string; value: string }>('SELECT key, value FROM secrets')
    expect(rows.length).toBeGreaterThanOrEqual(2)
    for (const r of rows) {
      expect(isSealed(r.value), r.key).toBe(true)
      expect(r.value).not.toContain('secret')
    }
    expect(await must(s, s.admin, 'settings.secrets')).toMatchObject({ smtp_password: true, sms_secret: true })
    const all = JSON.stringify([await must(s, s.admin, 'settings.get'), await must(s, s.admin, 'users.list'), (await http(`${s.base}/api/status`, { token: s.admin })).json])
    expect(all).not.toMatch(/mdp-smtp|cle-sms|password_hash|token_hash/)
    const snap = await exportSnapshot(db)
    expect(Object.keys(snap.tables)).not.toContain('secrets')
    expect(Object.keys(snap.tables)).not.toContain('auth_sessions')
    expect(JSON.stringify(snap)).not.toContain('mdp-smtp')
  })

  it('mots de passe des bases hébergées chiffrés, jamais listés', async () => {
    const rows = await control.query<{ db_password: string; sync_key_hash: string | null }>('SELECT db_password, sync_key_hash FROM cloud_tenants')
    expect(rows.length).toBeGreaterThanOrEqual(2)
    for (const r of rows) expect(isSealed(r.db_password)).toBe(true)
    const list = JSON.stringify((await http(`${cloud}/api/admin/tenants`, { token: ADMIN, headers: { 'X-Forwarded-For': '2.2.2.2' } })).json)
    expect(list).not.toMatch(/db_password|enc:v1:/)
    // Les jetons de session ne sont conservés que sous forme d'empreinte
    const sessions = await control.query<{ token_hash: string }>('SELECT token_hash FROM auth_sessions')
    for (const x of sessions) expect(x.token_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('une société hébergée ne peut pas faire appeler le réseau interne du serveur', async () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.18.0.2', '192.168.1.10', '169.254.169.254', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '100.64.0.1']) expect(isInternalAddress(ip), ip).toBe(true)
    for (const ip of ['8.8.8.8', '145.223.34.191', '2606:4700::1111']) expect(isInternalAddress(ip), ip).toBe(false)
    restrictOutbound(true)
    for (const target of ['http://127.0.0.1:8090/api/admin/tenants', 'http://localhost:5432/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data/', 'file:///etc/passwd', 'gopher://127.0.0.1/', '10.0.0.1'])
      await expect(assertPublicHost(target, 'Passerelle'), target).rejects.toThrow(/interne|http\(s\)|invalide/)
    const s = sites.a
    await must(s, s.admin, 'settings.save', { sms_provider: 'http', sms_http_url: 'http://127.0.0.1:1/x?to={to}&m={message}', smtp_host: '127.0.0.1', smtp_from_email: 'a@b.bf' })
    const sms = await call(s, s.admin, 'messages.sendSms', { to: '+22670000000', body: 'test' })
    expect(sms.json.ok).toBe(false)
    expect(sms.json.error).toMatch(/réseau interne/)
    const mail = await call(s, s.admin, 'messages.test', { to: 'x@y.bf' })
    expect(mail.json.ok).toBe(false)
    restrictOutbound(false)
  })

  it('copie en ligne : clé obligatoire, contenu contrôlé', async () => {
    const s = sites.b
    const bad = await http(`${s.base}/api/mirror`, { body: { schema: 1, tables: {} }, token: 'y'.repeat(43), headers: { 'X-Forwarded-For': '3.3.3.3' } })
    expect(bad.status).toBe(401)
    // Le jeton d'un administrateur de la société n'est pas une clé de synchronisation
    expect((await http(`${s.base}/api/mirror`, { body: { schema: 1, tables: {} }, token: s.admin })).status).toBe(401)
    const slug = s.base.split('/t/')[1]
    const key = (await http(`${cloud}/api/admin/tenants/${slug}/sync-key`, { body: {}, token: ADMIN, headers: { 'X-Forwarded-For': '2.2.2.2' } })).json.data.sync_key
    const snap = await exportSnapshot([...dbs.values()][1])
    for (const tampered of [{ ...snap, schema: 1 }, { ...snap, tables: { ...snap.tables, 'users; DROP TABLE users': [] } }, { ...snap, tables: { ...snap.tables, pg_shadow: [{ usename: 'x' }] } }, 'pas un instantané']) {
      const r = await http(`${s.base}/api/mirror`, { body: tampered, token: key })
      expect(r.status).toBe(400)
    }
    expect((await must(s, s.admin, 'users.list')).length).toBeGreaterThan(4)
  })
})
