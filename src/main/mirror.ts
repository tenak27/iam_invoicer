// Copie en ligne du serveur de l'entreprise : la base locale est envoyée à intervalles
// réguliers vers la base hébergée de la société (adresse https://…/t/<société>), qui devient
// sa copie de consultation. Le sens est unique : on saisit sur le serveur de l'entreprise, on
// consulte en ligne. Une coupure d'Internet ne gêne pas le travail ; l'envoi reprend ensuite.

import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import type { Db } from './db'
import { exportSnapshot } from './snapshot'

export interface MirrorState {
  enabled: boolean
  /** Envoi en cours. */
  running: boolean
  /** Dernier envoi réussi. */
  last: string | null
  lastError: string | null
  /** Lignes et taille du dernier envoi. */
  rows: number
  bytes: number
}

/** Adresse de la base en ligne → adresse d'envoi de la copie. */
export function mirrorEndpoint(raw: string): string {
  let url = String(raw ?? '').trim().replace(/\/+$/, '')
  if (!url) throw new Error("Saisissez l'adresse de la base en ligne (ex. https://invoice.exemple.bf/t/ma_societe).")
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url
  const u = new URL(url)
  if (!/^\/t\/[a-z][a-z0-9_]{2,30}$/.test(u.pathname)) throw new Error("Adresse invalide : elle doit se terminer par /t/ suivi de l'identifiant de la société.")
  return `${u.protocol}//${u.host}${u.pathname}/api/mirror`
}

/** Envoie un instantané complet de la base. `known` : empreinte du dernier envoi, pour ne rien envoyer si rien n'a changé. */
export async function pushMirror(db: Db, url: string, key: string, known?: string | null): Promise<{ sent: boolean; hash: string; rows: number; bytes: number }> {
  const endpoint = mirrorEndpoint(url)
  if (String(key ?? '').length < 20) throw new Error('Clé de synchronisation manquante : elle est fournie par IAM Technology avec votre base en ligne.')
  const snap = await exportSnapshot(db)
  const rows = Object.values(snap.tables).reduce((n, t) => n + t.length, 0)
  // L'heure de la prise ne compte pas dans l'empreinte : seules les données décident d'un nouvel envoi
  const hash = createHash('sha256').update(JSON.stringify(snap.tables)).digest('hex')
  if (known && known === hash) return { sent: false, hash, rows, bytes: 0 }
  const body = gzipSync(Buffer.from(JSON.stringify(snap)))
  let res: Response
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
      body,
      signal: AbortSignal.timeout(180_000)
    })
  } catch (e: any) {
    throw new Error(`Base en ligne injoignable (${e?.name === 'TimeoutError' ? 'délai dépassé' : e?.cause?.code ?? e?.message ?? e}).`)
  }
  const json: any = await res.json().catch(() => null)
  if (!json?.ok) throw new Error(json?.error ?? `La base en ligne a refusé la copie (HTTP ${res.status}).`)
  return { sent: true, hash, rows, bytes: body.length }
}

/** Envoi périodique, un seul à la fois ; l'état est lu par l'interface. */
export class MirrorLoop {
  private timer: NodeJS.Timeout | null = null
  private hash: string | null = null
  private current: Promise<MirrorState> | null = null
  private st: MirrorState = { enabled: false, running: false, last: null, lastError: null, rows: 0, bytes: 0 }

  constructor(private db: () => Db | null, private onChange: () => void = () => {}) {}

  state(): MirrorState {
    return { ...this.st }
  }

  /** (Re)démarre avec ces réglages ; adresse ou clé vide : arrêt. */
  configure(cfg: { url: string; key: string; minutes: number }) {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.hash = null
    this.st = { ...this.st, enabled: !!(cfg.url && cfg.key), lastError: null }
    if (!this.st.enabled) return this.onChange()
    const run = () => void this.push(cfg.url, cfg.key).catch(() => {})
    this.timer = setInterval(run, Math.max(1, cfg.minutes || 15) * 60_000)
    this.timer.unref?.()
    // Premier envoi peu après le démarrage, sans retarder l'ouverture de l'application
    setTimeout(run, 20_000).unref?.()
    this.onChange()
  }

  push(url: string, key: string, force = false): Promise<MirrorState> {
    this.current ??= (async () => {
      this.st = { ...this.st, running: true }
      this.onChange()
      try {
        const db = this.db()
        if (!db) throw new Error("La base n'est pas encore ouverte.")
        const r = await pushMirror(db, url, key, force ? null : this.hash)
        this.hash = r.hash
        this.st = { ...this.st, last: new Date().toISOString(), lastError: null, rows: r.rows, bytes: r.sent ? r.bytes : this.st.bytes }
      } catch (e) {
        this.st = { ...this.st, lastError: e instanceof Error ? e.message : String(e) }
        throw e
      } finally {
        this.st = { ...this.st, running: false }
        this.current = null
        this.onChange()
      }
      return this.state()
    })()
    return this.current
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
