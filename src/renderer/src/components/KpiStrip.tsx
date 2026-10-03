// Bande d'indicateurs d'une page : tuiles colorées (dégradés tournants) dont les
// chiffres défilent à l'arrivée sur la page (voir useCountUpEnhancer).

import type { Icon } from '@phosphor-icons/react'
import { formatMoney, formatNumber } from '@shared/format'

export interface Kpi {
  label: string
  value: number
  icon: Icon
  money?: boolean
  /** good : tuile verte ; bad : tuile rouge (alerte), verte quand la valeur est nulle. */
  tone?: 'good' | 'bad'
  hint?: string
  hidden?: boolean
}

export function KpiStrip({ items }: { items: Kpi[] }) {
  const shown = items.filter((k) => !k.hidden)
  if (!shown.length) return null
  return (
    <div className="kpi-row kpi-strip">
      {shown.map((k) => (
        <div key={k.label} className={`mini-kpi ${k.tone === 'bad' && k.value === 0 ? 'good' : k.tone ?? ''}`}>
          <span><k.icon size={17} weight="duotone" aria-hidden="true" />{k.label}</span>
          <strong>{k.money ? formatMoney(k.value) : formatNumber(k.value)}</strong>
          {k.hint && <small className="kpi-hint">{k.hint}</small>}
        </div>
      ))}
    </div>
  )
}
