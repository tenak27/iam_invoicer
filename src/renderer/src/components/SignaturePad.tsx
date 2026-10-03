import { useEffect, useRef, useState } from 'react'

/**
 * Zone de signature : doigt, stylet ou souris (Pointer Events).
 * Alternative clavier (règle d'accessibilité « dragging-alternative ») :
 * « Signer avec mon nom » trace le nom saisi en écriture manuscrite.
 */
export function SignaturePad({ onChange, typedName }: { onChange: (png: string | null) => void; typedName?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const [dirty, setDirty] = useState(false)
  const drew = useRef(false)

  const ctx = () => ref.current!.getContext('2d')!
  const setup = () => {
    const c = ref.current!
    const r = c.getBoundingClientRect()
    const d = window.devicePixelRatio || 1
    c.width = r.width * d
    c.height = r.height * d
    const x = ctx()
    x.scale(d, d)
    x.lineWidth = 2.6
    x.lineCap = 'round'
    x.lineJoin = 'round'
    x.strokeStyle = '#1c2b4a'
  }
  useEffect(setup, [])

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const commit = () => {
    setDirty(true)
    onChange(ref.current!.toDataURL('image/png'))
  }
  const clear = () => {
    const c = ref.current!
    ctx().clearRect(0, 0, c.width, c.height)
    drew.current = false
    setDirty(false)
    onChange(null)
  }
  const typeIt = () => {
    if (!typedName?.trim()) return
    clear()
    const r = ref.current!.getBoundingClientRect()
    const x = ctx()
    x.fillStyle = '#1c2b4a'
    x.font = `italic 600 ${Math.min(42, r.width / Math.max(typedName.length, 6) * 1.6)}px "Segoe Script", "Brush Script MT", cursive`
    x.fillText(typedName.trim(), 18, r.height / 2 + 12)
    commit()
  }

  return (
    <div className="sigpad">
      <div className={`sigpad-area ${dirty ? 'dirty' : ''}`}>
        <canvas
          ref={ref}
          aria-label="Zone de signature"
          onPointerDown={(e) => {
            drawing.current = true
            last.current = pos(e)
            ref.current!.setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => {
            if (!drawing.current || !last.current) return
            const p = pos(e)
            const x = ctx()
            x.beginPath()
            x.moveTo(last.current.x, last.current.y)
            x.lineTo(p.x, p.y)
            x.stroke()
            last.current = p
            drew.current = true
            if (!dirty) setDirty(true)
          }}
          onPointerUp={() => {
            if (drawing.current && drew.current) commit()
            drawing.current = false
          }}
          onPointerCancel={() => (drawing.current = false)}
        />
        {!dirty && <span className="sigpad-hint">Signez ici avec le doigt, un stylet ou la souris</span>}
      </div>
      <div className="row gap wrap">
        <button type="button" className="btn btn-sm" onClick={clear}>Effacer</button>
        {typedName !== undefined && <button type="button" className="btn btn-sm" onClick={typeIt} disabled={!typedName.trim()}>Signer avec mon nom</button>}
      </div>
    </div>
  )
}
