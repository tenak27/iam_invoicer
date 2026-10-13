import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'

/**
 * Awa, le personnage d'accueil (illustration originale) : en Faso Dan Fani, tablette en main.
 * Elle suit le pointeur du regard, penche la tête, cligne des yeux, et réagit quand on la
 * survole ou qu'on clique : salut, saut de joie avec pluie de pièces, clin d'œil, pouce levé.
 * Son humeur suit l'activité (ventes en hausse, points urgents) et elle dit un mot dans une bulle.
 * Animations en CSS (styles.css, préfixe .mx-), figées si l'on demande moins de mouvement.
 */
export type MascotMood = 'happy' | 'calm' | 'alert'
type Act = 'idle' | 'wave' | 'jump' | 'wink' | 'cheer'
const ACTS: Act[] = ['wave', 'jump', 'wink', 'cheer']
const DURATION: Record<Act, number> = { idle: 0, wave: 1700, jump: 1500, wink: 1100, cheer: 1700 }

export function Mascot({ className = '', mood = 'calm', messages = [] }: { className?: string; mood?: MascotMood; messages?: string[] }) {
  const id = useId().replace(/:/g, '')
  const fani = `fani-${id}`
  const wrap = `wrap-${id}`
  const box = useRef<HTMLDivElement>(null)
  const [act, setAct] = useState<Act>('idle')
  const [turn, setTurn] = useState(0)
  const [bubble, setBubble] = useState<string | null>(null)
  const timers = useRef<number[]>([])
  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms))

  // Regard et tête tournés vers le pointeur, où qu'il soit dans la fenêtre
  useEffect(() => {
    const el = box.current
    if (!el || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    let frame = 0
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect()
        const dx = e.clientX - (r.left + r.width / 2)
        const dy = e.clientY - (r.top + r.height * 0.42)
        const d = Math.hypot(dx, dy) || 1
        const reach = Math.min(1, d / 260)
        el.style.setProperty('--px', ((dx / d) * 3 * reach).toFixed(2))
        el.style.setProperty('--py', ((dy / d) * 2.4 * reach).toFixed(2))
        el.style.setProperty('--tilt', (Math.max(-1, Math.min(1, dx / 420)) * 6).toFixed(2))
      })
    }
    window.addEventListener('pointermove', move, { passive: true })
    return () => {
      window.removeEventListener('pointermove', move)
      cancelAnimationFrame(frame)
    }
  }, [])

  // Un mot d'accueil à l'arrivée, puis elle se tait
  const first = messages[0]
  useEffect(() => {
    if (!first) return
    later(() => setBubble(first), 900)
    later(() => setBubble((b) => (b === first ? null : b)), 7000)
    return () => {
      timers.current.forEach(clearTimeout)
      timers.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first])

  const react = () => {
    const next = ACTS[turn % ACTS.length]
    setTurn(turn + 1)
    setAct(next)
    const said = messages.length ? messages[turn % messages.length] : ['Bonjour !', 'On encaisse ?', 'Belle journée de ventes !', 'Tout est à jour.'][turn % 4]
    setBubble(said)
    timers.current.forEach(clearTimeout)
    timers.current = []
    later(() => setAct('idle'), DURATION[next])
    later(() => setBubble(null), 5200)
  }

  return (
    <div ref={box} className={`mascot-wrap ${className} mood-${mood} is-${act}`}>
      {bubble && <div className="mascot-bubble" role="status" aria-live="polite" key={bubble}>{bubble}</div>}
      <button type="button" className="mascot-btn" onClick={react} aria-label="Awa, votre assistante : cliquez pour une réaction et un conseil">
        <svg className="mascot" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
          <defs>
            {/* Pagne tissé : bandes verticales indigo, or, blanc, vert */}
            <pattern id={fani} width="16" height="10" patternUnits="userSpaceOnUse">
              <rect width="16" height="10" fill="#1c2f52" />
              <rect x="0" width="4" height="10" fill="#e2a81f" />
              <rect x="6" width="2" height="10" fill="#f4f6fa" />
              <rect x="10" width="3" height="10" fill="#1fa463" />
            </pattern>
            <pattern id={wrap} width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
              <rect width="12" height="12" fill="#e2a81f" />
              <rect width="4" height="12" fill="#1fa463" />
              <rect x="7" width="2" height="12" fill="#0b4f8a" />
            </pattern>
          </defs>

          <ellipse cx="100" cy="191" rx="52" ry="7" className="mx-shadow" />

          {/* Pièces en suspension ; au saut de joie, une pluie de pièces part du personnage */}
          {[[166, 52, 11], [186, 96, 8], [150, 22, 7]].map(([x, y, r], i) => (
            <g key={i} className={`mx-coin mx-coin-${i}`}>
              <circle cx={x} cy={y} r={r} fill="#e2a81f" stroke="#b07d0e" strokeWidth="2" />
              <text x={x} y={y + r * 0.38} textAnchor="middle" fontSize={r * 1.05} fontWeight="800" fill="#7a5600" fontFamily="Arial, sans-serif">F</text>
            </g>
          ))}
          <g className="mx-burst">
            {Array.from({ length: 9 }, (_, i) => (
              <circle key={i} cx="100" cy="96" r={i % 3 === 0 ? 5 : 3.6} fill={i % 3 === 1 ? '#1fa463' : '#e2a81f'} stroke="#b07d0e" strokeWidth={i % 3 === 1 ? 0 : 1} style={{ '--a': `${i * 40 - 160}deg`, '--d': `${i * 35}ms` } as CSSProperties} />
            ))}
          </g>
          <path className="mx-spark" d="M36 36 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3z" fill="#e2a81f" />
          <path className="mx-spark mx-spark-2" d="M178 134 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" fill="#1fa463" />
          <g className="mx-alert"><circle cx="150" cy="58" r="11" fill="#dc2626" /><path d="M150 51 v8 M150 63.5 v.5" stroke="#fff" strokeWidth="3" strokeLinecap="round" /></g>

          <g className="mx-all">
            {/* Bras qui salue (derrière le buste) */}
            <g className="mx-arm-l">
              <path d="M62 150 C50 136 42 120 38 104" stroke="#1c2f52" strokeWidth="14" fill="none" strokeLinecap="round" />
              <circle cx="36" cy="96" r="9.5" fill="#8d5a3a" />
              <path className="mx-fingers" d="M29 89 l-3 -6 M35 86 l-1 -7 M41 88 l2 -6" stroke="#8d5a3a" strokeWidth="4" strokeLinecap="round" />
              <path className="mx-thumb" d="M36 90 v-12" stroke="#8d5a3a" strokeWidth="5.5" strokeLinecap="round" />
            </g>

            {/* Buste en pagne tissé */}
            <path d="M50 192 C50 150 70 128 100 128 C130 128 150 150 150 192 Z" fill={`url(#${fani})`} />
            <path d="M86 128 L100 146 L114 128 Z" fill="#7a4a2d" />
            <rect x="91" y="110" width="18" height="22" rx="7" fill="#7a4a2d" />

            {/* Tête : penche vers le pointeur */}
            <g className="mx-head">
              <circle cx="69" cy="95" r="6.5" fill="#7a4a2d" />
              <circle cx="131" cy="95" r="6.5" fill="#7a4a2d" />
              <circle className="mx-earring" cx="69" cy="104" r="3" fill="#e2a81f" />
              <circle className="mx-earring" cx="131" cy="104" r="3" fill="#e2a81f" />
              <circle cx="100" cy="92" r="31" fill="#8d5a3a" />
              <circle className="mx-cheek" cx="81" cy="104" r="5.5" fill="#e07a5f" />
              <circle className="mx-cheek" cx="119" cy="104" r="5.5" fill="#e07a5f" />

              {/* Yeux : blanc, pupille mobile, reflet ; paupières pour le clignement et le clin d'œil */}
              <g className="mx-eye mx-eye-l">
                <ellipse cx="88" cy="93" rx="6.4" ry="7.2" fill="#fff" />
                <g className="mx-pupil"><circle cx="88" cy="93.5" r="3.6" fill="#1c1c28" /><circle cx="89.3" cy="92" r="1.2" fill="#fff" /></g>
              </g>
              <g className="mx-eye mx-eye-r">
                <ellipse cx="112" cy="93" rx="6.4" ry="7.2" fill="#fff" />
                <g className="mx-pupil"><circle cx="112" cy="93.5" r="3.6" fill="#1c1c28" /><circle cx="113.3" cy="92" r="1.2" fill="#fff" /></g>
              </g>
              <path className="mx-wink" d="M106 94 q6 -5 12 0" stroke="#3b1f12" strokeWidth="2.6" fill="none" strokeLinecap="round" />
              <path className="mx-brow mx-brow-l" d="M81 83 Q88 79 95 83" stroke="#3b1f12" strokeWidth="2.4" fill="none" strokeLinecap="round" />
              <path className="mx-brow mx-brow-r" d="M105 83 Q112 79 119 83" stroke="#3b1f12" strokeWidth="2.4" fill="none" strokeLinecap="round" />

              {/* Bouches : sourire, grand sourire (survol, joie), moue attentive */}
              <path className="mx-mouth mx-smile" d="M91 106 Q100 114 109 106" stroke="#5a2416" strokeWidth="2.8" fill="none" strokeLinecap="round" />
              <g className="mx-mouth mx-grin"><path d="M88 104 Q100 121 112 104 Z" fill="#5a2416" /><path d="M92 105.5 Q100 110 108 105.5" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" /></g>
              <path className="mx-mouth mx-pout" d="M93 109 Q100 105 107 109" stroke="#5a2416" strokeWidth="2.8" fill="none" strokeLinecap="round" />

              {/* Foulard noué */}
              <path d="M66 90 C63 57 84 47 100 47 C118 47 139 57 134 90 C127 77 114 71 100 71 C86 71 73 77 66 90 Z" fill={`url(#${wrap})`} />
              <g className="mx-knot">
                <ellipse cx="132" cy="59" rx="9" ry="8" fill={`url(#${wrap})`} />
                <path d="M137 61 C147 57 151 65 145 71 C142 67 140 65 137 65 Z" fill="#1fa463" />
              </g>
            </g>

            {/* Bras qui tient la tablette */}
            <g className="mx-arm-r">
              <path d="M140 150 C140 162 134 170 128 174" stroke="#1c2f52" strokeWidth="14" fill="none" strokeLinecap="round" />
              <g transform="rotate(-8 128 160)">
                <rect x="102" y="139" width="52" height="40" rx="7" fill="#ffffff" stroke="#0b4f8a" strokeWidth="3" />
                <rect className="mx-line" x="109" y="146" width="22" height="4" rx="2" fill="#c9d8e8" />
                <rect className="mx-line mx-line-2" x="109" y="154" width="16" height="4" rx="2" fill="#c9d8e8" />
                <circle className="mx-seal" cx="140" cy="164" r="8" fill="#1fa463" />
                <path className="mx-tick" d="M136 164 l3 3 5 -6" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </g>
              <circle cx="127" cy="176" r="7.5" fill="#8d5a3a" />
            </g>
          </g>
        </svg>
      </button>
    </div>
  )
}
