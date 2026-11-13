// Serveur MCP d'IAM INVOICER (/api/mcp, base commune tools/socle/server/mcp.ts) : catalogue des outils
// (src/server/mcp.ts) cohérent avec le routeur, et parcours d'un assistant de bout en bout par HTTP,
// avec une clé en lecture seule puis une clé en écriture ; même service sous l'adresse d'un client hébergé.
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../src/main/db'
import { CALLS } from '../src/main/router'
import { createHandler } from '../src/server/app'
import { integrationsConfig } from '../src/server/integrations'
import { MCP_TOOLS } from '../src/server/mcp'
import { catalogProblems, toolName } from '../tools/socle/server/mcp'

let db: Db
let server: Server
let tenant: Server
let base = ''
let tenantBase = ''

const post = async (path: string, body: unknown, token?: string, origin = base) => {
  const r = await fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
  return { status: r.status, json: await r.json() }
}
let seq = 0
const mcp = (method: string, params: unknown, key?: string, origin = base) => post('/api/mcp', { jsonrpc: '2.0', id: ++seq, method, params }, key, origin)
const tools = async (key: string) => (await mcp('tools/list', {}, key)).json.result.tools as { name: string; annotations: { readOnlyHint: boolean; destructiveHint: boolean } }[]
const run = async (name: string, args: unknown, key: string) => {
  const r = (await mcp('tools/call', { name, arguments: args }, key)).json.result
  return { isError: r.isError as boolean, text: r.content[0].text as string, data: r.isError ? null : JSON.parse(r.content[0].text) }
}

beforeAll(async () => {
  db = await openDb({ mode: 'local' })
  const webRoot = join(tmpdir(), `iam-mcp-web-${process.pid}`)
  mkdirSync(webRoot, { recursive: true })
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>IAM INVOICER</title>')
  server = createServer(createHandler({ db, version: '9.8.7', webRoot }))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  // Client hébergé : le serveur multi-clients (cloud.ts) retire « /t/<client> » de l'adresse puis passe la main
  const inner = createHandler({ db, version: '9.8.7', webRoot, publicPath: '/t/acme', clientSpace: true })
  tenant = createServer((rq, rs) => {
    rq.url = (rq.url ?? '/').replace(/^\/t\/acme/, '')
    void inner(rq, rs)
  })
  await new Promise<void>((r) => tenant.listen(0, '127.0.0.1', r))
  tenantBase = `http://127.0.0.1:${(tenant.address() as { port: number }).port}/t/acme`
})
afterAll(async () => {
  await new Promise((r) => server?.close(r))
  await new Promise((r) => tenant?.close(r))
  await db?.close()
})

describe('IAM INVOICER : serveur MCP', () => {
  it('catalogue : appels connus du routeur, sans doublon, rien d’interdit, 80 outils au plus', () => {
    expect(catalogProblems(MCP_TOOLS, CALLS)).toEqual([])
    expect(MCP_TOOLS.length).toBeGreaterThan(40)
    expect(MCP_TOOLS.length).toBeLessThanOrEqual(80)
    const cfg = integrationsConfig(db, async () => ({ ok: true }))
    expect(MCP_TOOLS.filter((t) => cfg.forbidden!.test(t.call)).map((t) => t.call)).toEqual([])
    // Toutes les consultations de la règle `read` sont proposées ; l'inventaire, qui écrit dans le stock, n'en fait pas partie
    const read = CALLS.filter((c) => cfg.read!.test(c))
    const offered = new Set(MCP_TOOLS.map((t) => t.call))
    expect(read.filter((c) => !offered.has(c))).toEqual([])
    expect(cfg.read!.test('stock.inventory')).toBe(false)
    // Un argument obligatoire porte une description, une liste de valeurs n'est jamais vide
    for (const t of MCP_TOOLS) for (const a of Object.values(t.args ?? {})) expect(a.enum?.length ?? 1, t.call).toBeGreaterThan(0)
  })

  it('de bout en bout : initialisation, clé en lecture limitée aux consultations, création avec la clé en écriture', async () => {
    const t = (await post('/api/setup', { company: { name: 'IAM Technology' }, username: 'admin', full_name: 'Admin', password: 'secret123' })).json.data.token
    const lecture = (await post('/api/socle/integrations/key', { name: 'Assistant en lecture', scope: 'lecture' }, t)).json.data.key
    const ecriture = (await post('/api/socle/integrations/key', { name: 'Assistant complet', scope: 'ecriture' }, t)).json.data.key

    // Sans clé, ou avec une clé inconnue : refus
    expect((await mcp('initialize', {})).status).toBe(401)
    expect((await mcp('tools/list', {}, 'iak_abcdefgh_' + 'x'.repeat(32))).status).toBe(401)

    const init = await mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } }, lecture)
    expect(init.status).toBe(200)
    expect(init.json.result.serverInfo).toMatchObject({ name: 'iam-invoicer', title: 'IAM INVOICER', version: '9.8.7' })
    expect(init.json.result.protocolVersion).toBe('2025-06-18')
    expect(init.json.result.capabilities.tools).toBeTruthy()

    // Adresse affichée dans Paramètres → API et webhooks
    const view = (await (await fetch(base + '/api/socle/integrations', { headers: { Authorization: `Bearer ${t}` } })).json()).data
    expect(view.mcp).toBe(`${base}/api/mcp`)
    expect(view.mcp_tools).toBe(MCP_TOOLS.length)

    const readTools = await tools(lecture)
    const allTools = await tools(ecriture)
    expect(readTools.length).toBeGreaterThan(0)
    expect(readTools.every((x) => x.annotations.readOnlyHint)).toBe(true)
    expect(readTools.length).toBeLessThan(allTools.length)
    // Aucun outil du catalogue n'est refusé à une clé en écriture (rien d'interdit n'y figure)
    expect(allTools.length).toBe(MCP_TOOLS.length)
    expect(allTools.map((x) => x.name).sort()).toEqual(MCP_TOOLS.map((x) => toolName(x.call)).sort())
    expect(readTools.map((x) => x.name)).not.toContain('parties_save')
    expect(allTools.find((x) => x.name === 'documents_cancel')!.annotations.destructiveHint).toBe(true)
    expect(allTools.find((x) => x.name === 'parties_save')!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false })

    // Consultation avec la clé en lecture
    const empty = await run('parties_list', { kind: 'client' }, lecture)
    expect(empty.isError).toBe(false)
    expect(Array.isArray(empty.data)).toBe(true)
    expect((await run('reports_dashboard', {}, lecture)).data).toHaveProperty('salesMonth')
    // Écriture refusée à la clé en lecture, argument obligatoire manquant signalé
    const refused = await run('parties_save', { kind: 'client', name: 'Interdit' }, lecture)
    expect(refused.isError).toBe(true)
    expect(refused.text).toMatch(/lecture seule/)
    expect((await run('parties_save', { kind: 'client' }, ecriture)).text).toMatch(/manquant : name/)

    // Création avec la clé en écriture, retrouvée en consultation
    const client = await run('parties_save', { kind: 'client', name: 'Coris Bank', phone: '70 00 00 00', payment_terms: 30 }, ecriture)
    expect(client.isError).toBe(false)
    const found = (await run('parties_list', { kind: 'client', search: 'coris' }, lecture)).data
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ id: client.data.id, name: 'Coris Bank', payment_terms: 30 })

    // Facture créée et validée, puis réglée en partie : les arguments décrits sont ceux des services
    const article = await run('products_save', { kind: 'prestation', name: 'Audit réseau', sale_price: 100000, tva_rate: 18 }, ecriture)
    const fac = await run('documents_save', { type: 'FAC', party_id: client.data.id, taxes: [], validate: true, lines: [{ product_id: article.data.id, description: 'Audit réseau', quantity: 1, unit_price: 100000, tva_rate: 18 }] }, ecriture)
    expect(fac.data).toMatchObject({ validated: true })
    expect((await run('payments_add', { document_id: fac.data.id, amount: 50000, method: 'Orange Money', reference: 'OM-1024' }, ecriture)).isError).toBe(false)
    const unpaid = (await run('documents_list', { types: ['FAC'], unpaidOnly: true }, lecture)).data
    expect(unpaid).toHaveLength(1)
    expect(unpaid[0]).toMatchObject({ id: fac.data.id, status: 'valide', total_ttc: 118000, paid: 50000, party_name: 'Coris Bank' })
    expect((await run('documents_get', { id: fac.data.id }, lecture)).data.lines).toHaveLength(1)
    // Refus métier rendu à l'assistant : le paiement dépasse le reste à régler
    const tooMuch = await run('payments_add', { document_id: fac.data.id, amount: 900000, method: 'Espèces' }, ecriture)
    expect(tooMuch.isError).toBe(true)
    expect(tooMuch.text).toMatch(/reste à régler/)

    // CRM et projets
    const opp = await run('crm_save', { title: 'Refonte du réseau', party_id: client.data.id, amount: 590000 }, ecriture)
    expect((await run('crm_move', { id: opp.data.id, stage: 'negociation' }, ecriture)).isError).toBe(false)
    expect((await run('crm_get', { id: opp.data.id }, lecture)).data).toMatchObject({ stage: 'negociation', probability: 75 })
    const prj = await run('projects_save', { name: 'Câblage du siège', party_id: client.data.id, hourly_rate: 15000 }, ecriture)
    expect((await run('projects_saveTime', { project_id: prj.data.id, hours: 2, description: 'Relevé des locaux' }, ecriture)).isError).toBe(false)
    expect((await run('projects_get', { id: prj.data.id }, lecture)).data).toMatchObject({ name: 'Câblage du siège', hours: 2 })

    // Outil inconnu, méthode inconnue
    expect((await mcp('tools/call', { name: 'users_save', arguments: {} }, ecriture)).json.error.code).toBe(-32602)
    expect((await mcp('resources/list', {}, ecriture)).json.error.code).toBe(-32601)
  })

  it('client hébergé : /t/<client>/api/mcp est servi comme /t/<client>/api/v1', async () => {
    const t = (await post('/api/login', { username: 'admin', password: 'secret123' }, undefined, tenantBase)).json.data.token
    const key = (await post('/api/socle/integrations/key', { name: 'Assistant du client', scope: 'lecture' }, t, tenantBase)).json.data.key
    const view = (await (await fetch(tenantBase + '/api/socle/integrations', { headers: { Authorization: `Bearer ${t}` } })).json()).data
    expect(view.api).toBe(`${tenantBase}/api/v1/`)
    expect(view.mcp).toBe(`${tenantBase}/api/mcp`)
    expect((await mcp('initialize', {}, undefined, tenantBase)).status).toBe(401)
    expect((await mcp('initialize', {}, key, tenantBase)).json.result.serverInfo.title).toBe('IAM INVOICER')
    const viaMcp = JSON.parse((await mcp('tools/call', { name: 'parties_list', arguments: { kind: 'client' } }, key, tenantBase)).json.result.content[0].text)
    const viaApi = await (await fetch(tenantBase + '/api/v1/parties.list?kind=client', { headers: { Authorization: `Bearer ${key}` } })).json()
    expect(viaMcp).toEqual(viaApi.data)
    expect(viaMcp.map((p: any) => p.name)).toContain('Coris Bank')
  })
})
