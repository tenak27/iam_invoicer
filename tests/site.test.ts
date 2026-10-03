import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../src/main/db'
import { createHandler } from '../src/server/app'
import { classify } from '../src/server/downloads'

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
  for (const f of ['IAM-INVOICER-0.5.1-arm64.dmg', 'IAM-INVOICER-0.5.1-x64.dmg', 'IAM-INVOICER-0.5.1-android.apk', 'IAM-INVOICER-0.5.1-ios.ipa', 'IAM-INVOICER-0.5.1-ios-unsigned.ipa'])
    writeFileSync(join(dir, 'telechargements', f), 'binaire ' + f)
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
    const files = list.data.files as { name: string; platform: string; version: string; sha256: string }[]
    expect(files.map((f) => f.name)).not.toContain('notes.txt')
    expect(files).toContainEqual(expect.objectContaining({ name: 'IAM-INVOICER-Setup-0.4.0.exe', platform: 'windows', url: '/telechargements/IAM-INVOICER-Setup-0.4.0.exe' }))
    // Plus récente version d'abord
    expect(files[0].version).toBe('0.5.1')
    expect(files.at(-1)!.name).toBe('IAM-INVOICER-Setup-0.4.0.exe')
    const apk = files.find((f) => f.platform === 'android')!
    expect(apk.sha256).toBe(createHash('sha256').update('binaire ' + apk.name).digest('hex'))
    const dl = await fetch(base + '/telechargements/IAM-INVOICER-Setup-0.4.0.exe')
    expect(dl.headers.get('content-disposition')).toContain('attachment')
    expect(await dl.text()).toBe('binaire')
    expect((await fetch(base + '/telechargements/absent.exe')).status).toBe(404)
  })

  it('classement par plateforme, architecture et signature', () => {
    expect(classify('IAM-INVOICER-0.5.1-arm64.dmg')).toMatchObject({ platform: 'macos', arch: 'arm64', kind: 'installer', version: '0.5.1' })
    expect(classify('IAM-INVOICER-0.5.1-x64.dmg')).toMatchObject({ platform: 'macos', arch: 'x64' })
    expect(classify('IAM-INVOICER-0.5.1-android.apk')).toMatchObject({ platform: 'android', kind: 'apk' })
    expect(classify('IAM-INVOICER-0.5.1-ios.ipa')).toMatchObject({ platform: 'ios', kind: 'ipa', signed: true })
    expect(classify('IAM-INVOICER-0.5.1-ios-unsigned.ipa')).toMatchObject({ platform: 'ios', signed: false })
    expect(classify('IAM-INVOICER-Setup-0.5.0.zip')).toMatchObject({ platform: 'windows', kind: 'portable' })
    expect(classify('IAM-INVOICER-0.5.0-mac.zip')).toMatchObject({ platform: 'macos' })
    expect(classify('notes.txt')).toBeNull()
  })

  it('types de fichiers reconnus par Android et macOS', async () => {
    expect((await fetch(base + '/telechargements/IAM-INVOICER-0.5.1-android.apk')).headers.get('content-type')).toBe('application/vnd.android.package-archive')
    expect((await fetch(base + '/telechargements/IAM-INVOICER-0.5.1-arm64.dmg')).headers.get('content-type')).toBe('application/x-apple-diskimage')
  })

  it('manifeste d’installation iPhone pour un IPA signé uniquement', async () => {
    const r = await fetch(base + '/api/ios-manifest/' + encodeURIComponent('IAM-INVOICER-0.5.1-ios.ipa') + '.plist', { headers: { 'x-forwarded-proto': 'https' } })
    expect(r.status).toBe(200)
    const plist = await r.text()
    expect(plist).toContain('<string>https://127.0.0.1:')
    expect(plist).toContain('/telechargements/IAM-INVOICER-0.5.1-ios.ipa</string>')
    expect(plist).toContain('<string>com.iamtechnology.invoicer</string>')
    expect(plist).toContain('<key>bundle-version</key><string>0.5.1</string>')
    expect((await fetch(base + '/api/ios-manifest/' + encodeURIComponent('IAM-INVOICER-0.5.1-ios-unsigned.ipa') + '.plist')).status).toBe(404)
    expect((await fetch(base + '/api/ios-manifest/absent.ipa.plist')).status).toBe(404)
    expect((await fetch(base + '/api/ios-manifest/' + encodeURIComponent('IAM-INVOICER-0.5.1-ios.ipa') + '.plist', { headers: { 'x-forwarded-host': 'a"><x' } })).status).toBe(400)
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
