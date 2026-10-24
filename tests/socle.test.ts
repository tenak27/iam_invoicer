// Base commune des applications IAM (tools/socle) : installateurs proposés, envoi avec reprise,
// choix de la mise à jour pour l'appareil.
import { createHmac, randomBytes } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { classify, compareVersions, listDownloads } from '../tools/socle/server/downloads'
import { PGlite } from '@electric-sql/pglite'
import { createSocle, spaceDemo } from '../tools/socle/server'
import { pickFile } from '../tools/socle/renderer/versions'
import { Notifier } from '../tools/socle/server/notify'
import { ConsoleAgent } from '../tools/socle/server/agent'
import { openDb, type Db } from '../src/main/db'

describe('installateurs', () => {
  it('classement par plateforme, type, processeur et version', () => {
    expect(classify('IAM-BTP-Setup-0.2.3.exe')).toMatchObject({ platform: 'windows', kind: 'installer', version: '0.2.3' })
    expect(classify('Faso-Artisans-0.1.0-windows.zip')).toMatchObject({ platform: 'windows', kind: 'portable' })
    expect(classify('IAM-BTP-0.2.3-arm64.dmg')).toMatchObject({ platform: 'macos', arch: 'arm64' })
    expect(classify('IAM-BTP-0.2.3-android.apk')).toMatchObject({ platform: 'android', kind: 'apk' })
    expect(classify('IAM-BTP-0.2.3-ios-unsigned.ipa')).toMatchObject({ platform: 'ios', signed: false })
    expect(classify('notes.txt')).toBeNull()
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0)
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0)
  })

  it('mise à jour choisie pour l’appareil : la plus récente, installateur plutôt que portable', () => {
    const f = (name: string) => ({ ...classify(name)!, size: 1, url: '/telechargements/' + name })
    const files = [f('A-Setup-0.2.2.exe'), f('A-0.2.3-windows.zip'), f('A-Setup-0.2.3.exe'), f('A-0.2.3-arm64.dmg'), f('A-0.2.3-x64.dmg'), f('A-0.2.3-android.apk')]
    expect(pickFile(files, 'windows', 'x64')?.url).toBe('/telechargements/A-Setup-0.2.3.exe')
    expect(pickFile(files, 'macos', 'arm64')?.url).toBe('/telechargements/A-0.2.3-arm64.dmg')
    expect(pickFile(files, 'android', null)?.version).toBe('0.2.3')
    expect(pickFile(files, 'linux', 'x64')).toBeNull()
  })
})

describe('serveur : /api/downloads et /telechargements/', () => {
  let server: Server
  let base = ''
  const dir = mkdtempSync(join(tmpdir(), 'socle-'))
  beforeAll(async () => {
    writeFileSync(join(dir, 'App-Setup-1.0.0.exe'), 'ancien')
    writeFileSync(join(dir, 'App-Setup-1.1.0.exe'), '0123456789')
    writeFileSync(join(dir, 'lisez-moi.txt'), 'x')
    const socle = createSocle({ app: 'Test', version: '1.1.0', downloadsDir: dir })
    server = createServer(async (req, res) => {
      const path = new URL(req.url ?? '/', 'http://x').pathname
      if (!(await socle(req, res, path))) {
        res.writeHead(404)
        res.end()
      }
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  })
  afterAll(() => new Promise((r) => server.close(r)))

  it('liste : version du serveur, fichiers reconnus, le plus récent d’abord, empreinte', async () => {
    const r = await (await fetch(base + '/api/downloads')).json()
    expect(r.data.version).toBe('1.1.0')
    expect(r.data.files.map((f: any) => f.name)).toEqual(['App-Setup-1.1.0.exe', 'App-Setup-1.0.0.exe'])
    expect(r.data.files[0].sha256).toMatch(/^[0-9a-f]{64}$/)
    expect((await listDownloads(join(dir, 'absent'))).length).toBe(0)
  })

  it('téléchargement complet, reprise (Range) et noms refusés', async () => {
    const full = await fetch(base + '/telechargements/App-Setup-1.1.0.exe')
    expect(full.status).toBe(200)
    expect(full.headers.get('content-disposition')).toContain('App-Setup-1.1.0.exe')
    expect(await full.text()).toBe('0123456789')
    const part = await fetch(base + '/telechargements/App-Setup-1.1.0.exe', { headers: { Range: 'bytes=4-' } })
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe('bytes 4-9/10')
    expect(await part.text()).toBe('456789')
    expect((await fetch(base + '/telechargements/lisez-moi.txt')).status).toBe(404)
    expect((await fetch(base + '/telechargements/..%2F..%2Fetc%2Fpasswd')).status).toBe(404)
  })
})

describe('notifications : fil des applications installées et abonnements Web Push', () => {
  let db: Db
  let server: Server
  let base = ''
  let uid = 0
  let other = 0
  let notifier: Notifier
  const get = (path: string, token = 'jeton') => fetch(base + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).then(async (r) => ({ status: r.status, json: await r.json() }))
  const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { Authorization: 'Bearer jeton', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json() }))

  beforeAll(async () => {
    db = await openDb({ mode: 'local' })
    uid = (await db.one<{ id: number }>("INSERT INTO users (username, full_name, role, password_hash) VALUES ('awa', 'Awa', 'admin', 'x') RETURNING id"))!.id
    other = (await db.one<{ id: number }>("INSERT INTO users (username, full_name, role, password_hash) VALUES ('issa', 'Issa', 'caissier', 'x') RETURNING id"))!.id
    notifier = new Notifier({ db, app: 'Test', resolveUser: async (t) => (t === 'jeton' ? { id: uid } : null) })
    server = createServer(async (req, res) => {
      const path = new URL(req.url ?? '/', 'http://x').pathname
      if (!(await notifier.handle(req, res, path))) {
        res.writeHead(404)
        res.end()
      }
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  })
  afterAll(async () => {
    await new Promise((r) => server.close(r))
    await db.close()
  })

  it('clé publique VAPID créée une fois, session exigée pour le reste', async () => {
    const k = await get('/api/socle/push/key', '')
    expect(k.json.data.key).toMatch(/^[A-Za-z0-9_-]{80,}$/)
    expect((await get('/api/socle/push/key', '')).json.data.key).toBe(k.json.data.key)
    expect((await get('/api/socle/notifications?since=0', '')).status).toBe(401)
  })

  it('fil : rien d’ancien au premier passage, puis les nouveautés de l’utilisateur seulement', async () => {
    await notifier.notify([uid], { title: 'Ancienne', body: 'déjà vue' })
    const first = await get('/api/socle/notifications?since=-1')
    expect(first.json.data.items).toEqual([])
    await notifier.notify([uid, other], { title: 'Nouvelle commande', body: 'Commande n° 12 : 45 000 F', url: '/commandes/12', tag: 'commande-12' })
    await notifier.notify([other], { title: 'Pour Issa' })
    const next = await get(`/api/socle/notifications?since=${first.json.data.last}`)
    expect(next.json.data.items.map((i: any) => [i.title, i.body, i.url, i.tag])).toEqual([['Nouvelle commande', 'Commande n° 12 : 45 000 F', '/commandes/12', 'commande-12']])
    expect((await get(`/api/socle/notifications?since=${next.json.data.last}`)).json.data.items).toEqual([])
  })

  it('abonnement Web Push : enregistré pour l’utilisateur, refusé s’il est incomplet, retiré', async () => {
    const subscription = { endpoint: 'https://push.exemple.invalid/abc', keys: { p256dh: 'BOr' + 'a'.repeat(84), auth: 'b'.repeat(22) } }
    expect((await post('/api/socle/push/subscribe', { subscription: { endpoint: 'http://non-securise' } })).status).toBe(400)
    expect((await post('/api/socle/push/subscribe', { subscription, device: 'Chrome Android' })).json.data).toBe(true)
    expect(await db.query('SELECT user_id, device FROM socle_push')).toEqual([{ user_id: uid, device: 'Chrome Android' }])
    await post('/api/socle/push/unsubscribe', { endpoint: subscription.endpoint })
    expect(await db.query('SELECT 1 FROM socle_push')).toEqual([])
  })
})

describe('agent de la console : jeton exigé, mesures, journal, espaces, licences', () => {
  let db: Db
  let server: Server
  let base = ''
  const TOKEN = 'c'.repeat(48)
  const req = (path: string, init: RequestInit = {}, token = TOKEN) =>
    fetch(base + path, { ...init, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' } }).then(async (r) => ({ status: r.status, json: await r.json() }))

  beforeAll(async () => {
    db = await openDb({ mode: 'local' })
    const uid = (await db.one<{ id: number }>("INSERT INTO users (username, full_name, role, password_hash) VALUES ('mariam', 'Mariam Traoré', 'admin', 'x') RETURNING id"))!.id
    await db.query('CREATE TABLE activity (id BIGSERIAL PRIMARY KEY, user_id INT, kind TEXT NOT NULL, details TEXT NOT NULL DEFAULT \'\', created_at TIMESTAMPTZ NOT NULL DEFAULT now())')
    await db.query("INSERT INTO activity (user_id, kind, details) VALUES ($1, 'connexion', 'Connexion'), ($1, 'facture', 'Facture F-0001 créée')", [uid])
    const agent = new ConsoleAgent({ db, app: 'Test', version: '1.2.3', token: TOKEN })
    server = createServer(async (rq, rs) => {
      agent.watch(rs)
      const path = new URL(rq.url ?? '/', 'http://x').pathname
      if (!(await agent.handle(rq, rs, path))) {
        rs.writeHead(204)
        rs.end()
      }
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  })
  afterAll(async () => {
    await new Promise((r) => server.close(r))
    await db.close()
  })

  it('sans le bon jeton, ces routes n’existent pas', async () => {
    expect((await req('/api/socle/console/metrics', {}, '')).status).toBe(404)
    expect((await req('/api/socle/console/metrics', {}, 'd'.repeat(48))).status).toBe(404)
  })

  it('mesures : version, mémoire, requêtes comptées, base et comptes', async () => {
    await fetch(base + '/autre')
    const m = (await req('/api/socle/console/metrics')).json.data
    expect(m).toMatchObject({ app: 'Test', version: '1.2.3', users: 1, spaces: 1 })
    expect(m.http.requests).toBeGreaterThanOrEqual(1)
    expect(m.db.size_mb).toBeGreaterThan(0)
    expect(m.mem_mb).toBeGreaterThan(0)
  })

  it('journal à partir d’un numéro, espaces clients, licence décidée par la console', async () => {
    const a = (await req('/api/socle/console/activity?since=0')).json.data
    expect(a.map((x: any) => [x.kind, x.details, x.user_name])).toEqual([['connexion', 'Connexion', 'Mariam Traoré'], ['facture', 'Facture F-0001 créée', 'Mariam Traoré']])
    expect((await req(`/api/socle/console/activity?since=${a[0].id}`)).json.data).toHaveLength(1)
    const spaces = (await req('/api/socle/console/spaces')).json.data
    expect(spaces.map((s: any) => s.name)).toContain('Mariam Traoré')
    await req('/api/socle/console/licence', { method: 'POST', body: JSON.stringify({ space_id: '1', plan: 'pro', status: 'active', limits: { users: 10 }, ends_on: '2027-10-31' }) })
    const lic = (await req('/api/socle/console/licences')).json.data
    expect(lic[0]).toMatchObject({ space_id: '1', plan: 'pro', status: 'active', limits: { users: 10 } })
  })
})

describe('version de démonstration : espaces séparés, nettoyage complet, jamais comptés', () => {
  const pg = new PGlite()
  const db = {
    query: async <T = any>(sql: string, params?: unknown[]) => (await pg.query<T>(sql, params as any[])).rows,
    one: async <T = any>(sql: string, params?: unknown[]) => (await pg.query<T>(sql, params as any[])).rows[0]
  }
  const TOKEN = 'k'.repeat(48)
  let server: Server
  let base = ''
  let seed: ReturnType<typeof spaceDemo>
  const count = async (sql: string) => Number((await db.one<{ n: number }>(sql))!.n)
  const realToken = async () => {
    const t = 'reel-' + randomBytes(8).toString('hex')
    await db.query('INSERT INTO auth_sessions (token_hash, user_id) VALUES ($1, 1)', [t])
    return t
  }

  beforeAll(async () => {
    await pg.exec(`
      CREATE TABLE companies (id SERIAL PRIMARY KEY, name TEXT NOT NULL, demo BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE users (id SERIAL PRIMARY KEY, company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, username TEXT NOT NULL, full_name TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE auth_sessions (token_hash TEXT PRIMARY KEY, user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE sites (id SERIAL PRIMARY KEY, company_id INT NOT NULL REFERENCES companies(id), name TEXT NOT NULL, parent_id INT REFERENCES sites(id), manager_id INT REFERENCES users(id));
      CREATE TABLE reports (id SERIAL PRIMARY KEY, site_id INT NOT NULL REFERENCES sites(id), author_id INT REFERENCES users(id) ON DELETE SET NULL, body TEXT);
      CREATE TABLE activity (id BIGSERIAL PRIMARY KEY, company_id INT, user_id INT, kind TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    `)
    // Un client réel, avec ses données
    await pg.exec(`
      INSERT INTO companies (name) VALUES ('Entreprise réelle');
      INSERT INTO users (company_id, username, full_name) VALUES (1, 'reel', 'Client Réel');
      INSERT INTO sites (company_id, name, manager_id) VALUES (1, 'Chantier réel', 1);
      INSERT INTO reports (site_id, author_id, body) VALUES (1, 1, 'Rapport réel');
      INSERT INTO activity (company_id, user_id, kind, details) VALUES (1, 1, 'connexion', 'Connexion réelle');
    `)
    seed = spaceDemo({
      db,
      async create() {
        const c = (await db.one<{ id: number }>("INSERT INTO companies (name, demo) VALUES ('Démo BTP', TRUE) RETURNING id"))!.id
        const u = (await db.one<{ id: number }>("INSERT INTO users (company_id, username, full_name) VALUES ($1, $2, 'Visiteur') RETURNING id", [c, 'demo-' + c]))!.id
        const s = (await db.one<{ id: number }>("INSERT INTO sites (company_id, name, manager_id) VALUES ($1, 'Chantier fictif', $2) RETURNING id", [c, u]))!.id
        await db.query("INSERT INTO sites (company_id, name, parent_id) VALUES ($1, 'Lot fictif', $2)", [c, s])
        await db.query("INSERT INTO reports (site_id, author_id, body) VALUES ($1, $2, 'Rapport fictif')", [s, u])
        await db.query("INSERT INTO activity (company_id, user_id, kind, details) VALUES ($1, $2, 'connexion', 'Connexion de démonstration')", [c, u])
        return { userId: u }
      }
    })
    const token = async (userId: number) => {
      const t = randomBytes(24).toString('hex')
      await db.query('INSERT INTO auth_sessions (token_hash, user_id) VALUES ($1, $2)', [t, userId])
      return t
    }
    const resolveUser = async (t: string) => db.one<{ id: number }>('SELECT user_id AS id FROM auth_sessions WHERE token_hash = $1', [t])
    process.env.CONSOLE_TOKEN = TOKEN
    const socle = createSocle({ app: 'Test', version: '1.0.0', db, resolveUser, webPush: false, demo: { seed, token } })
    delete process.env.CONSOLE_TOKEN
    server = createServer(async (rq, rs) => {
      const path = new URL(rq.url ?? '/', 'http://x').pathname
      if (!(await socle(rq, rs, path))) {
        rs.writeHead(404)
        rs.end()
      }
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  })
  afterAll(async () => {
    await new Promise((r) => server.close(r))
    await pg.close()
  })

  it('chaque visiteur reçoit son propre espace fictif, reconnu comme tel', async () => {
    const a = await (await fetch(base + '/api/socle/demo', { method: 'POST', headers: { 'x-forwarded-for': '10.0.0.1' } })).json()
    const b = await (await fetch(base + '/api/socle/demo', { method: 'POST', headers: { 'x-forwarded-for': '10.0.0.2' } })).json()
    expect([a, b]).toMatchObject([{ ok: true }, { ok: true }])
    expect(a.data.token).not.toBe(b.data.token)
    expect(await count('SELECT COUNT(*) AS n FROM companies WHERE demo')).toBe(2)
    const st = await (await fetch(base + '/api/socle/demo/status', { headers: { Authorization: `Bearer ${a.data.token}` } })).json()
    expect(st.data.demo).toBe(true)
    expect(new Date(st.data.expires_at).getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000)
    const st2 = await (await fetch(base + '/api/socle/demo/status', { headers: { Authorization: `Bearer ${await realToken()}` } })).json()
    expect(st2.data.demo).toBe(false)
  })

  it('trop de démonstrations depuis la même adresse : refusées', async () => {
    let last = 0
    for (let i = 0; i < 7; i++) last = (await fetch(base + '/api/socle/demo', { method: 'POST', headers: { 'x-forwarded-for': '10.0.0.9' } })).status
    expect(last).toBe(429)
  })

  it('console : comptes, espaces et journal réels seulement', async () => {
    const h = { headers: { Authorization: `Bearer ${TOKEN}` } }
    const m = (await (await fetch(base + '/api/socle/console/metrics', h)).json()).data
    expect(m).toMatchObject({ users: 1, spaces: 1 })
    const spaces = (await (await fetch(base + '/api/socle/console/spaces', h)).json()).data
    expect(spaces.map((s: any) => s.name)).toEqual(['Entreprise réelle'])
    const act = (await (await fetch(base + '/api/socle/console/activity?since=0', h)).json()).data
    expect(act.map((x: any) => x.details)).toEqual(['Connexion réelle'])
  })

  it('nettoyage : tout l’espace fictif disparaît, rien du client réel ne bouge', async () => {
    expect(await seed.purge(new Date(Date.now() - 3600_000))).toBe(0)
    expect(await seed.purge(new Date(Date.now() + 1000))).toBeGreaterThanOrEqual(2)
    expect(await count('SELECT COUNT(*) AS n FROM companies')).toBe(1)
    expect(await count('SELECT COUNT(*) AS n FROM users')).toBe(1)
    expect(await count('SELECT COUNT(*) AS n FROM sites')).toBe(1)
    expect(await count('SELECT COUNT(*) AS n FROM reports')).toBe(1)
    expect(await count('SELECT COUNT(*) AS n FROM activity')).toBe(1)
    expect(await count('SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id <> 1')).toBe(0)
  })
})

describe('licences : essai, version gratuite, formule payée, limites appliquées', () => {
  const pg = new PGlite()
  const db = {
    query: async <T = any>(sql: string, params?: unknown[]) => (await pg.query<T>(sql, params as any[])).rows,
    one: async <T = any>(sql: string, params?: unknown[]) => (await pg.query<T>(sql, params as any[])).rows[0]
  }
  class AppError extends Error {}
  let server: Server
  let base = ''
  let socle: ReturnType<typeof createSocle>
  const users: Record<string, { id: number; company_id: number; role: string }> = {}

  beforeAll(async () => {
    await pg.exec(`
      CREATE TABLE companies (id SERIAL PRIMARY KEY, name TEXT NOT NULL, demo BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE users (id SERIAL PRIMARY KEY, company_id INT NOT NULL REFERENCES companies(id), username TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'admin');
      CREATE TABLE sites (id SERIAL PRIMARY KEY, company_id INT NOT NULL REFERENCES companies(id), name TEXT NOT NULL);
      INSERT INTO companies (name, created_at) VALUES ('En essai', now()), ('Ancienne', now() - interval '90 days'), ('Payée', now() - interval '90 days'), ('Démo', now());
      UPDATE companies SET demo = TRUE WHERE name = 'Démo';
      INSERT INTO users (company_id, username, role) VALUES (1, 'essai@x.bf', 'admin'), (2, 'ancienne@x.bf', 'admin'), (3, 'payee@x.bf', 'admin'), (4, 'demo', 'admin'), (2, 'chef@x.bf', 'chef');
      INSERT INTO sites (company_id, name) SELECT 2, 'Chantier ' || g FROM generate_series(1, 3) g;
      INSERT INTO sites (company_id, name) SELECT 3, 'Chantier ' || g FROM generate_series(1, 3) g;
    `)
    for (const u of await db.query<{ id: number; company_id: number; role: string; username: string }>('SELECT * FROM users')) users[u.username] = u
    // Console injoignable : le paiement en ligne doit répondre clairement
    process.env.CONSOLE_URL = 'http://127.0.0.1:9'
    socle = createSocle({
      app: 'Test',
      version: '1.0.0',
      db,
      resolveUser: async (t) => Object.values(users).find((u) => `jeton-${u.id}` === t) ?? null,
      webPush: false,
      licence: {
        spaces: 'companies',
        spaceOf: (u) => u.company_id,
        canBuy: (u) => u.role === 'admin',
        quotas: { chantiers: { label: 'chantiers', sql: 'SELECT COUNT(*)::int AS n FROM sites WHERE company_id = $1' }, utilisateurs: { label: 'utilisateurs', sql: 'SELECT COUNT(*)::int AS n FROM users WHERE company_id = $1' } },
        free: { chantiers: 3, utilisateurs: 2 },
        calls: { 'sites.save': { quota: 'chantiers', when: (a) => !a?.id }, 'team.save': { quota: 'utilisateurs', when: (a) => !a?.id } },
        fail: (m) => {
          throw new AppError(m)
        }
      }
    })
    server = createServer(async (rq, rs) => {
      const path = new URL(rq.url ?? '/', 'http://x').pathname
      if (!(await socle(rq, rs, path))) {
        rs.writeHead(404)
        rs.end()
      }
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    // Licence payée poussée par la console : 10 chantiers, utilisateurs illimités
    await db.query(`CREATE TABLE IF NOT EXISTS socle_licences (space_id TEXT PRIMARY KEY, plan TEXT NOT NULL, status TEXT NOT NULL, limits JSONB NOT NULL DEFAULT '{}', ends_on DATE, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), seen_guide BOOLEAN NOT NULL DEFAULT FALSE)`)
    await db.query(`INSERT INTO socle_licences (space_id, plan, status, limits, ends_on) VALUES ('3', 'pro', 'active', '{"chantiers": 10, "utilisateurs": 0}', CURRENT_DATE + 30)`)
  })
  afterAll(async () => {
    await new Promise((r) => server.close(r))
    await pg.close()
  })

  const get = async (who: string) => (await (await fetch(base + '/api/socle/licence', { headers: { Authorization: `Bearer jeton-${users[who].id}` } })).json()).data

  it('états : essai sans limite, version gratuite limitée, formule payée, démonstration', async () => {
    const essai = await get('essai@x.bf')
    expect(essai.state).toMatchObject({ status: 'essai' })
    expect(essai.state.trial_left).toBeGreaterThan(28)
    expect(essai.state.usage.every((u: any) => u.limit === null)).toBe(true)
    const gratuit = await get('ancienne@x.bf')
    expect(gratuit.state.status).toBe('gratuit')
    expect(gratuit.state.usage).toEqual([{ key: 'chantiers', label: 'chantiers', used: 3, limit: 3 }, { key: 'utilisateurs', label: 'utilisateurs', used: 2, limit: 2 }])
    expect(gratuit.can_buy).toBe(true)
    expect((await get('chef@x.bf')).can_buy).toBe(false)
    const payee = await get('payee@x.bf')
    expect(payee.state).toMatchObject({ status: 'active', plan: 'pro' })
    expect(payee.state.usage).toEqual([{ key: 'chantiers', label: 'chantiers', used: 3, limit: 10 }, { key: 'utilisateurs', label: 'utilisateurs', used: 1, limit: null }])
    expect((await get('demo')).state.status).toBe('demo')
    // Console injoignable (pas de jeton ici) : pas de formules en ligne
    expect(gratuit.online).toBe(false)
  })

  it('limites : création refusée au-delà, modification toujours possible', async () => {
    const lic = socle.licence!
    await expect(lic.enforce(users['ancienne@x.bf'], 'sites.save', { name: 'Nouveau' })).rejects.toThrow(/limitée à 3 chantiers/)
    await expect(lic.enforce(users['ancienne@x.bf'], 'sites.save', { id: 1, name: 'Renommé' })).resolves.toBeUndefined()
    await expect(lic.enforce(users['ancienne@x.bf'], 'team.save', { username: 'nouveau' })).rejects.toThrow(/utilisateurs/)
    await expect(lic.enforce(users['payee@x.bf'], 'sites.save', { name: 'Nouveau' })).resolves.toBeUndefined()
    await expect(lic.enforce(users['payee@x.bf'], 'team.save', { username: 'nouveau' })).resolves.toBeUndefined()
    await expect(lic.enforce(users['essai@x.bf'], 'sites.save', { name: 'Nouveau' })).resolves.toBeUndefined()
    await expect(lic.enforce(users['ancienne@x.bf'], 'autre.appel', {})).resolves.toBeUndefined()
    // Licence expirée : retour aux limites gratuites
    await db.query("UPDATE socle_licences SET ends_on = CURRENT_DATE - 1 WHERE space_id = '3'")
    expect((await get('payee@x.bf')).state.status).toBe('expiree')
    await expect(lic.enforce(users['payee@x.bf'], 'sites.save', { name: 'Nouveau' })).rejects.toThrow(/expiré/)
    await db.query("UPDATE socle_licences SET ends_on = CURRENT_DATE + 30 WHERE space_id = '3'")
  })

  it('paiement : réservé à l’administrateur, message clair sans console ; guide vu', async () => {
    const pay = async (who: string) => (await fetch(base + '/api/socle/licence/checkout', { method: 'POST', headers: { Authorization: `Bearer jeton-${users[who].id}`, 'Content-Type': 'application/json' }, body: '{"plan":"pro"}' })).json()
    expect((await pay('chef@x.bf')).error).toMatch(/administrateur/)
    expect((await pay('demo')).error).toMatch(/démonstration/)
    expect((await pay('ancienne@x.bf')).error).toMatch(/indisponible|IAM Technology|préparé/)
    expect((await get('payee@x.bf')).state.seen_guide).toBe(false)
    await fetch(base + '/api/socle/licence/guide', { method: 'POST', headers: { Authorization: `Bearer jeton-${users['payee@x.bf'].id}`, 'Content-Type': 'application/json' }, body: '{}' })
    expect((await get('payee@x.bf')).state.seen_guide).toBe(true)
    expect((await fetch(base + '/api/socle/licence')).status).toBe(401)
  })
})

describe('intégrations : clés d’API, webhooks signés, verrouillage sous condition', () => {
  const pg = new PGlite()
  const db = {
    query: async <T = any>(sql: string, params?: unknown[]) => (await pg.query<T>(sql, params as any[])).rows,
    one: async <T = any>(sql: string, params?: unknown[]) => (await pg.query<T>(sql, params as any[])).rows[0]
  }
  class AppError extends Error {}
  let server: Server
  let hook: Server
  let base = ''
  let hookUrl = ''
  const received: { headers: Record<string, any>; body: string }[] = []
  const journal: string[] = []
  const users: Record<string, { id: number; company_id: number; role: string; full_name: string; active: boolean }> = {}
  const as = (who: string) => ({ Authorization: `Bearer jeton-${users[who].id}`, 'Content-Type': 'application/json' })
  const post = async (path: string, body: unknown, who: string) => (await fetch(base + path, { method: 'POST', headers: as(who), body: JSON.stringify(body) })).json()
  const view = async (who: string) => (await (await fetch(base + '/api/socle/integrations', { headers: as(who) })).json()).data
  const v1 = async (name: string, key: string, body?: unknown) => {
    const r = await fetch(base + '/api/v1/' + name + (body === undefined ? '?limit=5' : ''), {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    return { status: r.status, json: await r.json() }
  }
  const until = async (test: () => boolean | Promise<boolean>) => {
    for (let i = 0; i < 100 && !(await test()); i++) await new Promise((r) => setTimeout(r, 30))
  }

  beforeAll(async () => {
    process.env.WEBHOOK_ALLOW_PRIVATE = '1'
    await pg.exec(`
      CREATE TABLE companies (id SERIAL PRIMARY KEY, name TEXT NOT NULL, demo BOOLEAN NOT NULL DEFAULT FALSE);
      CREATE TABLE users (id SERIAL PRIMARY KEY, company_id INT NOT NULL REFERENCES companies(id), full_name TEXT NOT NULL, role TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE);
      CREATE TABLE sites (id SERIAL PRIMARY KEY, company_id INT NOT NULL, name TEXT NOT NULL);
      INSERT INTO companies (name, demo) VALUES ('Bâtisseurs du Faso', FALSE), ('Autre entreprise', FALSE), ('Démo', TRUE);
      INSERT INTO users (company_id, full_name, role) VALUES (1, 'Awa Patronne', 'admin'), (1, 'Issa Associé', 'admin'), (1, 'Chef Moussa', 'chef'), (2, 'Autre Patron', 'admin'), (3, 'Visiteur', 'admin');
      INSERT INTO sites (company_id, name) VALUES (1, 'Villa Ouaga 2000'), (2, 'Ailleurs');
    `)
    for (const u of await db.query<any>('SELECT * FROM users')) users[u.full_name.split(' ')[0].toLowerCase()] = u
    const userById = async (id: number) => (await db.one<any>('SELECT * FROM users WHERE id = $1 AND active', [id])) ?? null
    const socle = createSocle({
      app: 'Test BTP',
      version: '1.0.0',
      db,
      resolveUser: async (t) => {
        const u = Object.values(users).find((x) => `jeton-${x.id}` === t)
        return u ? userById(u.id) : null
      },
      webPush: false,
      integrations: {
        spaces: 'companies',
        spaceOf: (u) => u.company_id,
        isAdmin: (u) => u.role === 'admin',
        userById,
        checkPassword: async (_u, p) => p === 'bon-mot-de-passe',
        adminIds: async (space) => (await db.query<{ id: number }>("SELECT id FROM users WHERE company_id = $1 AND role = 'admin' AND active", [Number(space)])).map((r) => r.id),
        log: async (u, details) => void journal.push(`${u.full_name} : ${details}`),
        events: { 'site.created': 'Chantier créé' },
        triggers: { 'sites.save': (a, d) => !a?.id && ['site.created', { id: d.id, name: a.name }] },
        examples: ['GET sites.list', 'POST sites.save {"name": "Villa"}'],
        dispatch: async (u, name, args: any) => {
          if (name === 'sites.list') return { ok: true, data: await db.query('SELECT id, name FROM sites WHERE company_id = $1 ORDER BY id', [u.company_id]) }
          if (name === 'sites.save') return { ok: true, data: await db.one('INSERT INTO sites (company_id, name) VALUES ($1, $2) RETURNING id', [u.company_id, String(args?.name ?? '')]) }
          return { ok: false, error: `Appel inconnu : ${name}` }
        },
        fail: (m) => {
          throw new AppError(m)
        }
      }
    })
    server = createServer(async (rq, rs) => {
      const path = new URL(rq.url ?? '/', 'http://x').pathname
      if (!(await socle(rq, rs, path))) {
        rs.writeHead(404)
        rs.end()
      }
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    // Logiciel tiers qui reçoit les webhooks
    hook = createServer(async (rq, rs) => {
      let body = ''
      for await (const c of rq) body += c
      received.push({ headers: rq.headers, body })
      rs.writeHead(200)
      rs.end('ok')
    })
    await new Promise<void>((r) => hook.listen(0, '127.0.0.1', r))
    hookUrl = `http://127.0.0.1:${(hook.address() as { port: number }).port}/iam`
  })
  afterAll(async () => {
    delete process.env.WEBHOOK_ALLOW_PRIVATE
    await new Promise((r) => server.close(r))
    await new Promise((r) => hook.close(r))
    await pg.close()
  })

  const keys: Record<string, string> = {}
  let secret = ''

  it('administrateur seulement, jamais depuis une démonstration ; clés montrées une fois', async () => {
    expect((await post('/api/socle/integrations/key', { name: 'Compta', scope: 'lecture' }, 'chef')).error).toMatch(/administrateur/)
    expect((await post('/api/socle/integrations/key', { name: 'Compta', scope: 'lecture' }, 'visiteur')).error).toMatch(/démonstration/)
    expect((await view('visiteur')).demo).toBe(true)
    const lecture = await post('/api/socle/integrations/key', { name: 'Compta', scope: 'lecture' }, 'awa')
    const ecriture = await post('/api/socle/integrations/key', { name: 'Site', scope: 'ecriture' }, 'awa')
    keys.lecture = lecture.data.key
    keys.ecriture = ecriture.data.key
    expect(keys.lecture).toMatch(/^iak_[\w-]{8}_[\w-]{20,}$/)
    const v = await view('awa')
    expect(v.keys.map((k: any) => [k.name, k.scope, k.created_by_name])).toEqual([
      ['Site', 'ecriture', 'Awa Patronne'],
      ['Compta', 'lecture', 'Awa Patronne']
    ])
    expect(JSON.stringify(v)).not.toContain(keys.lecture)
    expect(v.api).toBe(`${base}/api/v1/`)
    expect(v.lock).toMatchObject({ locked: false, editable: true })
    expect((await fetch(base + '/api/socle/integrations')).status).toBe(401)
  })

  it('API : lecture seule, écriture, appels interdits, données de l’espace seulement', async () => {
    const list = await v1('sites.list', keys.lecture)
    expect(list.status).toBe(200)
    expect(list.json.data).toEqual([{ id: 1, name: 'Villa Ouaga 2000' }])
    expect((await v1('sites.save', keys.lecture, { name: 'Interdit' })).status).toBe(403)
    expect((await v1('team.save', keys.ecriture, { full_name: 'Pirate' })).status).toBe(403)
    expect((await v1('sites.list', 'iak_aaaaaaaa_bbbbbbbbbbbbbbbbbbbbbbbbbbbb')).status).toBe(401)
    expect((await v1('autre.inconnu', keys.ecriture, {})).status).toBe(400)
    const saved = await v1('sites.save', keys.ecriture, { name: 'Immeuble R+4' })
    expect(saved.json).toMatchObject({ ok: true, data: { id: 3 } })
  })

  it('webhook signé : événement tiré de l’appel, signature vérifiable, envoi inscrit', async () => {
    const h = await post('/api/socle/integrations/webhook', { url: hookUrl, events: ['site.created', 'inconnu'] }, 'awa')
    expect(h.data.secret).toMatch(/^whsec_/)
    secret = h.data.secret
    expect((await post('/api/socle/integrations/webhook', { url: 'ftp://exemple.bf', events: ['site.created'] }, 'awa')).error).toMatch(/https/)
    await v1('sites.save', keys.ecriture, { name: 'École de Koudougou' })
    await until(() => received.length > 0)
    const r = received[0]
    expect(r.headers['x-iam-event']).toBe('site.created')
    expect(r.headers['x-iam-signature']).toBe('sha256=' + createHmac('sha256', secret).update(r.body).digest('hex'))
    expect(JSON.parse(r.body)).toMatchObject({ app: 'Test BTP', event: 'site.created', space_id: '1', data: { id: 4, name: 'École de Koudougou' } })
    await until(async () => (await view('awa')).webhooks[0].deliveries.length > 0)
    const v = await view('awa')
    expect(v.webhooks[0]).toMatchObject({ url: hookUrl, events: ['site.created'], active: true })
    expect(v.webhooks[0].deliveries[0]).toMatchObject({ event: 'site.created', status: 'ok', code: 200 })
    expect((await post('/api/socle/integrations/webhook/test', { id: v.webhooks[0].id }, 'awa')).data).toMatchObject({ status: 'ok', code: 200 })
    // Un autre espace ne voit rien de celui-ci
    expect((await view('autre')).webhooks).toEqual([])
    expect((await view('autre')).keys).toEqual([])
  })

  it('verrouillage : plus aucune modification, même le secret ; mot de passe exigé ; fenêtre de 15 minutes', async () => {
    const hookId = (await view('awa')).webhooks[0].id
    expect((await post('/api/socle/integrations/lock', {}, 'awa')).data).toMatchObject({ locked: true, editable: false })
    const v = await view('issa')
    expect(v.lock).toMatchObject({ locked: true, editable: false, locked_by_name: 'Awa Patronne' })
    const attempts: [string, unknown][] = [
      ['/api/socle/integrations/key', { name: 'Nouvelle', scope: 'ecriture' }],
      ['/api/socle/integrations/key/revoke', { id: 1 }],
      ['/api/socle/integrations/webhook', { url: hookUrl, events: ['*'] }],
      ['/api/socle/integrations/webhook/remove', { id: hookId }],
      ['/api/socle/integrations/webhook/secret', { id: hookId }]
    ]
    for (const [path, body] of attempts) expect((await post(path, body, 'issa')).error).toMatch(/verrouillées/)
    // Les clés continuent de servir pendant le verrouillage
    expect((await v1('sites.list', keys.lecture)).status).toBe(200)
    // Mauvais mot de passe : refusé et inscrit au journal
    expect((await post('/api/socle/integrations/unlock', { password: 'faux' }, 'issa')).error).toMatch(/incorrect/)
    expect(journal.some((j) => j.startsWith('Issa Associé') && /refusé/.test(j))).toBe(true)
    const open = await post('/api/socle/integrations/unlock', { password: 'bon-mot-de-passe' }, 'issa')
    expect(open.data).toMatchObject({ locked: true, editable: true })
    const minutes = (new Date(open.data.unlocked_until).getTime() - Date.now()) / 60_000
    expect(minutes).toBeGreaterThan(14)
    expect(minutes).toBeLessThanOrEqual(15.1)
    expect((await post('/api/socle/integrations/webhook/secret', { id: hookId }, 'issa')).data.secret).toBe(secret)
    // L'autre administrateur est prévenu
    const notified = async () => ((await db.one<{ n: number }>('SELECT COUNT(*)::int AS n FROM socle_notifications WHERE user_id = $1', [users.awa.id]))?.n ?? 0) > 0
    await until(notified)
    expect(await db.one<any>('SELECT title, body FROM socle_notifications WHERE user_id = $1', [users.awa.id])).toMatchObject({ title: 'Intégrations déverrouillées', body: expect.stringContaining('Issa Associé') })
    expect(journal).toContain('Issa Associé : Intégrations déverrouillées pour 15 minutes')
    // Fenêtre écoulée : verrouillé de nouveau sans rien faire
    await db.query("UPDATE socle_integration_lock SET unlocked_until = now() - interval '1 second'")
    expect((await view('issa')).lock).toMatchObject({ locked: true, editable: false, unlocked_until: null })
    expect((await post('/api/socle/integrations/key/revoke', { id: 1 }, 'issa')).error).toMatch(/verrouillées/)
  })

  it('déverrouillage : 5 essais par quart d’heure ; clé inutilisable si son auteur n’est plus administrateur', async () => {
    for (let i = 0; i < 5; i++) await post('/api/socle/integrations/unlock', { password: 'faux' }, 'awa')
    expect((await post('/api/socle/integrations/unlock', { password: 'bon-mot-de-passe' }, 'awa')).error).toMatch(/Trop d’essais/)
    expect((await post('/api/socle/integrations/unlock', { password: 'faux' }, 'chef')).error).toMatch(/administrateur/)
    await db.query("UPDATE users SET role = 'chef' WHERE id = $1", [users.awa.id])
    expect((await v1('sites.list', keys.lecture)).status).toBe(401)
    await db.query("UPDATE users SET role = 'admin' WHERE id = $1", [users.awa.id])
    expect((await v1('sites.list', keys.lecture)).status).toBe(200)
  })
})
