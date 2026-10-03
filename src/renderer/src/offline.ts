// Mode hors ligne (web et mobile) :
//  - lectures : la dernière réponse de chaque écran est gardée sur l'appareil et
//    réaffichée si le réseau tombe ;
//  - saisies courantes (vente en caisse, règlement, temps passé, congé, activité
//    CRM, nouveau client) : mises en file d'attente, puis envoyées dans l'ordre
//    au retour du réseau. Chaque opération porte un identifiant unique : le
//    serveur ne l'exécute qu'une fois, même si l'envoi est répété.
// Les numéros (factures…) sont attribués par le serveur lors de la synchronisation.

export type CallResult = { ok: true; data: any; offline?: boolean } | { ok: false; error: string; network?: boolean }
export type Sender = (name: string, args: unknown, opId?: string) => Promise<CallResult>

export interface KeyValueStore {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
  removeItem(k: string): void
}

/** Saisies acceptées hors ligne. */
export const QUEUEABLE = new Set(['cash.sale', 'payments.add', 'parties.save', 'crm.save', 'crm.saveActivity', 'projects.saveTime', 'hr.saveLeave'])

/** Lectures conservées pour la consultation hors ligne. */
const CACHEABLE = /^(settings\.get|reports\.dashboard|cash\.(current|options)|products\.(list|categories)|parties\.(list|get|options)|documents\.(list|get)|payments\.list|warehouses\.options|projects\.(list|get|options)|crm\.(list|get|pipeline|agenda)|hr\.(employees|leaves))$/

const QUEUE_KEY = 'iam.offline.queue'
const FAILED_KEY = 'iam.offline.failed'
const CACHE_PREFIX = 'iam.cache.'
const MAX_CACHE = 150

export interface QueuedOp {
  opId: string
  name: string
  args: unknown
  at: string
}

export function newOpId(): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)
  return rnd.replace(/[^A-Za-z0-9_-]/g, '')
}

export const OFFLINE_LABELS: Record<string, string> = {
  'cash.sale': 'Vente en caisse',
  'payments.add': 'Règlement',
  'parties.save': 'Fiche client / fournisseur',
  'crm.save': 'Opportunité',
  'crm.saveActivity': 'Activité commerciale',
  'projects.saveTime': 'Temps passé',
  'hr.saveLeave': 'Demande de congé'
}

export function createOfflineLayer(storage: KeyValueStore, send: Sender, notify: () => void = () => {}) {
  const read = <T>(k: string, fallback: T): T => {
    try {
      const v = storage.getItem(k)
      return v ? (JSON.parse(v) as T) : fallback
    } catch {
      return fallback
    }
  }
  const write = (k: string, v: unknown) => {
    try {
      storage.setItem(k, JSON.stringify(v))
    } catch {
      /* stockage plein : on ignore le cache, la file d'attente reste prioritaire */
    }
  }
  const queue = () => read<QueuedOp[]>(QUEUE_KEY, [])
  const cacheIndex = () => read<string[]>(CACHE_PREFIX + 'index', [])

  const remember = (key: string, data: unknown) => {
    write(CACHE_PREFIX + key, data)
    const idx = cacheIndex().filter((k) => k !== key)
    idx.push(key)
    while (idx.length > MAX_CACHE) storage.removeItem(CACHE_PREFIX + idx.shift()!)
    write(CACHE_PREFIX + 'index', idx)
  }

  let syncing: Promise<{ sent: number; failed: number }> | null = null

  async function call(name: string, args: unknown): Promise<CallResult> {
    const key = `${name}:${JSON.stringify(args ?? null)}`
    if (QUEUEABLE.has(name) && queue().length > 0) {
      // Garder l'ordre : tant que la file n'est pas vide, les nouvelles saisies s'y ajoutent.
      return enqueue(name, args)
    }
    const opId = QUEUEABLE.has(name) ? newOpId() : undefined
    const r = await send(name, args, opId)
    if (r.ok) {
      if (CACHEABLE.test(name)) remember(key, r.data)
      return r
    }
    if (!r.network) return r
    if (QUEUEABLE.has(name)) return enqueue(name, args, opId)
    const cached = read<unknown>(CACHE_PREFIX + key, undefined)
    if (cached !== undefined) return { ok: true, data: cached, offline: true }
    return { ok: false, error: 'Hors connexion : ces données ne sont pas encore disponibles sur cet appareil.', network: true }
  }

  function enqueue(name: string, args: unknown, opId = newOpId()): CallResult {
    const q = queue()
    q.push({ opId, name, args, at: new Date().toISOString() })
    write(QUEUE_KEY, q)
    notify()
    return { ok: true, data: { queued: true, opId }, offline: true }
  }

  /** Envoie la file dans l'ordre ; s'arrête à la première coupure réseau. */
  function sync() {
    if (syncing) return syncing
    syncing = (async () => {
      let sent = 0
      let failed = 0
      for (;;) {
        const q = queue()
        if (q.length === 0) break
        const op = q[0]
        const r = await send(op.name, op.args, op.opId)
        if (!r.ok && r.network) break
        if (!r.ok) {
          failed++
          write(FAILED_KEY, [...read<any[]>(FAILED_KEY, []), { ...op, error: r.error }])
        } else sent++
        write(QUEUE_KEY, queue().filter((x) => x.opId !== op.opId))
        notify()
      }
      return { sent, failed }
    })().finally(() => {
      syncing = null
    })
    return syncing
  }

  return {
    call,
    sync,
    pending: () => queue(),
    failed: () => read<(QueuedOp & { error: string })[]>(FAILED_KEY, []),
    clearFailed: () => {
      storage.removeItem(FAILED_KEY)
      notify()
    }
  }
}

export type OfflineLayer = ReturnType<typeof createOfflineLayer>
