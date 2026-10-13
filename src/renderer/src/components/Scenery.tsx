// Décors illustrés (illustrations originales, purement décoratives) : paysage de savane
// sous les nuages pour la carte d'accueil et les écrans de connexion, feuillage pour le
// menu du thème Améthyste. Les couleurs viennent des jetons du thème (styles.css, .sc-*).

/** Ciel, soleil, nuages qui dérivent, collines et baobabs. */
export function Scenery({ className = '' }: { className?: string }) {
  return (
    <svg className={`scenery ${className}`} viewBox="0 0 1200 300" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <circle className="sc-sun-halo" cx="905" cy="70" r="70" />
      <circle className="sc-sun" cx="905" cy="70" r="34" />
      <g className="sc-stars">
        {[[120, 40, 2], [300, 86, 1.6], [470, 30, 2.2], [640, 64, 1.5], [760, 24, 2], [1040, 44, 1.7], [1140, 110, 2]].map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} />)}
      </g>
      <g className="sc-cloud sc-cloud-1"><ellipse cx="210" cy="82" rx="62" ry="17" /><circle cx="188" cy="70" r="21" /><circle cx="220" cy="62" r="27" /><circle cx="250" cy="74" r="17" /></g>
      <g className="sc-cloud sc-cloud-2"><ellipse cx="610" cy="52" rx="48" ry="13" /><circle cx="594" cy="43" r="16" /><circle cx="619" cy="37" r="20" /><circle cx="640" cy="46" r="12" /></g>
      <g className="sc-cloud sc-cloud-3"><ellipse cx="1090" cy="112" rx="54" ry="14" /><circle cx="1072" cy="102" r="17" /><circle cx="1098" cy="95" r="22" /><circle cx="1122" cy="105" r="13" /></g>
      <path className="sc-hill-far" d="M0 226 C165 182 321 198 495 214 C678 231 786 172 960 186 C1074 195 1152 214 1200 204 L1200 300 L0 300Z" />
      {/* Baobabs : tronc épais, branches courtes, petites couronnes */}
      <g className="sc-tree" transform="translate(742 146)">
        <path d="M-9 60 C-7 34 -8 20 -4 6 L4 6 C8 20 7 34 9 60Z" />
        <path d="M-3 10 L-22 -8 M0 8 L-4 -16 M3 10 L20 -10" fill="none" strokeWidth="5" strokeLinecap="round" />
        <circle cx="-24" cy="-12" r="11" /><circle cx="-4" cy="-22" r="13" /><circle cx="22" cy="-14" r="11" />
      </g>
      <g className="sc-tree" transform="translate(96 168) scale(.72)">
        <path d="M-9 60 C-7 34 -8 20 -4 6 L4 6 C8 20 7 34 9 60Z" />
        <path d="M-3 10 L-22 -8 M0 8 L-4 -16 M3 10 L20 -10" fill="none" strokeWidth="5" strokeLinecap="round" />
        <circle cx="-24" cy="-12" r="11" /><circle cx="-4" cy="-22" r="13" /><circle cx="22" cy="-14" r="11" />
      </g>
      <path className="sc-hill-near" d="M0 262 C210 226 393 250 600 258 C813 266 963 224 1200 244 L1200 300 L0 300Z" />
    </svg>
  )
}

/** Feuillage au pied du menu (thème Améthyste). */
export function SidebarArt() {
  return (
    <svg className="sidebar-art" viewBox="0 0 260 230" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <path className="lf-1" d="M-10 230 C-6 150 30 96 96 70 C92 132 70 190 20 230Z" />
      <path className="lf-2" d="M48 230 C40 170 62 120 118 92 C132 150 116 200 86 230Z" />
      <path className="lf-3" d="M150 230 C150 176 176 134 232 118 C238 168 220 208 190 230Z" />
      <path className="lf-4" d="M96 230 C100 196 122 170 160 160 C162 192 150 216 130 230Z" />
      <path className="lf-5" d="M196 230 C204 196 228 176 270 172 L270 230Z" />
      <g className="lf-vein" fill="none" strokeLinecap="round">
        <path d="M14 226 C30 170 56 120 92 76" />
        <path d="M70 226 C72 180 88 136 116 98" />
        <path d="M172 226 C182 184 202 150 230 122" />
      </g>
      <g className="lf-sprig">
        <path d="M118 150 C112 120 122 96 144 82" fill="none" strokeLinecap="round" />
        <ellipse cx="124" cy="118" rx="5" ry="10" transform="rotate(-40 124 118)" /><ellipse cx="134" cy="100" rx="5" ry="10" transform="rotate(-30 134 100)" /><ellipse cx="112" cy="132" rx="5" ry="10" transform="rotate(40 112 132)" /><ellipse cx="147" cy="86" rx="5" ry="10" transform="rotate(30 147 86)" />
      </g>
    </svg>
  )
}
