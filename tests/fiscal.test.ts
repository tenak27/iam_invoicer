import { generateKeyPairSync, sign } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TIERS } from '../src/shared/licence'
import { openDb, type Db } from '../src/main/db'
import { call } from '../src/main/router'
import type { Ctx, SessionUser } from '../src/main/services/context'
import { useTestLicenceKey } from '../src/main/services/licence'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
useTestLicenceKey(publicKey.export({ type: 'spki', format: 'pem' }) as string)

let db: Db
let admin: Ctx
let comptable: Ctx
let commercial: Ctx
let client = 0
let y25 = 0
const PASSWORDS: Record<string, string> = { admin: 'secret123', compta: 'motdepasse9', vente: 'motdepasse9' }
const signed = (ctx: Ctx, name: string, args: any) =>
  /^fiscal\.(open|close|reopen|delete)$/.test(name) && ctx.user && !args?.auth ? { ...args, auth: { password: PASSWORDS[ctx.user.username] } } : args
const ok = async <T = any>(ctx: Ctx, name: string, args?: unknown): Promise<T> => {
  const r = await call(ctx, name, signed(ctx, name, args))
  if (!r.ok) throw new Error(r.error)
  return r.data as T
}
const refused = async (ctx: Ctx, name: string, args?: unknown) => {
  const r = await call(ctx, name, signed(ctx, name, args))
  return r.ok ? '' : r.error
}
const invoice = (date: string, price: number) => ok<any>(admin, 'documents.save', { type: 'FAC', party_id: client, validate: true, date, taxes: [], lines: [{ description: 'Prestation', quantity: 1, unit_price: price, tva_rate: 18 }] })

beforeAll(async () => {
  db = await openDb({ mode: 'local' })
  const u = await ok<SessionUser>({ db, user: null }, 'auth.setup', { company: { name: 'Vista Énergie SARL' }, username: 'admin', full_name: 'Admin', password: 'secret123' })
  admin = { db, user: u }
  const data = Buffer.from(JSON.stringify({ v: 1, id: 'LIC-F', company: 'Vista Énergie SARL', tier: 'entreprise', modules: TIERS.entreprise.modules, users: 0, issued: '2026-01-01', expires: null, whiteLabel: false })).toString('base64url')
  await ok(admin, 'licence.activate', { key: `${data}.${sign(null, Buffer.from(data), privateKey).toString('base64url')}` })
  for (const [name, role] of [['compta', 'comptable'], ['vente', 'commercial']] as const) {
    const r = await ok<{ id: number }>(admin, 'users.save', { username: name, full_name: name, role, password: 'motdepasse9', active: true })
    const ctx = { db, user: { id: r.id, username: name, full_name: name, role } as SessionUser }
    if (role === 'comptable') comptable = ctx
    else commercial = ctx
  }
  client = (await ok<any>(admin, 'parties.save', { kind: 'client', name: 'Davycas International' })).id
  await invoice('2025-03-10', 1_000_000)
  await invoice('2025-11-20', 500_000)
  await ok(admin, 'expenses.save', { category: 'loyer', label: 'Loyer annuel', amount: 400_000, date: '2025-06-30', submit: true }).then(async (e: any) => {
    await ok(admin, 'expenses.decide', { id: e.id, approve: true })
    await ok(admin, 'expenses.pay', { id: e.id, date: '2025-06-30', method: 'Virement' })
  })
})
afterAll(() => db.close())

describe('Exercices comptables', () => {
  it('ouverture : dates contrôlées, pas de chevauchement, droit requis', async () => {
    expect(await refused(commercial, 'fiscal.list')).toMatch(/droits/)
    const before = await ok<any>(comptable, 'fiscal.list')
    expect(before.years).toHaveLength(0)
    expect(before.suggestion.start_date).toMatch(/-01-01$/)
    expect(await refused(comptable, 'fiscal.open', { start_date: '2025-12-31', end_date: '2025-01-01' })).toMatch(/suivre la date de début/)
    expect(await refused(comptable, 'fiscal.open', { start_date: '2025-01-01', end_date: '2028-12-31' })).toMatch(/deux ans/)
    y25 = (await ok<any>(comptable, 'fiscal.open', { start_date: '2025-01-01', end_date: '2025-12-31' })).id
    expect(await refused(comptable, 'fiscal.open', { label: 'Bis', start_date: '2025-07-01', end_date: '2026-06-30' })).toMatch(/chevauchent l'exercice 2025/)
    expect(await refused(comptable, 'fiscal.open', { start_date: '2025-01-01', end_date: '2025-12-31' })).toMatch(/existe déjà/)
    const list = await ok<any>(comptable, 'fiscal.list')
    expect(list.years[0]).toMatchObject({ label: '2025', status: 'ouvert', result: null })
    expect(list.suggestion).toMatchObject({ label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' })
  })

  it('contrôles avant clôture : résultat attendu, points bloquants et avertissements', async () => {
    await ok(admin, 'documents.save', { type: 'FAC', party_id: client, date: '2025-12-15', taxes: [], lines: [{ description: 'Brouillon', quantity: 1, unit_price: 1000, tva_rate: 0 }] })
    const p = await ok<any>(comptable, 'fiscal.preview', { id: y25 })
    expect(p).toMatchObject({ produits: 1_500_000, charges: 400_000, result: 1_100_000, canClose: true })
    const by = Object.fromEntries(p.checks.map((c: any) => [c.key, c]))
    expect(by.brouillons).toMatchObject({ ok: false, blocking: false })
    expect(by.equilibre).toMatchObject({ ok: true, blocking: true })
    expect(by.ecritures.ok).toBe(true)
    // Confirmation par le nom de l'exercice, et droit « Validation financière »
    expect(await refused(comptable, 'fiscal.close', { id: y25, confirm: 'oui' })).toMatch(/saisissez le nom de l'exercice : 2025/)
    expect(await refused({ ...commercial, user: { ...commercial.user!, role: 'chef_service' } }, 'fiscal.close', { id: y25, confirm: '2025' })).toMatch(/droits/)
  })

  it('clôture : écriture de résultat équilibrée, exercice suivant ouvert, période verrouillée', async () => {
    const r = await ok<any>(comptable, 'fiscal.close', { id: y25, confirm: '2025', open_next: true })
    expect(r).toMatchObject({ label: '2025', result: 1_100_000, next: { label: '2026' } })
    const lines = await db.query<any>("SELECT l.account, l.debit, l.credit FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.source = 'fiscal_close' ORDER BY l.account")
    expect(lines.reduce((s, l) => s + l.debit, 0)).toBeCloseTo(lines.reduce((s, l) => s + l.credit, 0), 2)
    expect(lines.find((l) => l.account === '131')).toMatchObject({ credit: 1_100_000, debit: 0 })
    expect(lines.find((l) => l.account === '622')).toMatchObject({ credit: 400_000 })
    // Le compte de résultat de l'exercice clôturé reste lisible, et le bilan porte le bénéfice au 131
    const cr = await ok<any>(comptable, 'accounting.income', { from: '2025-01-01', to: '2025-12-31' })
    expect(cr.result).toBe(1_100_000)
    const bilan = await ok<any>(comptable, 'accounting.balanceSheet', { to: '2025-12-31' })
    expect(bilan.balanced).toBe(true)
    expect(JSON.stringify(bilan.passif)).toContain('"131"')
    expect(bilan.result).toBe(0)
    const list = await ok<any>(comptable, 'fiscal.list')
    expect(list).toMatchObject({ lockedUntil: '2025-12-31' })
    expect(list.years.map((y: any) => [y.label, y.status])).toEqual([['2026', 'ouvert'], ['2025', 'cloture']])
    expect(await refused(comptable, 'fiscal.close', { id: y25, confirm: '2025' })).toMatch(/déjà clôturé/)
  })

  it('plus rien ne bouge sur la période clôturée', async () => {
    // Nouvelle facture, validation d'un brouillon, annulation, écriture manuelle, dépense : tout est refusé
    const dated = await call(admin, 'documents.save', { type: 'FAC', party_id: client, validate: true, date: '2025-12-20', taxes: [], lines: [{ description: 'Tardive', quantity: 1, unit_price: 1000, tva_rate: 18 }] })
    expect(JSON.stringify(dated)).toMatch(/L'exercice 2025 est clôturé/)
    const facs = await ok<any[]>(admin, 'documents.list', { types: ['FAC'] })
    const first = facs.find((d) => d.date === '2025-03-10')
    expect(await refused(admin, 'payments.add', { document_id: first.id, amount: 1000, method: 'Espèces', date: '2025-12-01' })).toMatch(/clôturé/)
    expect(await refused(comptable, 'accounting.saveEntry', { date: '2025-08-01', label: 'OD tardive', lines: [{ account: '571', debit: 10 }, { account: '701', credit: 10 }] })).toMatch(/clôturé/)
    const manual = await db.one<{ id: number }>("SELECT id FROM journal_entries WHERE source = 'fiscal_close'")
    expect(await refused(comptable, 'accounting.deleteEntry', { id: manual!.id })).toMatch(/automatiquement|clôturé/)
    const e = await ok<any>(admin, 'expenses.save', { category: 'divers', label: 'Oubli', amount: 5000, date: '2025-10-01', submit: true })
    await ok(admin, 'expenses.decide', { id: e.id, approve: true })
    expect(await refused(admin, 'expenses.pay', { id: e.id, date: '2025-10-05' })).toMatch(/clôturé/)
    // Sur l'exercice ouvert, tout fonctionne
    expect((await invoice('2026-02-01', 200_000)).validated).toBe(true)
    expect((await ok<any>(admin, 'expenses.pay', { id: e.id, date: '2026-01-05' })).status).toBe('payee')
    expect((await ok<any>(comptable, 'accounting.income', { from: '2025-01-01', to: '2025-12-31' })).result).toBe(1_100_000)
  })

  it('réouverture : administrateur seulement, motif obligatoire, dernier exercice clôturé', async () => {
    expect(await refused(comptable, 'fiscal.reopen', { id: y25, reason: 'Erreur de saisie' })).toMatch(/administrateur/)
    expect(await refused(admin, 'fiscal.reopen', { id: y25, reason: '' })).toMatch(/motif/)
    await ok(admin, 'fiscal.reopen', { id: y25, reason: 'Facture oubliée en décembre' })
    expect(await db.query("SELECT 1 FROM journal_entries WHERE source = 'fiscal_close'")).toHaveLength(0)
    expect((await ok<any>(comptable, 'fiscal.list')).lockedUntil).toBeNull()
    expect((await invoice('2025-12-28', 100_000)).validated).toBe(true)
    // Nouvelle clôture : le résultat tient compte de la facture ajoutée
    const again = await ok<any>(comptable, 'fiscal.close', { id: y25, confirm: '2025' })
    expect(again.result).toBe(1_200_000)
    const audit = await ok<any[]>(admin, 'reports.audit', { limit: 20 })
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['ouverture', 'cloture', 'reouverture']))
    // Un exercice qui contient des écritures ne se supprime pas ; les exercices se clôturent dans l'ordre
    const y26 = (await ok<any>(comptable, 'fiscal.list')).years.find((y: any) => y.label === '2026')
    expect(await refused(comptable, 'fiscal.delete', { id: y26.id })).toMatch(/écriture/)
    expect(await refused(comptable, 'fiscal.delete', { id: y25 })).toMatch(/clôturé/)
  })
})
