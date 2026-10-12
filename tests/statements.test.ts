import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../src/main/db'
import { call } from '../src/main/router'
import type { Ctx, SessionUser } from '../src/main/services/context'
import { todayISO } from '../src/shared/format'

let db: Db
let admin: Ctx
const ok = async <T = any>(ctx: Ctx, name: string, args?: unknown): Promise<T> => {
  const r = await call(ctx, name, args)
  if (!r.ok) throw new Error(r.error)
  return r.data as T
}
const line = (unit_price: number) => ({ product_id: null, description: 'Prestation', quantity: 1, unit_price, discount: 0, tva_rate: 18 })

describe('Bilan et déclarations', () => {
  const month = todayISO().slice(0, 7)

  beforeAll(async () => {
    db = await openDb({ mode: 'local' })
    const user = await ok<SessionUser>({ db, user: null }, 'auth.setup', { company: { name: 'Faso Services' }, username: 'admin', full_name: 'Admin', password: 'secret123' })
    admin = { db, user }
    const client = (await ok(admin, 'parties.save', { kind: 'client', name: 'Ministère' })).id
    const supplier = (await ok(admin, 'parties.save', { kind: 'supplier', name: 'Cabinet' })).id
    await ok(admin, 'taxes.importPresets')
    const rtva = (await ok<any[]>(admin, 'taxes.list')).find((t) => t.code === 'RAS-TVA')
    await ok(admin, 'taxes.save', { ...rtva, active: true })

    // Facture 100 000 HT avec retenue de TVA par le client, réglée pour le net
    const fac = await ok(admin, 'documents.save', { type: 'FAC', party_id: client, lines: [line(100000)], taxes: ['RAS-TVA'] })
    await ok(admin, 'documents.validate', { id: fac.id })
    await ok(admin, 'payments.add', { document_id: fac.id, amount: 100000, method: 'Virement' })
    // Facture fournisseur 50 000 HT, non réglée
    const ff = await ok(admin, 'documents.save', { type: 'FF', party_id: supplier, lines: [line(50000)] })
    await ok(admin, 'documents.validate', { id: ff.id })
  })
  afterAll(() => db?.close())

  it('compte de résultat et bilan équilibré', async () => {
    const income = await ok(admin, 'accounting.income', {})
    expect(income.result).toBe(50000)
    const b = await ok(admin, 'accounting.balanceSheet', {})
    expect(b.balanced).toBe(true)
    expect(b.totalActif).toBe(b.totalPassif)
    expect(b.result).toBe(50000)
    const all = (sections: any[]) => sections.flatMap((s: any) => s.lines)
    // Banque (521) à l'actif, TVA retenue (449) en créance, fournisseur (401) au passif
    expect(all(b.actif).find((l: any) => l.number === '521').amount).toBe(100000)
    expect(all(b.actif).find((l: any) => l.number === '449').amount).toBe(18000)
    expect(all(b.passif).find((l: any) => l.number === '401').amount).toBe(59000)
    expect(all(b.passif).find((l: any) => l.number === '13').amount).toBe(50000)
  })

  it('déclaration de TVA du mois', async () => {
    const d = await ok(admin, 'declarations.month', { month })
    expect(d.vat).toMatchObject({ collected: 18000, deductible: 9000, withheldByClients: 18000, net: -9000 })
    expect(d.vat.rows).toEqual([{ rate: 18, base: 100000, tva: 18000 }])
    expect(d.withholdings.totalSuffered).toBe(18000)
    expect(d.withholdings.suffered[0].documents[0]).toMatchObject({ party: 'Ministère', amount: 18000 })
    expect(d.payroll).toBeNull()
  })

  it('échéancier du mois : montants, date limite et minimum forfaitaire selon le régime', async () => {
    const d = await ok(admin, 'declarations.month', { month })
    const [y, m] = month.split('-').map(Number)
    const due = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-20`
    const by = (code: string) => d.schedule.find((s: any) => s.code === code)
    // Crédit de TVA : rien à payer, le crédit est signalé
    expect(by('TVA')).toMatchObject({ amount: 0, due })
    expect(by('TVA').note).toMatch(/Crédit de TVA de 9000/)
    expect(by('RAS')).toMatchObject({ amount: 0, due })
    expect(by('IUTS')).toMatchObject({ amount: null })
    expect(by('MFP')).toBeUndefined() // régime non renseigné
    expect(d.turnover).toBe(100000)
    // Réel normal : 0,5 % du chiffre d'affaires, avec le plancher mensuel
    await ok(admin, 'settings.save', { regime_fiscal: 'RNI' })
    const rni = await ok(admin, 'declarations.month', { month })
    expect(rni.country).toMatchObject({ code: 'BF', regime: 'RNI' })
    expect(rni.schedule.find((s: any) => s.code === 'MFP')).toMatchObject({ amount: 83334, due })
    expect(rni.scheduleTotal).toBe(83334)
  })

  it('mois invalide refusé', async () => {
    const r = await call(admin, 'declarations.month', { month: '2026-13-01' })
    expect(r.ok).toBe(false)
  })
})
