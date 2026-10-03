// Barre supérieure flottante : recherche rapide (Ctrl+K), thème, notifications,
// menu du compte. Les menus déroulants se ferment au clic extérieur et à Échap.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bell, CashRegister, Desktop, FileText, Gear, MagnifyingGlass, Moon, Notepad, Package, SignOut, Sun, User, Warning,
  type Icon
} from '@phosphor-icons/react'
import { can, ROLE_LABELS, type Module } from '@shared/domain'
import { formatDate, formatMoney, formatQty } from '@shared/format'
import { useQuery } from '../api'
import { useSession } from '../session'
import { useTheme } from '../theme'

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

/** Avatar de l'utilisateur : initiales sur anneau dégradé, pastille « en ligne » qui pulse. */
export function UserAvatar({ name, size = 38, online = true }: { name: string; size?: number; online?: boolean }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  return (
    <span className="uavatar" style={{ width: size, height: size }} aria-hidden="true">
      <span className="uavatar-ring" />
      <span className="uavatar-face">{initials}</span>
      <span className={`uavatar-dot ${online ? 'on' : 'off'}`} />
    </span>
  )
}

export function ThemeCycle() {
  const [theme, setTheme] = useTheme()
  const next = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system'
  const I = theme === 'light' ? Sun : theme === 'dark' ? Moon : Desktop
  const label = { system: 'automatique', light: 'clair', dark: 'sombre' }[theme]
  return (
    <button className="nav-icon-btn" onClick={() => setTheme(next)} title={`Thème : ${label}`} aria-label={`Thème ${label}, changer`}>
      <I size={21} aria-hidden="true" />
    </button>
  )
}

function Notifications() {
  const pop = usePopover()
  const nav = useNavigate()
  const { data, reload } = useQuery<any>('reports.dashboard')
  useEffect(() => {
    const t = setInterval(reload, 120_000)
    return () => clearInterval(t)
  }, [reload])
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
        <UserAvatar name={user.full_name} online={online} />
      </button>
      {pop.open && (
        <div className="pop-panel user-panel" role="menu">
          <div className="user-panel-head">
            <UserAvatar name={user.full_name} size={44} online={online} />
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
        <ThemeCycle />
        {can(user.role, 'dashboard') && <Notifications />}
        <UserMenu online={online} />
      </div>
      {palette && <CommandPalette entries={entries} onClose={() => setPalette(false)} />}
    </header>
  )
}
