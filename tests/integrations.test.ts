// API et webhooks d'IAM INVOICER (serveur web, base commune tools/socle/server/integrations.ts) : clés en
// lecture et en écriture, appels interdits, webhooks signés tirés des documents et des paiements,
// verrouillage levé seulement par le mot de passe de l'administrateur.
import { createHmac } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../src/main/db'
import { createHandler } from '../src/server/app'

let db: Db
let server: Server
let hook: Server
let base = ''
let hookUrl = ''
const received: { headers: Record<string, any>; body: string }[] = []

const post = async (path: string, body: unknown, token?: string) => {
  const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
  return { status: r.status, json: await r.json() }
}
const rpc = async (name: string, args: unknown, token: string) => {
  const r = (await post('/api/call', { name, args }, token)).json
  if (!r.ok) throw new Error(`${name} : ${r.error}`)
  return r.data
}
const v1 = async (name: string, key: string, body?: unknown) => {
  const r = await fetch(base + '/api/v1/' + name, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  return { status: r.status, json: await r.json() }
}
const until = async (test: () => boolean) => {
  for (let i = 0; i < 100 && !test(); i++) await new Promise((r) => setTimeout(r, 30))
}

beforeAll(async () => {
  // Le logiciel qui reçoit les webhooks tourne ici sur la machine de test
  process.env.WEBHOOK_ALLOW_PRIVATE = '1'
  db = await openDb({ mode: 'local' })
  const webRoot = join(tmpdir(), `iam-integrations-web-${process.pid}`)
  mkdirSync(webRoot, { recursive: true })
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>IAM INVOICER</title>')
  server = createServer(createHandler({ db, version: 'test', webRoot }))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  hook = createServer(async (rq, rs) => {
    let body = ''
    for await (const c of rq) body += c
    received.push({ headers: rq.headers, body })
    rs.writeHead(200)
    rs.end('ok')
  })
  await new Promise<void>((r) => hook.listen(0, '127.0.0.1', r))
  hookUrl = `http://127.0.0.1:${(hook.address() as { port: number }).port}/iam`
})
afterAll(async () => {
  delete process.env.WEBHOOK_ALLOW_PRIVATE
  await new Promise((r) => server?.close(r))
  await new Promise((r) => hook?.close(r))
  await db?.close()
})

describe('IAM INVOICER : API et webhooks', () => {
  it('clés, facture validée et paiement transmis aux webhooks, verrouillage par mot de passe', async () => {
    const t = (await post('/api/setup', { company: { name: 'IAM Technology' }, username: 'admin', full_name: 'Admin', password: 'secret123' })).json.data.token
    const lecture = (await post('/api/socle/integrations/key', { name: 'Comptabilité', scope: 'lecture' }, t)).json.data.key
    const ecriture = (await post('/api/socle/integrations/key', { name: 'Boutique en ligne', scope: 'ecriture' }, t)).json.data.key
    expect(lecture).toMatch(/^iak_/)
    const list = await v1('parties.list?kind=client', lecture)
    expect(list.status).toBe(200)
    expect(list.json.ok).toBe(true)
    expect((await v1('parties.save', lecture, { kind: 'client', name: 'Interdit' })).status).toBe(403)
    expect((await v1('messages.sendEmail', ecriture, {})).status).toBe(403)
    expect((await v1('users.save', ecriture, { username: 'pirate' })).status).toBe(403)
    const view = (await (await fetch(base + '/api/socle/integrations', { headers: { Authorization: `Bearer ${t}` } })).json()).data
    expect(view.api).toBe(`${base}/api/v1/`)
    expect(view.demo).toBe(false)

    const h = (await post('/api/socle/integrations/webhook', { url: hookUrl, events: ['document.validated', 'payment.received'] }, t)).json.data
    const client = await rpc('parties.save', { kind: 'client', name: 'Coris Bank' }, t)
    const fac = await rpc('documents.save', { type: 'FAC', party_id: client.id, validate: true, taxes: [], lines: [{ description: 'Audit réseau', quantity: 1, unit_price: 100000, tva_rate: 18 }] }, t)
    await until(() => received.length > 0)
    const first = received[0]
    expect(first.headers['x-iam-event']).toBe('document.validated')
    expect(first.headers['x-iam-signature']).toBe('sha256=' + createHmac('sha256', h.secret).update(first.body).digest('hex'))
    const facture = JSON.parse(first.body).data
    expect(facture).toMatchObject({ id: fac.id, type: 'FAC', status: 'valide', total_ttc: 118000, party: 'Coris Bank' })
    expect(facture.number).toBeTruthy()
    // Paiement enregistré par un logiciel tiers (clé en écriture)
    const paid = await v1('payments.add', ecriture, { document_id: fac.id, amount: 50000, method: 'Espèces' })
    expect(paid.json.ok).toBe(true)
    await until(() => received.length > 1)
    expect(JSON.parse(received[1].body)).toMatchObject({ event: 'payment.received', data: { amount: 50000, method: 'Espèces', document: { number: facture.number } } })

    expect((await post('/api/socle/integrations/lock', {}, t)).json.data).toMatchObject({ locked: true, editable: false })
    expect((await post('/api/socle/integrations/webhook/remove', { id: 1 }, t)).json.error).toMatch(/verrouillées/)
    expect((await post('/api/socle/integrations/unlock', { password: 'faux' }, t)).json.error).toMatch(/incorrect/)
    expect((await post('/api/socle/integrations/unlock', { password: 'secret123' }, t)).json.data.editable).toBe(true)
    expect((await v1('parties.list?kind=client', lecture)).status).toBe(200)
  })
})
