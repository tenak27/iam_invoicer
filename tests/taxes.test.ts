import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { countryProfile } from '../src/shared/countries'
import { computeFullTotals, taxCaption } from '../src/shared/taxes'
import { openDb, type Db } from '../src/main/db'
import { call } from '../src/main/router'
import type { Ctx, SessionUser } from '../src/main/services/context'

let db: Db
let admin: Ctx

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
async function entryOf(source: string, id: number) {
  const e = await db.one<{ id: number }>('SELECT id FROM journal_entries WHERE source = $1 AND source_id = $2', [source, id])
  if (!e) return []
  return db.query<{ account: string; debit: number; credit: number }>('SELECT account, debit, credit FROM journal_lines WHERE entry_id = $1 ORDER BY id', [e.id])
}

const line = (unit_price: number, tva_rate = 18) => ({ product_id: null, description: 'Prestation', quantity: 1, unit_price, discount: 0, tva_rate })

describe('Calcul des taxes', () => {
  it('taxes additionnelles et retenues à la source', () => {
    const t = computeFullTotals([line(100000)], [
      { code: 'TIMBRE', label: 'Droit de timbre', kind: 'addition', base: 'fixed', rate: 0, amount: 200, account_sale: '447', account_purchase: '646' },
      { code: 'RAS', label: 'Retenue', kind: 'withholding', base: 'ht', rate: 5, amount: 0, account_sale: '449', account_purchase: '447' },
      { code: 'RTVA', label: 'Retenue TVA', kind: 'withholding', base: 'tva', rate: 100, amount: 0, account_sale: '449', account_purchase: '447' }
    ])
    expect(t).toMatchObject({ ht: 100000, tva: 18000, additions: 200, ttc: 118200, withheld: 23000, net: 95200 })
    expect(t.taxes.map((x) => x.value)).toEqual([200, 5000, 18000])
  })

  it('sans ligne, pas de taxe proportionnelle', () => {
    const t = computeFullTotals([], [{ code: 'RAS', label: 'Retenue', kind: 'withholding', base: 'ht', rate: 5, amount: 0, account_sale: '449', account_purchase: '447' }])
    expect(t).toMatchObject({ ttc: 0, withheld: 0, net: 0 })
  })

  it('libellés', () => {
    expect(taxCaption({ label: 'Retenue', base: 'ht', rate: 5 })).toBe('Retenue (5 % du HT)')
    expect(taxCaption({ label: 'Retenue de TVA', base: 'tva', rate: 100 })).toBe('Retenue de TVA (100 % de la TVA)')
  })
})

describe('Profils pays', () => {
  it('identifiant fiscal selon le pays', () => {
    expect(countryProfile('BF').taxId.short).toBe('IFU')
    expect(countryProfile('CI').taxId.short).toBe('NCC')
    expect(countryProfile('SN').taxId.short).toBe('NINEA')
    expect(countryProfile('CM').taxId.short).toBe('NIU')
    // Anciennes installations : reconnaissance par le nom du pays
    expect(countryProfile('', 'Burkina Faso').code).toBe('BF')
    expect(countryProfile('', 'Sénégal').code).toBe('SN')
    expect(countryProfile('', 'Pays imaginaire').code).toBe('XX')
  })
})

describe('Taxes sur les factures', () => {
  let clientId: number
  let supplierId: number

  beforeAll(async () => {
    db = await openDb({ mode: 'local' })
    const user = await ok<SessionUser>({ db, user: null }, 'auth.setup', {
      company: { name: 'Faso Services', country_code: 'BF', country: 'Burkina Faso' },
      username: 'admin', full_name: 'Administrateur', password: 'secret123'
    })
    admin = { db, user }
    clientId = (await ok(admin, 'parties.save', { kind: 'client', name: 'Ministère de la Santé' })).id
    supplierId = (await ok(admin, 'parties.save', { kind: 'supplier', name: 'Cabinet Conseil' })).id
  })
  afterAll(() => db?.close())

  it('panorama des impôts et taxes du Burkina Faso', async () => {
    const guide = await ok(admin, 'taxes.guide')
    expect(guide).toMatchObject({ code: 'BF', country: 'Burkina Faso' })
    expect(guide.entries.map((e: any) => e.code)).toEqual(expect.arrayContaining(['TVA', 'RAS', 'PREL', 'IUTS', 'TPA', 'CNSS', 'IS', 'MFP']))
    expect(guide.entries.find((e: any) => e.code === 'TVA').rate).toMatch(/18 %/)
  })

  it('première ouverture de l’onglet : taxes du pays installées d’elles-mêmes, une seule fois', async () => {
    expect(await ok<any[]>(admin, 'taxes.list')).toHaveLength(0) // un écran de saisie n'installe rien
    const all = await ok<any[]>(admin, 'taxes.list', { seed: true })
    expect(all.map((t) => t.code)).toEqual(['RAS-PS', 'RAS-PS-25', 'RAS-BTP', 'RAS-NR', 'RAS-TVA', 'PREL-BIC', 'TIMBRE', 'TAXE-SPE'])
    // Rien n'est appliqué d'office : les taxes actives se choisissent sur chaque facture
    expect(all.some((t) => t.auto)).toBe(false)
    expect(all.filter((t) => t.active).map((t) => t.code)).toEqual(['RAS-PS', 'RAS-PS-25', 'RAS-BTP', 'RAS-NR', 'PREL-BIC'])
    expect(all.find((t) => t.code === 'RAS-PS-25')).toMatchObject({ kind: 'withholding', base: 'ht', rate: 25 })
    // Une taxe supprimée ne revient pas à l'ouverture suivante
    await ok(admin, 'taxes.delete', { id: all.find((t) => t.code === 'TAXE-SPE').id })
    expect(await ok<any[]>(admin, 'taxes.list', { seed: true })).toHaveLength(7)
  })

  it('modèles du pays : pas de doublon, puis paramétrage', async () => {
    expect(await ok(admin, 'taxes.importPresets')).toBe(1) // seule la taxe supprimée est rajoutée
    expect(await ok(admin, 'taxes.importPresets')).toBe(0)
    const all = await ok<any[]>(admin, 'taxes.list')
    const timbre = all.find((t) => t.code === 'TIMBRE')
    await ok(admin, 'taxes.save', { ...timbre, amount: 200, active: true, auto: true })
    const ras = all.find((t) => t.code === 'RAS-PS')
    await ok(admin, 'taxes.save', { ...ras, active: true })
    expect(await err(admin, 'taxes.save', { code: 'X', label: 'X', kind: 'addition', base: 'ht', rate: 5, account_sale: '9999', applies_to: 'sale' })).toMatch(/inconnu/)
  })

  it('facture : timbre automatique, retenue choisie, règlement de la retenue et écritures', async () => {
    const { id } = await ok(admin, 'documents.save', { type: 'FAC', party_id: clientId, lines: [line(100000)], taxes: ['TIMBRE', 'RAS-PS'] })
    const draft = await ok(admin, 'documents.get', { id })
    expect(draft).toMatchObject({ total_ht: 100000, total_tva: 18000, total_taxes: 200, total_ttc: 118200, total_withheld: 5000 })

    // Modification sans préciser les taxes : elles sont conservées
    await ok(admin, 'documents.save', { id, type: 'FAC', party_id: clientId, lines: [line(200000)] })
    expect(await ok(admin, 'documents.get', { id })).toMatchObject({ total_ttc: 236200, total_withheld: 10000 })

    const doc = await ok(admin, 'documents.validate', { id })
    const retenue = doc.payments.find((p: any) => p.method === 'Retenue à la source')
    expect(retenue).toMatchObject({ amount: 10000, tax_account: '449' })
    // Le client ne doit plus que le net
    const unpaid = await ok<any[]>(admin, 'documents.list', { types: ['FAC'], unpaidOnly: true })
    expect(unpaid[0].total_ttc - unpaid[0].paid).toBe(226200)

    const sale = await entryOf('document', id)
    const sum = (acc: string, k: 'debit' | 'credit') => sale.filter((l) => l.account === acc).reduce((s, l) => s + l[k], 0)
    expect(sum('411', 'debit')).toBe(236200)
    expect(sum('706', 'credit')).toBe(200000)
    expect(sum('4431', 'credit')).toBe(36000)
    expect(sum('447', 'credit')).toBe(200)
    const ras = await entryOf('payment', retenue.id)
    expect(ras).toEqual([
      expect.objectContaining({ account: '449', debit: 10000 }),
      expect.objectContaining({ account: '411', credit: 10000 })
    ])
  })

  it('une nouvelle facture reçoit les taxes automatiques, pas les retenues', async () => {
    const { id } = await ok(admin, 'documents.save', { type: 'FAC', party_id: clientId, lines: [line(50000)] })
    const d = await ok(admin, 'documents.get', { id })
    expect(d.taxes.map((t: any) => t.code)).toEqual(['TIMBRE'])
    // Transformation et duplication gardent les taxes
    const copy = await ok(admin, 'documents.duplicate', { id })
    expect((await ok(admin, 'documents.get', { id: copy.id })).total_taxes).toBe(200)
  })

  it('un avoir ne porte pas de retenue', async () => {
    const { id } = await ok(admin, 'documents.save', { type: 'AV', party_id: clientId, lines: [line(10000)], taxes: ['RAS-PS', 'TIMBRE'] })
    expect((await ok(admin, 'documents.get', { id })).taxes.map((t: any) => t.code)).toEqual(['TIMBRE'])
  })

  it('facture fournisseur : retenue opérée (447) et annulation complète', async () => {
    const { id } = await ok(admin, 'documents.save', { type: 'FF', party_id: supplierId, lines: [line(100000)], taxes: ['RAS-PS'] })
    const doc = await ok(admin, 'documents.validate', { id })
    const r = doc.payments.find((p: any) => p.method === 'Retenue à la source')
    expect(r).toMatchObject({ amount: 5000, direction: 'out', tax_account: '447' })
    expect(await entryOf('payment', r.id)).toEqual([
      expect.objectContaining({ account: '401', debit: 5000 }),
      expect.objectContaining({ account: '447', credit: 5000 })
    ])
    await ok(admin, 'documents.cancel', { id })
    expect(await entryOf('payment', r.id)).toEqual([])
    expect(await entryOf('document', id)).toEqual([])
    expect(await db.query('SELECT 1 FROM payments WHERE document_id = $1', [id])).toHaveLength(0)
  })
})
