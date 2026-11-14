// Coffre des clés de la base commune (tools/socle/server/coffre.ts) : chiffrement au repos, lecture
// des valeurs restées en clair, refus d'une mauvaise clé, chiffrement d'une colonne au démarrage.
import { afterEach, describe, expect, it } from 'vitest'
import { configureCoffreKey, coffreAvailable, isSealed, seal, sealColumn, unseal, unsealOr } from '../tools/socle/server/coffre'

const KEY_A = 'a'.repeat(64)
const KEY_B = 'b'.repeat(64)

afterEach(() => configureCoffreKey(''))

/** Table en mémoire, qui ne comprend que les deux requêtes de sealColumn(). */
function table(rows: { id: number; secret: string | null }[]) {
  return {
    rows,
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      if (sql.startsWith('SELECT')) return rows.filter((r) => r.secret && !r.secret.startsWith('enc:v1:')).map((r) => ({ id: r.id, value: r.secret })) as T[]
      const row = rows.find((r) => r.id === params[0])!
      row.secret = params[1] as string
      return []
    }
  }
}

describe('Base commune : coffre des clés', () => {
  it('sans clé, les valeurs restent en clair et se relisent', () => {
    expect(coffreAvailable()).toBe(false)
    expect(seal('whsec_abc')).toBe('whsec_abc')
    expect(unseal('whsec_abc')).toBe('whsec_abc')
    expect(unseal(null)).toBe('')
  })

  it('avec une clé, la valeur est chiffrée, différente à chaque fois, et se relit', () => {
    configureCoffreKey(KEY_A)
    const one = seal('jeton-très-secret é')
    const two = seal('jeton-très-secret é')
    expect(isSealed(one)).toBe(true)
    expect(one).not.toContain('jeton')
    expect(one).not.toBe(two)
    expect(unseal(one)).toBe('jeton-très-secret é')
    expect(unseal(two)).toBe('jeton-très-secret é')
    // Déjà chiffrée, ou vide : inchangée
    expect(seal(one)).toBe(one)
    expect(seal('')).toBe('')
    // Une valeur antérieure au chiffrement se lit toujours
    expect(unseal('ancien-en-clair')).toBe('ancien-en-clair')
  })

  it('une phrase longue sert de clé ; une clé trop courte est refusée', () => {
    configureCoffreKey('une phrase secrète assez longue pour servir de clé')
    expect(unseal(seal('x'))).toBe('x')
    expect(() => configureCoffreKey('court')).toThrow(/trop courte/)
  })

  it('mauvaise clé, clé absente ou valeur modifiée : refus, jamais de valeur fausse', () => {
    configureCoffreKey(KEY_A)
    const sealed = seal('secret')
    configureCoffreKey(KEY_B)
    expect(() => unseal(sealed)).toThrow(/illisible/)
    expect(unsealOr(sealed)).toBe('')
    configureCoffreKey('')
    expect(() => unseal(sealed)).toThrow(/illisible/)
    configureCoffreKey(KEY_A)
    const tampered = sealed.slice(0, -2) + (sealed.at(-2) === 'A' ? 'B' : 'A') + sealed.slice(-1)
    expect(() => unseal(tampered)).toThrow(/illisible/)
  })

  it('sealColumn chiffre ce qui était en clair, une seule fois, et rien sans clé', async () => {
    const db = table([
      { id: 1, secret: 'whsec_un' },
      { id: 2, secret: '' },
      { id: 3, secret: null },
      { id: 4, secret: 'whsec_quatre' }
    ])
    expect(await sealColumn(db, 'socle_webhooks', 'secret')).toBe(0)
    expect(db.rows[0].secret).toBe('whsec_un')

    configureCoffreKey(KEY_A)
    expect(await sealColumn(db, 'socle_webhooks', 'secret')).toBe(2)
    expect(isSealed(db.rows[0].secret)).toBe(true)
    expect(db.rows[1].secret).toBe('')
    expect(db.rows[2].secret).toBeNull()
    expect(unseal(db.rows[3].secret)).toBe('whsec_quatre')
    expect(await sealColumn(db, 'socle_webhooks', 'secret')).toBe(0)
  })
})
