import { generateKeyPairSync, sign } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PERMISSIONS, ROLE_LABELS, type Role } from '../src/shared/domain'
import { TIERS } from '../src/shared/licence'
import { openDb, type Db } from '../src/main/db'
import { call } from '../src/main/router'
import type { Ctx, SessionUser } from '../src/main/services/context'
import { useTestLicenceKey } from '../src/main/services/licence'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
useTestLicenceKey(publicKey.export({ type: 'spki', format: 'pem' }) as string)

let db: Db
const who: Record<string, Ctx> = {}
const as = (r: string) => who[r]
const ok = async <T = any>(ctx: Ctx, name: string, args?: unknown): Promise<T> => {
  const r = await call(ctx, name, args)
  if (!r.ok) throw new Error(r.error)
  return r.data as T
}
const refused = async (ctx: Ctx, name: string, args?: unknown) => {
  const r = await call(ctx, name, args)
  return r.ok ? '' : r.error
}

beforeAll(async () => {
  db = await openDb({ mode: 'local' })
  const admin = await ok<SessionUser>({ db, user: null }, 'auth.setup', { company: { name: 'Vista Énergie SARL' }, username: 'admin', full_name: 'Admin', password: 'secret123' })
  who.admin = { db, user: admin }
  // Licence Pro émise avant ces modules : dépenses, besoins et validations font partie de toutes les offres
  const old = TIERS.pro.modules.filter((m) => !['expenses', 'requests', 'approvals', 'finance'].includes(m))
  const data = Buffer.from(JSON.stringify({ v: 1, id: 'LIC-W', company: 'Vista Énergie SARL', tier: 'pro', modules: old, users: 0, issued: '2026-01-01', expires: null, whiteLabel: false })).toString('base64url')
  await ok(as('admin'), 'licence.activate', { key: `${data}.${sign(null, Buffer.from(data), privateKey).toString('base64url')}` })
  const roles: [string, Role][] = [['directeur', 'directeur'], ['daf', 'daf'], ['comptable', 'comptable'], ['acheteur', 'acheteur'], ['chef_service', 'chef_service'], ['employe', 'employe'], ['employe2', 'employe'], ['commercial', 'commercial'], ['caissier', 'caissier']]
  for (const [username, role] of roles) {
    const u = await ok<{ id: number }>(as('admin'), 'users.save', { username, full_name: ROLE_LABELS[role], role, password: 'motdepasse9', active: true })
    who[username] = { db, user: { id: u.id, username, full_name: ROLE_LABELS[role], role } }
  }
})
afterAll(() => db.close())

describe('Rôles de l’entreprise', () => {
  it('douze rôles, chacun avec ses modules ; les licences existantes ouvrent les nouveaux modules', async () => {
    expect(Object.keys(ROLE_LABELS)).toHaveLength(12)
    expect(PERMISSIONS.employe).toEqual(['expenses', 'requests'])
    expect(PERMISSIONS.chef_service).toContain('approvals')
    expect(PERMISSIONS.daf).toEqual(expect.arrayContaining(['finance', 'approvals', 'accounting']))
    expect(PERMISSIONS.acheteur).toContain('purchases')
    const st = await ok<any>(as('admin'), 'licence.status')
    expect(st.modules).toEqual(expect.arrayContaining(['expenses', 'requests', 'approvals', 'finance']))
    expect(await refused(as('employe'), 'documents.list', { types: ['FAC'] })).toMatch(/droits/)
    expect(await refused(as('employe'), 'users.list')).toMatch(/droits/)
  })
})

describe('Dépenses', () => {
  let id = 0
  it('saisie puis envoi : numéro attribué, visible du seul demandeur et des valideurs', async () => {
    const saved = await ok<any>(as('employe'), 'expenses.save', { category: 'transport', label: 'Taxi livraison client', amount: 7500, method: 'Espèces', beneficiary: 'Taxi' })
    id = saved.id
    expect(saved.status).toBe('brouillon')
    expect(await refused(as('employe'), 'expenses.save', { category: 'inconnue', label: 'x', amount: 10 })).toMatch(/catégorie/)
    expect(await refused(as('employe'), 'expenses.save', { category: 'repas', label: 'x', amount: 0 })).toMatch(/supérieur/)
    expect(await refused(as('employe'), 'expenses.save', { category: 'repas', label: 'x', amount: 10, receipt: 'data:text/html;base64,PHNjcmlwdD4=' })).toMatch(/Justificatif/)
    expect((await ok<any>(as('employe'), 'expenses.submit', { id })).status).toBe('soumise')
    const e = await ok<any>(as('employe'), 'expenses.get', { id })
    expect(e.number).toMatch(/^DEP-\d{4}-0001$/)
    expect((await ok<any>(as('employe2'), 'expenses.list')).rows).toHaveLength(0)
    expect(await refused(as('employe2'), 'expenses.get', { id })).toMatch(/introuvable/)
    expect((await ok<any>(as('chef_service'), 'expenses.list')).rows).toHaveLength(1)
    // Plus modifiable une fois envoyée
    expect(await refused(as('employe'), 'expenses.save', { id, category: 'transport', label: 'x', amount: 1 })).toMatch(/circuit/)
  })

  it('approbation : ni par le demandeur, ni sans le droit ; rejet avec motif obligatoire', async () => {
    expect(await refused(as('employe'), 'expenses.decide', { id, approve: true })).toMatch(/droits/)
    expect(await refused(as('comptable'), 'expenses.decide', { id, approve: true })).toMatch(/droits/)
    expect(await refused(as('chef_service'), 'expenses.decide', { id, approve: false })).toMatch(/motif/)
    // Le chef de service ne s'approuve pas lui-même
    const own = await ok<any>(as('chef_service'), 'expenses.save', { category: 'repas', label: 'Déjeuner client', amount: 12000, submit: true })
    expect(await refused(as('chef_service'), 'expenses.decide', { id: own.id, approve: true })).toMatch(/propre dépense/)
    expect((await ok<any>(as('directeur'), 'expenses.decide', { id: own.id, approve: false, comment: 'Justificatif manquant' })).status).toBe('rejetee')
    // Rejetée : son auteur la corrige et la renvoie
    expect((await ok<any>(as('chef_service'), 'expenses.save', { id: own.id, category: 'repas', label: 'Déjeuner client', amount: 12000, submit: true })).status).toBe('soumise')
    expect((await ok<any>(as('chef_service'), 'expenses.decide', { id, approve: true, comment: 'OK' })).status).toBe('approuvee')
  })

  it('paiement : réservé aux finances, écriture comptable équilibrée sur le bon compte', async () => {
    expect(await refused(as('chef_service'), 'expenses.pay', { id })).toMatch(/droits/)
    const unapproved = await ok<any>(as('employe'), 'expenses.save', { category: 'telecom', label: 'Recharge', amount: 2000, submit: true })
    expect(await refused(as('comptable'), 'expenses.pay', { id: unapproved.id })).toMatch(/approuvée/)
    expect((await ok<any>(as('comptable'), 'expenses.pay', { id, date: '2026-10-13', method: 'Espèces' })).status).toBe('payee')
    const lines = await db.query<any>("SELECT l.account, l.debit, l.credit, e.journal FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.source = 'expense' AND e.source_id = $1 ORDER BY l.position", [id])
    expect(lines).toMatchObject([{ account: '618', debit: 7500, credit: 0, journal: 'CA' }, { account: '571', debit: 0, credit: 7500 }])
    expect(await refused(as('comptable'), 'expenses.pay', { id })).toMatch(/pas à payer/)
    const detail = await ok<any>(as('employe'), 'expenses.get', { id })
    expect(detail.events.map((e: any) => e.action)).toEqual(['creation', 'soumission', 'approbation', 'paiement'])
    // Annulation du paiement : administrateur seulement, l'écriture disparaît
    expect(await refused(as('comptable'), 'expenses.unpay', { id })).toMatch(/administrateur/)
    await ok(as('admin'), 'expenses.unpay', { id })
    expect(await db.query("SELECT 1 FROM journal_entries WHERE source = 'expense' AND source_id = $1", [id])).toHaveLength(0)
    const list = await ok<any>(as('daf'), 'expenses.list')
    expect(list.totals).toMatchObject({ n_pay: 1, to_pay: 7500, n_approve: 2 })
  })
})

describe('Expressions de besoin', () => {
  let id = 0
  const lines = [{ description: 'Ordinateur portable', quantity: 3, unit: 'pièce', unit_price: 450000 }, { description: 'Souris', quantity: 3, unit_price: 5000 }]
  it('expression, envoi et cloisonnement', async () => {
    expect(await refused(as('employe'), 'requests.save', { title: 'Vide', lines: [] })).toMatch(/au moins une ligne/)
    const saved = await ok<any>(as('employe'), 'requests.save', { title: 'Postes du service commercial', department: 'Commercial', priority: 'haute', needed_by: '2026-11-15', justification: 'Renouvellement', lines, submit: true })
    id = saved.id
    expect(saved.status).toBe('soumise')
    const r = await ok<any>(as('employe'), 'requests.get', { id })
    expect(r).toMatchObject({ total: 1365000, priority: 'haute' })
    expect(r.number).toMatch(/^EB-\d{4}-0001$/)
    expect(r.lines).toHaveLength(2)
    expect(await refused(as('employe2'), 'requests.get', { id })).toMatch(/introuvable/)
    expect((await ok<any>(as('acheteur'), 'requests.list')).rows).toHaveLength(1)
  })

  it('deux validations successives, chacune avec son droit, jamais par le demandeur', async () => {
    // Les finances ne peuvent pas sauter le visa du responsable
    expect(await refused(as('comptable'), 'requests.decide', { id, approve: true })).toMatch(/Approbations/)
    expect(await refused(as('employe'), 'requests.decide', { id, approve: true })).toMatch(/Approbations/)
    expect(await refused(as('acheteur'), 'requests.order', { id, supplier_id: 1 })).toMatch(/pas encore validée/)
    expect((await ok<any>(as('chef_service'), 'requests.decide', { id, approve: true })).status).toBe('approuvee')
    // Le chef de service a visé : la validation financière n'est pas de son ressort
    expect(await refused(as('chef_service'), 'requests.decide', { id, approve: true })).toMatch(/Validation financière/)
    expect((await ok<any>(as('daf'), 'requests.decide', { id, approve: true, comment: 'Budget disponible' })).status).toBe('validee')
    expect(await refused(as('daf'), 'requests.decide', { id, approve: true })).toMatch(/n'attend pas/)
  })

  it('commande : bon de commande en brouillon avec les lignes de la demande, puis clôture', async () => {
    const supplier = await ok<any>(as('admin'), 'parties.save', { kind: 'supplier', name: 'Bureautique Faso' })
    const client = await ok<any>(as('admin'), 'parties.save', { kind: 'client', name: 'Client' })
    expect(await refused(as('employe'), 'requests.order', { id, supplier_id: supplier.id })).toMatch(/droits/)
    expect(await refused(as('acheteur'), 'requests.order', { id, supplier_id: client.id })).toMatch(/fournisseur/)
    const done = await ok<any>(as('acheteur'), 'requests.order', { id, supplier_id: supplier.id })
    expect(done.status).toBe('commandee')
    const bc = await ok<any>(as('acheteur'), 'documents.get', { id: done.document_id })
    expect(bc).toMatchObject({ type: 'BC', status: 'brouillon', total_ht: 1365000 })
    expect(bc.lines.map((l: any) => l.description)).toEqual(['Ordinateur portable', 'Souris'])
    expect(await refused(as('acheteur'), 'requests.order', { id, supplier_id: supplier.id })).toMatch(/pas encore validée/)
    expect((await ok<any>(as('acheteur'), 'requests.close', { id })).status).toBe('cloturee')
    const r = await ok<any>(as('employe'), 'requests.get', { id })
    expect(r.events.map((e: any) => e.action)).toEqual(['creation', 'soumission', 'visa', 'validation_financiere', 'commande', 'cloture'])
    expect(r.document).toMatchObject({ type: 'BC' })
  })

  it('rejet : la demande revient à son auteur, qui la corrige ; l’assistant signale ce qui attend chacun', async () => {
    const r = await ok<any>(as('commercial'), 'requests.save', { title: 'Véhicule de livraison', lines: [{ description: 'Tricycle', quantity: 1, unit_price: 1800000 }], submit: true })
    const boss = await ok<any[]>(as('chef_service'), 'assistant.list')
    expect(boss.map((i) => i.key)).toEqual(expect.arrayContaining(['besoins_a_viser', 'depenses_a_viser']))
    expect((await ok<any>(as('directeur'), 'requests.decide', { id: r.id, approve: false, comment: 'À reporter au prochain exercice' })).status).toBe('rejetee')
    expect(await ok<any>(as('commercial'), 'requests.get', { id: r.id })).toMatchObject({ status: 'rejetee', rejected_reason: 'À reporter au prochain exercice' })
    expect((await ok<any>(as('commercial'), 'requests.save', { id: r.id, title: 'Véhicule de livraison (occasion)', lines: [{ description: 'Tricycle', quantity: 1, unit_price: 900000 }], submit: true })).status).toBe('soumise')
    expect(await refused(as('employe2'), 'requests.delete', { id: r.id })).toMatch(/introuvable/)
    const fin = await ok<any[]>(as('comptable'), 'assistant.list')
    expect(fin.map((i) => i.key)).toContain('depenses_a_payer')
    expect(await ok<any[]>(as('caissier'), 'assistant.list')).toEqual([])
  })
})
