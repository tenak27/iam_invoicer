// Protections communes du serveur web : adresse réelle du visiteur, limitation des essais,
// en-têtes de sécurité et politique de contenu (CSP) des pages servies.

import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'

const PRIVATE = /^(::ffff:)?(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|^::1$|^f[cd][0-9a-f]{2}:/i

/**
 * Adresse du visiteur. Derrière un proxy de confiance (nginx, Caddy), c'est la DERNIÈRE adresse
 * de X-Forwarded-For : celle que le proxy a constatée. Les précédentes sont écrites par le
 * visiteur lui-même et ne doivent pas servir à contourner la limitation des essais.
 */
export function clientIp(req: IncomingMessage, trustProxy = false): string {
  const peer = req.socket.remoteAddress ?? ''
  if (trustProxy && PRIVATE.test(peer)) {
    const chain = String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    const last = chain[chain.length - 1]
    if (last && /^[0-9a-fA-F.:]{3,45}$/.test(last)) return last
  }
  return peer
}

/** Compteur d'échecs par clé (adresse, compte), à mémoire bornée. */
export class Limiter {
  private hits = new Map<string, { n: number; since: number }>()
  constructor(private max: number, private windowMs = 15 * 60_000, private capacity = 20_000) {}

  private get(key: string) {
    const f = this.hits.get(key)
    if (f && Date.now() - f.since > this.windowMs) {
      this.hits.delete(key)
      return undefined
    }
    return f
  }
  blocked(key: string): boolean {
    return (this.get(key)?.n ?? 0) >= this.max
  }
  /** Compte un événement ; rend vrai si la limite est atteinte. */
  hit(key: string): boolean {
    const f = this.get(key) ?? { n: 0, since: Date.now() }
    f.n++
    this.hits.set(key, f)
    if (this.hits.size > this.capacity) this.prune()
    return f.n >= this.max
  }
  reset(key: string) {
    this.hits.delete(key)
  }
  private prune() {
    const now = Date.now()
    for (const [k, f] of this.hits) if (now - f.since > this.windowMs) this.hits.delete(k)
    // Toujours trop : les plus anciennes entrées sortent (Map garde l'ordre d'insertion)
    for (const k of this.hits.keys()) {
      if (this.hits.size <= this.capacity / 2) break
      this.hits.delete(k)
    }
  }
}

/** En-têtes posés sur toutes les réponses. */
export function securityHeaders(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), payment=(), usb=(), camera=(self)')
  // HTTPS constaté par le proxy : le navigateur n'utilisera plus que HTTPS pour ce domaine
  if (String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() === 'https') res.setHeader('Strict-Transport-Security', 'max-age=31536000')
}

const inlineScripts = (html: string) => [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1])

/**
 * Politique de contenu d'une page : scripts du serveur uniquement, plus les scripts écrits
 * dans la page elle-même, reconnus par leur empreinte. Un script injecté ne s'exécute pas.
 */
export function contentSecurityPolicy(html: string): string {
  const hashes = inlineScripts(html).filter((s) => s.trim()).map((s) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`)
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self' https: http://localhost:* http://127.0.0.1:*",
    "frame-src 'self' blob: data:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'"
  ].join('; ')
}

const pageCache = new Map<string, { mtime: number; csp: string }>()
/** Politique d'un fichier HTML servi tel quel (recalculée quand le fichier change). */
export function fileCsp(file: string): string {
  const mtime = statSync(file).mtimeMs
  const hit = pageCache.get(file)
  if (hit && hit.mtime === mtime) return hit.csp
  const csp = contentSecurityPolicy(readFileSync(file, 'utf8'))
  if (pageCache.size > 200) pageCache.clear()
  pageCache.set(file, { mtime, csp })
  return csp
}
