// Cloisonnement par rôle : chacun n'accède qu'à ce que son rôle lui ouvre, quel que soit l'identifiant envoyé.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../src/main/db'
import { call } from '../src/main/router'
import type { Ctx, SessionUser } from '../src/main/services/context'

let db: Db
let admin: Ctx
const as = async (ctx: Ctx, name: string, args?: unknown): Promise<any> => call(ctx, name, args)
const ok = async <T = any>(ctx: Ctx, name: string, args?: unknown): Promise<T> => {
  const r = await call(ctx, name, args)
  if (!r.ok) throw new Error(r.error)
  return r.data as T
}
const userCtx = async (username: string, role: string): Promise<Ctx> => {
  // Créé directement en base : la licence d'évaluation limite le nombre de comptes actifs
  const u = (await db.one<{ id: number }>("INSERT INTO users (username, full_name, role, password_hash) VALUES ($1, $1, $2, 'x') RETURNING id", [username, role]))!
  return { db, user: { id: u.id, username, full_name: username, role } as SessionUser }
}

beforeAll(async () => {
  db = await openDb({ mode: 'local' })
  const user = await ok<SessionUser>({ db, user: null }, 'auth.setup', { company: { name: 'Société Test' }, username: 'admin', full_name: 'Admin', password: 'secret123' })
  admin = { db, user }
})
afterAll(async () => {
  await db.close()
})

describe('Cloisonnement par rôle', () => {
  it('un commercial ne lit ni ne règle un document d’achat, même en glissant un autre identifiant', async () => {
    const commercial = await userCtx('awa', 'commercial')
    const client = await ok(admin, 'parties.save', { kind: 'client', name: 'Client A' })
    const supplier = await ok(admin, 'parties.save', { kind: 'supplier', name: 'Fournisseur B' })
    const line = [{ description: 'Article', quantity: 1, unit_price: 10000, tva_rate: 18 }]
    const fac = await ok(admin, 'documents.save', { type: 'FAC', party_id: client.id, date: '2026-11-11', taxes: [], lines: line, validate: true })
    const ff = await ok(admin, 'documents.save', { type: 'FF', party_id: supplier.id, date: '2026-11-11', taxes: [], lines: line, validate: true })
    // Le contrôle porte sur le document que le service lit (documentId), pas sur un autre identifiant joint
    expect((await as(commercial, 'signatures.list', { id: fac.id, documentId: ff.id })).ok).toBe(false)
    expect((await as(commercial, 'signatures.list', { documentId: fac.id })).ok).toBe(true)
    expect((await as(commercial, 'documents.get', { id: ff.id })).ok).toBe(false)
    // Règlement d'une facture fournisseur refusé, d'une facture client accepté
    const pay = await as(commercial, 'payments.add', { document_id: ff.id, amount: 1000, method: 'Virement' })
    expect(pay.ok).toBe(false)
    expect(pay.error).toMatch(/droits pour régler/)
    expect((await as(commercial, 'payments.add', { document_id: fac.id, amount: 1000, method: 'Virement' })).ok).toBe(true)
    const adminPay = await ok(admin, 'payments.add', { document_id: ff.id, amount: 2000, method: 'Virement' })
    const seen = await ok<any[]>(commercial, 'payments.list', {})
    expect(seen.length).toBe(1)
    expect(seen.every((p) => p.party_kind === 'client')).toBe(true)
    expect((await as(commercial, 'payments.delete', { id: adminPay.id })).ok).toBe(false)
    expect((await ok<any[]>(admin, 'payments.list', {})).length).toBe(2)
  })

  it('réglages et catalogue : ni cachet, ni signatures, ni coûts d’achat pour un employé', async () => {
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
    await ok(admin, 'settings.save', { stamp: PNG, smtp_user: 'compte@exemple.test', signatories: [{ id: 'dg', name: 'DG', title: '', image: PNG, default: true }] })
    await ok(admin, 'products.save', { kind: 'produit', name: 'Câble', sale_price: 5000, purchase_price: 3000, tva_rate: 18 })
    const employe = await userCtx('issa', 'employe')
    const s = await ok<any>(employe, 'settings.get')
    expect(s.name).toBe('Société Test')
    expect(s.stamp).toBe('')
    expect(s.signature_image).toBe('')
    expect(s.signatories[0].image).toBe('')
    expect(s.smtp_user).toBe('')
    expect((await ok<any>(admin, 'settings.get')).stamp).toBe(PNG)
    const products = await as(employe, 'products.list', {})
    if (products.ok) for (const p of products.data as any[]) expect('avg_cost' in p || 'stock_value' in p).toBe(false)
    expect((await ok<any[]>(admin, 'products.list', {}))[0].purchase_price).toBeDefined()
  })

  it('base d’une société cliente : identifiant de l’éditeur réservé, licences jamais attribuables', async () => {
    const tenant: Ctx = { ...admin, client: true }
    const r = await as(tenant, 'users.save', { username: 'tenak27', full_name: 'Faux', role: 'admin', password: 'motdepasse9', active: true })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/réservé/)
    const fake: Ctx = { db, user: { ...(admin.user as SessionUser), username: 'tenak27' }, client: true }
    const lic = await as(fake, 'licensing.list', {})
    expect(lic.ok).toBe(false)
  })

  it('temps saisis : modifiables par leur auteur seulement', async () => {
    const a = await userCtx('paul', 'commercial')
    const b = await userCtx('lea', 'commercial')
    const client = await ok(admin, 'parties.save', { kind: 'client', name: 'Client Projet' })
    const project = await ok(admin, 'projects.save', { name: 'Projet X', party_id: client.id })
    const t = await ok(a, 'projects.saveTime', { project_id: project.id, hours: 2, description: 'Étude' })
    expect((await as(b, 'projects.saveTime', { id: t.id, project_id: project.id, hours: 9, description: 'Changé' })).ok).toBe(false)
    expect((await as(b, 'projects.deleteTime', { id: t.id })).ok).toBe(false)
    expect((await as(a, 'projects.saveTime', { id: t.id, project_id: project.id, hours: 3, description: 'Étude' })).ok).toBe(true)
    expect((await as(admin, 'projects.deleteTime', { id: t.id })).ok).toBe(true)
  })
})
