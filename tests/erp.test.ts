import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { computePayslip, DEFAULT_PAYROLL_PARAMS, iutsFromBrackets, workingDays } from '../src/shared/payroll'
import { openDb, type Db } from '../src/main/db'
import { call } from '../src/main/router'
import type { Ctx, SessionUser } from '../src/main/services/context'
import { schedule } from '../src/main/services/assets'
import { setSecefFetch } from '../src/main/services/secef'

let db: Db
let admin: Ctx
let rh: Ctx
let clientId: number
let supplierId: number
let routerId: number

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
const balanceOf = async (prefix: string) =>
  (await ok<any[]>(admin, 'accounting.balance', {})).filter((r) => r.number.startsWith(prefix)).reduce((s, r) => s + r.balance, 0)

beforeAll(async () => {
  db = await openDb({ mode: 'local' })
  const user = await ok<SessionUser>({ db, user: null }, 'auth.setup', { company: { name: 'IAM Technology', tax_id: '00123456A' }, username: 'admin', full_name: 'Admin', password: 'secret123' })
  admin = { db, user }
  await ok(admin, 'users.save', { username: 'awa', full_name: 'Awa RH', role: 'rh', password: 'motdepasse' })
  const { login } = await import('../src/main/services/auth')
  rh = { db, user: await login(db, 'awa', 'motdepasse') }
  clientId = (await ok(admin, 'parties.save', { kind: 'client', name: 'ONEA' })).id
  supplierId = (await ok(admin, 'parties.save', { kind: 'supplier', name: 'Faso Distribution' })).id
  routerId = (await ok(admin, 'products.save', { kind: 'produit', name: 'Routeur 4G', sale_price: 60000, purchase_price: 40000, tva_rate: 18, tracking: 'serie' })).id
})

afterAll(async () => {
  await db?.close()
})

describe('Stock multi-dépôts, séries et transferts', () => {
  let bobo: number
  it('dépôt secondaire et réception avec numéros de série', async () => {
    bobo = (await ok(admin, 'stock.saveWarehouse', { code: 'bobo', name: 'Agence Bobo-Dioulasso' })).id
    const br = await ok(admin, 'documents.save', {
      type: 'BR', party_id: supplierId, warehouse_id: bobo,
      lines: [{ product_id: routerId, description: 'Routeur 4G', quantity: 3, unit_price: 40000, tva_rate: 18, lot_refs: 'SN-001, SN-002, SN-003' }]
    })
    await ok(admin, 'documents.validate', { id: br.id })
    const lots = await ok<any[]>(admin, 'stock.lots', { productId: routerId })
    expect(lots.map((l) => l.lot).sort()).toEqual(['SN-001', 'SN-002', 'SN-003'])
    expect(lots.every((l) => l.warehouse_name === 'Agence Bobo-Dioulasso')).toBe(true)
  })

  it('nombre de séries contrôlé, doublon refusé', async () => {
    const bad = await ok(admin, 'documents.save', {
      type: 'BR', party_id: supplierId, warehouse_id: bobo,
      lines: [{ product_id: routerId, description: 'Routeur 4G', quantity: 2, unit_price: 40000, tva_rate: 18, lot_refs: 'SN-009' }]
    })
    expect(await err(admin, 'documents.validate', { id: bad.id })).toMatch(/2 numéro\(s\) de série attendu/)
    await ok(admin, 'documents.save', { id: bad.id, type: 'BR', party_id: supplierId, warehouse_id: bobo, lines: [{ product_id: routerId, description: 'Routeur 4G', quantity: 1, unit_price: 40000, tva_rate: 18, lot_refs: 'SN-001' }] })
    expect(await err(admin, 'documents.validate', { id: bad.id })).toMatch(/déjà en stock/)
  })

  it('le stock est contrôlé par dépôt', async () => {
    const fac = await ok(admin, 'documents.save', { type: 'FAC', party_id: clientId, lines: [{ product_id: routerId, description: 'Routeur 4G', quantity: 1, unit_price: 60000, tva_rate: 18 }] })
    expect(await err(admin, 'documents.validate', { id: fac.id })).toMatch(/Dépôt principal.*disponible 0/)
    await ok(admin, 'documents.save', { id: fac.id, type: 'FAC', party_id: clientId, warehouse_id: bobo, lines: [{ product_id: routerId, description: 'Routeur 4G', quantity: 1, unit_price: 60000, tva_rate: 18, lot_refs: 'SN-002' }] })
    await ok(admin, 'documents.validate', { id: fac.id })
    const trace = await ok(admin, 'stock.trace', { lot: 'SN-002' })
    expect(trace.documents.map((d: any) => d.type).sort()).toEqual(['BR', 'FAC'])
    expect(trace.stock[0].qty).toBe(0)
  })

  it('transfert entre dépôts avec numéro de série', async () => {
    const t = await ok(admin, 'stock.transfer', { from: bobo, to: 1, lines: [{ productId: routerId, quantity: 1, lot: 'SN-003' }] })
    expect(t.number).toMatch(/^TRF-\d{4}-0001$/)
    const s = await ok(admin, 'stock.byWarehouse', {})
    const r = s.rows.find((x: any) => x.id === routerId)
    expect(r.by_wh).toEqual({ 1: 1, [bobo]: 1 })
    expect(r.stock_qty).toBe(2)
    expect(await err(admin, 'stock.transfer', { from: bobo, to: 1, lines: [{ productId: routerId, quantity: 5 }] })).toMatch(/insuffisant/)
    expect(await err(admin, 'stock.transfer', { from: 1, to: 1, lines: [{ productId: routerId, quantity: 1 }] })).toMatch(/différents/)
  })
})

describe('Paie Burkina Faso', () => {
  it('barème IUTS progressif et jours ouvrables', () => {
    expect(iutsFromBrackets(30000, DEFAULT_PAYROLL_PARAMS.iuts_brackets)).toBe(0)
    expect(Math.round(iutsFromBrackets(50000, DEFAULT_PAYROLL_PARAMS.iuts_brackets))).toBe(2420)
    expect(workingDays('2026-10-05', '2026-10-11')).toBe(6) // lundi → dimanche
  })

  it('bulletin calculé à la main : non-cadre, 2 charges', () => {
    const p = computePayslip({ category: 'non_cadre', base_salary: 200000, housing: 50000, transport: 20000, function_allowance: 0, other_allowances: 0, family_charges: 2 })
    expect(p.gross).toBe(270000)
    expect(p.cnssEmployee).toBe(14850)
    expect(p.cnssEmployer).toBe(43200)
    expect(p.taxable).toBe(155100)
    expect(p.iuts).toBe(17396)
    expect(p.net).toBe(237754)
  })

  let empId: number
  let runId: number
  it('salarié, paie du mois, variables', async () => {
    expect(await err(rh, 'documents.list', { types: ['FAC'] })).toMatch(/droits/)
    empId = (await ok(rh, 'hr.saveEmployee', { first_name: 'Issa', last_name: 'Compaoré', job: 'Technicien réseau', hire_date: '2025-01-01', base_salary: 200000, housing: 50000, transport: 20000, family_charges: 2, cnss_number: '1234567' })).id
    await ok(rh, 'hr.saveEmployee', { first_name: 'Salif', last_name: 'Ouédraogo', category: 'cadre', hire_date: '2024-03-15', base_salary: 450000, housing: 100000, transport: 30000, function_allowance: 50000 })
    runId = (await ok(rh, 'hr.prepareRun', { period: '2026-09' })).id
    let run = await ok(rh, 'hr.run', { id: runId })
    expect(run.payslips).toHaveLength(2)
    expect(run.payslips.find((s: any) => s.employee_id === empId).net).toBe(237754)
    await ok(rh, 'hr.setVariables', { runId, employeeId: empId, variables: { bonus: 25000, advance: 30000 } })
    run = await ok(rh, 'hr.run', { id: runId })
    const slip = run.payslips.find((s: any) => s.employee_id === empId)
    expect(slip.gross).toBe(295000)
    expect(slip.detail.lines.some((l: any) => l.label === 'Avance sur salaire')).toBe(true)
  })

  it('validation : écriture de paie équilibrée, puis paiement', async () => {
    await ok(rh, 'hr.validateRun', { id: runId })
    expect(await err(rh, 'hr.setVariables', { runId, employeeId: empId, variables: {} })).toMatch(/validée/)
    const run = await ok(rh, 'hr.run', { id: runId })
    expect(await balanceOf('422')).toBe(-run.net)
    expect(await balanceOf('421')).toBe(-30000)
    await ok(rh, 'hr.payRun', { id: runId, method: 'Virement' })
    expect(await balanceOf('422')).toBe(0)
    expect(await err(rh, 'hr.payRun', { id: runId, method: 'Virement' })).toMatch(/déjà payés/)
    const html = await ok<string>(rh, 'hr.payslipsHtml', { runId })
    expect(html).toContain('Issa Compaoré')
    expect(html).toContain('Net à payer')
    const decl = await ok(rh, 'hr.declaration', { runId })
    expect(decl.totals.cnss_employee).toBe(run.payslips.reduce((s: number, p: any) => s + p.cnss_employee, 0))
  })

  it('congés : solde contrôlé', async () => {
    const list = await ok<any[]>(rh, 'hr.employees', {})
    const e = list.find((x) => x.id === empId)
    expect(e.leave_balance).toBeGreaterThan(40) // 2,5 j × mois depuis janvier 2025
    const l = await ok(rh, 'hr.saveLeave', { employee_id: empId, kind: 'conge_paye', start_date: '2026-11-02', end_date: '2026-11-14' })
    await ok(rh, 'hr.decideLeave', { id: l.id, approve: true })
    expect(await err(rh, 'hr.saveLeave', { employee_id: empId, kind: 'maladie', start_date: '2026-11-10', end_date: '2026-11-11' })).toMatch(/déjà une absence/)
    const big = await ok(rh, 'hr.saveLeave', { employee_id: empId, kind: 'conge_paye', start_date: '2027-01-04', end_date: '2027-04-30' })
    expect(await err(rh, 'hr.decideLeave', { id: big.id, approve: true })).toMatch(/Solde de congés insuffisant/)
  })
})

describe('CRM', () => {
  it('pipeline, perte motivée, conversion en devis', async () => {
    const o = await ok(admin, 'crm.save', { title: 'Vidéosurveillance siège', prospect_name: 'Banque Commerciale du Burkina', contact: 'Mme Kaboré', amount: 3540000, expected_date: '2026-12-15' })
    await ok(admin, 'crm.saveActivity', { opportunity_id: o.id, kind: 'appel', subject: 'Rappeler pour la visite technique', due_date: '2026-10-10' })
    expect((await ok<any[]>(admin, 'crm.agenda', {}))[0].subject).toMatch(/Rappeler/)
    await ok(admin, 'crm.move', { id: o.id, stage: 'qualifie' })
    expect(await err(admin, 'crm.move', { id: o.id, stage: 'perdu' })).toMatch(/raison/)
    const q = await ok(admin, 'crm.createQuote', { id: o.id })
    const doc = await ok(admin, 'documents.get', { id: q.documentId })
    expect(doc.type).toBe('DEV')
    expect(doc.party.name).toBe('Banque Commerciale du Burkina')
    expect(doc.total_ttc).toBe(3540000)
    const got = await ok(admin, 'crm.get', { id: o.id })
    expect(got.stage).toBe('proposition')
    const pipe = await ok(admin, 'crm.pipeline')
    expect(pipe.open.weighted).toBe(3540000 * 0.5)
  })
})

describe('Projets', () => {
  it('temps, facturation des heures, rentabilité', async () => {
    const p = await ok(admin, 'projects.save', { name: 'Câblage agence Koudougou', party_id: clientId, hourly_rate: 15000, budget_hours: 40 })
    await ok(admin, 'projects.saveTime', { project_id: p.id, date: '2026-10-01', hours: 6, description: 'Tirage des câbles' })
    await ok(admin, 'projects.saveTime', { project_id: p.id, date: '2026-10-02', hours: 2.5, description: 'Tests', rate: 20000 })
    await ok(admin, 'projects.saveTime', { project_id: p.id, date: '2026-10-02', hours: 1, description: 'Réunion interne', billable: false })
    let got = await ok(admin, 'projects.get', { id: p.id })
    expect(got.hours).toBe(9.5)
    expect(got.unbilled).toBe(6 * 15000 + 2.5 * 20000)
    const inv = await ok(admin, 'projects.invoiceTime', { id: p.id })
    const fac = await ok(admin, 'documents.get', { id: inv.documentId })
    expect(fac.lines).toHaveLength(2)
    expect(fac.total_ht).toBe(140000)
    expect(fac.project_id).toBe(p.id)
    await ok(admin, 'documents.validate', { id: inv.documentId })
    got = await ok(admin, 'projects.get', { id: p.id })
    expect(got.unbilled).toBe(0)
    expect(got.invoiced).toBe(140000)
    const billed = got.entries.find((e: any) => e.invoice_id)
    expect(await err(admin, 'projects.deleteTime', { id: billed.id })).toMatch(/déjà facturé/)
    expect(await err(admin, 'projects.invoiceTime', { id: p.id })).toMatch(/Aucun temps/)
  })
})

describe('Immobilisations', () => {
  it('plan linéaire prorata temporis', () => {
    const plan = schedule({ acquisition_date: '2025-07-01', value: 1200000, residual: 0, duration_years: 3 })
    expect(plan.map((r) => r.dotation)).toEqual([200000, 400000, 400000, 200000])
    expect(plan.at(-1)!.net).toBe(0)
  })

  it('dotations comptabilisées une fois, cession', async () => {
    const a = await ok(admin, 'assets.save', { name: 'Véhicule utilitaire', account: '245', acquisition_date: '2025-07-01', value: 1200000, duration_years: 3, post_acquisition: '481' })
    expect(await balanceOf('245')).toBe(1200000)
    const r = await ok(admin, 'assets.postYear', { year: 2025 })
    expect(r.total).toBe(200000)
    expect(await err(admin, 'assets.postYear', { year: 2025 })).toMatch(/Aucune dotation/)
    expect(await balanceOf('2845')).toBe(-200000)
    expect(await err(admin, 'assets.save', { id: a.id, name: 'Véhicule', account: '245', acquisition_date: '2025-07-01', value: 1500000, duration_years: 3 })).toMatch(/ne peuvent plus changer/)
    const d = await ok(admin, 'assets.dispose', { id: a.id, date: '2026-06-30', price: 900000, method: 'Virement' })
    // Dotation complémentaire 2026 : 6 mois = 200 000 → cumul 400 000, VNC 800 000
    expect(d.net).toBe(800000)
    expect(d.result).toBe(100000)
    expect(await balanceOf('2845')).toBe(0)
    expect(await balanceOf('245')).toBe(0)
    expect(await balanceOf('822')).toBe(-900000)
  })
})

describe('Budgets et trésorerie prévisionnelle', () => {
  it('prévu / réalisé et projection', async () => {
    const year = new Date().getFullYear()
    await ok(admin, 'budget.saveLine', { year, account: '70', amounts: Array(12).fill(500000) })
    const b = await ok(admin, 'budget.get', { year })
    expect(b.lines[0].totalPlanned).toBe(6000000)
    expect(b.lines[0].totalActual).toBeGreaterThan(0)
    await ok(admin, 'budget.saveForecast', { date: new Date().toISOString().slice(0, 10), label: 'Loyer', amount: -150000, recurrence: 'mensuelle' })
    const f = await ok(admin, 'budget.forecast', { weeks: 13 })
    expect(f.series).toHaveLength(13)
    expect(f.events.some((e: any) => e.kind === 'client')).toBe(true)
    expect(f.events.filter((e: any) => e.label === 'Loyer').length).toBeGreaterThanOrEqual(3)
  })
})

describe('Facture certifiée SECeF', () => {
  const mkInvoice = async () =>
    (await ok(admin, 'documents.save', { type: 'FAC', party_id: clientId, lines: [{ description: 'Audit', quantity: 1, unit_price: 100000, tva_rate: 18 }] })).id

  it('simulation : codes marqués, QR imprimé', async () => {
    await ok(admin, 'settings.save', { secef_mode: 'simulation', secef_nim: 'EM01' })
    const id = await mkInvoice()
    const doc = await ok(admin, 'documents.validate', { id })
    expect(doc.secef_code).toMatch(/^SIM-[0-9A-F]{4}(-[0-9A-F]{4}){5}$/)
    const { printable } = await import('../src/main/printing')
    const p = await printable(admin, id, 'a4', false)
    expect(p.html).toContain('Simulation SECeF')
    expect(p.html).toContain('<svg')
  })

  it('API : envoi puis confirmation ; refus = validation annulée', async () => {
    const calls: string[] = []
    let refuse = false
    setSecefFetch((async (url: any, init: any) => {
      calls.push(`${init.method} ${url}`)
      if (refuse) return new Response(JSON.stringify({ errorCode: '12', errorDesc: 'IFU inconnu' }), { status: 400 })
      if (init.method === 'POST') return new Response(JSON.stringify({ uid: 'abc-123' }), { status: 200 })
      return new Response(JSON.stringify({ codeMECeFDGI: 'K7QM-3XA2-PL9D-55RT-HU8C-EQ2B', nim: 'BF01000123', counters: '42/42 FV', qrCode: 'F;BF01000123;K7QM', dateTime: '03/10/2026 10:15' }), { status: 200 })
    }) as any)
    await ok(admin, 'settings.save', { secef_mode: 'api', secef_url: 'https://secef.test/api' })
    await ok(admin, 'settings.saveSecrets', { secef_token: 'jeton' })
    const id = await mkInvoice()
    const doc = await ok(admin, 'documents.validate', { id })
    expect(calls).toEqual(['POST https://secef.test/api/invoice', 'PUT https://secef.test/api/invoice/abc-123/confirm'])
    expect(doc).toMatchObject({ secef_code: 'K7QM-3XA2-PL9D-55RT-HU8C-EQ2B', secef_nim: 'BF01000123', secef_counters: '42/42 FV' })
    refuse = true
    const id2 = await mkInvoice()
    expect(await err(admin, 'documents.validate', { id: id2 })).toMatch(/IFU inconnu/)
    expect((await ok(admin, 'documents.get', { id: id2 })).status).toBe('brouillon')
    await ok(admin, 'settings.save', { secef_mode: '' })
  })
})
