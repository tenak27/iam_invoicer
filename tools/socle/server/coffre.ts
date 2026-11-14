// Coffre des clés : chiffrement au repos des secrets que le serveur doit pouvoir relire (secrets de
// webhook, clé privée des notifications, jetons WhatsApp et SMS, mots de passe de messagerie, secrets
// de double authentification). AES-256-GCM, même format que le coffre d'IAM INVOICER, d'IAM MAILS et
// de la console : « enc:v1:<iv>.<étiquette>.<chiffré> » en base64url.
//
// La clé vient de SECRETS_KEY (ou du fichier SECRETS_KEY_FILE), jamais de la base : une copie de la
// base seule ne livre aucun de ces secrets. Sans clé (tests, développement, serveur pas encore
// réglé), les valeurs restent en clair ; dès qu'une clé existe, sealColumn() chiffre au démarrage ce
// qui était resté en clair. Perdre la clé rend ces secrets illisibles : elle est dans le dépôt
// chiffré des sauvegardes (tools/sauvegarde).

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'

const PREFIX = 'enc:v1:'

interface CoffreDb {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>
}

// undefined : pas encore lue dans l'environnement
let key: Buffer | null | undefined

function parse(raw: string | null | undefined): Buffer | null {
  const v = String(raw ?? '').trim()
  if (!v) return null
  if (v.length < 32) throw new Error('SECRETS_KEY trop courte : 32 caractères au moins (ex. openssl rand -hex 32).')
  return /^[0-9a-fA-F]{64}$/.test(v) ? Buffer.from(v, 'hex') : createHash('sha256').update(v).digest()
}

function current(): Buffer | null {
  if (key === undefined) {
    let raw = process.env.SECRETS_KEY ?? ''
    if (!raw && process.env.SECRETS_KEY_FILE) {
      try {
        raw = readFileSync(process.env.SECRETS_KEY_FILE, 'utf8')
      } catch {
        raw = ''
      }
    }
    key = parse(raw)
  }
  return key
}

/** Impose la clé (tests, ou clé gardée ailleurs que dans l'environnement) ; vide = pas de clé. */
export function configureCoffreKey(raw: string | null | undefined) {
  key = parse(raw)
}

export const coffreAvailable = () => !!current()
export const isSealed = (v: unknown): v is string => typeof v === 'string' && v.startsWith(PREFIX)

/** Chiffre une valeur ; rendue telle quelle si elle est vide, déjà chiffrée, ou sans clé. */
export function seal(plain: string | null | undefined): string {
  const v = plain ?? ''
  const k = current()
  if (!v || !k || isSealed(v)) return v
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', k, iv)
  const body = Buffer.concat([c.update(v, 'utf8'), c.final()])
  return PREFIX + [iv, c.getAuthTag(), body].map((b) => b.toString('base64url')).join('.')
}

/** Déchiffre ; une valeur en clair (antérieure au chiffrement) est rendue telle quelle. */
export function unseal(stored: string | null | undefined): string {
  if (!stored) return ''
  if (!isSealed(stored)) return stored
  const unreadable = () => Object.assign(new Error('Secret illisible : la clé de chiffrement du serveur (SECRETS_KEY) est absente ou a changé. Saisissez-le de nouveau.'), { status: 400, expose: true })
  const k = current()
  if (!k) throw unreadable()
  try {
    const [iv, tag, body] = stored.slice(PREFIX.length).split('.').map((s) => Buffer.from(s, 'base64url'))
    const d = createDecipheriv('aes-256-gcm', k, iv)
    d.setAuthTag(tag)
    return Buffer.concat([d.update(body), d.final()]).toString('utf8')
  } catch {
    throw unreadable()
  }
}

/** Comme unseal(), mais rend '' au lieu d'échouer : pour un envoi facultatif qui ne doit pas bloquer l'action. */
export function unsealOr(stored: string | null | undefined, fallback = ''): string {
  try {
    return unseal(stored)
  } catch {
    return fallback
  }
}

const ident = (name: string) => '"' + name.replace(/"/g, '""') + '"'

/**
 * Chiffre les valeurs encore en clair d'une colonne (au démarrage, après l'installation de la clé).
 * `idColumn` désigne la clé primaire de la table. Rend le nombre de lignes chiffrées ; 0 sans clé.
 */
export async function sealColumn(db: CoffreDb, table: string, column: string, idColumn = 'id'): Promise<number> {
  if (!current()) return 0
  const t = ident(table)
  const c = ident(column)
  const i = ident(idColumn)
  const rows = await db.query<{ id: unknown; value: string }>(`SELECT ${i} AS id, ${c} AS value FROM ${t} WHERE ${c} IS NOT NULL AND ${c} <> '' AND ${c} NOT LIKE '${PREFIX}%'`)
  for (const r of rows) await db.query(`UPDATE ${t} SET ${c} = $2 WHERE ${i} = $1`, [r.id, seal(r.value)])
  return rows.length
}
