// Graphiques SVG légers (aucune bibliothèque) : aire lissée, mini-courbe,
// anneau et barres de progression. Chaque graphique porte un résumé texte
// (aria-label) et des info-bulles natives (<title>) avec les valeurs exactes.

import { useId, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { formatMoney, formatNumber } from '@shared/format'

export function compact(n: number): string {
  if (Math.abs(n) >= 1e6) return formatNumber(n / 1e6, 1) + ' M'
  if (Math.abs(n) >= 1e3) return formatNumber(n / 1e3, 0) + ' k'
  return formatNumber(n)
}

type Point = { label: string; value: number; title?: string }

/** Chemin lissé (courbe de Catmull-Rom convertie en Bézier). */
function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return ''
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`
  }
  return d
}

export function AreaChart({ points, height = 220, summary }: { points: Point[]; height?: number; summary: string }) {
  const gid = `area-${useId().replace(/:/g, '')}`
  const W = 640
  const H = height
  const top = 18
  const bottom = 28
  const left = 22
  const max = Math.max(...points.map((p) => p.value), 1)
  const step = (W - left * 2) / Math.max(points.length - 1, 1)
  const xy = points.map((p, i): [number, number] => [left + i * step, top + (1 - p.value / max) * (H - top - bottom)])
  const line = smoothPath(xy)
  const area = `${line} L${xy[xy.length - 1][0]},${H - bottom} L${xy[0][0]},${H - bottom} Z`
  const grid = [0.25, 0.5, 0.75, 1].map((f) => top + (1 - f) * (H - top - bottom))
  const peak = points.reduce((b, p, i) => (p.value > points[b].value ? i : b), 0)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="area-chart" role="img" aria-label={summary}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="area-stop-top" />
          <stop offset="1" className="area-stop-bottom" />
        </linearGradient>
      </defs>
      {grid.map((y) => <line key={y} x1={left} x2={W - left} y1={y} y2={y} className="chart-grid" />)}
      <path d={area} fill={`url(#${gid})`} className="area-fill" />
      <path d={line} className="area-line draw" pathLength={1} />
      {xy.map(([x, y], i) => (
        <g key={i} className="area-point">
          <rect x={x - step / 2} y={0} width={step} height={H - bottom} fill="transparent" />
          <circle cx={x} cy={y} r={i === peak && points[i].value > 0 ? 5 : 3.5} className={i === peak && points[i].value > 0 ? 'area-dot peak' : 'area-dot'} />
          <title>{points[i].title ?? `${points[i].label} : ${formatMoney(points[i].value)}`}</title>
          <text x={x} y={H - 8} className="chart-label">{points[i].label}</text>
        </g>
      ))}
      {points[peak].value > 0 && (
        <g className="area-peak-label">
          <rect x={Math.min(Math.max(xy[peak][0] - 30, 0), W - 60)} y={Math.max(xy[peak][1] - 30, 0)} width="60" height="20" rx="5" />
          <text x={Math.min(Math.max(xy[peak][0], 30), W - 30)} y={Math.max(xy[peak][1] - 16, 14)}>{compact(points[peak].value)}</text>
        </g>
      )}
    </svg>
  )
}

export function Sparkline({ values, summary, height = 64 }: { values: number[]; summary: string; height?: number }) {
  const gid = `spark-${useId().replace(/:/g, '')}`
  const W = 220
  const H = height
  const max = Math.max(...values, 1)
  const step = W / Math.max(values.length - 1, 1)
  const xy = values.map((v, i): [number, number] => [i * step, 4 + (1 - v / max) * (H - 8)])
  const line = smoothPath(xy)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="sparkline" role="img" aria-label={summary} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="area-stop-top" />
          <stop offset="1" className="area-stop-bottom" />
        </linearGradient>
      </defs>
      <path d={`${line} L${W},${H} L0,${H} Z`} fill={`url(#${gid})`} className="area-fill" />
      <path d={line} className="area-line draw" pathLength={1} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function Donut({ segments, center, sub, summary }: { segments: { value: number; color: string; label: string }[]; center: string; sub: string; summary: string }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1
  const R = 52
  const C = 2 * Math.PI * R
  let offset = 0
  return (
    <svg viewBox="0 0 140 140" className="donut" role="img" aria-label={summary}>
      <circle cx="70" cy="70" r={R} className="donut-track" />
      {segments.map((s, i) => {
        const len = (s.value / total) * C
        const el = (
          <circle key={i} cx="70" cy="70" r={R} fill="none" stroke={s.color} strokeWidth="14" strokeLinecap="round" className="donut-seg"
            style={{ '--len': `${Math.max(len - 4, 0)}px`, '--c': `${C}px`, animationDelay: `${i * 120}ms` } as React.CSSProperties}
            strokeDasharray={`${Math.max(len - 4, 0)} ${C}`} strokeDashoffset={-offset} transform="rotate(-90 70 70)">
            <title>{`${s.label} : ${formatMoney(s.value)}`}</title>
          </circle>
        )
        offset += len
        return el
      })}
      <text x="70" y="68" className="donut-center">{center}</text>
      <text x="70" y="86" className="donut-sub">{sub}</text>
    </svg>
  )
}

export function Progress({ value, color = 'var(--primary)', label }: { value: number; color?: string; label: string }) {
  const v = Math.max(0, Math.min(100, value))
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <span style={{ width: `${v}%`, background: color }} />
    </div>
  )
}

// ── Graphiques interactifs (rapports) ─────────────────────────────────────────────
// Survol, toucher ou flèches du clavier : la valeur exacte s'affiche dans une bulle ; un clic
// sur la légende masque ou affiche une série. Les barres poussent à l'apparition (CSS).

export const CHART_COLORS = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899', '#64748b']

export interface Series { name: string; values: number[]; color?: string; line?: boolean }

/** Barres groupées (et courbes) par catégorie, avec légende cliquable et bulle de détail. */
export function BarChart({ labels, series, height = 300, summary, format = formatMoney }: { labels: string[]; series: Series[]; height?: number; summary: string; format?: (n: number) => string }) {
  const [active, setActive] = useState<number | null>(null)
  const [hidden, setHidden] = useState<string[]>([])
  const shown = series.map((s, i) => ({ ...s, color: s.color ?? CHART_COLORS[i % CHART_COLORS.length] })).filter((s) => !hidden.includes(s.name))
  const bars = shown.filter((s) => !s.line)
  const lines = shown.filter((s) => s.line)
  const W = 760, H = height, top = 16, bottom = 34, left = 54, right = 12
  const all = shown.flatMap((s) => s.values)
  const max = Math.max(...all, 1)
  const min = Math.min(...all, 0)
  const span = max - min || 1
  const y = (v: number) => top + ((max - v) / span) * (H - top - bottom)
  const band = (W - left - right) / Math.max(labels.length, 1)
  const bw = Math.min(46, (band * 0.72) / Math.max(bars.length, 1))
  const ticks = Array.from({ length: 5 }, (_, i) => min + (span * i) / 4)
  const key = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Escape') return
    e.preventDefault()
    if (e.key === 'Escape') return setActive(null)
    setActive((a) => (a === null ? 0 : Math.max(0, Math.min(labels.length - 1, a + (e.key === 'ArrowRight' ? 1 : -1)))))
  }
  if (!labels.length) return null
  return (
    <div className="ichart">
      <div className="ichart-legend" role="group" aria-label="Séries affichées">
        {series.map((s, i) => {
          const off = hidden.includes(s.name)
          return (
            <button key={s.name} type="button" className={`ichart-key${off ? ' off' : ''}`} aria-pressed={!off} onClick={() => setHidden((h) => (off ? h.filter((n) => n !== s.name) : h.length < series.length - 1 ? [...h, s.name] : h))}>
              <i style={{ background: s.color ?? CHART_COLORS[i % CHART_COLORS.length] }} className={s.line ? 'line' : ''} aria-hidden="true" />{s.name}
            </button>
          )
        })}
      </div>
      <div className="ichart-plot" tabIndex={0} role="img" aria-label={`${summary}. Flèches gauche et droite pour lire chaque valeur.`} onKeyDown={key} onBlur={() => setActive(null)} onPointerLeave={() => setActive(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={W - right} y1={y(t)} y2={y(t)} className={`chart-grid${Math.abs(t) < 1e-9 ? ' zero' : ''}`} />
              <text x={left - 8} y={y(t) + 4} className="ichart-tick">{compact(t)}</text>
            </g>
          ))}
          {labels.map((l, i) => {
            const cx = left + band * i + band / 2
            return (
              <g key={i} className={`ichart-col${active === i ? ' on' : ''}${active !== null && active !== i ? ' dim' : ''}`} onPointerEnter={() => setActive(i)} onPointerDown={() => setActive(i)}>
                <rect x={left + band * i} y={top} width={band} height={H - top - bottom} className="ichart-hit" />
                {bars.map((s, k) => {
                  const v = s.values[i] ?? 0
                  const y0 = y(0), y1 = y(v)
                  return <rect key={s.name} x={cx - (bars.length * bw) / 2 + k * bw + 1.5} y={Math.min(y0, y1)} width={Math.max(bw - 3, 2)} height={Math.max(Math.abs(y0 - y1), v ? 2 : 0)} rx="4" fill={s.color} className="ichart-bar"
                    style={{ transformOrigin: `0 ${y0}px`, animationDelay: `${i * 35 + k * 60}ms` } as CSSProperties} />
                })}
                <text x={cx} y={H - 12} className="chart-label">{l}</text>
              </g>
            )
          })}
          {lines.map((s) => {
            const pts = s.values.map((v, i): [number, number] => [left + band * i + band / 2, y(v ?? 0)])
            return (
              <g key={s.name} className="ichart-line">
                <path d={smoothPath(pts)} stroke={s.color} pathLength={1} className="draw" />
                {pts.map(([px, py], i) => <circle key={i} cx={px} cy={py} r={active === i ? 6 : 3.5} fill={s.color} />)}
              </g>
            )
          })}
        </svg>
        {active !== null && (
          <div className="ichart-tip" role="status" style={{ left: `${((left + band * active + band / 2) / W) * 100}%`, '--shift': active > labels.length * 0.6 ? '-100%' : active < labels.length * 0.4 ? '0%' : '-50%' } as CSSProperties}>
            <strong>{labels[active]}</strong>
            {shown.map((s) => <span key={s.name}><i style={{ background: s.color }} aria-hidden="true" />{s.name}<b>{format(s.values[active] ?? 0)}</b></span>)}
          </div>
        )}
      </div>
    </div>
  )
}

/** Classement en barres horizontales : la part de chaque ligne se lit d'un coup d'œil. */
export function BarList({ items, format = formatMoney, limit = 8 }: { items: { label: string; value: number; sub?: string }[]; format?: (n: number) => string; limit?: number }) {
  const [on, setOn] = useState<number | null>(null)
  const rows = items.filter((r) => r.value > 0).slice(0, limit)
  const max = Math.max(...rows.map((r) => r.value), 1)
  const total = items.reduce((s, r) => s + Math.max(r.value, 0), 0) || 1
  if (!rows.length) return null
  return (
    <ul className="barlist" onPointerLeave={() => setOn(null)}>
      {rows.map((r, i) => (
        <li key={r.label + i} className={on === i ? 'on' : on !== null ? 'dim' : ''} onPointerEnter={() => setOn(i)} tabIndex={0} onFocus={() => setOn(i)} onBlur={() => setOn(null)}>
          <span className="barlist-label">{r.label}{r.sub && <small>{r.sub}</small>}</span>
          <span className="barlist-track"><i style={{ width: `${(r.value / max) * 100}%`, background: CHART_COLORS[i % CHART_COLORS.length], animationDelay: `${i * 70}ms` }} /></span>
          <span className="barlist-value">{format(r.value)}<small>{formatNumber((r.value / total) * 100, 1)} %</small></span>
        </li>
      ))}
    </ul>
  )
}

/** Anneau interactif : survoler une part (ou sa ligne de légende) affiche son montant et son poids au centre. */
export function PieChart({ segments, title, summary, format = formatMoney, limit = 6 }: { segments: { label: string; value: number }[]; title: string; summary: string; format?: (n: number) => string; limit?: number }) {
  const [on, setOn] = useState<number | null>(null)
  const sorted = segments.filter((s) => s.value > 0).sort((a, b) => b.value - a.value)
  const head = sorted.slice(0, limit)
  const rest = sorted.slice(limit).reduce((s, x) => s + x.value, 0)
  const parts = rest > 0 ? [...head, { label: 'Autres', value: rest }] : head
  const total = parts.reduce((s, x) => s + x.value, 0)
  if (!total) return null
  const R = 70, C = 2 * Math.PI * R
  let offset = 0
  const cur = on !== null ? parts[on] : null
  return (
    <div className="pie" onPointerLeave={() => setOn(null)}>
      <svg viewBox="0 0 200 200" role="img" aria-label={summary}>
        <circle cx="100" cy="100" r={R} className="donut-track" strokeWidth="26" />
        {parts.map((s, i) => {
          const len = (s.value / total) * C
          const el = (
            <circle key={s.label + i} cx="100" cy="100" r={R} fill="none" stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={on === i ? 32 : 26}
              className={`pie-seg${on !== null && on !== i ? ' dim' : ''}`} strokeDasharray={`${Math.max(len - 2, 0.5)} ${C}`} strokeDashoffset={-offset} transform="rotate(-90 100 100)"
              style={{ '--len': `${Math.max(len - 2, 0.5)}px`, '--c': `${C}px`, animationDelay: `${i * 110}ms` } as CSSProperties} onPointerEnter={() => setOn(i)} onPointerDown={() => setOn(i)} />
          )
          offset += len
          return el
        })}
        <text x="100" y="94" className="pie-center">{compact(cur ? cur.value : total)}</text>
        <text x="100" y="114" className="pie-sub">{cur ? `${formatNumber((cur.value / total) * 100, 1)} %` : title}</text>
      </svg>
      <ul className="pie-legend">
        {parts.map((s, i) => (
          <li key={s.label + i} className={on === i ? 'on' : on !== null ? 'dim' : ''} tabIndex={0} onPointerEnter={() => setOn(i)} onFocus={() => setOn(i)} onBlur={() => setOn(null)}>
            <i style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} aria-hidden="true" />
            <span>{s.label}</span>
            <b>{format(s.value)}</b>
            <small>{formatNumber((s.value / total) * 100, 1)} %</small>
          </li>
        ))}
      </ul>
    </div>
  )
}
