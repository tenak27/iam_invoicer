// Transformation d'un devis : une seule fois par type de document, puis réédition en duplicata.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../src/main/db'
import { call } from '../src/main/router'
import { printable } from '../src/main/printing'
import type { Ctx, SessionUser } from '../src/main/services/context'

let db: Db
let admin: Ctx
let clientId = 0

async function ok<T = any>(ctx: Ctx, name: string, args?: unknown): Promise<T> {
  const r = await call(ctx, name, args)
  if (!r.ok) throw new Error(r.error)
  return r.data as T
}

beforeAll(async () => {
  db = await openDb({ mode: 'local' })
  const user = await ok<SessionUser>({ db, user: null }, 'auth.setup', { company: { name: 'IAM Technology' }, username: 'admin', full_name: 'Administrateur', password: 'secret123' })
  admin = { db, user }
  clientId = (await ok(admin, 'parties.save', { kind: 'client', name: 'SONABEL' })).id
})
afterAll(() => db?.close())

const quote = async () => {
  const dev = await ok(admin, 'documents.save', { type: 'DEV', party_id: clientId, lines: [{ description: 'Installation réseau', quantity: 1, unit_price: 100000, tva_rate: 18 }] })
  await ok(admin, 'documents.validate', { id: dev.id })
  return dev.id as number
}

describe('Transformation et duplicata', () => {
  it('le devis reste en place ; une seconde transformation ne crée pas de second bon de livraison', async () => {
    const dev = await quote()
    const first = await ok(admin, 'documents.convert', { id: dev, to: 'BL' })
    expect(first.existing).toBeFalsy()

    // Brouillon déjà créé : on le rouvre, sans duplicata
    const again = await ok(admin, 'documents.convert', { id: dev, to: 'BL' })
    expect(again).toMatchObject({ id: first.id, existing: true, duplicata: false })

    // Bon de livraison validé : réédition en duplicata, toujours un seul bon
    const bl = await ok(admin, 'documents.validate', { id: first.id })
    const dup = await ok(admin, 'documents.convert', { id: dev, to: 'BL' })
    expect(dup).toMatchObject({ id: first.id, existing: true, duplicata: true, number: bl.number })
    const children = (await ok(admin, 'documents.get', { id: dev })).children.filter((c: any) => c.type === 'BL')
    expect(children).toHaveLength(1)

    // Le devis est toujours listé et validé
    const list = await ok<any[]>(admin, 'documents.list', { types: ['DEV'] })
    expect(list.find((d) => d.id === dev)?.status).toBe('valide')

    // Traçabilité : la réédition figure au journal d'activité
    const log = await db.query("SELECT action, details FROM audit_log WHERE action = 'duplicata'")
    expect(log.length).toBe(1)
  })

  it('le document réédité porte la mention DUPLICATA, l’original non', async () => {
    const dev = await quote()
    const bl = await ok(admin, 'documents.convert', { id: dev, to: 'BL' })
    await ok(admin, 'documents.validate', { id: bl.id })
    const original = await printable(admin, bl.id, 'a4', false)
    const copy = await printable(admin, bl.id, 'a4', false, { duplicata: true })
    expect(original.html).not.toContain('DUPLICATA')
    expect(copy.html).toContain('<div class="stamp dup">DUPLICATA</div>')
    expect(copy.html).toContain('original établi le')
    expect(copy.filename).toContain('(duplicata)')
    const ticket = await printable(admin, bl.id, 'ticket', false, { duplicata: true })
    expect(ticket.html).toContain('DUPLICATA')
  })

  it('un document annulé peut être refait ; une facture peut recevoir plusieurs avoirs', async () => {
    const dev = await quote()
    const bl = await ok(admin, 'documents.convert', { id: dev, to: 'BL' })
    await ok(admin, 'documents.validate', { id: bl.id })
    await ok(admin, 'documents.cancel', { id: bl.id })
    const redo = await ok(admin, 'documents.convert', { id: dev, to: 'BL' })
    expect(redo.id).not.toBe(bl.id)
    expect(redo.existing).toBeFalsy()

    const fac = await ok(admin, 'documents.convert', { id: dev, to: 'FAC' })
    await ok(admin, 'documents.validate', { id: fac.id })
    const av1 = await ok(admin, 'documents.convert', { id: fac.id, to: 'AV' })
    const av2 = await ok(admin, 'documents.convert', { id: fac.id, to: 'AV' })
    expect(av2.id).not.toBe(av1.id)
  })
})
