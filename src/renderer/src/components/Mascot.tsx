import { useId } from 'react'

/**
 * Personnage d'accueil animé (illustration originale) : une caissière en
 * Faso Dan Fani qui salue, tablette en main avec une facture validée.
 * Animations en CSS (styles.css, préfixe .m-), coupées si l'utilisateur
 * demande moins de mouvement.
 */
export function Mascot({ className = '' }: { className?: string }) {
  const id = useId().replace(/:/g, '')
  const fani = `fani-${id}`
  const wrap = `wrap-${id}`
  return (
    <svg className={`mascot ${className}`} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
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

      <ellipse cx="100" cy="191" rx="54" ry="7" className="m-shadow" />

      {/* Étincelles et pièces */}
      <path className="m-spark" d="M38 34 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3z" fill="#e2a81f" />
      <path className="m-spark m-spark-2" d="M176 130 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" fill="#1fa463" />
      {[
        [162, 50, 12],
        [184, 90, 9],
        [148, 18, 8]
      ].map(([x, y, r], i) => (
        <g key={i} className={`m-coin m-coin-${i}`}>
          <circle cx={x} cy={y} r={r} fill="#e2a81f" stroke="#b07d0e" strokeWidth="2" />
          <circle cx={x} cy={y} r={r - 4} fill="none" stroke="#fff3c4" strokeWidth="1.2" opacity=".8" />
          <text x={x} y={y + r * 0.38} textAnchor="middle" fontSize={r * 1.05} fontWeight="800" fill="#7a5600" fontFamily="Arial, sans-serif">F</text>
        </g>
      ))}

      <g className="m-body">
        {/* Buste en pagne tissé */}
        <path d="M50 192 C50 150 70 128 100 128 C130 128 150 150 150 192 Z" fill={`url(#${fani})`} />
        <path d="M86 128 L100 146 L114 128 Z" fill="#7a4a2d" />
        <rect x="91" y="110" width="18" height="22" rx="7" fill="#7a4a2d" />

        {/* Tête */}
        <circle cx="70" cy="95" r="6.5" fill="#7a4a2d" />
        <circle cx="130" cy="95" r="6.5" fill="#7a4a2d" />
        <circle cx="70" cy="103" r="2.6" fill="#e2a81f" />
        <circle cx="130" cy="103" r="2.6" fill="#e2a81f" />
        <circle cx="100" cy="92" r="30" fill="#8d5a3a" />
        <circle cx="83" cy="103" r="5" fill="#e07a5f" opacity=".35" />
        <circle cx="117" cy="103" r="5" fill="#e07a5f" opacity=".35" />
        <ellipse className="m-eye" cx="89" cy="93" rx="3.2" ry="4.2" fill="#1c1c28" />
        <ellipse className="m-eye" cx="111" cy="93" rx="3.2" ry="4.2" fill="#1c1c28" />
        <path d="M84 85 Q89 82 94 85 M106 85 Q111 82 116 85" stroke="#3b1f12" strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d="M90 104 Q100 117 110 104 Z" fill="#5a2416" />
        <path d="M93 105.5 Q100 109 107 105.5" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />

        {/* Foulard noué */}
        <path d="M67 90 C64 58 84 48 100 48 C118 48 138 58 133 90 C126 77 114 72 100 72 C86 72 74 77 67 90 Z" fill={`url(#${wrap})`} />
        <ellipse cx="131" cy="60" rx="9" ry="8" fill={`url(#${wrap})`} />
        <path d="M136 62 C146 58 150 66 144 72 C141 68 139 66 136 66 Z" fill="#1fa463" />

        {/* Bras qui tient la tablette */}
        <path d="M140 150 C140 162 134 170 128 174" stroke="#1c2f52" strokeWidth="14" fill="none" strokeLinecap="round" />
        <g transform="rotate(-8 128 160)">
          <rect x="102" y="139" width="52" height="40" rx="7" fill="#ffffff" stroke="#0b4f8a" strokeWidth="3" />
          <rect x="109" y="146" width="22" height="4" rx="2" fill="#c9d8e8" />
          <rect x="109" y="154" width="16" height="4" rx="2" fill="#c9d8e8" />
          <circle cx="140" cy="164" r="8" fill="#1fa463" />
          <path d="M136 164 l3 3 5 -6" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        <circle cx="127" cy="176" r="7.5" fill="#8d5a3a" />
      </g>

      {/* Bras qui salue */}
      <g className="m-wave">
        <path d="M62 148 C52 132 44 116 40 102" stroke="#1c2f52" strokeWidth="14" fill="none" strokeLinecap="round" />
        <circle cx="38" cy="95" r="9.5" fill="#8d5a3a" />
        <path d="M31 88 l-3 -6 M37 85 l-1 -7 M43 87 l2 -6" stroke="#8d5a3a" strokeWidth="4" strokeLinecap="round" />
      </g>
    </svg>
  )
}
