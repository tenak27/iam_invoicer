import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { importDefs, mapHeaders, parseCsv, rowsToRecords, templateCsv } from '../src/shared/imports'
import { parseDate, parseNumber } from '../src/main/services/imports'
import { openDb, type Db } from '../src/main/db'
import { call } from '../src/main/router'
import type { Ctx, SessionUser } from '../src/main/services/context'

const def = (k: string) => importDefs().find((d) => d.kind === k)!

describe('Lecture des fichiers', () => {
  it('CSV Excel français : point-virgule, guillemets, BOM, retours à la ligne', () => {
    const rows = parseCsv('﻿Nom;Tél;Adresse\r\n"Boutique ""Wend-Kuni""";70 00 00 00;"Rue 12\r\nSecteur 4"\r\nSONABEL;25 30 61 00;\r\n')
    expect(rows).toEqual([['Nom', 'Tél', 'Adresse'], ['Boutique "Wend-Kuni"', '70 00 00 00', 'Rue 12\r\nSecteur 4'], ['SONABEL', '25 30 61 00', '']])
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']])
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']])
  })

  it('reconnaît les intitulés usuels', () => {
    expect(mapHeaders(['Raison sociale', 'TÉL.', 'N° IFU', 'Colonne inconnue', 'E-mail'], def('clients'))).toEqual(['name', 'phone', 'tax_id', null, 'email'])
    expect(mapHeaders(['Désignation', 'PV HT', "Prix d'achat", 'Famille'], def('products'))).toEqual(['name', 'sale_price', 'purchase_price', 'category'])
    // Une même colonne n'est associée qu'une fois
    expect(mapHeaders(['Nom', 'Nom'], def('clients'))).toEqual(['name', null])
  })

  it('le modèle se relit tel quel', () => {
    const t = parseCsv(templateCsv(def('employees')))
    expect(mapHeaders(t[0], def('employees')).every(Boolean)).toBe(true)
  })

  it('nombres et dates à la française', () => {
    expect(parseNumber('1 250 000 FCFA')).toBe(1250000)
    expect(parseNumber('18 %')).toBe(18)
    expect(parseNumber('12,5')).toBe(12.5)
    expect(parseNumber('')).toBeNull()
    expect(parseNumber('abc')).toBeNaN()
    expect(parseDate('15/01/2024')).toBe('2024-01-15')
    expect(parseDate('2024-01-15')).toBe('2024-01-15')
    expect(parseDate('45306')).toBe('2024-01-15') // numéro de série Excel
  })
})

describe('Import en base', () => {
  let db: Db
  let admin: Ctx
  let caissier: Ctx
  const ok = async <T = any>(ctx: Ctx, name: string, args?: unknown): Promise<T> => {
    const r = await call(ctx, name, args)
    if (!r.ok) throw new Error(r.error)
    return r.data as T
  }

  beforeAll(async () => {
    db = await openDb({ mode: 'local' })
    const user = await ok<SessionUser>({ db, user: null }, 'auth.setup', { company: { name: 'Test' }, username: 'admin', full_name: 'Admin', password: 'secret123' })
    admin = { db, user }
    await ok(admin, 'users.save', { username: 'kadi', full_name: 'Kadi', role: 'caissier', password: 'caisse123' })
    const { login } = await import('../src/main/services/auth')
    caissier = { db, user: await login(db, 'kadi', 'caisse123') }
  })
  afterAll(() => db?.close())

  it('clients : création, mise à jour sans doublon, lignes refusées', async () => {
    const table = parseCsv('Code;Raison sociale;Ville;Délai de paiement\nC-100;SONABEL;Ouagadougou;45\n;Pharmacie du Progrès;Bobo-Dioulasso;\nC-101;;Koudougou;\nC-102;ONEA;Ouaga;trente\n')
    const rows = rowsToRecords(table, mapHeaders(table[0], def('clients')))
    const r = await ok(admin, 'imports.run', { kind: 'clients', rows })
    expect(r.created).toBe(2)
    expect(r.errors).toEqual([
      { line: 4, message: expect.stringMatching(/Nom.*obligatoire/) },
      { line: 5, message: expect.stringMatching(/n'est pas un nombre/) }
    ])
    const again = await ok(admin, 'imports.run', { kind: 'clients', rows: [{ code: 'C-100', name: 'SONABEL', city: 'Bobo-Dioulasso' }] })
    expect(again).toMatchObject({ created: 0, updated: 1 })
    const p = await db.one('SELECT city, payment_terms FROM parties WHERE code = $1', ['C-100'])
    expect(p).toMatchObject({ city: 'Bobo-Dioulasso', payment_terms: 45 }) // les champs absents sont conservés
  })

  it('articles puis stock initial', async () => {
    const r = await ok(admin, 'imports.run', {
      kind: 'products',
      rows: [
        { ref: 'SW-24', name: 'Switch 24 ports', kind: 'produit', sale_price: '350 000', purchase_price: '240 000', tva_rate: '18' },
        { ref: 'INST', name: 'Installation', kind: 'Prestation', sale_price: '150000' }
      ]
    })
    expect(r).toMatchObject({ created: 2, errors: [] })
    const s = await ok(admin, 'imports.run', {
      kind: 'stock',
      rows: [{ ref: 'SW-24', quantity: '10', unit_cost: '240000' }, { ref: 'INST', quantity: '3' }, { ref: 'INCONNU', quantity: '1' }]
    })
    expect(s.created).toBe(1)
    expect(s.errors.map((e: any) => e.line)).toEqual([3, 4])
    expect((await db.one('SELECT stock_qty FROM products WHERE ref = $1', ['SW-24'])).stock_qty).toBe(10)
  })

  it('salariés avec dates françaises', async () => {
    const r = await ok(admin, 'imports.run', {
      kind: 'employees',
      rows: [{ first_name: 'Issa', last_name: 'Compaoré', hire_date: '15/01/2024', base_salary: '200 000', category: 'Cadre' }]
    })
    expect(r).toMatchObject({ created: 1, errors: [] })
    expect(await db.one('SELECT hire_date, category FROM employees WHERE last_name = $1', ['Compaoré'])).toMatchObject({ hire_date: '2024-01-15', category: 'cadre' })
  })

  it('droits : un caissier ne peut pas importer de clients', async () => {
    const r = await call(caissier, 'imports.run', { kind: 'clients', rows: [{ name: 'X' }] })
    expect(r.ok).toBe(false)
  })
})
