// Base commune des applications IAM (tools/socle) : installateurs proposés, envoi avec reprise,
// choix de la mise à jour pour l'appareil.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { classify, compareVersions, listDownloads } from '../tools/socle/server/downloads'
import { createSocle } from '../tools/socle/server'

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' } }))
const { pickFile } = await import('../tools/socle/renderer/update')

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
