import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../src/main/db'
import { call } from '../src/main/router'
import { compareRange, periodKeys, resolvePreset, runAnalysis } from '../src/main/services/analytics'
import type { Ctx, SessionUser } from '../src/main/services/context'

let db: Db
let admin: Ctx
const ok = async <T = any>(ctx: Ctx, name: string, args?: unknown): Promise<T> => {
  const r = await call(ctx, name, args)
  if (!r.ok) throw new Error(`${name} : ${r.error}`)
  return r.data as T
}
const err = async (ctx: Ctx, name: string, args?: unknown) => {
  const r = await call(ctx, name, args)
  if (r.ok) throw new Error(`${name} aurait dû échouer`)
  return r.error
}

// Jeu d'essai : deux clients (Ouaga, Bobo), un produit (coût 6 000) et une prestation, des
// factures sur plusieurs mois de 2025 et 2026, un avoir, des règlements et une facture fournisseur.
const TODAY = '2026-06-15'
const ids: Record<string, number> = {}
async function invoice(type: string, party: number, date: string, lines: [number, number, number][], due?: string) {
  const d = await ok(admin, 'documents.save', { type, party_id: party, date, due_date: due, lines: lines.map(([product_id, quantity, unit_price]) => ({ product_id, description: 'x', quantity, unit_price, tva_rate: 18 })) })
  await ok(admin, 'documents.validate', { id: d.id })
  return d.id as number
}

beforeAll(async () => {
  db = await openDb({ mode: 'local' })
  const user = await ok<SessionUser>({ db, user: null }, 'auth.setup', { company: { name: 'Test Analyses SARL' }, username: 'admin', full_name: 'Awa Admin', password: 'secret123' })
  admin = { db, user }
  ids.ouaga = (await ok(admin, 'parties.save', { kind: 'client', name: 'Ouaga Distribution', city: 'Ouagadougou', payment_terms: 30 })).id
  ids.bobo = (await ok(admin, 'parties.save', { kind: 'client', name: 'Bobo Services', city: 'Bobo-Dioulasso', payment_terms: 30 })).id
  ids.fourn = (await ok(admin, 'parties.save', { kind: 'supplier', name: 'Grossiste Sahel' })).id
  ids.ciment = (await ok(admin, 'products.save', { kind: 'produit', name: 'Ciment 50 kg', category: 'Matériaux', sale_price: 8000, purchase_price: 6000, tva_rate: 18, min_stock: 50 })).id
  ids.pose = (await ok(admin, 'products.save', { kind: 'prestation', name: 'Pose carrelage', category: 'Services', sale_price: 20000, tva_rate: 18 })).id
  // Stock initial par facture fournisseur
  await invoice('FF', ids.fourn, '2025-01-05', [[ids.ciment, 500, 6000]])
  // 2025 : base de comparaison
  await invoice('FAC', ids.ouaga, '2025-03-10', [[ids.ciment, 10, 8000]])
  await invoice('FAC', ids.bobo, '2025-04-12', [[ids.pose, 2, 20000]])
  // 2026
  const f1 = await invoice('FAC', ids.ouaga, '2026-01-15', [[ids.ciment, 20, 8000]])
  await invoice('FAC', ids.ouaga, '2026-02-10', [[ids.ciment, 25, 8000], [ids.pose, 1, 20000]])
  await invoice('FAC', ids.bobo, '2026-03-05', [[ids.pose, 3, 20000]], '2026-03-20')
  await invoice('FAC', ids.ouaga, '2026-04-20', [[ids.ciment, 30, 8000]], '2026-06-30')
  await invoice('FAC', ids.bobo, '2026-05-02', [[ids.ciment, 5, 8000]], '2026-05-10')
  // Avoir de 2 sacs sur la facture de janvier
  const av = await ok(admin, 'documents.convert', { id: f1, to: 'AV' })
  await ok(admin, 'documents.save', { id: av.id, party_id: ids.ouaga, date: '2026-01-25', lines: [{ product_id: ids.ciment, description: 'x', quantity: 2, unit_price: 8000, tva_rate: 18 }] })
  await ok(admin, 'documents.validate', { id: av.id })
  await ok(admin, 'payments.add', { document_id: f1, amount: 50000, method: 'Orange Money', date: '2026-01-20' })
})
afterAll(() => db?.close())

describe('Analyses : calendrier', () => {
  it('périodes continues, y compris les mois sans vente', () => {
    expect(periodKeys('2026-01-15', '2026-04-02', 'mois')).toEqual(['2026-01', '2026-02', '2026-03', '2026-04'])
    expect(periodKeys('2025-12-29', '2026-01-12', 'semaine')).toEqual(['2026-S01', '2026-S02', '2026-S03'])
    expect(periodKeys('2025-11-01', '2026-02-01', 'trimestre')).toEqual(['2025-T4', '2026-T1'])
  })
  it('période de comparaison : précédente et année précédente', () => {
    expect(compareRange('2026-04-01', '2026-04-30', 'previous')).toEqual(['2026-03-02', '2026-03-31'])
    expect(compareRange('2024-02-29', '2024-03-31', 'year')).toEqual(['2023-02-28', '2023-03-31'])
  })
  it('périodes glissantes des analyses enregistrées', () => {
    expect(resolvePreset({ dataset: 'ventes', measures: ['ca_ht'], preset: 'mois-dernier' } as any, TODAY)).toMatchObject({ from: '2026-05-01', to: '2026-05-31' })
    expect(resolvePreset({ dataset: 'ventes', measures: ['ca_ht'], preset: '12-mois' } as any, TODAY)).toMatchObject({ from: '2025-07-01', to: TODAY })
  })
})

describe('Analyses : ventes', () => {
  it('CA, marge et taux par mois, comparés à l’année précédente, avec prévision', async () => {
    const r = await runAnalysis(admin, { dataset: 'ventes', measures: ['ca_ht', 'marge', 'taux_marge'], rows: 'periode', grain: 'mois', from: '2026-01-01', to: '2026-05-31', compare: 'year' }, TODAY)
    // Janvier : 20 sacs − avoir de 2 = 18 × 8 000 ; marge 18 × 2 000
    expect(r.rows.map((x) => [x.key, x.values.ca_ht])).toEqual([['2026-01', 144000], ['2026-02', 220000], ['2026-03', 60000], ['2026-04', 240000], ['2026-05', 40000]])
    expect(r.rows[0].values.marge).toBe(36000)
    expect(r.totals.ca_ht).toBe(704000)
    // Marge : ciment 2 000/sac (18+25+30+5 = 78 sacs → 156 000) + prestations sans coût (80 000)
    expect(r.totals.marge).toBe(236000)
    expect(r.totals.taux_marge).toBeCloseTo((236000 / 704000) * 100, 5)
    // Comparaison 2025 : mars 80 000, avril 40 000
    expect(r.rows[2].compare?.ca_ht).toBe(80000)
    expect(r.compareTotals?.ca_ht).toBe(120000)
    expect(r.forecast).toHaveLength(3)
    expect(r.forecast[0].key).toBe('2026-06')
    expect(r.insights.some((i) => /par rapport à l’an dernier/.test(i.text))).toBe(true)
  })

  it('classement des clients, regroupement « Autres » et filtre', async () => {
    const r = await runAnalysis(admin, { dataset: 'ventes', measures: ['ca_ht', 'documents', 'panier'], rows: 'client', from: '2026-01-01', to: '2026-12-31' }, TODAY)
    expect(r.rows.map((x) => x.label)).toEqual(['Ouaga Distribution', 'Bobo Services'])
    expect(r.rows[0].values).toMatchObject({ ca_ht: 604000, documents: 3 })
    expect(r.rows[0].values.panier).toBeCloseTo(604000 / 3, 5)
    const top1 = await runAnalysis(admin, { dataset: 'ventes', measures: ['ca_ht', 'documents'], rows: 'client', top: 1, from: '2026-01-01', to: '2026-12-31' }, TODAY)
    // Une seule ligne restante : affichée telle quelle (pas de « Autres (1) »)
    expect(top1.rows.map((x) => x.key)).toEqual(['Ouaga Distribution', 'Bobo Services'])
    const lines = await runAnalysis(admin, { dataset: 'ventes', measures: ['ca_ht', 'documents'], rows: 'periode', grain: 'mois', from: '2026-01-01', to: '2026-05-31' }, TODAY)
    expect(lines.rows).toHaveLength(5)
    const grouped = await runAnalysis(admin, { dataset: 'tresorerie', measures: ['entrees', 'operations'], rows: 'tiers', top: 1, from: '2025-01-01', to: '2026-12-31' }, TODAY)
    expect(grouped.rows.length).toBeLessThanOrEqual(2)
    const filtered = await runAnalysis(admin, { dataset: 'ventes', measures: ['ca_ht'], rows: 'categorie', filters: { ville: ['Bobo-Dioulasso'] }, from: '2026-01-01', to: '2026-12-31' }, TODAY)
    expect(filtered.rows.map((x) => [x.label, x.values.ca_ht])).toEqual([['Services', 60000], ['Matériaux', 40000]])
  })

  it('tableau croisé : mois × client', async () => {
    const r = await runAnalysis(admin, { dataset: 'ventes', measures: ['ca_ht'], rows: 'periode', columns: 'client', grain: 'trimestre', from: '2026-01-01', to: '2026-06-30' }, TODAY)
    expect(r.columns).toEqual(['Ouaga Distribution', 'Bobo Services'])
    expect(r.rows.find((x) => x.key === '2026-T1')!.cells).toEqual({ 'Ouaga Distribution': 364000, 'Bobo Services': 60000 })
    expect(r.rows.find((x) => x.key === '2026-T2')!.cells).toEqual({ 'Ouaga Distribution': 240000, 'Bobo Services': 40000 })
  })
})

describe('Analyses : autres jeux de données', () => {
  it('balance âgée des créances', async () => {
    const r = await runAnalysis(admin, { dataset: 'creances', measures: ['reste_du', 'factures'], rows: 'anciennete' }, TODAY)
    const by = Object.fromEntries(r.rows.map((x) => [x.label, x.values.reste_du]))
    // Avril (échéance 30/06) : non échue ; mai (échéance 10/05) : 36 jours ; mars (20/03) : 87 jours
    expect(by['Non échues']).toBe(283200)
    expect(by['31 à 60 jours']).toBe(47200)
    expect(by['61 à 90 jours']).toBe(70800)
    expect(r.insights.some((i) => /plus de 60 jours/.test(i.text))).toBe(true)
  })

  it('trésorerie par mode et stock par catégorie', async () => {
    const t = await runAnalysis(admin, { dataset: 'tresorerie', measures: ['entrees', 'operations'], rows: 'mode', from: '2026-01-01', to: '2026-12-31' }, TODAY)
    expect(t.rows.find((x) => x.key === 'Orange Money')?.values.entrees).toBe(50000)
    const s = await runAnalysis(admin, { dataset: 'stock', measures: ['quantite', 'valeur'], rows: 'categorie' }, TODAY)
    // 500 achetés − 10 (2025) − 80 (2026) + 2 (avoir) = 412 sacs à 6 000
    expect(s.rows[0]).toMatchObject({ label: 'Matériaux', values: { quantite: 412, valeur: 2472000 } })
  })
})

describe('Analyses : droits, enregistrement, tableau de bord, alertes', () => {
  it('droits du rôle : jeux de données et routes', async () => {
    await ok(admin, 'users.save', { username: 'compta', full_name: 'Comptable', role: 'comptable', password: 'secret123', active: true })
    const u = await db.one("SELECT id, username, full_name, role FROM users WHERE username = 'compta'")
    const compta: Ctx = { db, user: u as SessionUser }
    const cat = await ok<any[]>(compta, 'analytics.catalog')
    expect(cat.map((d) => d.id)).toEqual(expect.arrayContaining(['ventes', 'achats', 'tresorerie', 'creances']))
    expect(cat.map((d) => d.id)).not.toContain('stock')
    expect(await err(compta, 'analytics.run', { dataset: 'stock', measures: ['valeur'] })).toMatch(/accès/)
    expect(await err(admin, 'analytics.run', { dataset: 'ventes', measures: ['inconnue'] })).toMatch(/Mesure inconnue/)
    expect(await err(admin, 'analytics.run', { dataset: 'ventes', measures: ['ca_ht'], rows: "client; DROP TABLE users" })).toMatch(/Regroupement inconnu/)
  })

  it('valeurs d’une dimension pour les filtres', async () => {
    const v = await ok<any[]>(admin, 'analytics.values', { dataset: 'ventes', dimension: 'ville' })
    expect(v.map((x) => x.key).sort()).toEqual(['Bobo-Dioulasso', 'Ouagadougou'])
  })

  it('analyses enregistrées, épinglées et alertes', async () => {
    const a = await ok(admin, 'analytics.save', { name: 'CA de l’année', config: { dataset: 'ventes', measures: ['ca_ht'], rows: 'periode', grain: 'mois', preset: 'cette-annee' }, pinned: true, alert: { measure: 'ca_ht', op: '>', threshold: 1000 } })
    await ok(admin, 'analytics.save', { name: 'Créances', config: { dataset: 'creances', measures: ['reste_du'] }, alert: { measure: 'reste_du', op: '>', threshold: 999_999_999 } })
    const list = await ok<any[]>(admin, 'analytics.reports')
    expect(list.map((r) => r.name)).toEqual(['CA de l’année', 'Créances'])
    const pinned = await ok<any[]>(admin, 'analytics.pinned')
    expect(pinned).toHaveLength(1)
    expect(pinned[0].result.totals.ca_ht).toBeGreaterThan(0)
    const alerts = await ok<any[]>(admin, 'analytics.alerts')
    expect(alerts.map((x) => x.name)).toEqual(['CA de l’année'])
    await ok(admin, 'analytics.delete', { id: a.id })
    expect(await ok<any[]>(admin, 'analytics.reports')).toHaveLength(1)
  })
})
