import { generateKeyPairSync, sign } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TIERS } from '../src/shared/licence'
import { openDb, type Db } from '../src/main/db'
import { call } from '../src/main/router'
import type { Ctx, SessionUser } from '../src/main/services/context'
import { totpCode } from '../src/main/services/fiscalGuard'
import { useTestLicenceKey } from '../src/main/services/licence'
import { explainMailError, setMailTransportFactory, smtpHost, smtpOptions } from '../src/main/services/messaging'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
useTestLicenceKey(publicKey.export({ type: 'spki', format: 'pem' }) as string)

let db: Db
let admin: Ctx
let comptable: Ctx
const mails: any[] = []
const transports: any[] = []
let verifyError: any = null
const ADMIN = 'secret123'
const COMPTA = 'motdepasse9'
const ok = async <T = any>(ctx: Ctx, name: string, args?: unknown): Promise<T> => {
  const r = await call(ctx, name, args)
  if (!r.ok) throw new Error(r.error)
  return r.data as T
}
const refused = async (ctx: Ctx, name: string, args?: unknown) => {
  const r = await call(ctx, name, args)
  return r.ok ? '' : r.error
}
const lastCode = () => String(mails[mails.length - 1].text).match(/Code de sécurité : (\d{6})/)![1]
const wrong = (code: string) => (code === '000000' ? '111111' : '000000')
/** Les demandes de code sont espacées de 30 secondes : on vieillit les précédentes. */
const age = () => db.query("UPDATE fiscal_challenges SET created_at = created_at - interval '2 minutes'")

beforeAll(async () => {
  setMailTransportFactory((opts) => {
    transports.push(opts)
    return { sendMail: async (m: any) => { mails.push(m); return { messageId: 'x' } }, verify: async () => { if (verifyError) throw verifyError; return true } }
  })
  db = await openDb({ mode: 'local' })
  const u = await ok<SessionUser>({ db, user: null }, 'auth.setup', { company: { name: 'Vista Énergie SARL' }, username: 'admin', full_name: 'Admin', password: ADMIN })
  admin = { db, user: u }
  const data = Buffer.from(JSON.stringify({ v: 1, id: 'LIC-G', company: 'Vista Énergie SARL', tier: 'entreprise', modules: TIERS.entreprise.modules, users: 0, issued: '2026-01-01', expires: null, whiteLabel: false })).toString('base64url')
  await ok(admin, 'licence.activate', { key: `${data}.${sign(null, Buffer.from(data), privateKey).toString('base64url')}` })
  const r = await ok<{ id: number }>(admin, 'users.save', { username: 'compta', full_name: 'Compta', role: 'comptable', password: COMPTA, active: true })
  comptable = { db, user: { id: r.id, username: 'compta', full_name: 'Compta', role: 'comptable' } as SessionUser }
})
afterAll(() => db.close())

describe('Verrou des exercices : mot de passe', () => {
  it('sans mot de passe ou avec un mauvais, rien ne s’ouvre ; le refus est inscrit au journal', async () => {
    expect(await refused(comptable, 'fiscal.open', { start_date: '2024-01-01', end_date: '2024-12-31' })).toMatch(/Saisissez votre mot de passe/)
    expect(await refused(comptable, 'fiscal.open', { start_date: '2024-01-01', end_date: '2024-12-31', auth: { password: 'pas-le-bon' } })).toMatch(/Mot de passe incorrect/)
    // Le mot de passe d'un autre compte ne vaut rien
    expect(await refused(comptable, 'fiscal.open', { start_date: '2024-01-01', end_date: '2024-12-31', auth: { password: ADMIN } })).toMatch(/Mot de passe incorrect/)
    expect((await ok<any>(admin, 'fiscal.list')).years).toHaveLength(0)
    const trace = await db.query<any>("SELECT details FROM audit_log WHERE entity = 'verrou_exercice' AND action = 'refus'")
    expect(trace.length).toBe(2)
    await ok(comptable, 'fiscal.open', { start_date: '2024-01-01', end_date: '2024-12-31', auth: { password: COMPTA } })
  })

  it('cinq essais manqués suspendent les opérations un quart d’heure, même avec le bon mot de passe ensuite', async () => {
    const id = (await ok<any>(admin, 'fiscal.list')).years[0].id
    let last = ''
    for (let i = 0; i < 3; i++) last = await refused(comptable, 'fiscal.delete', { id, auth: { password: 'faux' + i } })
    expect(last).toMatch(/suspendues 15 minutes/)
    expect(await refused(comptable, 'fiscal.delete', { id, auth: { password: COMPTA } })).toMatch(/suspendues 15 minutes/)
    // Le blocage vise le compte fautif, pas les autres
    expect(await refused(admin, 'fiscal.delete', { id, auth: { password: 'faux' } })).toMatch(/^Mot de passe incorrect\.$/)
    await db.query('DELETE FROM fiscal_auth_failures')
    await ok(comptable, 'fiscal.delete', { id, auth: { password: COMPTA } })
  })
})

describe('Verrou des exercices : code par e-mail', () => {
  it('réglage réservé à l’administrateur, messagerie et adresse vérifiées avant activation', async () => {
    expect(await refused(comptable, 'fiscalGuard.save', { mode: 'email', email: 'dg@vista.bf', password: COMPTA })).toMatch(/administrateur/)
    expect(await refused(admin, 'fiscalGuard.save', { mode: 'email', email: 'dg@vista.bf', password: ADMIN })).toMatch(/Configurez d'abord l'envoi des e-mails/)
    await ok(admin, 'settings.save', { smtp_host: 'smtp.exemple.com', smtp_port: 587, smtp_user: 'compta@vista.bf', smtp_from_email: 'compta@vista.bf' })
    await ok(admin, 'settings.saveSecrets', { smtp_password: 'boite' })
    // Les paramètres généraux ne permettent pas de toucher au verrou
    await ok(admin, 'settings.save', { fiscal_guard: { mode: 'password' } } as any)
    expect(await refused(admin, 'fiscalGuard.save', { mode: 'email', email: 'dg@vista.bf', password: ADMIN })).toMatch(/code à six chiffres/)
    const sent = await ok<any>(admin, 'fiscalGuard.challenge', { action: 'config', email: 'dg@vista.bf' })
    expect(sent).toMatchObject({ sent: true, to: 'dg•••@vista.bf' })
    expect(mails[mails.length - 1].to).toBe('dg@vista.bf')
    expect(mails[mails.length - 1].bcc).toBeUndefined()
    expect(await refused(admin, 'fiscalGuard.challenge', { action: 'config', email: 'dg@vista.bf' })).toMatch(/patientez 30 secondes/)
    const code = lastCode()
    expect(await refused(admin, 'fiscalGuard.save', { mode: 'email', email: 'dg@vista.bf', password: ADMIN, new_code: wrong(code) })).toMatch(/Code incorrect/)
    const g = await ok<any>(admin, 'fiscalGuard.save', { mode: 'email', email: 'dg@vista.bf', password: ADMIN, new_code: code })
    expect(g).toMatchObject({ mode: 'email', email: 'dg@vista.bf' })
    expect((await ok<any>(comptable, 'fiscalGuard.get')).email).toBe('dg•••@vista.bf')
    // Le code n'est conservé ni en clair en base, ni dans le journal des envois
    const stored = JSON.stringify(await db.query('SELECT * FROM fiscal_challenges')) + JSON.stringify(await db.query('SELECT * FROM message_log'))
    expect(stored).not.toContain(code)
    await db.query('DELETE FROM fiscal_auth_failures')
  })

  it('une opération demande le mot de passe et un code propre à cette opération, utilisable une seule fois', async () => {
    const args = { start_date: '2024-01-01', end_date: '2024-12-31' }
    expect(await refused(comptable, 'fiscal.open', { ...args, auth: { password: COMPTA } })).toMatch(/code à six chiffres/)
    await age()
    await ok(comptable, 'fiscalGuard.challenge', { action: 'open' })
    const code = lastCode()
    expect(String(mails[mails.length - 1].text)).toMatch(/Compta demande l'ouverture d'un exercice/)
    // Le code d'un collègue ne sert pas à un autre compte, ni à une autre opération
    expect(await refused(admin, 'fiscal.open', { ...args, auth: { password: ADMIN, code } })).toMatch(/Aucun code valable/)
    expect(await refused(comptable, 'fiscal.open', { ...args, auth: { password: COMPTA, code: wrong(code) } })).toMatch(/Code incorrect/)
    const y = await ok<any>(comptable, 'fiscal.open', { ...args, auth: { password: COMPTA, code } })
    expect(await refused(comptable, 'fiscal.delete', { id: y.id, auth: { password: COMPTA, code } })).toMatch(/Aucun code valable/)
    // Code expiré
    await age()
    await ok(comptable, 'fiscalGuard.challenge', { action: 'delete', id: y.id })
    const c2 = lastCode()
    await db.query("UPDATE fiscal_challenges SET expires_at = now() - interval '1 minute' WHERE used_at IS NULL")
    expect(await refused(comptable, 'fiscal.delete', { id: y.id, auth: { password: COMPTA, code: c2 } })).toMatch(/Aucun code valable/)
    await age()
    await ok(comptable, 'fiscalGuard.challenge', { action: 'delete', id: y.id })
    await ok(comptable, 'fiscal.delete', { id: y.id, auth: { password: COMPTA, code: lastCode() } })
    await db.query('DELETE FROM fiscal_auth_failures')
  })

  it('alléger la protection demande de franchir celle en place', async () => {
    expect(await refused(admin, 'fiscalGuard.save', { mode: 'password', password: ADMIN })).toMatch(/code à six chiffres/)
    await age()
    await ok(admin, 'fiscalGuard.challenge', { action: 'config' })
    expect((await ok<any>(admin, 'fiscalGuard.save', { mode: 'password', password: ADMIN, code: lastCode() })).mode).toBe('password')
  })
})

describe('Verrou des exercices : application d’authentification', () => {
  let secret = ''
  const now = () => Math.floor(Date.now() / 30_000)
  it('association par code QR, vérifiée avant d’être exigée', async () => {
    expect(await refused(comptable, 'fiscalGuard.totp')).toMatch(/administrateur/)
    expect(await refused(admin, 'fiscalGuard.save', { mode: 'totp', password: ADMIN, new_code: '123456' })).toMatch(/Affichez d'abord le code QR/)
    const t = await ok<any>(admin, 'fiscalGuard.totp')
    expect(t.uri).toMatch(/^otpauth:\/\/totp\/IAM%20INVOICER%3AVista/)
    expect(t.qr).toMatch(/^data:image\/png;base64,/)
    secret = t.secret.replace(/ /g, '')
    expect(await refused(admin, 'fiscalGuard.save', { mode: 'totp', password: ADMIN, new_code: wrong(totpCode(secret, now())) })).toMatch(/ne correspond pas/)
    expect((await ok<any>(admin, 'fiscalGuard.save', { mode: 'totp', password: ADMIN, new_code: totpCode(secret, now()) })).mode).toBe('totp')
    await db.query('DELETE FROM fiscal_auth_failures')
  })

  it('vecteur de référence RFC 6238', () => {
    // Clé « 12345678901234567890 », T = 59 s → 94287082 (8 chiffres) : les six derniers
    expect(totpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 1)).toBe('287082')
  })

  it('le code de l’application ouvre l’opération, une seule fois', async () => {
    const args = { start_date: '2024-01-01', end_date: '2024-12-31' }
    expect(await refused(comptable, 'fiscal.open', { ...args, auth: { password: COMPTA } })).toMatch(/application d'authentification/)
    const code = totpCode(secret, now())
    expect(await refused(comptable, 'fiscal.open', { ...args, auth: { password: COMPTA, code: wrong(code) } })).toMatch(/Code incorrect/)
    const y = await ok<any>(comptable, 'fiscal.open', { ...args, auth: { password: COMPTA, code } })
    expect(await refused(comptable, 'fiscal.delete', { id: y.id, auth: { password: COMPTA, code } })).toMatch(/déjà servi/)
    await ok(comptable, 'fiscal.delete', { id: y.id, auth: { password: COMPTA, code: totpCode(secret, now() + 1) } })
  })
})

describe('Messagerie : réglages SMTP', () => {
  it('le chiffrement se déduit du port, le nom du serveur est nettoyé, le mot de passe ne part jamais en clair', () => {
    expect(smtpHost(' ssl://SMTP.Hostinger.com:465/ ')).toBe('smtp.hostinger.com')
    const base = { smtp_host: 'smtp.exemple.com', smtp_user: 'a@b.bf' }
    expect(smtpOptions({ ...base, smtp_port: 465, smtp_secure: false }, 'p')).toMatchObject({ secure: true, requireTLS: false, port: 465 })
    expect(smtpOptions({ ...base, smtp_port: 587, smtp_secure: true }, 'p')).toMatchObject({ secure: false, requireTLS: true, auth: { user: 'a@b.bf', pass: 'p' } })
    expect(smtpOptions({ ...base, smtp_port: 0 as any, smtp_secure: false }, 'p').port).toBe(587)
    expect(smtpOptions({ smtp_host: 'relais.local', smtp_user: '', smtp_port: 2500, smtp_secure: false }, '')).toMatchObject({ secure: false, requireTLS: false, auth: undefined })
  })

  it('contrôle de connexion avec les valeurs du formulaire, avant enregistrement', async () => {
    const r = await ok<any>(admin, 'messages.verify', { smtp_host: 'smtp.hostinger.com', smtp_port: 465, smtp_user: 'x@vista.bf', smtp_password: 'essai' })
    expect(r).toMatchObject({ ok: true, host: 'smtp.hostinger.com', port: 465, encryption: 'SSL/TLS' })
    expect(transports[transports.length - 1]).toMatchObject({ host: 'smtp.hostinger.com', secure: true, auth: { user: 'x@vista.bf', pass: 'essai' } })
    // Rien n'a été enregistré
    expect((await ok<any>(admin, 'settings.get')).smtp_host).toBe('smtp.exemple.com')
    verifyError = Object.assign(new Error('Invalid login: 535-5.7.8 Username and Password not accepted'), { code: 'EAUTH', responseCode: 535 })
    expect(await refused(admin, 'messages.verify', {})).toMatch(/Connexion refusée : le serveur refuse l'identifiant ou le mot de passe.*mot de passe d'application/)
    verifyError = null
    expect(await refused(comptable, 'messages.verify', {})).toMatch(/droits/)
  })

  it('erreurs du serveur traduites', () => {
    expect(explainMailError(Object.assign(new Error('getaddrinfo ENOTFOUND smtp.x'), { code: 'ENOTFOUND' }))).toMatch(/serveur introuvable/)
    expect(explainMailError(new Error('C0:error:0A00010B:SSL routines:ssl3_get_record:wrong version number'), { smtp_port: 587 } as any)).toMatch(/port 465 \(SSL\) ou le port 587/)
    expect(explainMailError(Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT' }), { smtp_port: 465 } as any)).toMatch(/connexion impossible au port 465/)
    expect(explainMailError(Object.assign(new Error('Mail command failed'), { responseCode: 553, response: '553 5.7.1 Sender address rejected: not owned by user' }))).toMatch(/refuse l'expéditeur/)
    expect(explainMailError(new Error('self-signed certificate'))).toMatch(/certificat/)
  })
})
