// Barre supérieure flottante : recherche rapide (Ctrl+K), thème, notifications,
// menu du compte. Les menus déroulants se ferment au clic extérieur et à Échap.

import type { PointerEvent as ReactPointerEvent } from 'react'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Bell, CashRegister, Check, Desktop, FileText, Gear, MagnifyingGlass, Moon, Notepad, Package, Palette as PaletteIcon, SignOut, Sun, User, Warning,
  type Icon
} from '@phosphor-icons/react'
import { can, ROLE_LABELS, type Module } from '@shared/domain'
import { formatDate, formatMoney, formatQty } from '@shared/format'
import { useQuery } from '../api'
import { useSession } from '../session'
import { PALETTES, setPalette, setTheme, useAppearance, type ThemeChoice } from '../theme'
import { flushSync } from 'react-dom'
import { themeReveal } from './fx'

export type NavEntry = { to: string; label: string; module: Module; icon: Icon }

function usePopover() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return { open, setOpen, ref }
}

/** Dégradés de l'avatar : assez sombres pour des initiales blanches lisibles (contraste AA). */
const AVATAR_TONES: [string, string][] = [
  ['#2a70d6', '#163f8a'], ['#5b4bd6', '#33248f'], ['#8a3fc4', '#541f85'], ['#c23a7a', '#7d1d4a'],
  ['#0d8a8f', '#07555c'], ['#1c8a52', '#0c5631'], ['#b3600f', '#733a06'], ['#c0453a', '#7c241c']
]

/** Teinte stable par personne : le même nom donne toujours la même couleur. */
function avatarTone(name: string): [string, string] {
  let h = 0
  for (const c of name.trim().toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return AVATAR_TONES[h % AVATAR_TONES.length]
}

/**
 * Avatar de l'utilisateur : photo ou initiales sur un dégradé propre à la personne, anneau
 * tissé qui tourne avec son halo, étincelle en orbite, reflet périodique et pastille
 * « en ligne » qui pulse. Hors connexion, l'anneau se fige et se ternit.
 */
/** Inclinaison en relief vers le pointeur (sans effet si l'on demande moins de mouvement : voir styles.css). */
function tilt(e: ReactPointerEvent<HTMLElement>) {
  const el = e.currentTarget
  const r = el.getBoundingClientRect()
  el.style.setProperty('--tx', (((e.clientX - r.left) / r.width - 0.5) * 2).toFixed(2))
  el.style.setProperty('--ty', (((e.clientY - r.top) / r.height - 0.5) * 2).toFixed(2))
}
function untilt(e: ReactPointerEvent<HTMLElement>) {
  e.currentTarget.style.setProperty('--tx', '0')
  e.currentTarget.style.setProperty('--ty', '0')
}

export function UserAvatar({ name, size = 38, online = true, photo, ring = true }: { name: string; size?: number; online?: boolean; photo?: string; ring?: boolean }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  const [a, b] = avatarTone(name)
  const style = { width: size, height: size, '--av-a': a, '--av-b': b, '--av-size': `${size}px` } as CSSProperties
  return (
    <span className={`uavatar${ring ? ' has-ring' : ''}${online ? '' : ' is-off'}`} style={style} aria-hidden="true" onPointerMove={tilt} onPointerLeave={untilt}>
      {ring && <span className="uavatar-glow" />}
      {ring && <span className="uavatar-ring" />}
      <span className="uavatar-face">{photo ? <img src={photo} alt="" /> : <span className="uavatar-initials">{initials}</span>}</span>
      {ring && <span className="uavatar-orbit"><i /></span>}
      {ring && <span className={`uavatar-dot ${online ? 'on' : 'off'}`} />}
    </span>
  )
}

const MODES: { id: ThemeChoice; label: string; icon: Icon }[] = [
  { id: 'system', label: 'Auto', icon: Desktop },
  { id: 'light', label: 'Clair', icon: Sun },
  { id: 'dark', label: 'Sombre', icon: Moon }
]

/**
 * Apparence : choix du thème de couleurs et du mode clair ou sombre. Le nouveau thème se
 * dévoile en cercle depuis l'élément cliqué. `floating` : bouton posé dans un coin des
 * écrans de connexion.
 */
export function ThemeMenu({ floating = false }: { floating?: boolean }) {
  const { theme, palette } = useAppearance()
  const pop = usePopover()
  const change = (el: Element, fn: () => void) => themeReveal(el, () => flushSync(fn))
  return (
    <div className={`pop${floating ? ' theme-float' : ''}`} ref={pop.ref}>
      <button className="nav-icon-btn" onClick={() => pop.setOpen(!pop.open)} aria-expanded={pop.open} aria-label="Apparence : thème et mode d'affichage" title="Apparence">
        <PaletteIcon size={21} aria-hidden="true" />
      </button>
      {pop.open && (
        <div className="pop-panel theme-panel" role="dialog" aria-label="Apparence">
          <div className="pop-head"><strong>Apparence</strong></div>
          <div className="theme-modes" role="radiogroup" aria-label="Mode d'affichage">
            {MODES.map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={theme === m.id} className={theme === m.id ? 'on' : ''} onClick={(e) => change(e.currentTarget, () => setTheme(m.id))}>
                <m.icon size={18} aria-hidden="true" />{m.label}
              </button>
            ))}
          </div>
          <div className="theme-list" role="radiogroup" aria-label="Thème de couleurs">
            {PALETTES.map((p) => (
              <button key={p.id} type="button" role="radio" aria-checked={palette === p.id} className={`theme-opt${palette === p.id ? ' on' : ''}`} onClick={(e) => change(e.currentTarget, () => setPalette(p.id))}>
                <span className="theme-thumb" aria-hidden="true" style={{ '--tb': p.swatch[0], '--ts': p.swatch[1], '--tp': p.swatch[2] } as CSSProperties}><i /><b /><b /><em /></span>
                <span className="theme-name"><strong>{p.name}</strong><small>{p.hint}</small></span>
                {palette === p.id && <Check className="theme-check" size={18} weight="bold" aria-hidden="true" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Notifications() {
  const pop = usePopover()
  const nav = useNavigate()
  const { data, reload } = useQuery<any>('reports.dashboard')
  // Rafraîchies après chaque saisie, au changement de page, au retour sur la fenêtre, et chaque minute
  const location = useLocation()
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const soon = () => { if (timer) clearTimeout(timer); timer = setTimeout(reload, 400) }
    const onVisible = () => document.visibilityState === 'visible' && soon()
    const t = setInterval(reload, 60_000)
    window.addEventListener('iam-data-changed', soon)
    window.addEventListener('focus', soon)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(t)
      if (timer) clearTimeout(timer)
      window.removeEventListener('iam-data-changed', soon)
      window.removeEventListener('focus', soon)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [reload])
  useEffect(() => { reload() }, [location.pathname, reload])
  const canSales = can(useSession().user.role, 'sales')
  const items: { key: string; icon: Icon; tone: string; title: string; text: string; to?: string }[] = [
    ...(data?.overdue ?? []).slice(0, 6).map((o: any) => ({
      key: `o${o.id}`, icon: Warning, tone: 'danger', title: `${o.number} en retard`,
      text: `${o.party_name} · ${formatMoney(o.remaining)} depuis le ${formatDate(o.due_date)}`, to: canSales ? `/doc/${o.id}` : undefined
    })),
    ...(data?.lowStock ?? []).slice(0, 6).map((p: any) => ({
      key: `s${p.id}`, icon: Package, tone: 'warning', title: `Stock bas : ${p.name}`,
      text: `${formatQty(p.stock_qty)} ${p.unit} restant(s), seuil ${formatQty(p.min_stock)}`, to: '/stock'
    }))
  ]
  return (
    <div className="pop" ref={pop.ref}>
      <button className="nav-icon-btn" onClick={() => pop.setOpen(!pop.open)} aria-expanded={pop.open} aria-label={`Notifications : ${items.length}`}>
        <Bell size={21} aria-hidden="true" />
        {items.length > 0 && <span className="nav-badge">{items.length}</span>}
      </button>
      {pop.open && (
        <div className="pop-panel notif-panel" role="dialog" aria-label="Notifications">
          <div className="pop-head"><strong>Notifications</strong>{items.length > 0 && <span className="pill">{items.length} à traiter</span>}</div>
          {items.length === 0 ? (
            <p className="pop-empty">Tout est à jour : aucune facture en retard, aucun stock bas.</p>
          ) : (
            <ul className="notif-list">
              {items.map((it) => (
                <li key={it.key}>
                  <button disabled={!it.to} onClick={() => { if (it.to) { nav(it.to); pop.setOpen(false) } }}>
                    <span className={`tint tint-${it.tone} tint-sm`}><it.icon size={18} weight="duotone" aria-hidden="true" /></span>
                    <span className="grow"><b>{it.title}</b><span>{it.text}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function UserMenu({ online }: { online: boolean }) {
  const { user, logout, dbMode } = useSession()
  const pop = usePopover()
  const nav = useNavigate()
  const go = (to: string) => {
    nav(to)
    pop.setOpen(false)
  }
  return (
    <div className="pop" ref={pop.ref}>
      <button className="avatar-btn" onClick={() => pop.setOpen(!pop.open)} aria-expanded={pop.open} aria-label={`Compte de ${user.full_name}`}>
        <UserAvatar name={user.full_name} online={online} photo={user.avatar} />
      </button>
      {pop.open && (
        <div className="pop-panel user-panel" role="menu">
          <div className="user-panel-head">
            <UserAvatar name={user.full_name} size={44} online={online} photo={user.avatar} />
            <div><strong>{user.full_name}</strong><span>{ROLE_LABELS[user.role]} · {online ? (dbMode === 'remote' ? 'en ligne' : 'connecté') : 'hors connexion'}</span></div>
          </div>
          <button role="menuitem" onClick={() => go('/account')}><User size={20} aria-hidden="true" />Mon compte</button>
          {can(user.role, 'settings') && <button role="menuitem" onClick={() => go('/settings')}><Gear size={20} aria-hidden="true" />Société et paramètres</button>}
          <div className="pop-sep" />
          <button role="menuitem" className="danger" onClick={logout}><SignOut size={20} aria-hidden="true" />Déconnexion</button>
        </div>
      )}
    </div>
  )
}

/** Recherche rapide : pages et actions courantes, au clavier (Ctrl+K). */
function CommandPalette({ entries, onClose }: { entries: NavEntry[]; onClose: () => void }) {
  const nav = useNavigate()
  const { user } = useSession()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const actions: NavEntry[] = [
    { to: '/docs/FAC/new', label: 'Nouvelle facture', module: 'sales', icon: FileText },
    { to: '/docs/DEV/new', label: 'Nouveau devis', module: 'sales', icon: Notepad },
    { to: '/caisse', label: 'Ouvrir le point de vente', module: 'cash', icon: CashRegister }
  ]
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const list = useMemo(
    () => [...actions, ...entries].filter((e) => can(user.role, e.module)).filter((e) => !q || norm(e.label).includes(norm(q))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q, entries, user.role]
  )
  const go = (e?: NavEntry) => {
    if (!e) return
    nav(e.to)
    onClose()
  }
  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Recherche rapide">
        <div className="palette-input">
          <MagnifyingGlass size={20} aria-hidden="true" />
          <input
            autoFocus
            value={q}
            placeholder="Aller à une page ou une action…"
            aria-label="Rechercher une page ou une action"
            onChange={(e) => { setQ(e.target.value); setSel(0) }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, list.length - 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
              if (e.key === 'Enter') go(list[sel])
              if (e.key === 'Escape') onClose()
            }}
          />
          <kbd>Échap</kbd>
        </div>
        <ul className="palette-list" role="listbox">
          {list.length === 0 && <li className="pop-empty">Aucun résultat pour « {q} ».</li>}
          {list.map((e, i) => (
            <li key={e.to + e.label} role="option" aria-selected={i === sel}>
              <button className={i === sel ? 'sel' : ''} onMouseEnter={() => setSel(i)} onClick={() => go(e)}>
                <e.icon size={20} aria-hidden="true" />
                <span>{e.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export function Navbar({ entries, title, online, left }: { entries: NavEntry[]; title: string; online: boolean; left?: ReactNode }) {
  const { user } = useSession()
  const [palette, setPalette] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <header className="navbar">
      {left}
      <div className="navbar-title">{title}</div>
      <button className="search-btn" onClick={() => setPalette(true)} aria-label="Recherche rapide (Ctrl+K)">
        <MagnifyingGlass size={20} aria-hidden="true" />
        <span>Rechercher</span>
        <kbd>Ctrl K</kbd>
      </button>
      <div className="navbar-actions">
        <ThemeMenu />
        {can(user.role, 'dashboard') && <Notifications />}
        <UserMenu online={online} />
      </div>
      {palette && <CommandPalette entries={entries} onClose={() => setPalette(false)} />}
    </header>
  )
}
