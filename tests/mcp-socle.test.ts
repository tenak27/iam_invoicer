// Serveur MCP de la base commune (tools/socle/server/mcp.ts) : protocole, droits de la clé, résultats.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { catalogProblems, McpEndpoint, renderResult, toolName, type McpTool } from '../tools/socle/server/mcp'

const TOOLS: McpTool[] = [
  { call: 'sites.list', title: 'Liste des chantiers', description: 'Chantiers de l’entreprise, avec leur état.', args: { status: { type: 'string', description: 'Filtre par état', enum: ['en_cours', 'termine'] } } },
  { call: 'sites.save', title: 'Enregistrer un chantier', description: 'Crée ou modifie un chantier de l’entreprise.', args: { name: { type: 'string', description: 'Nom du chantier', required: true } } },
  { call: 'sites.remove', title: 'Supprimer un chantier', description: 'Supprime un chantier et ses rapports.', args: { id: { type: 'integer', description: 'Numéro du chantier', required: true } } },
  { call: 'team.list', title: 'Équipe', description: 'Appel fermé aux clés : ne doit jamais apparaître.' }
]
const READ = /\.list$/
const calls: { call: string; args: any }[] = []
let budget = 100
let server: Server
let url = ''

const rpc = async (body: unknown, key?: string) => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body) })
  const text = await r.text()
  return { status: r.status, json: text ? JSON.parse(text) : null, headers: r.headers }
}
const ask = (method: string, params?: unknown, key = 'ecriture') => rpc({ jsonrpc: '2.0', id: 1, method, params }, key)

beforeAll(async () => {
  const mcp = new McpEndpoint({
    app: 'IAM Éssai',
    version: '1.2.3',
    tools: TOOLS,
    access: async (key) => {
      if (key !== 'lecture' && key !== 'ecriture') return null
      return {
        refusal: (call) => (call.startsWith('team.') ? 'Fermé aux clés.' : key === 'lecture' && !READ.test(call) ? 'Clé en lecture seule : cet appel modifie des données.' : null),
        readOnly: (call) => READ.test(call),
        take: () => budget-- > 0,
        run: async (call, args) => {
          calls.push({ call, args })
          if (call === 'sites.save' && (args as any).name === 'refus') return { ok: false, error: 'Nom déjà pris.' }
          if (call === 'sites.save' && (args as any).name === 'licence') throw Object.assign(new Error('Limite de la formule atteinte.'), { status: 402 })
          if (call === 'sites.save' && (args as any).name === 'panne') throw new Error('secret interne')
          return { ok: true, data: call === 'sites.list' ? [{ id: 1, name: 'Villa' }] : { id: 2 } }
        }
      }
    }
  })
  server = createServer((req, res) => void mcp.handle(req, res))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/mcp`
})
afterAll(() => server.close())

describe('Base commune : serveur MCP', () => {
  it('refuse sans clé, et tout ce qui n’est pas un POST', async () => {
    const none = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(none.status).toBe(401)
    expect(none.headers.get('www-authenticate')).toBe('Bearer')
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'fausse')).status).toBe(401)
    const get = await fetch(url, { headers: { Authorization: 'Bearer lecture' } })
    expect(get.status).toBe(405)
    expect(get.headers.get('allow')).toBe('POST')
  })

  it('se présente, garde la version du protocole demandée et répond au ping', async () => {
    const init = await ask('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
    expect(init.status).toBe(200)
    expect(init.json.result.protocolVersion).toBe('2025-03-26')
    expect(init.json.result.serverInfo).toEqual({ name: 'iam-essai', title: 'IAM Éssai', version: '1.2.3' })
    expect(init.json.result.capabilities.tools).toBeTruthy()
    expect((await ask('initialize', { protocolVersion: '1999-01-01' })).json.result.protocolVersion).toBe('2025-06-18')
    expect((await ask('ping')).json.result).toEqual({})
    // Notification : acceptée sans corps
    const note = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, 'lecture')
    expect(note.status).toBe(202)
    expect(note.json).toBeNull()
    expect((await ask('resources/list')).json.error.code).toBe(-32601)
    expect((await rpc({ id: 1, method: 'ping' }, 'lecture')).json.error.code).toBe(-32600)
  })

  it('ne montre à une clé que les outils qui lui sont permis', async () => {
    const write = (await ask('tools/list')).json.result.tools
    expect(write.map((t: any) => t.name)).toEqual(['sites_list', 'sites_save', 'sites_remove'])
    expect(write[0].annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false })
    expect(write[1].annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false })
    expect(write[2].annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true })
    expect(write[0].inputSchema).toEqual({ type: 'object', properties: { status: { type: 'string', description: 'Filtre par état', enum: ['en_cours', 'termine'] } } })
    expect(write[1].inputSchema.required).toEqual(['name'])
    const read = (await ask('tools/list', undefined, 'lecture')).json.result.tools
    expect(read.map((t: any) => t.name)).toEqual(['sites_list'])
  })

  it('exécute un outil, et rend les refus lisibles par l’assistant', async () => {
    const list = (await ask('tools/call', { name: 'sites_list', arguments: { status: 'en_cours' } }, 'lecture')).json.result
    expect(list.isError).toBe(false)
    expect(JSON.parse(list.content[0].text)).toEqual([{ id: 1, name: 'Villa' }])
    expect(calls.at(-1)).toEqual({ call: 'sites.list', args: { status: 'en_cours' } })

    const before = calls.length
    const denied = (await ask('tools/call', { name: 'sites_save', arguments: { name: 'Immeuble' } }, 'lecture')).json.result
    expect(denied.isError).toBe(true)
    expect(denied.content[0].text).toContain('lecture seule')
    expect((await ask('tools/call', { name: 'team_list' })).json.result.isError).toBe(true)
    const missing = (await ask('tools/call', { name: 'sites_save', arguments: {} })).json.result
    expect(missing.isError).toBe(true)
    expect(missing.content[0].text).toContain('name')
    // Type ou valeur hors liste : refusé avant l'appel, avec les valeurs permises
    const type = (await ask('tools/call', { name: 'sites_remove', arguments: { id: '3' } })).json.result
    expect(type).toMatchObject({ isError: true, content: [{ text: 'Argument id : un nombre entier est attendu.' }] })
    const value = (await ask('tools/call', { name: 'sites_list', arguments: { status: 'fini' } })).json.result
    expect(value.content[0].text).toContain('en_cours, termine')
    expect(calls.length).toBe(before)

    expect((await ask('tools/call', { name: 'sites_save', arguments: { name: 'Immeuble' } })).json.result.isError).toBe(false)
    expect((await ask('tools/call', { name: 'sites_save', arguments: { name: 'refus' } })).json.result.content[0].text).toBe('Nom déjà pris.')
    expect((await ask('tools/call', { name: 'sites_save', arguments: { name: 'licence' } })).json.result.content[0].text).toBe('Limite de la formule atteinte.')
    // Une panne ne dit rien de l'intérieur du serveur
    const crash = (await ask('tools/call', { name: 'sites_save', arguments: { name: 'panne' } })).json.result
    expect(crash).toMatchObject({ isError: true, content: [{ text: 'Erreur interne du serveur.' }] })
    expect((await ask('tools/call', { name: 'inconnu' })).json.error.code).toBe(-32602)
  })

  it('applique la limite d’appels', async () => {
    budget = 0
    const r = (await ask('tools/call', { name: 'sites_list' })).json.result
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain('Trop d’appels')
    budget = 100
  })

  it('coupe proprement une liste trop longue et contrôle un catalogue', () => {
    const rows = Array.from({ length: 5000 }, (_, i) => ({ id: i, label: 'x'.repeat(40) }))
    const out = JSON.parse(renderResult(rows))
    expect(out.tronque).toBe(true)
    expect(out.total).toBe(5000)
    expect(out.affiches).toBe(out.elements.length)
    expect(out.affiches).toBeLessThan(5000)
    expect(renderResult(undefined)).toBe('null')
    expect(toolName('stock.byWarehouse')).toBe('stock_byWarehouse')
    expect(catalogProblems(TOOLS, ['sites.list', 'sites.save', 'sites.remove', 'team.list'])).toEqual([])
    const bad = catalogProblems([...TOOLS, TOOLS[0], { call: 'x.y', title: '', description: 'court' }], ['sites.list', 'sites.save', 'sites.remove', 'team.list'])
    expect(bad).toHaveLength(3)
  })
})
