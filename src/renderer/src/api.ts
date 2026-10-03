import { useCallback, useEffect, useState } from 'react'
import { notify } from './components/ui'

export async function api<T = any>(name: string, args?: unknown): Promise<T> {
  const r = await window.erp.call(name, args)
  if (!r.ok) throw new Error(r.error)
  return r.data as T
}

/** Exécute une action et affiche l'erreur éventuelle ; renvoie undefined en cas d'échec. */
export async function run<T>(fn: () => Promise<T>, success?: string): Promise<T | undefined> {
  try {
    const result = await fn()
    if (success) notify(success, 'success')
    return result
  } catch (e) {
    notify(e instanceof Error ? e.message : String(e), 'error')
    return undefined
  }
}

/** Charge des données depuis le processus principal et permet de les recharger. */
export function useQuery<T>(name: string, args?: unknown, deps: unknown[] = []) {
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const key = JSON.stringify(args ?? null)
  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setData(await api<T>(name, args))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, key, ...deps])
  useEffect(() => {
    reload()
  }, [reload])
  return { data, error, loading, reload, setData }
}

export async function unwrap<T = any>(p: Promise<{ ok: true; data: T } | { ok: false; error: string }>): Promise<T> {
  const r = await p
  if (!r.ok) throw new Error(r.error)
  return r.data
}

/** Export CSV (séparateur « ; », lisible directement par Excel en français). */
export async function exportCsv(filename: string, columns: { label: string; value: (row: any) => unknown }[], rows: any[]) {
  const cell = (v: unknown) => {
    const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? '')
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const content = [columns.map((c) => cell(c.label)).join(';'), ...rows.map((r) => columns.map((c) => cell(c.value(r))).join(';'))].join('\r\n')
  await run(() => unwrap(window.erp.saveText(filename, content)))
}
