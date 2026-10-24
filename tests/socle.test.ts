// Base commune des applications IAM (tools/socle) : installateurs proposés, envoi avec reprise,
// choix de la mise à jour pour l'appareil.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { classify, compareVersions, listDownloads } from '../tools/socle/server/downloads'
import { createSocle } from '../tools/socle/server'
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
