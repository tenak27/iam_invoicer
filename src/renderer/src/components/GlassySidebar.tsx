// Barre latérale en verre dépoli, animée et colorée (inspirée de la démo « Glassy Sidebar ») :
//   - tuiles d'icônes colorées (dégradé par rubrique) en squircle ;
//   - état rail (replié) avec effet loupe façon dock macOS au survol ;
//   - état étendu avec libellés et pilule active qui glisse (motion layoutId) ;
//   - lettrage !am DÉPENSE en tête, compte en pied.
import { useRef, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { motion } from 'motion/react'
import { CaretDown, DotsThreeOutline, LockSimple, type Icon } from '@phosphor-icons/react'

// Petit avatar autonome (initiales + couleur stable), sans dépendance à ./ui (portable d'une app à l'autre).
const GSB_AV_COLORS = ['#3b60d8', '#0d9488', '#16a34a', '#8b2fd0', '#0891b2', '#ea8a0c', '#e11d48', '#4f46e5', '#64748b']
function GsbAvatar({ name, address, size }: { name: string; address: string; size: number }) {
  const label = (name || address || '?').replace(/["']/g, '').trim()
  const parts = label.split(/[\s@._-]+/).filter(Boolean)
  const initials = ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase()
  let h = 0
  for (const c of address) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return <span className="gsb-avatar" style={{ width: size, height: size, background: GSB_AV_COLORS[h % GSB_AV_COLORS.length], fontSize: size * 0.38 }} aria-hidden="true">{initials}</span>
}

export interface GItem { to: string; label: string; icon: Icon; tone: string; color?: string; locked?: boolean }
export interface GSection { title?: string; items: GItem[] }

// Dégradés par rubrique (tuiles colorées)
const TONE: Record<string, [string, string]> = {
  blue: ['#60a5fa', '#3b60d8'],
  indigo: ['#818cf8', '#4f46e5'],
  green: ['#4ade80', '#16a34a'],
  teal: ['#2dd4bf', '#0d9488'],
  violet: ['#c084fc', '#8b2fd0'],
  cyan: ['#38bdf8', '#0891b2'],
  amber: ['#fbbf24', '#ea8a0c'],
  rose: ['#fb7185', '#e11d48'],
  slate: ['#94a3b8', '#64748b']
}
const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

export function GlassySidebar({
  sections, collapsed, onToggle, isActive, name, address, companyName, badges, topSlot, bottomSlot, fold, logoSrc = './logo.svg', wordmark, lockedHref = '/licence'
}: {
  sections: GSection[]
  collapsed: boolean
  onToggle: () => void
  isActive: (to: string) => boolean
  name: string
  address: string
  companyName: string
  /** Pastilles facultatives par route (ex. alertes), affichées à droite du libellé et en point sur le rail. */
  badges?: Record<string, ReactNode>
  /** Contenu propre à l'app sous l'en-tête (ex. sélecteur d'établissement), masqué en mode rail. */
  topSlot?: ReactNode
  /** Contenu propre à l'app au-dessus du pied (ex. jauge de stockage), masqué en mode rail. */
  bottomSlot?: ReactNode
  /** Sections repliables (ex. IAM ÉDUCATION) : en-têtes cliquables qui masquent leurs entrées. */
  fold?: { isFolded: (title?: string) => boolean; toggle: (title: string) => void }
  /** Logo du rail (replié). Par défaut ./logo.svg. */
  logoSrc?: string
  /** Lettrage déplié : image wordmark.svg par défaut, ou un nœud fourni (ex. texte de marque). */
  wordmark?: ReactNode
  /** Destination des entrées verrouillées (module hors licence). Par défaut /licence. */
  lockedHref?: string
}) {
  const navRef = useRef<HTMLElement>(null)

  // Effet loupe (dock) : uniquement en mode rail, au survol vertical.
  const magnify = (clientY: number) => {
    if (!collapsed || reduce || !navRef.current) return
    navRef.current.querySelectorAll<HTMLElement>('.gsb-tile').forEach((el) => {
      const r = el.getBoundingClientRect()
      const d = Math.abs(r.top + r.height / 2 - clientY)
      const k = Math.max(0, 1 - d / 96)
      const boost = 0.55 * k * k
      el.style.setProperty('--s', (1 + boost).toFixed(3))
      el.style.setProperty('--tx', (boost * 12).toFixed(1) + 'px')
    })
  }
  const resetMag = () => {
    navRef.current?.querySelectorAll<HTMLElement>('.gsb-tile').forEach((el) => {
      el.style.setProperty('--s', '1')
      el.style.setProperty('--tx', '0')
    })
  }

  return (
    <aside className={`glass-sb ${collapsed ? 'rail' : 'wide'}`} aria-label="Navigation principale">
      <div className="gsb-brand">
        {collapsed
          ? <img className="gsb-mark" src={logoSrc} width={38} height={38} alt="" />
          : (wordmark ?? <img className="gsb-word" src="./wordmark.svg" alt="" />)}
        {!collapsed && <span className="gsb-company">{companyName}</span>}
        <button className="gsb-collapse" onClick={onToggle} aria-pressed={collapsed} aria-label={collapsed ? 'Déplier le menu' : 'Replier le menu'}>
          <DotsThreeOutline size={18} weight="fill" aria-hidden="true" />
        </button>
      </div>

      {!collapsed && topSlot && <div className="gsb-slot">{topSlot}</div>}

      <nav className="gsb-nav" ref={navRef} onMouseMove={(e) => magnify(e.clientY)} onMouseLeave={resetMag}>
        {sections.map((section, si) => {
          const shut = !collapsed && !!section.title && !!fold && fold.isFolded(section.title)
          const items = shut ? section.items.filter((it) => isActive(it.to)) : section.items
          return (
          <div className={`gsb-section${shut ? ' is-folded' : ''}`} key={si}>
            {section.title && !collapsed && (fold
              ? <button type="button" className="gsb-sec-lbl gsb-fold" onClick={() => fold.toggle(section.title!)} aria-expanded={!shut}><span>{section.title}</span><CaretDown size={12} weight="bold" className="gsb-fold-ic" style={{ transform: shut ? 'rotate(-90deg)' : 'none' }} aria-hidden="true" /></button>
              : <div className="gsb-sec-lbl">{section.title}</div>)}
            {items.map((it) => {
              const [c1, c2] = it.color ? [it.color, it.color] : (TONE[it.tone] ?? TONE.slate)
              const locked = !!it.locked
              const active = !locked && isActive(it.to)
              return (
                <NavLink key={it.to} to={locked ? lockedHref : it.to} end={it.to === '/'} className={`gsb-item${active ? ' active' : ''}${locked ? ' locked' : ''}`} title={locked ? `${it.label} — non inclus dans votre licence` : collapsed ? it.label : undefined} style={{ ['--c1' as string]: c1, ['--c2' as string]: c2 }}>
                  {active && !reduce && <motion.span layoutId="gsb-pill" className="gsb-pill" transition={{ type: 'spring', stiffness: 420, damping: 34 }} aria-hidden="true" />}
                  {active && reduce && <span className="gsb-pill" aria-hidden="true" />}
                  <span className="gsb-tile" aria-hidden="true"><it.icon size={19} weight={active ? 'fill' : 'regular'} />{collapsed && badges?.[it.to] && <span className="gsb-dot" />}</span>
                  {!collapsed && <span className="gsb-label">{it.label}</span>}
                  {!collapsed && locked && <LockSimple className="gsb-lock" size={14} weight="fill" aria-label="non inclus" />}
                  {!collapsed && !locked && badges?.[it.to] && <span className="gsb-badge">{badges[it.to]}</span>}
                </NavLink>
              )
            })}
          </div>
          )
        })}
      </nav>

      {!collapsed && bottomSlot && <div className="gsb-slot">{bottomSlot}</div>}

      <div className="gsb-foot">
        <GsbAvatar name={name} address={address} size={collapsed ? 34 : 36} />
        {!collapsed && (
          <div className="gsb-who">
            <b>{name}</b>
            <span>{address}</span>
          </div>
        )}
      </div>
    </aside>
  )
}

export function GlassBackdrop(): ReactNode {
  return <div className="glass-bg" aria-hidden="true"><span className="gb g1" /><span className="gb g2" /><span className="gb g3" /></div>
}
