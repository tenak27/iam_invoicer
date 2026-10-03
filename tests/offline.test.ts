import { describe, expect, it } from 'vitest'
import { createOfflineLayer, type CallResult, type KeyValueStore } from '../src/shared/offline'

function memoryStore(): KeyValueStore {
  const m = new Map<string, string>()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) }
}

describe('Mode hors ligne', () => {
  it('lectures servies depuis le cache quand le réseau tombe', async () => {
    let online = true
    const layer = createOfflineLayer(memoryStore(), async (name) => (online ? { ok: true, data: { name, n: 1 } } : { ok: false, error: 'injoignable', network: true }))
    expect((await layer.call('products.list', {})).ok).toBe(true)
    online = false
    const r = await layer.call('products.list', {})
    expect(r).toEqual({ ok: true, data: { name: 'products.list', n: 1 }, offline: true })
    const miss = await layer.call('products.list', { search: 'x' })
    expect(miss.ok).toBe(false)
  })

  it('saisies mises en file, rejouées dans l’ordre avec le même identifiant', async () => {
    let online = false
    const seen: { name: string; opId?: string }[] = []
    const done = new Set<string>()
    const send = async (name: string, _args: unknown, opId?: string): Promise<CallResult> => {
      if (!online) return { ok: false, error: 'injoignable', network: true }
      seen.push({ name, opId })
      if (opId && done.has(opId)) return { ok: true, data: 'déjà fait' }
      if (opId) done.add(opId)
      return name === 'payments.add' ? { ok: false, error: 'Montant invalide.' } : { ok: true, data: { id: 1 } }
    }
    let changes = 0
    const layer = createOfflineLayer(memoryStore(), send, () => changes++)
    const a = await layer.call('cash.sale', { lines: [1] })
    expect(a).toMatchObject({ ok: true, data: { queued: true } })
    await layer.call('payments.add', { amount: -1 })
    await layer.call('crm.saveActivity', { subject: 'Appel' })
    expect(layer.pending()).toHaveLength(3)
    // Lecture non mise en cache et hors ligne : erreur explicite
    expect((await layer.call('reports.sales', {})).ok).toBe(false)

    expect(await layer.sync()).toEqual({ sent: 0, failed: 0 }) // toujours hors ligne
    online = true
    expect(await layer.sync()).toEqual({ sent: 2, failed: 1 })
    expect(seen.map((s) => s.name)).toEqual(['cash.sale', 'payments.add', 'crm.saveActivity'])
    expect(seen.every((s) => s.opId && s.opId.length >= 8)).toBe(true)
    expect(layer.pending()).toHaveLength(0)
    expect(layer.failed()[0]).toMatchObject({ name: 'payments.add', error: 'Montant invalide.' })
    expect(changes).toBeGreaterThan(3)
  })

  it('une nouvelle saisie attend derrière la file pour garder l’ordre', async () => {
    let online = false
    const order: string[] = []
    const layer = createOfflineLayer(memoryStore(), async (name, args: any) => {
      if (!online) return { ok: false, error: 'x', network: true }
      order.push(args.n)
      return { ok: true, data: null }
    })
    await layer.call('projects.saveTime', { n: 'premier' })
    online = true
    await layer.call('projects.saveTime', { n: 'second' }) // file non vide → mis en file
    await layer.sync()
    expect(order).toEqual(['premier', 'second'])
  })
})
