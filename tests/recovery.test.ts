// « Mot de passe oublié ? » d'IAM INVOICER (serveur web, base commune tools/socle/server/recovery.ts) :
// e-mail de récupération choisi dans « Mon compte », code envoyé par la console d'IAM Technology (simulée
// ici), nouveau mot de passe, sessions fermées ; jamais dans la société de démonstration.
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../src/main/db'
import { createHandler } from '../src/server/app'

let db: Db
let server: Server
let consoleSrv: Server
let base = ''
const relayed: { channel: string; to: string; code: string; app: string; name: string }[] = []

const post = async (path: string, body: unknown, token?: string) => {
  const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
  return { status: r.status, json: await r.json() }
}
const until = async (test: () => boolean) => {
  for (let i = 0; i < 100 && !test(); i++) await new Promise((r) => setTimeout(r, 30))
}

beforeAll(async () => {
  consoleSrv = createServer(async (rq, rs) => {
    let body = ''
    for await (const c of rq) body += c
    if (rq.method === 'POST') relayed.push(JSON.parse(body))
    rs.writeHead(200, { 'Content-Type': 'application/json' })
    rs.end(JSON.stringify({ ok: true, data: rq.method === 'GET' ? { email: true, whatsapp: true } : { sent: true } }))
  })
  await new Promise<void>((r) => consoleSrv.listen(0, '127.0.0.1', r))
  process.env.CONSOLE_URL = `http://127.0.0.1:${(consoleSrv.address() as { port: number }).port}`
  process.env.CONSOLE_TOKEN = 'jeton-console-de-test-0123456789abcdef'
  db = await openDb({ mode: 'local' })
  const webRoot = join(tmpdir(), `iam-recovery-web-${process.pid}`)
  mkdirSync(webRoot, { recursive: true })
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>IAM INVOICER</title>')
  server = createServer(createHandler({ db, version: 'test', webRoot }))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterAll(async () => {
  delete process.env.CONSOLE_URL
  delete process.env.CONSOLE_TOKEN
  await new Promise((r) => server?.close(r))
  await new Promise((r) => consoleSrv?.close(r))
  await db?.close()
})

describe('IAM INVOICER : mot de passe oublié', () => {
  it('e-mail de récupération choisi, code reçu, nouveau mot de passe, sessions fermées', async () => {
    const t = (await post('/api/setup', { company: { name: 'IAM Technology' }, username: 'admin', full_name: 'Awa Patronne', password: 'secret123' })).json.data.token
    // Aucune coordonnée : demande acceptée, mais rien n'est envoyé (l'administrateur reste le recours)
    expect((await post('/api/socle/recovery/request', { identifier: 'admin' })).json.data).toEqual({ sent: true })
    await new Promise((r) => setTimeout(r, 150))
    expect(relayed).toHaveLength(0)
    expect((await post('/api/socle/recovery/contacts', { email: 'awa@iamtechnology.store', phone: '', password: 'faux' }, t)).json.error).toMatch(/incorrect/)
    expect((await post('/api/socle/recovery/contacts', { email: 'awa@iamtechnology.store', phone: '+226 70 11 22 33', password: 'secret123' }, t)).json.data).toMatchObject({ email: 'awa@iamtechnology.store', demo: false })

    expect((await post('/api/socle/recovery/request', { identifier: 'ADMIN' })).json.data).toEqual({ sent: true })
    await until(() => relayed.length >= 2)
    expect(relayed.map((r) => [r.channel, r.to, r.app, r.name])).toEqual([
      ['email', 'awa@iamtechnology.store', 'IAM INVOICER', 'Awa Patronne'],
      ['whatsapp', '22670112233', 'IAM INVOICER', 'Awa Patronne']
    ])
    const code = relayed[0].code
    expect(relayed[1].code).toBe(code)
    expect((await post('/api/socle/recovery/reset', { identifier: 'admin', code, password: 'court' })).json.error).toMatch(/8 caractères/)
    expect((await post('/api/socle/recovery/reset', { identifier: 'admin', code, password: 'nouveau-secret-2026' })).json.data).toEqual({ reset: true })
    // Ancienne session fermée ; le nouveau mot de passe ouvre une session, l'ancien non
    expect((await post('/api/call', { name: 'settings.get' }, t)).status).toBe(401)
    expect((await post('/api/login', { username: 'admin', password: 'nouveau-secret-2026' })).json.ok).toBe(true)
    expect((await post('/api/login', { username: 'admin', password: 'secret123' })).json.ok).toBe(false)
    // Trace dans le journal d'audit, sans le code
    const audit = await db.query<{ details: string }>("SELECT details FROM audit_log WHERE action = 'recuperation' ORDER BY id")
    expect(audit.map((a) => a.details)).toContain('Mot de passe réinitialisé avec un code de récupération (sessions fermées)')
    expect(JSON.stringify(audit)).not.toContain(code)
  })
})
