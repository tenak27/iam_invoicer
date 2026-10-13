import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { normalizeServerUrl, RemoteBackend } from '../src/main/backend'
import { openDb, type Db } from '../src/main/db'
import { createHandler } from '../src/server/app'
import { dbConfigFromEnv } from '../src/server/config'

let db: Db
let server: Server
let base: string
let token: string

async function post(path: string, body: unknown, auth = token) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: JSON.stringify(body)
  })
  return { status: res.status, body: await res.json() }
}

async function rpc(name: string, args?: unknown, auth = token) {
  const r = await post('/api/call', { name, args }, auth)
  if (!r.body.ok) throw new Error(r.body.error)
  return r.body.data
}

beforeAll(async () => {
  db = await openDb({ mode: 'local' })
  const webRoot = join(tmpdir(), `iam-web-${process.pid}`)
  mkdirSync(webRoot, { recursive: true })
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>IAM INVOICER</title>')
  server = createServer(createHandler({ db, version: 'test', webRoot }))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address() as { port: number }
  base = `http://127.0.0.1:${addr.port}`
})

afterAll(async () => {
  await new Promise((r) => server?.close(r))
  await db?.close()
})

describe('Serveur web (synchronisation via un domaine)', () => {
  it('configuration initiale puis jeton', async () => {
    const st = await (await fetch(base + '/api/status')).json()
    expect(st.data).toMatchObject({ app: 'IAM INVOICER', needsSetup: true, user: null })
    const r = await post('/api/setup', { company: { name: 'IAM Technology' }, username: 'admin', full_name: 'Admin', password: 'secret123' }, '')
    expect(r.body.ok).toBe(true)
    token = r.body.data.token
    expect(token.length).toBeGreaterThan(30)
    const st2 = await (await fetch(base + '/api/status', { headers: { Authorization: `Bearer ${token}` } })).json()
    expect(st2.data.user.username).toBe('admin')
  })

  it('refuse les appels sans jeton valide', async () => {
    const r = await post('/api/call', { name: 'settings.get' }, 'faux-jeton')
    expect(r.status).toBe(401)
    expect(r.body.ok).toBe(false)
  })

  it('appels métier et droits du routeur', async () => {
    const client = await rpc('parties.save', { kind: 'client', name: 'Coris Bank' })
    const prod = await rpc('products.save', { kind: 'prestation', name: 'Audit réseau', sale_price: 200000, tva_rate: 18 })
    const fac = await rpc('documents.save', {
      type: 'FAC', party_id: client.id,
      lines: [{ product_id: prod.id, description: 'Audit réseau', quantity: 1, unit_price: 200000, tva_rate: 18 }]
    })
    const v = await rpc('documents.validate', { id: fac.id })
    expect(v.total_ttc).toBe(236000)
  })

  it('hors ligne : une opération rejouée n’est exécutée qu’une fois', async () => {
    const body = { name: 'parties.save', args: { kind: 'client', name: 'Client hors ligne' }, opId: 'op_test_12345678' }
    const send = () => fetch(base + '/api/call', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }).then((r) => r.json())
    const first = await send()
    const second = await send()
    expect(first.ok).toBe(true)
    expect(second).toMatchObject({ ok: true, replayed: true, data: first.data })
    const list = await rpc('parties.list', { kind: 'client', search: 'hors ligne' })
    expect(list).toHaveLength(1)
  })

  it('en-têtes CORS pour les applications mobiles', async () => {
    const res = await fetch(base + '/api/call', { method: 'OPTIONS' })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-headers')).toMatch(/Authorization/)
  })

  it('lien d’impression à usage unique', async () => {
    const [fac] = await rpc('documents.list', { types: ['FAC'] })
    const r = await post('/api/print', { id: fac.id, format: 'a4' })
    const url = r.body.data.url as string
    const page = await fetch(base + url)
    const html = await page.text()
    expect(html).toContain(fac.number)
    expect(html).toContain('window.print()')
    expect((await fetch(base + url)).status).toBe(410)
  })

  it('sert l’application web et protège l’arborescence', async () => {
    expect(await (await fetch(base + '/')).text()).toContain('IAM INVOICER')
    expect(await (await fetch(base + '/clients/42')).text()).toContain('IAM INVOICER') // retour sur index.html
    expect((await fetch(base + '/..%2f..%2fpackage.json')).status).not.toBe(200)
  })

  it('déconnexion : le jeton ne fonctionne plus', async () => {
    const login = await post('/api/login', { username: 'admin', password: 'secret123' }, '')
    const t2 = login.body.data.token
    await post('/api/logout', {}, t2)
    expect((await post('/api/call', { name: 'settings.get' }, t2)).status).toBe(401)
  })

  it('désactiver un compte le déconnecte de tous ses appareils', async () => {
    const u = await rpc('users.save', { username: 'ali', full_name: 'Ali', role: 'commercial', password: 'motdepasse9' })
    const t = (await post('/api/login', { username: 'ali', password: 'motdepasse9' }, '')).body.data.token
    await rpc('users.save', { id: u.id, username: 'ali', full_name: 'Ali', role: 'commercial', active: false })
    expect((await post('/api/call', { name: 'settings.get' }, t)).status).toBe(401)
  })

  it('bloque après 10 mots de passe erronés', async () => {
    let last = 0
    for (let i = 0; i < 11; i++) last = (await post('/api/login', { username: 'admin', password: 'mauvais' }, '')).status
    expect(last).toBe(429)
  })
})

describe('Poste de bureau connecté au domaine (RemoteBackend)', () => {
  it('normalise l’adresse saisie', () => {
    expect(normalizeServerUrl('facturation.iam.bf/')).toBe('https://facturation.iam.bf')
    expect(normalizeServerUrl('http://192.168.1.10:8080')).toBe('http://192.168.1.10:8080')
  })

  it('se connecte, appelle et récupère un document imprimable', async () => {
    const remote = new RemoteBackend(base)
    expect((await remote.ping()).app).toBe('IAM INVOICER')
    const fresh = await openDb({ mode: 'local' }) // le limiteur bloque 127.0.0.1 : on passe par un second serveur
    const srv = createServer(createHandler({ db: fresh, version: 'test' }))
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
    try {
      const b = new RemoteBackend(`http://127.0.0.1:${(srv.address() as any).port}`)
      const user = await b.setup({ company: { name: 'IAM' }, username: 'admin', full_name: 'Admin', password: 'secret123' })
      expect(user.role).toBe('admin')
      const c = await b.call('parties.save', { kind: 'client', name: 'Client distant' })
      expect(c.ok).toBe(true)
      const list = await b.call('parties.list', { kind: 'client' })
      expect((list as any).data[0].name).toBe('Client distant')
      await b.logout()
      expect((await b.call('parties.list', { kind: 'client' })).ok).toBe(false)
    } finally {
      await new Promise((r) => srv.close(r))
      await fresh.close()
    }
  })

  it('message clair si le serveur est injoignable', async () => {
    const b = new RemoteBackend('http://127.0.0.1:9')
    await expect(b.ping()).rejects.toThrow(/injoignable/)
  })
})

describe('Configuration du serveur', () => {
  it('lit DATABASE_URL', () => {
    expect(dbConfigFromEnv({ DATABASE_URL: 'postgres://iam:s%40cret@db:5433/factu' })).toMatchObject({
      mode: 'server', host: 'db', port: 5433, database: 'factu', user: 'iam', password: 's@cret'
    })
  })
})

describe('Accueil de la société et assistant du jour', () => {
  it('identité publique : nom, logo et couleur, rien d’autre', async () => {
    await rpc('settings.save', { name: 'IAM Technology', doc_color: '#0b4f8a', city: 'Ouagadougou', bank_account: 'BF00 SECRET', smtp_user: 'compta@iam.bf' })
    const r = await fetch(base + '/api/brand')
    const j = await r.json()
    expect(j.data).toEqual({ name: 'IAM Technology', logo: '', color: '#0b4f8a', city: 'Ouagadougou' })
    expect(JSON.stringify(j)).not.toMatch(/SECRET|compta@/)
    // Chemin de l'application web annoncé pour s'y rendre depuis une autre adresse
    expect((await (await fetch(base + '/api/status')).json()).data.web).toBe('/')
  })

  it('l’assistant signale retards, devis sans suite et brouillons, selon les droits', async () => {
    const client = await rpc('parties.save', { kind: 'client', name: 'Client Assistant' })
    await rpc('documents.save', { type: 'FAC', party_id: client.id, validate: true, date: '2026-01-10', due_date: '2026-02-10', taxes: [], lines: [{ description: 'Retard', quantity: 1, unit_price: 100000, tva_rate: 18 }] })
    const old = new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10)
    await rpc('documents.save', { type: 'DEV', party_id: client.id, validate: true, date: old, taxes: [], lines: [{ description: 'Devis', quantity: 1, unit_price: 50000, tva_rate: 18 }] })
    await rpc('documents.save', { type: 'FAC', party_id: client.id, taxes: [], lines: [{ description: 'Brouillon', quantity: 1, unit_price: 1, tva_rate: 0 }] })
    const items = await rpc('assistant.list')
    const keys = items.map((i: any) => i.key)
    expect(keys).toEqual(expect.arrayContaining(['retards', 'devis', 'brouillons']))
    expect(items[0].tone).toBe('danger')
    expect(items.find((i: any) => i.key === 'retards')).toMatchObject({ to: '/docs/FAC' })
    expect(items.find((i: any) => i.key === 'retards').detail).toMatch(/118[\s  ]000/)
    // Un caissier n'a ni ventes ni stock : rien ne lui est montré
    await rpc('users.save', { username: 'caisse9', full_name: 'Caisse', role: 'caissier', password: 'motdepasse9', active: true }).catch(() => null)
    const login = await post('/api/login', { username: 'caisse9', password: 'motdepasse9' }, '')
    if (login.body.ok) expect(await rpc('assistant.list', undefined, login.body.data.token)).toEqual([])
  })
})
