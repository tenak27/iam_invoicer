// Base commune des applications IAM (tools/socle) : installateurs proposés, envoi avec reprise,
// choix de la mise à jour pour l'appareil.
import { randomBytes } from 'node:crypto'
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
