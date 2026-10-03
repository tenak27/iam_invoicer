// Graphiques SVG légers (aucune bibliothèque) : aire lissée, mini-courbe,
// anneau et barres de progression. Chaque graphique porte un résumé texte
// (aria-label) et des info-bulles natives (<title>) avec les valeurs exactes.

import { useId } from 'react'
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
