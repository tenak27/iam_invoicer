// Recherche des désignations pendant la saisie d'un document : désignations libres déjà utilisées, du
// même côté (ventes ou achats), accents et majuscules ignorés, dernier prix et dernière TVA.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../src/main/db'
import { call } from '../src/main/router'
import type { Ctx, SessionUser } from '../src/main/services/context'
import { searchKey, searchText } from '../src/shared/format'

let db: Db
let admin: Ctx
const ok = async <T = any>(ctx: Ctx, name: string, args?: unknown): Promise<T> => {
  const r = await call(ctx, name, args)
  if (!r.ok) throw new Error(r.error)
  return r.data as T
}

beforeAll(async () => {
  db = await openDb({ mode: 'local' })
  const user = await ok<SessionUser>({ db, user: null }, 'auth.setup', { company: { name: 'IAM Technology' }, username: 'admin', full_name: 'Admin', password: 'secret123' })
  admin = { db, user }
  const client = (await ok(admin, 'parties.save', { kind: 'client', name: 'ONEA' })).id
  const supplier = (await ok(admin, 'parties.save', { kind: 'supplier', name: 'Faso Distribution' })).id
  const routeur = (await ok(admin, 'products.save', { kind: 'produit', name: 'Routeur 4G', sale_price: 60000, purchase_price: 40000, tva_rate: 18 })).id
  await ok(admin, 'documents.save', { type: 'DEV', party_id: client, date: '2026-10-01', lines: [
    { description: 'Câble réseau Cat6 (rouleau 305 m)', quantity: 1, unit_price: 85000, tva_rate: 18 },
    { description: 'Main-d’œuvre : câblage et mise en service', quantity: 1, unit_price: 100000, tva_rate: 18 },
    { description: 'Installation du réseau Wi-Fi maillé', quantity: 1, unit_price: 175000, tva_rate: 18 },
    { product_id: routeur, description: 'Routeur 4G', quantity: 1, unit_price: 60000, tva_rate: 18 }
  ] })
  await ok(admin, 'documents.save', { type: 'FAC', party_id: client, date: '2026-10-20', lines: [
    { description: 'Câble réseau Cat6 (rouleau 305 m)', quantity: 2, unit_price: 89000, tva_rate: 0 }
  ] })
  await ok(admin, 'documents.save', { type: 'BC', party_id: supplier, date: '2026-10-05', lines: [
    { description: 'Câble électrique 2,5 mm²', quantity: 10, unit_price: 12000, tva_rate: 18 }
  ] })
})
afterAll(async () => {
  await db.close()
})

describe('Désignations déjà utilisées', () => {
  it('sans accents ni majuscules, avec le dernier prix et la dernière TVA', async () => {
    const r = await ok<any[]>(admin, 'documents.searchDesignations', { type: 'FAC', q: 'CABLE reseau' })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ description: 'Câble réseau Cat6 (rouleau 305 m)', uses: 2, unit_price: 89000, tva_rate: 0 })
    expect((await ok<any[]>(admin, 'documents.searchDesignations', { type: 'DEV', q: 'oeuvre' })).map((h) => h.description)).toEqual(['Main-d’œuvre : câblage et mise en service'])
    // Ponctuation ignorée : « wifi » trouve « Wi-Fi », « main d'oeuvre » trouve « Main-d’œuvre »
    expect((await ok<any[]>(admin, 'documents.searchDesignations', { type: 'FAC', q: 'wifi' })).map((h) => h.description)).toEqual(['Installation du réseau Wi-Fi maillé'])
    expect((await ok<any[]>(admin, 'documents.searchDesignations', { type: 'FAC', q: "main d'oeuvre" })).map((h) => h.description)).toEqual(['Main-d’œuvre : câblage et mise en service'])
  })

  it('ventes et achats séparés, lignes du catalogue écartées, recherche vide sans résultat', async () => {
    expect((await ok<any[]>(admin, 'documents.searchDesignations', { type: 'FAC', q: 'cable' })).map((h) => h.description)).toEqual(['Câble réseau Cat6 (rouleau 305 m)'])
    expect((await ok<any[]>(admin, 'documents.searchDesignations', { type: 'BC', q: 'cable' })).map((h) => h.description)).toEqual(['Câble électrique 2,5 mm²'])
    expect(await ok<any[]>(admin, 'documents.searchDesignations', { type: 'FAC', q: 'routeur' })).toEqual([])
    expect(await ok<any[]>(admin, 'documents.searchDesignations', { type: 'FAC', q: ' ' })).toEqual([])
    // Les caractères spéciaux de LIKE ne servent pas de jokers
    expect(await ok<any[]>(admin, 'documents.searchDesignations', { type: 'FAC', q: '%%' })).toEqual([])
    expect((await call(admin, 'documents.searchDesignations', { type: 'XX', q: 'cable' })).ok).toBe(false)
  })

  it('clé de recherche commune à l’application et au serveur', () => {
    expect(searchKey('Main-d’Œuvre ÉLECTRIQUE')).toBe('main-d’oeuvre electrique')
    expect(searchText('Main-d’Œuvre Wi-Fi')).toBe('maindoeuvre wifi')
  })
})
