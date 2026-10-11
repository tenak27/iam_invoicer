import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DOC_LAYOUTS } from '../src/shared/domain'
import { compareVersions, pickDownload, releaseFiles } from '../src/shared/update'
import { openDb, type Db } from '../src/main/db'
import { sampleDocumentHtml } from '../src/main/pdf'
import { printable } from '../src/main/printing'
import { call } from '../src/main/router'
import type { Ctx, SessionUser } from '../src/main/services/context'
import { verifyDocument } from '../src/main/services/documents'
import { getSettings } from '../src/main/services/settings'
import { createHandler } from '../src/server/app'

let db: Db
let admin: Ctx
let server: Server
let base = ''
const ok = async <T = any>(ctx: Ctx, name: string, args?: unknown): Promise<T> => {
  const r = await call(ctx, name, args)
  if (!r.ok) throw new Error(r.error)
  return r.data as T
}

beforeAll(async () => {
  db = await openDb({ mode: 'local' })
  const user = await ok<SessionUser>({ db, user: null }, 'auth.setup', { company: { name: 'IAM Technology', doc_color: '#178a55' }, username: 'admin', full_name: 'Admin', password: 'secret123' })
  admin = { db, user }
  server = createServer(createHandler({ db, version: 't' }))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterAll(async () => {
  await new Promise((r) => server.close(r))
  await db.close()
})

describe('Modèles de documents', () => {
  it('six modèles, même contenu, couleurs imprimées telles quelles', async () => {
    const company = await getSettings(db)
    expect(DOC_LAYOUTS.map((l) => l.id)).toEqual(['moderne', 'bandeau', 'elegant', 'classique', 'minimal', 'compact'])
    for (const l of DOC_LAYOUTS) {
      const html = sampleDocumentHtml(company, l.id)
      expect(html).toContain(`<body class="tpl-${l.id}">`)
      // Sans cette règle, les navigateurs retirent les aplats à l'impression (en-têtes illisibles)
      expect(html).toContain('print-color-adjust: exact')
      expect(html).toContain('FAC-2026-0042')
      expect(html).toContain('Caméra dôme 4K 12 MP')
      expect(html).toContain('#178a55')
      expect(html).toContain('Document authentique')
    }
    // Couleur en cours de choix, modèle inconnu ramené au modèle par défaut
    expect(sampleDocumentHtml(company, 'bandeau', '#be123c')).toContain('#be123c')
    expect(sampleDocumentHtml(company, 'inconnu' as any)).toContain('class="tpl-moderne"')
    expect((await ok(admin, 'settings.docSample', { layout: 'elegant', color: '#0b4f8a', doc_line_numbers: false })).html).not.toContain('<th class="n">')
  })
})

describe('QR code d’authenticité', () => {
  let facId = 0
  let code = ''

  it('code attribué à la validation, absent d’un brouillon', async () => {
    const client = await ok(admin, 'parties.save', { kind: 'client', name: 'Vista Énergie' })
    const body = { type: 'FAC', party_id: client.id, date: '2026-10-01', taxes: [], lines: [{ description: 'Abonnement', quantity: 2, unit_price: 63800, tva_rate: 18 }] }
    const draft = await ok(admin, 'documents.save', body)
    expect((await printable(admin, draft.id, 'a4', false)).html).not.toContain('Document authentique')
    facId = (await ok(admin, 'documents.save', { ...body, validate: true })).id
    const row = await db.one<{ auth_code: string }>('SELECT auth_code FROM documents WHERE id = $1', [facId])
    expect(row!.auth_code).toMatch(/^[A-HJ-NP-Z2-9]{16}$/)
    code = row!.auth_code
    expect((await db.one<{ auth_code: string | null }>('SELECT auth_code FROM documents WHERE id = $1', [draft.id]))!.auth_code).toBeNull()
  })

  it('sur le serveur : le QR mène à la page de vérification ; sans serveur : il porte les informations', async () => {
    const pretty = code.match(/.{4}/g)!.join('-')
    const online = await printable({ ...admin, origin: 'https://facturation.exemple.bf/t/vista' }, facId, 'a4', false)
    expect(online.html).toContain(pretty)
    expect(online.html).toContain('facturation.exemple.bf/t/vista/verify')
    const local = await printable(admin, facId, 'a4', false)
    expect(local.html).toContain(pretty)
    expect(local.html).toContain('Scannez ce code pour lire')
    expect((await printable(admin, facId, 'ticket', false)).html).toContain(`Authenticité : ${pretty}`)
    // Désactivable dans les paramètres
    await ok(admin, 'settings.save', { doc_show_qr: false })
    expect((await printable(admin, facId, 'a4', false)).html).not.toContain('Document authentique')
    await ok(admin, 'settings.save', { doc_show_qr: true })
  })

  it('vérification : ce que la société a enregistré, rien pour un code inconnu', async () => {
    const v = await verifyDocument(db, code.toLowerCase().match(/.{4}/g)!.join(' '))
    expect(v).toMatchObject({ label: 'Facture', number: expect.stringMatching(/^FAC-2026-/), cancelled: false, date: '2026-10-01', total_ttc: 150568, party: 'Vista Énergie', settled: false })
    expect(await verifyDocument(db, 'AAAA-BBBB-CCCC-DDDD')).toBeNull()
    expect(await verifyDocument(db, '')).toBeNull()
    await ok(admin, 'payments.add', { document_id: facId, amount: 150568, method: 'Virement' })
    expect((await verifyDocument(db, code))!.settled).toBe(true)
  })

  it('page publique : authentique, inconnu, saisie du code, essais limités', async () => {
    const page = await (await fetch(`${base}/verify/${code}`)).text()
    expect(page).toContain('Document authentique')
    expect(page).toContain('Vista Énergie')
    expect(page).toContain('150')
    expect(await (await fetch(`${base}/verify?code=${code.toLowerCase()}`)).text()).toContain('Document authentique')
    expect(await (await fetch(`${base}/verify`)).text()).toContain('Vérifier un document')
    const unknown = await fetch(`${base}/verify/AAAABBBBCCCCDDDD`)
    expect(await unknown.text()).toContain('Code inconnu')
    for (let i = 0; i < 10; i++) await fetch(`${base}/verify/AAAABBBBCCCCDDD${'23456789AB'[i]}`)
    expect((await fetch(`${base}/verify/${code}`)).status).toBe(429)
  })
})

describe('Mise à jour disponible', () => {
  it('comparaison de versions', () => {
    expect(compareVersions('0.7.0', '0.6.3')).toBeGreaterThan(0)
    expect(compareVersions('v0.10.0', '0.9.9')).toBeGreaterThan(0)
    expect(compareVersions('0.6.3', '0.6.3')).toBe(0)
    expect(compareVersions('0.6.3', '0.7.0')).toBeLessThan(0)
    expect(compareVersions('', '0.1.0')).toBeLessThan(0)
  })

  it('installateur de l’appareil', () => {
    const files = releaseFiles(['IAM-INVOICER-Setup-0.7.0.exe', 'IAM-INVOICER-0.7.0-arm64.dmg', 'IAM-INVOICER-0.7.0-x64.dmg', 'IAM-INVOICER-0.7.0-arm64-macos-ancien.dmg', 'IAM-INVOICER-0.7.0-android.apk', 'SHA256SUMS.txt'].map((name) => ({ name, browser_download_url: `https://x/${name}` })))
    expect(files).toHaveLength(5)
    expect(pickDownload(files, { platform: 'win32', arch: 'x64' })!.name).toBe('IAM-INVOICER-Setup-0.7.0.exe')
    expect(pickDownload(files, { platform: 'darwin', arch: 'arm64' })!.name).toBe('IAM-INVOICER-0.7.0-arm64.dmg')
    expect(pickDownload(files, { platform: 'darwin', arch: 'arm64', legacy: true })!.name).toBe('IAM-INVOICER-0.7.0-arm64-macos-ancien.dmg')
    expect(pickDownload(files, { platform: 'darwin', arch: 'x64', legacy: true })!.name).toBe('IAM-INVOICER-0.7.0-x64.dmg')
    expect(pickDownload(files, { platform: 'android' })!.name).toBe('IAM-INVOICER-0.7.0-android.apk')
    expect(pickDownload(files, { platform: 'linux' })).toBeNull()
  })
})
