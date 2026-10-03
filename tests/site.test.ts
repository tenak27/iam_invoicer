import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../src/main/db'
import { createHandler } from '../src/server/app'

let db: Db
let server: Server
let base = ''
const dir = mkdtempSync(join(tmpdir(), 'iam-site-'))

beforeAll(async () => {
  db = await openDb({ mode: 'local' })
  for (const d of ['web', 'site', 'telechargements', 'web-secret']) mkdirSync(join(dir, d), { recursive: true })
  writeFileSync(join(dir, 'web', 'index.html'), '<div id="root"></div>APPLICATION')
  writeFileSync(join(dir, 'site', 'index.html'), 'SITE DE PRESENTATION')
  writeFileSync(join(dir, 'telechargements', 'IAM-INVOICER-Setup-0.4.0.exe'), 'binaire')
  writeFileSync(join(dir, 'telechargements', 'notes.txt'), 'pas un installateur')
  writeFileSync(join(dir, 'web-secret', 'x.txt'), 'secret')
  server = createServer(createHandler({ db, version: '0.4.0', webRoot: join(dir, 'web'), siteRoot: join(dir, 'site'), downloadsDir: join(dir, 'telechargements') }))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterAll(async () => {
  await new Promise((r) => server.close(r))
  await db.close()
})

describe('Site de présentation, application et téléchargements', () => {
  it('site à la racine, application sous /app/', async () => {
    expect(await (await fetch(base + '/')).text()).toBe('SITE DE PRESENTATION')
    expect(await (await fetch(base + '/app/')).text()).toContain('APPLICATION')
    expect(await (await fetch(base + '/app/factures/inconnue')).text()).toContain('APPLICATION') // application monopage
    const r = await fetch(base + '/app', { redirect: 'manual' })
    expect(r.status).toBe(301)
    expect(r.headers.get('location')).toBe('/app/')
  })

  it('installateurs listés et téléchargeables, rien d’autre', async () => {
    const list = await (await fetch(base + '/api/downloads')).json()
    expect(list.data.files).toEqual([expect.objectContaining({ name: 'IAM-INVOICER-Setup-0.4.0.exe', platform: 'windows', url: '/telechargements/IAM-INVOICER-Setup-0.4.0.exe' })])
    const dl = await fetch(base + '/telechargements/IAM-INVOICER-Setup-0.4.0.exe')
    expect(dl.headers.get('content-disposition')).toContain('attachment')
    expect(await dl.text()).toBe('binaire')
    expect((await fetch(base + '/telechargements/absent.exe')).status).toBe(404)
  })

  it('aucune sortie des dossiers publics', async () => {
    for (const p of ['/app/..%2Fweb-secret%2Fx.txt', '/telechargements/..%2Fweb-secret%2Fx.txt', '/..%2Fweb-secret%2Fx.txt']) {
      const r = await fetch(base + p)
      expect(await r.text()).not.toContain('secret')
    }
  })

  it('sans site, l’application reste à la racine (installations existantes)', async () => {
    const s2 = createServer(createHandler({ db, version: 't', webRoot: join(dir, 'web') }))
    await new Promise<void>((r) => s2.listen(0, '127.0.0.1', r))
    const b2 = `http://127.0.0.1:${(s2.address() as { port: number }).port}`
    expect(await (await fetch(b2 + '/')).text()).toContain('APPLICATION')
    await new Promise((r) => s2.close(r))
  })
})
