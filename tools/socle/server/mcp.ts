// Serveur MCP des applications IAM (base commune : source iam-erp/tools/socle, recopiée par sync.mjs ;
// ne pas modifier ici). Il ouvre l'application aux assistants (Claude, ChatGPT, Cursor…) par le
// protocole MCP : chaque outil est un appel de l'API, décrit pour qu'un assistant sache s'en servir.
//   • Adresse : POST /api/mcp (transport « Streamable HTTP », sans session, réponses JSON).
//   • Accès : la clé d'API de l'espace (Authorization: Bearer iak_…), avec les mêmes droits et les
//     mêmes limites que /api/v1 : une clé en lecture seule ne voit que les outils de consultation.
//   • Aucune dépendance : le protocole (JSON-RPC 2.0) est traité ici, pour les onze applications.
import type { IncomingMessage, ServerResponse } from 'node:http'

/** Argument d'un outil. */
export interface McpArg {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object'
  /** Ce que l'assistant doit y mettre (format, exemple, valeurs possibles). */
  description: string
  required?: boolean
  enum?: (string | number)[]
  /** Schéma des éléments d'un tableau. */
  items?: Record<string, unknown>
  /** Schéma des champs d'un objet. */
  properties?: Record<string, unknown>
}

/** Outil proposé aux assistants : un appel de l'API de l'application. */
export interface McpTool {
  /** Appel de l'API (« sites.list ») ; l'outil s'appelle « sites_list ». */
  call: string
  /** Libellé court (« Liste des chantiers »). */
  title: string
  /** Ce que fait l'outil, ce qu'il renvoie, quand s'en servir. */
  description: string
  args?: Record<string, McpArg>
  /** Faux : l'appel a un effet (envoi, import…) bien que la clé en lecture y ait droit. */
  readOnly?: false
  /** Supprime ou annule des données (par défaut : d'après le nom de l'appel). */
  destructive?: boolean
}

/** Droits de la clé présentée. */
export interface McpAccess {
  /** Appel refusé à cette clé ? (message de refus, ou null) */
  refusal: (call: string) => string | null
  /** Appel de simple consultation ? */
  readOnly: (call: string) => boolean
  /** Passage permis par la limite d'appels ? */
  take: () => boolean
  run: (call: string, args: unknown, req: IncomingMessage) => Promise<{ ok: boolean; data?: unknown; error?: string }>
}

export interface McpOptions {
  /** Nom affiché de l'application (IAM BTP…). */
  app: string
  version?: string
  tools: McpTool[]
  /** Clé présentée → droits, ou null si elle est absente, invalide ou révoquée. */
  access: (key: string) => Promise<McpAccess | null>
  /** Présentation donnée à l'assistant à la connexion. */
  instructions?: string
}

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
const DEFAULT_VERSION = '2025-06-18'
const MAX_TEXT = 60_000
const DESTRUCTIVE = /\.(remove|delete|cancel|purge|revoke|archive|void|close)\w*$/i

/** Nom de l'outil : « sites.list » → « sites_list ». */
export const toolName = (call: string) => call.replace(/\./g, '_')

const slug = (app: string) =>
  app
    .normalize('NFD')
    .replace(/[^\x20-\x7e]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

function inputSchema(t: McpTool) {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const [k, a] of Object.entries(t.args ?? {})) {
    properties[k] = { type: a.type, description: a.description, ...(a.enum ? { enum: a.enum } : {}), ...(a.items ? { items: a.items } : {}), ...(a.properties ? { properties: a.properties } : {}) }
    if (a.required) required.push(k)
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}) }
}

/** Valeur d'un argument contraire à son type ou à ses valeurs permises ? (message, ou rien) */
function argProblem(name: string, a: McpArg, v: unknown): string {
  if (v === undefined || v === null) return ''
  const ok =
    a.type === 'string'
      ? typeof v === 'string'
      : a.type === 'number'
        ? typeof v === 'number' && Number.isFinite(v)
        : a.type === 'integer'
          ? Number.isInteger(v)
          : a.type === 'boolean'
            ? typeof v === 'boolean'
            : a.type === 'array'
              ? Array.isArray(v)
              : typeof v === 'object' && !Array.isArray(v)
  const kinds = { string: 'un texte', number: 'un nombre', integer: 'un nombre entier', boolean: 'true ou false', array: 'une liste', object: 'un objet' }
  if (!ok) return `Argument ${name} : ${kinds[a.type]} est attendu.`
  if (a.enum && !a.enum.includes(v as string | number)) return `Argument ${name} : valeur inconnue ; valeurs permises : ${a.enum.join(', ')}.`
  return ''
}

/** Résultat en texte : JSON compact ; une longue liste est coupée proprement, avec son total. */
export function renderResult(data: unknown): string {
  const full = JSON.stringify(data ?? null)
  if (full.length <= MAX_TEXT) return full
  if (Array.isArray(data)) {
    const shown: unknown[] = []
    let size = 0
    for (const x of data) {
      const s = JSON.stringify(x ?? null)
      if (size + s.length > MAX_TEXT) break
      shown.push(x)
      size += s.length + 1
    }
    return JSON.stringify({ tronque: true, total: data.length, affiches: shown.length, conseil: 'Liste coupée : précisez les filtres de l’outil pour voir la suite.', elements: shown })
  }
  return `${full.slice(0, MAX_TEXT)}\n… [résultat coupé à ${MAX_TEXT} caractères sur ${full.length} : précisez les filtres de l’outil]`
}

/** Défauts d'un catalogue (pour les tests de chaque application) : appels inconnus, doublons, descriptions vides. */
export function catalogProblems(tools: McpTool[], calls: Iterable<string>): string[] {
  const known = new Set(calls)
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of tools) {
    const name = toolName(t.call)
    if (!known.has(t.call)) out.push(`${t.call} : appel inconnu de l’application`)
    if (seen.has(name)) out.push(`${t.call} : outil en double`)
    seen.add(name)
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) out.push(`${t.call} : nom d’outil invalide`)
    if (!t.title.trim() || t.description.trim().length < 20) out.push(`${t.call} : titre ou description trop court`)
    for (const [k, a] of Object.entries(t.args ?? {})) if (!a.description.trim()) out.push(`${t.call}.${k} : argument sans description`)
  }
  return out
}

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: any }

const rpcError = (id: Rpc['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

function send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers })
  res.end(body === undefined ? '' : JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    // Même limite que /api/v1 (photos jointes à un rapport, par exemple)
    if (size > 2 * 1024 * 1024) throw Object.assign(new Error('Requête trop volumineuse.'), { status: 413 })
    chunks.push(c as Buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

export class McpEndpoint {
  private byName = new Map<string, McpTool>()

  constructor(private opts: McpOptions) {
    for (const t of opts.tools) this.byName.set(toolName(t.call), t)
  }

  get size() {
    return this.byName.size
  }

  /** Outils visibles avec cette clé. */
  private list(access: McpAccess) {
    return [...this.byName.entries()]
      .filter(([, t]) => !access.refusal(t.call))
      .map(([name, t]) => {
        const readOnly = t.readOnly !== false && access.readOnly(t.call)
        return {
          name,
          title: t.title,
          description: t.description,
          inputSchema: inputSchema(t),
          annotations: { title: t.title, readOnlyHint: readOnly, destructiveHint: !readOnly && (t.destructive ?? DESTRUCTIVE.test(t.call)), openWorldHint: false }
        }
      })
  }

  private async callTool(access: McpAccess, params: any, req: IncomingMessage, id: Rpc['id']) {
    const tool = this.byName.get(String(params?.name ?? ''))
    if (!tool) return rpcError(id, -32602, `Outil inconnu : ${String(params?.name ?? '')}. Demandez la liste des outils (tools/list).`)
    const text = (t: string, isError = false) => ({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: t }], isError } })
    const refused = access.refusal(tool.call)
    if (refused) return text(refused, true)
    const args = params?.arguments ?? {}
    if (typeof args !== 'object' || Array.isArray(args)) return text('Les arguments doivent être un objet JSON.', true)
    const missing = Object.entries(tool.args ?? {})
      .filter(([k, a]) => a.required && (args[k] === undefined || args[k] === null || args[k] === ''))
      .map(([k]) => k)
    if (missing.length) return text(`Argument${missing.length > 1 ? 's' : ''} manquant${missing.length > 1 ? 's' : ''} : ${missing.join(', ')}.`, true)
    // Type et valeurs permises : refusés ici, car les services retombent souvent en silence sur une valeur par défaut
    const wrong = Object.entries(tool.args ?? {})
      .map(([k, a]) => argProblem(k, a, args[k]))
      .filter(Boolean)
    if (wrong.length) return text(wrong.join(' '), true)
    if (!access.take()) return text('Trop d’appels : 120 par minute au plus. Réessayez dans une minute.', true)
    try {
      const out = await access.run(tool.call, args, req)
      return out?.ok ? text(renderResult(out.data)) : text(String(out?.error || 'Appel refusé.'), true)
    } catch (e: any) {
      // Refus de l'application (licence, règle métier) : message utile ; panne : message neutre
      const status = Number(e?.status) || 500
      if (status >= 500) console.error('[mcp]', tool.call, e)
      return text(status >= 500 ? 'Erreur interne du serveur.' : String(e?.message ?? e), true)
    }
  }

  private async answer(access: McpAccess, m: Rpc, req: IncomingMessage): Promise<unknown | null> {
    if (!m || typeof m !== 'object' || m.jsonrpc !== '2.0') return rpcError((m as any)?.id, -32600, 'Message JSON-RPC invalide.')
    // Notification ou réponse du client : rien à renvoyer
    if (m.id === undefined || m.id === null || typeof m.method !== 'string') return null
    switch (m.method) {
      case 'initialize': {
        const asked = String(m.params?.protocolVersion ?? '')
        return {
          jsonrpc: '2.0',
          id: m.id,
          result: {
            protocolVersion: VERSIONS.includes(asked) ? asked : DEFAULT_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: slug(this.opts.app), title: this.opts.app, version: this.opts.version ?? '1.0.0' },
            instructions:
              this.opts.instructions ??
              `${this.opts.app} : chaque outil est une fonction du logiciel, exécutée au nom de l’administrateur qui a créé la clé d’API. Les dates sont au format AAAA-MM-JJ et les montants, quand il y en a, en francs CFA (XOF). Consultez avant de modifier, et demandez confirmation à la personne avant toute suppression.`
          }
        }
      }
      case 'ping':
        return { jsonrpc: '2.0', id: m.id, result: {} }
      case 'tools/list':
        return { jsonrpc: '2.0', id: m.id, result: { tools: this.list(access) } }
      case 'tools/call':
        return this.callTool(access, m.params, req, m.id)
      default:
        return rpcError(m.id, -32601, `Méthode inconnue : ${m.method}`)
    }
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<true> {
    try {
      // Pas de flux ouvert par le serveur ni de session : seul POST est servi
      if (req.method !== 'POST') return send(res, 405, rpcError(null, -32000, 'Méthode non autorisée : envoyez les messages en POST.'), { Allow: 'POST' }), true
      const key = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1] ?? String(req.headers['x-api-key'] ?? '')
      const access = key ? await this.opts.access(key) : null
      if (!access) return send(res, 401, rpcError(null, -32001, 'Clé d’API absente, invalide ou révoquée (en-tête Authorization: Bearer <clé>).'), { 'WWW-Authenticate': 'Bearer' }), true
      let body: unknown
      try {
        body = await readBody(req)
      } catch (e: any) {
        return send(res, Number(e?.status) || 400, rpcError(null, -32700, e?.status ? String(e.message) : 'JSON invalide.')), true
      }
      if (Array.isArray(body)) {
        if (!body.length || body.length > 20) return send(res, 400, rpcError(null, -32600, 'Lot de messages vide ou trop long (20 au plus).')), true
        const out = (await Promise.all(body.map((m) => this.answer(access, m as Rpc, req)))).filter(Boolean)
        return out.length ? send(res, 200, out) : send(res, 202), true
      }
      const out = await this.answer(access, body as Rpc, req)
      return out ? send(res, 200, out) : send(res, 202), true
    } catch (e) {
      console.error('[mcp]', e)
      if (!res.headersSent) send(res, 500, rpcError(null, -32603, 'Erreur interne du serveur.'))
      return true
    }
  }
}
