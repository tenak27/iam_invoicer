import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { projectProgress } from '../src/shared/projects'
import { openDb, type Db } from '../src/main/db'
import { call } from '../src/main/router'
import type { Ctx, SessionUser } from '../src/main/services/context'
import { checkIntegrity } from './integrity'

let db: Db
let admin: Ctx
const ok = async <T = any>(ctx: Ctx, name: string, args?: unknown): Promise<T> => {
  const r = await call(ctx, name, args)
  if (!r.ok) throw new Error(r.error)
  return r.data as T
}
async function entryLines(source: string, id: number) {
  const e = await db.one<{ id: number }>('SELECT id FROM journal_entries WHERE source = $1 AND source_id = $2', [source, id])
  return e ? db.query<{ account: string; debit: number; credit: number }>('SELECT account, debit, credit FROM journal_lines WHERE entry_id = $1 ORDER BY id', [e.id]) : []
}

describe('Gestion de projet', () => {
  let projectId: number
  beforeAll(async () => {
    db = await openDb({ mode: 'local' })
    const user = await ok<SessionUser>({ db, user: null }, 'auth.setup', { company: { name: 'BTP Faso' }, username: 'admin', full_name: 'Admin', password: 'secret123' })
    admin = { db, user }
    const client = (await ok(admin, 'parties.save', { kind: 'client', name: 'Mairie de Koudougou' })).id
    projectId = (await ok(admin, 'projects.save', {
      name: 'Réhabilitation de l’école', party_id: client, hourly_rate: 10000, cost_rate: 6000, budget_amount: 500000, budget_hours: 20,
      budget_lines: { materiel: 200000, transport: 30000 }, end_date: '2020-01-01'
    })).id
  })
  afterAll(() => db?.close())

  it('avancement pondéré par les heures estimées', () => {
    expect(projectProgress([])).toBe(0)
    expect(projectProgress([
      { status: 'termine', progress: 0, estimated_hours: 30 },
      { status: 'en_cours', progress: 50, estimated_hours: 10 },
      { status: 'a_faire', progress: 0, estimated_hours: 0 }
    ])).toBe(Math.round((30 * 100 + 10 * 50 + 1 * 0) / 41))
  })

  it('dépenses : écritures comptables (payée, à payer), modification, suppression', async () => {
    const paid = await ok(admin, 'projects.saveExpense', { project_id: projectId, category: 'materiel', description: 'Ciment (20 sacs)', supplier: 'Quincaillerie', amount_ht: 150000, tva_rate: 18, paid: true, payment_method: 'Orange Money' })
    expect(await entryLines('depense', paid.id)).toEqual([
      expect.objectContaining({ account: '604', debit: 150000 }),
      expect.objectContaining({ account: '4452', debit: 27000 }),
      expect.objectContaining({ account: '552', credit: 177000 })
    ])
    const due = await ok(admin, 'projects.saveExpense', { project_id: projectId, category: 'transport', description: 'Camion', amount_ht: 50000, tva_rate: 0, paid: false, billable: true, markup: 10 })
    expect((await entryLines('depense', due.id)).find((l) => l.account === '401')?.credit).toBe(50000)
    // Modification : l'écriture est remplacée
    await ok(admin, 'projects.saveExpense', { id: due.id, project_id: projectId, category: 'transport', description: 'Camion benne', amount_ht: 60000, tva_rate: 0, paid: false, billable: true, markup: 10 })
    expect((await entryLines('depense', due.id)).find((l) => l.account === '618')?.debit).toBe(60000)
    const tmp = await ok(admin, 'projects.saveExpense', { project_id: projectId, category: 'frais_divers', description: 'Erreur', amount_ht: 1000 })
    await ok(admin, 'projects.deleteExpense', { id: tmp.id })
    expect(await entryLines('depense', tmp.id)).toEqual([])
  })

  it('refacturation des dépenses avec marge, une seule fois', async () => {
    const { documentId } = await ok(admin, 'projects.invoiceExpenses', { id: projectId })
    const doc = await ok(admin, 'documents.get', { id: documentId })
    expect(doc.lines).toHaveLength(1)
    expect(doc.lines[0].unit_price).toBe(66000) // 60 000 + 10 %
    expect(doc.project_id).toBe(projectId)
    expect((await call(admin, 'projects.invoiceExpenses', { id: projectId })).ok).toBe(false)
  })

  it('tâches, temps rattachés, budget par poste, coûts et alertes', async () => {
    const t1 = await ok(admin, 'projects.saveTask', { project_id: projectId, title: 'Toiture', estimated_hours: 10, due_date: '2020-01-01' })
    await ok(admin, 'projects.saveTask', { project_id: projectId, title: 'Peinture', estimated_hours: 10 })
    await ok(admin, 'projects.moveTask', { id: t1.id, status: 'termine' })
    await ok(admin, 'projects.saveTime', { project_id: projectId, hours: 15, description: 'Chantier, jour 1', task_id: t1.id })
    await ok(admin, 'projects.saveTime', { project_id: projectId, hours: 10, description: 'Chantier, jour 2', task_id: t1.id })
    const p = await ok(admin, 'projects.get', { id: projectId })
    expect(p.progress).toBe(50)
    expect(p.tasks.find((t: any) => t.id === t1.id)).toMatchObject({ status: 'termine', progress: 100, spent_hours: 25 })
    expect(p.byCategory.find((c: any) => c.key === 'materiel')).toMatchObject({ budget: 200000, actual: 150000 })
    expect(p.byCategory.find((c: any) => c.key === 'transport')).toMatchObject({ budget: 30000, actual: 60000 })
    expect(p.laborCost).toBe(150000) // 25 h × coût interne 6 000
    expect(p.laborValue).toBe(250000) // 25 h × taux de facturation 10 000
    expect(p.totalCost).toBe(150000 + 210000)
    expect(p.alerts.join(' ')).toMatch(/Transport/)
    expect(p.alerts.join(' ')).toMatch(/Heures \(25\) au-delà du budget/)
    expect(p.alerts.join(' ')).toMatch(/Date de fin dépassée/)
    const list = await ok<any[]>(admin, 'projects.list', {})
    expect(list[0]).toMatchObject({ tasks_total: 2, tasks_done: 1, expenses: 210000 })
    expect(p.expensesTotal).toBe(210000)
  })

  it('cohérence comptable après dépenses et refacturation', async () => {
    expect(await checkIntegrity(db)).toEqual([])
  })
})
