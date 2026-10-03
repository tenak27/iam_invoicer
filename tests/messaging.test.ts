import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../src/main/db'
import { call } from '../src/main/router'
import type { Ctx, SessionUser } from '../src/main/services/context'
import { normalizePhone, renderTemplate, setHttpFetch, setMailTransportFactory } from '../src/main/services/messaging'
import { createHandler } from '../src/server/app'

let db: Db
let admin: Ctx
let caissier: Ctx
let invoiceId: number
let devisId: number
const sentMails: any[] = []
const httpCalls: { url: string; init?: any }[] = []
let mailFails = false

async function ok<T = any>(ctx: Ctx, name: string, args?: unknown): Promise<T> {
  const r = await call(ctx, name, args)
  if (!r.ok) throw new Error(r.error)
  return r.data as T
}
async function err(ctx: Ctx, name: string, args?: unknown): Promise<string> {
  const r = await call(ctx, name, args)
  if (r.ok) throw new Error(`${name} aurait dû échouer`)
  return r.error
}

// Signature simulée : une image PNG en base64 assez longue pour ne pas être vide.
const SIGNATURE = 'data:image/png;base64,' + 'iVBORw0KGgo'.padEnd(2400, 'A')

beforeAll(async () => {
  setMailTransportFactory(() => ({
    sendMail: async (msg: any) => {
      if (mailFails) throw new Error('Connexion SMTP refusée')
      sentMails.push(msg)
      return { messageId: 'x' }
    }
  }))
  setHttpFetch((async (url: any, init?: any) => {
    httpCalls.push({ url: String(url), init })
    if (String(url).includes('oauth')) return new Response(JSON.stringify({ access_token: 'jeton-orange' }), { status: 200 })
    return new Response('{"ok":true}', { status: 201 })
  }) as any)

  db = await openDb({ mode: 'local' })
  const user = await ok<SessionUser>({ db, user: null }, 'auth.setup', {
    company: { name: 'IAM Technology', phone: '+226 25 00 00 00' }, username: 'admin', full_name: 'Ibrahim Konaté', password: 'secret123'
  })
  admin = { db, user }
  await ok(admin, 'users.save', { username: 'kadi', full_name: 'Kadi', role: 'caissier', password: 'caisse123' })
  const { login } = await import('../src/main/services/auth')
  caissier = { db, user: await login(db, 'kadi', 'caisse123') }

  const client = await ok(admin, 'parties.save', { kind: 'client', name: 'SONABEL', contact: 'M. Ouédraogo', email: 'compta@sonabel.bf', phone: '70 11 22 33', payment_terms: 0 })
  const fac = await ok(admin, 'documents.save', {
    type: 'FAC', party_id: client.id, date: '2026-01-10', due_date: '2026-01-20',
    lines: [{ description: 'Maintenance réseau', quantity: 1, unit_price: 100000, tva_rate: 18 }]
  })
  await ok(admin, 'documents.validate', { id: fac.id })
  invoiceId = fac.id
  const dev = await ok(admin, 'documents.save', {
    type: 'DEV', party_id: client.id, lines: [{ description: 'Caméras IP', quantity: 4, unit_price: 65000, tva_rate: 18 }]
  })
  await ok(admin, 'documents.validate', { id: dev.id })
  devisId = dev.id
})

afterAll(async () => {
  await db?.close()
})

describe('Modèles de messages', () => {
  it('six modèles par défaut, variables remplacées', async () => {
    const t = await ok<any[]>(admin, 'messages.templates')
    expect(t.map((x) => x.code).sort()).toEqual(['doc_email', 'doc_sms', 'reminder_email', 'reminder_sms', 'sign_email', 'sign_sms'])
    expect(renderTemplate('Bonjour {client}, {inconnu}', { client: 'Awa' })).toBe('Bonjour Awa, {inconnu}')
    const p = await ok(admin, 'messages.preview', { code: 'reminder_email', documentId: invoiceId })
    expect(p.to).toBe('compta@sonabel.bf')
    expect(p.subject).toMatch(/^Rappel : facture FAC-2026-0001 échue le 20\/01\/2026$/)
    expect(p.body).toContain('M. Ouédraogo')
    expect(p.body).toContain('118 000 FCFA')
  })

  it('modification réservée aux paramètres, SMS limité en longueur', async () => {
    const [sms] = (await ok<any[]>(admin, 'messages.templates')).filter((x) => x.code === 'doc_sms')
    expect(await err(admin, 'messages.saveTemplate', { id: sms.id, body: 'x'.repeat(500) })).toMatch(/480/)
    await ok(admin, 'messages.saveTemplate', { id: sms.id, body: '{societe} : {type_min} {numero} prêt.' })
    expect(await err(caissier, 'messages.templates')).toMatch(/droits/)
  })
})

describe('Paramètres secrets', () => {
  it('le mot de passe SMTP n’est jamais renvoyé', async () => {
    await ok(admin, 'settings.save', { smtp_host: 'smtp.example.bf', smtp_user: 'factu@iam.bf', smtp_from_email: 'factu@iam.bf', smtp_from_name: 'IAM Technology' })
    await ok(admin, 'settings.saveSecrets', { smtp_password: 'TresSecret!' })
    const s = await ok(admin, 'settings.get')
    expect(JSON.stringify(s)).not.toContain('TresSecret')
    expect(await ok(admin, 'settings.secrets')).toMatchObject({ smtp_password: true, sms_secret: false })
  })
})

describe('E-mail', () => {
  it('envoie un document avec pièce jointe et journalise', async () => {
    await ok(admin, 'messages.sendDocument', { documentId: invoiceId, to: 'compta@sonabel.bf', subject: 'Votre facture', body: 'Bonjour,\nCi-joint.' })
    const m = sentMails.at(-1)
    expect(m.from).toBe('"IAM Technology" <factu@iam.bf>')
    expect(m.attachments[0].filename).toMatch(/^FAC-2026-0001 - SONABEL\.html$/)
    expect(m.attachments[0].content.toString()).toContain('FAC-2026-0001')
    const [log] = await ok<any[]>(admin, 'messages.log', {})
    expect(log).toMatchObject({ channel: 'email', status: 'envoye', kind: 'document', document_number: 'FAC-2026-0001', party_name: 'SONABEL' })
  })

  it('pièce jointe PDF fournie par le poste de bureau', async () => {
    await ok(admin, 'messages.sendDocument', { documentId: invoiceId, to: 'a@b.bf', subject: 'PDF', body: '.', pdf: Buffer.from('%PDF-1.4').toString('base64') })
    expect(sentMails.at(-1).attachments[0]).toMatchObject({ filename: 'FAC-2026-0001 - SONABEL.pdf', contentType: 'application/pdf' })
  })

  it('adresse invalide refusée, échec SMTP journalisé', async () => {
    expect(await err(admin, 'messages.sendEmail', { to: 'pas-une-adresse', subject: 'x', body: 'y' })).toMatch(/invalide/)
    mailFails = true
    expect(await err(admin, 'messages.sendEmail', { to: 'x@y.bf', subject: 'x', body: 'y' })).toMatch(/Connexion SMTP refusée/)
    mailFails = false
    const [log] = await ok<any[]>(admin, 'messages.log', { channel: 'email' })
    expect(log).toMatchObject({ status: 'echec', error: 'Connexion SMTP refusée' })
  })
})

describe('SMS', () => {
  it('numéros burkinabè normalisés', () => {
    expect(normalizePhone('70 11 22 33')).toBe('+22670112233')
    expect(normalizePhone('0022670112233')).toBe('+22670112233')
    expect(() => normalizePhone('123')).toThrow(/invalide/)
  })

  it('passerelle HTTP générique', async () => {
    await ok(admin, 'settings.save', { sms_provider: 'http', sms_sender: 'IAM', sms_http_url: 'https://sms.example.bf/send?to={to}&text={message}&from={sender}&key={key}' })
    await ok(admin, 'settings.saveSecrets', { sms_secret: 'cle123' })
    await ok(admin, 'messages.remind', { documentId: invoiceId, channel: 'sms' })
    const url = new URL(httpCalls.at(-1)!.url)
    expect(url.searchParams.get('to')).toBe('+22670112233')
    expect(url.searchParams.get('key')).toBe('cle123')
    expect(url.searchParams.get('text')).toContain('FAC-2026-0001')
  })

  it('API Orange : jeton puis envoi', async () => {
    await ok(admin, 'settings.save', { sms_provider: 'orange', sms_account: 'client-id', sms_sender: 'tel:+22600000000' })
    httpCalls.length = 0
    await ok(admin, 'messages.sendSms', { to: '76 00 00 00', body: 'Bonjour' })
    expect(httpCalls[0].url).toBe('https://api.orange.com/oauth/v3/token')
    expect(httpCalls[1].url).toContain('/outbound/tel%3A%2B22600000000/requests')
    expect(JSON.parse(httpCalls[1].init.body).outboundSMSMessageRequest.address).toBe('tel:+22676000000')
  })

  it('relance groupée des factures échues', async () => {
    const r = await ok(admin, 'messages.remindAll', { channel: 'email' })
    expect(r).toEqual({ sent: 1, failed: [] })
    expect(sentMails.at(-1).subject).toMatch(/Rappel/)
  })
})

describe('Signatures', () => {
  it('signature sur place avec empreinte du contenu', async () => {
    expect(await err(admin, 'signatures.signOnSite', { documentId: devisId, name: 'Awa', image: 'data:image/png;base64,AAAA' })).toMatch(/signer dans le cadre/)
    await ok(admin, 'signatures.signOnSite', { documentId: devisId, name: 'Awa Traoré', image: SIGNATURE })
    const l = await ok(admin, 'signatures.list', { documentId: devisId })
    expect(l.signatures).toHaveLength(1)
    expect(l.signatures[0]).toMatchObject({ signer_name: 'Awa Traoré', method: 'sur_place', valid: true })
    expect(l.signatures[0].content_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('un brouillon ne se signe pas', async () => {
    const [c] = await ok<any[]>(admin, 'parties.list', { kind: 'client' })
    const d = await ok(admin, 'documents.save', { type: 'DEV', party_id: c.id, lines: [{ description: 'x', quantity: 1, unit_price: 1, tva_rate: 0 }] })
    expect(await err(admin, 'signatures.signOnSite', { documentId: d.id, name: 'Awa', image: SIGNATURE })).toMatch(/validé/)
  })

  it('demande à distance : adresse publique requise', async () => {
    expect(await err(admin, 'signatures.request', { documentId: devisId })).toMatch(/adresse publique/)
  })

  describe('signature à distance par le serveur', () => {
    let server: Server
    let base: string
    beforeAll(async () => {
      server = createServer(createHandler({ db, version: 'test' }))
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
      base = `http://127.0.0.1:${(server.address() as any).port}`
    })
    afterAll(async () => {
      await new Promise((r) => server.close(r))
    })

    it('lien, page publique, signature unique', async () => {
      const { url } = await ok(admin, 'signatures.request', { documentId: devisId, baseUrl: base })
      expect(url).toMatch(new RegExp(`^${base}/sign/[A-Za-z0-9_-]{30,}$`))
      const page = await (await fetch(url)).text()
      expect(page).toContain('Signer le document')
      expect(page).toContain('DEV-2026-0001')
      const token = url.split('/sign/')[1]
      const post = (body: any) => fetch(`${base}/api/public/sign/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json())
      expect((await post({ name: 'A', image: SIGNATURE })).error).toMatch(/nom/)
      expect((await post({ name: 'Moussa Sawadogo', image: SIGNATURE })).ok).toBe(true)
      expect((await post({ name: 'Moussa Sawadogo', image: SIGNATURE })).error).toMatch(/déjà été signé/)
      expect(await (await fetch(url)).text()).toContain('Document signé')
      const l = await ok(admin, 'signatures.list', { documentId: devisId })
      expect(l.signatures.map((s: any) => s.method)).toEqual(['sur_place', 'a_distance'])
      expect((await fetch(`${base}/sign/${'x'.repeat(32)}`)).status).toBe(404)
    })
  })

  it('les signatures figurent sur le document imprimé', async () => {
    const { printable } = await import('../src/main/printing')
    const p = await printable(admin, devisId, 'a4', false)
    expect(p.html).toContain('Awa Traoré')
    expect(p.html).toContain('Empreinte SHA-256')
  })
})
