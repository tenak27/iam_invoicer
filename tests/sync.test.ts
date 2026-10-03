import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { RemoteBackend, type SavedLogin, type SessionVault } from '../src/main/backend'
import { openDb, type Db } from '../src/main/db'
import { createFileStore } from '../src/main/localStore'
import { createHandler } from '../src/server/app'

// Ordinateur relié au serveur en ligne : base locale, connexion et saisies sans réseau,
// envoi automatique au retour du serveur.

let db: Db
let server: Server
let port = 0
let url = ''
const dataDir = mkdtempSync(join(tmpdir(), 'iam-sync-'))

/** Coffre en mémoire (sur le poste réel, il est chiffré par le système). */
function memoryVault(): SessionVault {
  const all = new Map<string, SavedLogin>()
  return {
    get: (u, name) => all.get(`${u}|${name.toLowerCase()}`) ?? null,
    put: (l) => void all.set(`${l.url}|${l.username.toLowerCase()}`, l)
  }
}
const vault = memoryVault()

async function startServer() {
  server = createServer(createHandler({ db, version: 'test', webRoot: join(dataDir, 'web') }))
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r))
  port = (server.address() as { port: number }).port
  url = `http://127.0.0.1:${port}`
}

async function stopServer() {
  server.closeAllConnections()
  await new Promise((r) => server.close(r))
}

beforeAll(async () => {
  db = await openDb({ mode: 'local' })
  mkdirSync(join(dataDir, 'web'), { recursive: true })
  writeFileSync(join(dataDir, 'web', 'index.html'), '<!doctype html><title>IAM INVOICER</title>')
  await startServer()
  const admin = new RemoteBackend(url)
  await admin.setup({ company: { name: 'IAM Technology' }, username: 'admin', full_name: 'Admin', password: 'secret123' })
  await admin.call('parties.save', { kind: 'client', name: 'SONABEL' })
  await admin.call('products.save', { kind: 'prestation', name: 'Maintenance', sale_price: 50000, tva_rate: 18 })
})

afterAll(async () => {
  await stopServer().catch(() => {})
  await db?.close()
})

describe('Base locale et synchronisation (ordinateur ↔ serveur en ligne)', () => {
  let poste: RemoteBackend

  it('précharge les données de travail après une connexion en ligne', async () => {
    poste = new RemoteBackend(url, { dataDir, vault })
    await poste.login('admin', 'secret123')
    const loaded = await poste.prefetch()
    expect(loaded).toBeGreaterThan(10)
    expect(poste.state()).toMatchObject({ reachable: true, pending: 0, needsLogin: false })
    expect(poste.state().localBytes).toBeGreaterThan(100)
  })

  it('sans serveur : lectures depuis la base locale et saisies mises en attente', async () => {
    await stopServer()
    const clients = await poste.call('parties.options', { kind: 'client' })
    expect(clients.ok).toBe(true)
    expect((clients as any).data.map((c: any) => c.name)).toContain('SONABEL')
    expect((clients as any).offline).toBe(true)
    expect(poste.state().reachable).toBe(false)

    const r = await poste.call('parties.save', { kind: 'client', name: 'Client du marché de Rood Woko' })
    expect(r).toMatchObject({ ok: true, data: { queued: true } })
    expect(poste.state().pending).toBe(1)

    // Une lecture jamais consultée n'est pas inventée
    const unknown = await poste.call('documents.get', { id: 999 })
    expect(unknown.ok).toBe(false)
  })

  it('sans serveur : connexion sur la base locale avec le mot de passe, au redémarrage du poste', async () => {
    const restart = new RemoteBackend(url, { dataDir, vault })
    await expect(restart.login('admin', 'mauvais')).rejects.toThrow(/incorrect/)
    await expect(restart.login('inconnu', 'secret123')).rejects.toThrow(/connectez-vous d'abord une fois/)
    const user = await restart.login('admin', 'secret123')
    expect(user.username).toBe('admin')
    // La file d'attente du poste est retrouvée
    expect(restart.state().pending).toBe(1)
    await restart.close()
  })

  it('retour du serveur : envoi automatique, une seule fois', async () => {
    await startServer()
    const r = await poste.sync()
    expect(r).toEqual({ sent: 1, failed: 0 })
    expect(poste.state()).toMatchObject({ reachable: true, pending: 0 })
    expect(poste.state().lastSync).not.toBeNull()
    const again = await poste.sync()
    expect(again).toEqual({ sent: 0, failed: 0 })
    const found = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM parties WHERE name = 'Client du marché de Rood Woko'`)
    expect(found[0].n).toBe(1)
  })

  it('une saisie refusée par le serveur est signalée sans bloquer les suivantes', async () => {
    await stopServer()
    await poste.call('parties.save', { kind: 'client', name: '' }) // refusée : nom obligatoire
    await poste.call('parties.save', { kind: 'client', name: 'Pharmacie du Progrès' })
    expect(poste.state().pending).toBe(2)
    await startServer()
    expect(await poste.sync()).toEqual({ sent: 1, failed: 1 })
    expect(poste.state().failed).toHaveLength(1)
    poste.clearFailed()
    expect(poste.state().failed).toHaveLength(0)
  })

  it('déconnexion en ligne : jeton révoqué, connexion hors ligne encore possible', async () => {
    await poste.logout()
    expect(vault.get(url, 'admin')?.token).toBeNull()
    await stopServer()
    const offline = new RemoteBackend(url, { dataDir, vault })
    await offline.login('admin', 'secret123')
    expect(offline.state().needsLogin).toBe(true)
    await startServer()
  })
})

describe('Fichier de la base locale', () => {
  it('écrit la file d’attente immédiatement et conserve les données après réouverture', () => {
    const file = join(dataDir, 'store.json')
    const a = createFileStore(file)
    a.setItem('iam.offline.queue', '[1]')
    a.setItem('iam.cache.x', '"y"')
    const b = createFileStore(file)
    expect(b.getItem('iam.offline.queue')).toBe('[1]') // écrite tout de suite
    a.flush()
    const c = createFileStore(file)
    expect(c.getItem('iam.cache.x')).toBe('"y"')
    c.clearCache()
    expect(createFileStore(file).getItem('iam.cache.x')).toBeNull()
    expect(createFileStore(file).getItem('iam.offline.queue')).toBe('[1]')
  })
})
