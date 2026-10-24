// Fichiers exportés (tableaux CSV pour Excel) vers les applications installées sur téléphone (base
// commune : source iam-erp/tools/socle, recopiée par sync.mjs). Dans l'application Android ou iPhone,
// un téléchargement direct n'aboutit pas : l'application confie le fichier au serveur, qui le garde
// 10 minutes derrière une adresse imprévisible, puis le navigateur du téléphone l'ouvre (enregistrer,
// partager, ouvrir dans Excel). Sur ordinateur et dans le navigateur, le fichier est enregistré
// directement, sans passer par ici.
//   POST /api/socle/export          { name, content } (compte connecté) → { url }
//   GET  /api/socle/export/<jeton>  le fichier, 10 minutes
import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

const TTL_MS = 10 * 60_000
/** Taille maximale d'un fichier exporté (texte). */
const MAX_BYTES = 8 * 1024 * 1024
/** Fichiers gardés en même temps au plus (les plus anciens partent d'abord). */
const MAX_FILES = 200

interface Kept {
  name: string
  body: Buffer
  expires: number
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

/** Nom de fichier sûr : lettres (accents compris), chiffres, espaces, tirets, points ; extension .csv. */
export function exportName(raw: unknown): string {
  const base = String(raw ?? '')
    .replace(/\.csv$/i, '')
    .replace(/[^\p{L}\p{N} ._-]+/gu, '-')
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
    .slice(0, 80)
  return `${base || 'export'}.csv`
}

export class ExportService {
  private files = new Map<string, Kept>()

  constructor(private resolveUser: (token: string) => Promise<{ id: number } | null | undefined>) {}

  /** Garde un fichier 10 minutes ; renvoie son adresse. */
  keep(name: string, content: string): string {
    const now = Date.now()
    for (const [k, f] of this.files) if (f.expires < now) this.files.delete(k)
    while (this.files.size >= MAX_FILES) this.files.delete(this.files.keys().next().value as string)
    const key = randomBytes(24).toString('base64url')
    this.files.set(key, { name: exportName(name), body: Buffer.from(content, 'utf8'), expires: now + TTL_MS })
    return `/api/socle/export/${key}`
  }

  async handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
    if (path === '/api/socle/export' && req.method === 'POST') {
      const token = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1] ?? ''
      const user = token ? await this.resolveUser(token) : null
      if (!user) return json(res, 401, { ok: false, error: 'Session expirée, veuillez vous reconnecter.' }), true
      const chunks: Buffer[] = []
      let size = 0
      for await (const c of req) {
        size += (c as Buffer).length
        if (size > MAX_BYTES + 4096) return json(res, 413, { ok: false, error: 'Fichier trop volumineux : affinez la liste avant de l’exporter.' }), true
        chunks.push(c as Buffer)
      }
      let body: { name?: unknown; content?: unknown }
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      } catch {
        return json(res, 400, { ok: false, error: 'JSON invalide.' }), true
      }
      if (typeof body.content !== 'string' || !body.content) return json(res, 400, { ok: false, error: 'Rien à exporter.' }), true
      return json(res, 200, { ok: true, data: { url: this.keep(String(body.name ?? ''), body.content) } }), true
    }
    if (path.startsWith('/api/socle/export/') && (req.method === 'GET' || req.method === 'HEAD')) {
      const f = this.files.get(path.slice('/api/socle/export/'.length))
      if (!f || f.expires < Date.now()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
        res.end('Ce fichier n’est plus disponible : relancez l’export depuis l’application.')
        return true
      }
      const ascii = f.name.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/"/g, '') || 'export.csv'
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Length': f.body.length,
        'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      })
      res.end(req.method === 'HEAD' ? undefined : f.body)
      return true
    }
    return false
  }
}
