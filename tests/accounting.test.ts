import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../src/main/db'
import { call } from '../src/main/router'
import type { Ctx, SessionUser } from '../src/main/services/context'

let db: Db
let admin: Ctx
let caissier: Ctx

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

/** Somme des soldes (débit − crédit) des comptes commençant par prefix. */
async function balanceOf(prefix: string): Promise<number> {
  const rows = await ok<any[]>(admin, 'accounting.balance', {})
  return rows.filter((r) => r.number.startsWith(prefix)).reduce((s, r) => s + r.balance, 0)
}

let clientId: number
let supplierId: number
let productId: number
let serviceId: number

beforeAll(async () => {
  db = await openDb({ mode: 'local' })
  const user = await ok<SessionUser>({ db, user: null }, 'auth.setup', {
    company: { name: 'IAM Technology' },
    username: 'admin',
    full_name: 'Administrateur',
    password: 'secret123'
  })
  admin = { db, user }
  await ok(admin, 'users.save', { username: 'kadi', full_name: 'Kadi', role: 'caissier', password: 'caisse123' })
  const { login } = await import('../src/main/services/auth')
  caissier = { db, user: await login(db, 'kadi', 'caisse123') }

  clientId = (await ok(admin, 'parties.save', { kind: 'client', name: 'SONABEL' })).id
  supplierId = (await ok(admin, 'parties.save', { kind: 'supplier', name: 'Faso Distribution' })).id
  productId = (await ok(admin, 'products.save', { kind: 'produit', name: 'Onduleur 1500VA', sale_price: 100000, tva_rate: 18 })).id
  serviceId = (await ok(admin, 'products.save', { kind: 'prestation', name: 'Maintenance', sale_price: 50000, tva_rate: 18 })).id
})

afterAll(async () => {
  await db?.close()
})

describe('Paramètres Burkina Faso', () => {
  it('IFU, pays et TVA 18 % par défaut', async () => {
    const s = await ok(admin, 'settings.get')
    expect(s.tax_id_label).toBe('IFU')
    expect(s.country).toBe('Burkina Faso')
    expect(s.default_tva).toBe(18)
  })
})

describe('Comptabilité SYSCOHADA', () => {
  it('facture fournisseur : 601 + 4452 au débit, 401 au crédit', async () => {
    const ff = await ok(admin, 'documents.save', {
      type: 'FF', party_id: supplierId,
      lines: [{ product_id: productId, description: 'Onduleur', quantity: 10, unit_price: 60000, tva_rate: 18 }]
    })
    await ok(admin, 'documents.validate', { id: ff.id })
    const [entry] = await ok<any[]>(admin, 'accounting.entries', { journal: 'AC' })
    expect(entry.number).toMatch(/^AC-\d{4}-00001$/)
    const byAcc = Object.fromEntries(entry.lines.map((l: any) => [l.account, l.debit - l.credit]))
    expect(byAcc).toEqual({ '601': 600000, '4452': 108000, '401': -708000 })
  })

  it('facture client : 411 au débit, 701/706 et 4431 au crédit, puis règlement Orange Money', async () => {
    const fac = await ok(admin, 'documents.save', {
      type: 'FAC', party_id: clientId,
      lines: [
        { product_id: productId, description: 'Onduleur', quantity: 1, unit_price: 100000, tva_rate: 18 },
        { product_id: serviceId, description: 'Maintenance', quantity: 1, unit_price: 50000, tva_rate: 18 }
      ]
    })
    await ok(admin, 'documents.validate', { id: fac.id })
    const [entry] = await ok<any[]>(admin, 'accounting.entries', { journal: 'VT' })
    const byAcc = Object.fromEntries(entry.lines.map((l: any) => [l.account, l.debit - l.credit]))
    expect(byAcc).toEqual({ '411': 177000, '701': -100000, '706': -50000, '4431': -27000 })

    await ok(admin, 'payments.add', { document_id: fac.id, amount: 77000, method: 'Orange Money' })
    const [mm] = await ok<any[]>(admin, 'accounting.entries', { journal: 'MM' })
    expect(mm.lines.map((l: any) => [l.account, l.debit, l.credit])).toEqual([['552', 77000, 0], ['411', 0, 77000]])
    expect(await balanceOf('411')).toBe(100000)
  })

  it('avoir : écriture inverse de la facture', async () => {
    const [fac] = await ok<any[]>(admin, 'documents.list', { types: ['FAC'] })
    const av = await ok(admin, 'documents.convert', { id: fac.id, to: 'AV' })
    await ok(admin, 'documents.validate', { id: av.id, applyStock: true })
    const [entry] = await ok<any[]>(admin, 'accounting.entries', { journal: 'VT' })
    const byAcc = Object.fromEntries(entry.lines.map((l: any) => [l.account, l.debit - l.credit]))
    expect(byAcc).toEqual({ '411': -177000, '701': 100000, '706': 50000, '4431': 27000 })
  })

  it('supprimer un règlement supprime son écriture', async () => {
    const [p] = await ok<any[]>(admin, 'payments.list', {})
    await ok(admin, 'payments.delete', { id: p.id })
    expect(await ok<any[]>(admin, 'accounting.entries', { journal: 'MM' })).toHaveLength(0)
  })

  it('opération diverse : refuse une écriture déséquilibrée, accepte une écriture équilibrée', async () => {
    expect(await err(admin, 'accounting.saveEntry', {
      label: 'Apport', lines: [{ account: '521', debit: 1000000 }, { account: '101', credit: 900000 }]
    })).toMatch(/déséquilibrée/)
    const { id } = await ok(admin, 'accounting.saveEntry', {
      label: 'Apport en capital', lines: [{ account: '521', debit: 1000000 }, { account: '101', credit: 1000000 }]
    })
    expect(await balanceOf('521')).toBe(1000000)
    await ok(admin, 'accounting.deleteEntry', { id })
    expect(await balanceOf('521')).toBe(0)
  })

  it('la balance est toujours équilibrée et le résultat se calcule', async () => {
    const rows = await ok<any[]>(admin, 'accounting.balance', {})
    expect(Math.round(rows.reduce((s, r) => s + r.balance, 0))).toBe(0)
    const inc = await ok(admin, 'accounting.income', {})
    // Ventes 150 000 annulées par l'avoir ; achats 600 000.
    expect(inc.totalProduits).toBe(0)
    expect(inc.totalCharges).toBe(600000)
    expect(inc.result).toBe(-600000)
  })

  it('grand livre : solde progressif du compte fournisseur', async () => {
    const l = await ok(admin, 'accounting.ledger', { account: '401' })
    expect(l.closing).toBe(-708000)
  })

  it('génère les écritures manquantes sans doublon', async () => {
    await db.query("DELETE FROM journal_entries WHERE source = 'document'")
    expect((await ok(admin, 'accounting.missing')).documents).toBe(3)
    await ok(admin, 'accounting.generateMissing')
    await ok(admin, 'accounting.generateMissing')
    expect((await ok(admin, 'accounting.missing')).documents).toBe(0)
    expect(await ok<any[]>(admin, 'accounting.entries', { journal: 'VT' })).toHaveLength(2)
  })
})

describe('Caisse', () => {
  it('un caissier n’accède qu’à la caisse', async () => {
    expect(await err(caissier, 'documents.list', { types: ['FAC'] })).toMatch(/droits/)
    expect(await err(caissier, 'accounting.entries', {})).toMatch(/droits/)
  })

  it('refuse de vendre caisse fermée', async () => {
    expect(await err(caissier, 'cash.sale', {
      lines: [{ product_id: productId, description: 'Onduleur', quantity: 1, unit_price: 100000, tva_rate: 18 }],
      payments: [{ method: 'Espèces', amount: 118000 }]
    })).toMatch(/Ouvrez la caisse/)
  })

  it('ouverture, vente comptoir, mobile money, sortie, clôture avec écart', async () => {
    await ok(caissier, 'cash.open', { opening_amount: 20000 })
    expect(await err(caissier, 'cash.open', { opening_amount: 0 })).toMatch(/déjà ouverte/)

    const sale = await ok(caissier, 'cash.sale', {
      lines: [{ product_id: productId, description: 'Onduleur', quantity: 1, unit_price: 100000, tva_rate: 18 }],
      payments: [{ method: 'Espèces', amount: 100000 }, { method: 'Moov Money', amount: 18000 }]
    })
    expect(sale.number).toMatch(/^FAC-/)
    expect(sale.paid).toBe(118000)

    // Le client comptoir doit tout payer
    expect(await err(caissier, 'cash.sale', {
      lines: [{ product_id: serviceId, description: 'Maintenance', quantity: 1, unit_price: 50000, tva_rate: 18 }],
      payments: [{ method: 'Espèces', amount: 1000 }]
    })).toMatch(/totalité/)

    await ok(caissier, 'cash.movement', { kind: 'sortie', amount: 5000, account: '618', label: 'Taxi livraison' })
    expect(await err(caissier, 'cash.movement', { kind: 'sortie', amount: 999999, account: '618', label: 'Trop' })).toMatch(/insuffisantes/)

    const cur = await ok(caissier, 'cash.current')
    expect(cur.expected).toBe(20000 + 100000 - 5000)
    expect(cur.salesTotal).toBe(118000)
    expect(cur.sales).toHaveLength(1)

    expect(await err(caissier, 'cash.close', { counted_amount: 114000 })).toMatch(/Écart de -1000/)
    const closed = await ok(caissier, 'cash.close', { counted_amount: 114000, note: 'Erreur de rendu monnaie' })
    expect(closed.session.status).toBe('fermee')
    expect(await ok(caissier, 'cash.current')).toBeNull()

    // Écritures : vente (VT), espèces (CA), Moov (MM), sortie (CA), écart (CA)
    expect(await balanceOf('571')).toBe(100000 - 5000 - 1000)
    expect(await balanceOf('552')).toBe(18000)
    expect(await balanceOf('658')).toBe(1000)
  })

  it('le stock a bien été sorti par la vente au comptoir', async () => {
    const [p] = await ok<any[]>(admin, 'products.list', { search: 'onduleur' })
    expect(p.stock_qty).toBe(10 - 1 + 1 - 1) // achat 10, facture -1, avoir +1, caisse -1
  })

  it('un règlement d’une caisse clôturée ne se supprime pas', async () => {
    const pays = await ok<any[]>(admin, 'payments.list', {})
    const p = pays.find((x) => x.cash_session_id)
    expect(await err(admin, 'payments.delete', { id: p.id })).toMatch(/clôturée/)
  })

  it('historique : le caissier ne voit que ses sessions', async () => {
    expect(await ok<any[]>(caissier, 'cash.history', {})).toHaveLength(1)
  })
})
