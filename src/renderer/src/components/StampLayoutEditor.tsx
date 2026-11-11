// Ajustement du cachet et de la signature sur les documents : aperçu du cadre de signature à l'échelle
// du document, images déplaçables à la souris ou au doigt, curseurs de taille, rotation et encre.
import { useRef, useState } from 'react'
import { DEFAULT_STAMP_LAYOUT, LAYOUT_LIMITS, signStyle, stampStyle, type StampLayout } from '@shared/stampLayout'

const css = (s: string): React.CSSProperties =>
  Object.fromEntries(s.split(';').filter(Boolean).map((p) => { const i = p.indexOf(':'); return [p.slice(0, i).replace(/-([a-z])/g, (_m, c) => c.toUpperCase()), p.slice(i + 1)] })) as React.CSSProperties
const bound = (v: number) => Math.min(LAYOUT_LIMITS.offset[1], Math.max(LAYOUT_LIMITS.offset[0], Math.round(v)))

export function StampLayoutEditor({ value, onChange, stamp, signature, company, signer }: { value: StampLayout; onChange: (l: StampLayout) => void; stamp?: string; signature?: string; company: string; signer: string }) {
  const [target, setTarget] = useState<'stamp' | 'sign'>('stamp')
  const drag = useRef<{ what: 'stamp' | 'sign'; px: number; py: number; x: number; y: number } | null>(null)
  const set = (what: 'stamp' | 'sign', patch: Record<string, number>) => onChange({ ...value, [what]: { ...value[what], ...patch } } as StampLayout)
  const down = (what: 'stamp' | 'sign') => (e: React.PointerEvent) => {
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setTarget(what)
    drag.current = { what, px: e.clientX, py: e.clientY, x: value[what].x, y: value[what].y }
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (d) set(d.what, { x: bound(d.x + e.clientX - d.px), y: bound(d.y + e.clientY - d.py) })
  }
  const up = () => (drag.current = null)
  const cur = value[target]
  const slider = (label: string, key: string, [min, max]: readonly [number, number], unit: string) => (
    <label className="sl-row">
      <span>{label}</span>
      <input type="range" min={min} max={max} value={(cur as any)[key]} onChange={(e) => set(target, { [key]: Number(e.target.value) })} />
      <output>{(cur as any)[key]}{unit}</output>
    </label>
  )
  return (
    <div className="stamp-layout">
      <div className="sl-preview" onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <div className="sl-sigbox">
          <div className="sl-t">Pour {company || 'votre société'}</div>
          {signature ? <img className={`sl-sig${target === 'sign' ? ' on' : ''}`} src={signature} alt="Signature" style={css(signStyle(value))} onPointerDown={down('sign')} draggable={false} /> : <span className="muted small">Ajoutez une signature pour la placer.</span>}
          {stamp && <img className={`sl-cachet${target === 'stamp' ? ' on' : ''}`} src={stamp} alt="Cachet" style={css(stampStyle(value))} onPointerDown={down('stamp')} draggable={false} />}
          <div className="sl-who">{signer || 'Signature et cachet'}</div>
        </div>
        <p className="muted small">Aperçu à la taille réelle du document. Faites glisser le cachet ou la signature pour les placer.</p>
      </div>
      <div className="sl-controls">
        <div className="chips" role="tablist">
          <button type="button" className={`chip${target === 'stamp' ? ' on' : ''}`} aria-pressed={target === 'stamp'} onClick={() => setTarget('stamp')}>Cachet</button>
          <button type="button" className={`chip${target === 'sign' ? ' on' : ''}`} aria-pressed={target === 'sign'} onClick={() => setTarget('sign')}>Signature</button>
        </div>
        {slider('Taille', 'size', LAYOUT_LIMITS.size, ' %')}
        {slider('Horizontal', 'x', LAYOUT_LIMITS.offset, ' px')}
        {slider('Vertical', 'y', LAYOUT_LIMITS.offset, ' px')}
        {target === 'stamp' && slider('Rotation', 'rotate', LAYOUT_LIMITS.rotate, '°')}
        {target === 'stamp' && slider('Encre', 'opacity', LAYOUT_LIMITS.opacity, ' %')}
        <button type="button" className="link-btn small" onClick={() => onChange({ ...value, [target]: DEFAULT_STAMP_LAYOUT[target] } as StampLayout)}>Remettre {target === 'stamp' ? 'le cachet' : 'la signature'} à sa place d’origine</button>
      </div>
    </div>
  )
}
