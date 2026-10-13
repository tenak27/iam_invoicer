// Chiffrement des secrets au repos (mots de passe SMTP, clés SMS, jeton SECeF, jeton
// d'administration, mots de passe des bases hébergées) : AES-256-GCM, une clé par installation.
//
//   Serveur : variable SECRETS_KEY (ou fichier SECRETS_KEY_FILE), jamais dans la base.
//   Poste   : clé tirée au hasard, protégée par le système (DPAPI, Trousseau) ; voir index.ts.
//
// Sans clé, les valeurs restent en clair comme avant (poste sans trousseau, tests). Une valeur
// en clair rencontrée alors qu'une clé existe est lue telle quelle : elle est chiffrée à la
// prochaine écriture ou par sealAll().

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import type { Db } from './db'
import { AppError } from './services/context'

const PREFIX = 'enc:v1:'

type Provider = () => Buffer | null
let provider: Provider = () => null
let cached: Buffer | null | undefined

/** Clé fournie à la demande : sur un poste, le trousseau n'est interrogé qu'au premier besoin. */
export function setSecretKeyProvider(p: Provider) {
  provider = p
  cached = undefined
}

/** Clé donnée en texte (64 caractères hexadécimaux conseillés) ; toute autre valeur longue est dérivée. */
export function configureSecretKey(raw: string | null | undefined) {
  const v = String(raw ?? '').trim()
  if (!v) return setSecretKeyProvider(() => null)
  if (v.length < 32) throw new Error('SECRETS_KEY trop courte : 32 caractères au moins (ex. openssl rand -hex 32).')
  const key = /^[0-9a-fA-F]{64}$/.test(v) ? Buffer.from(v, 'hex') : createHash('sha256').update(v).digest()
  setSecretKeyProvider(() => key)
}

function key(): Buffer | null {
  if (cached === undefined) {
    try {
      cached = provider()
    } catch {
      cached = null
    }
  }
  return cached
}

export const secretKeyAvailable = () => !!key()
export const isSealed = (v: unknown) => typeof v === 'string' && v.startsWith(PREFIX)

/** Chiffre une valeur ; rendue telle quelle si elle est vide, déjà chiffrée, ou sans clé. */
export function seal(plain: string): string {
  const k = key()
  if (!plain || !k || isSealed(plain)) return plain
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', k, iv)
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return PREFIX + [iv, c.getAuthTag(), body].map((b) => b.toString('base64url')).join('.')
}

/** Déchiffre ; une valeur en clair (antérieure au chiffrement) est rendue telle quelle. */
export function unseal(stored: string | null | undefined): string {
  if (!stored) return ''
  if (!isSealed(stored)) return stored
  const k = key()
  const unreadable = () => new AppError("Secret illisible : la clé de chiffrement de cette installation a changé. Saisissez-le de nouveau dans les paramètres.")
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

/** Chiffre les secrets encore en clair d'une base (après installation de la clé). */
export async function sealAll(db: Db): Promise<number> {
  if (!key()) return 0
  const rows = await db.query<{ key: string; value: string }>(`SELECT key, value FROM secrets WHERE value <> '' AND value NOT LIKE '${PREFIX}%'`)
  for (const r of rows) await db.query('UPDATE secrets SET value = $2 WHERE key = $1', [r.key, seal(r.value)])
  return rows.length
}
