import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  ArrowsDownUp, ArrowUUpLeft, BookOpen, Buildings, CashRegister, ChartBar, ChartLineUp, ClipboardText,
  ClockCounterClockwise, Desktop, Tray, DotsThreeOutline, Factory, FileText, House, ListChecks, ListNumbers, Moon,
  Notepad, Package, Receipt, Scales, ShoppingCart, SignOut, Sun, Truck, UserGear, Users, Wallet, Warehouse,
  WifiSlash, type Icon
} from '@phosphor-icons/react'
import { can, ROLE_LABELS, type Module } from '@shared/domain'
import { useSession } from '../session'
import { useTheme, type ThemeChoice } from '../theme'

type Item = { to: string; label: string; short?: string; module: Module; icon: Icon; end?: boolean }
type Section = { title?: string; items: Item[] }

const NAV: Section[] = [
  { items: [{ to: '/', label: 'Tableau de bord', short: 'Accueil', module: 'dashboard', icon: House, end: true }] },
  {
    title: 'Caisse',
    items: [
      { to: '/caisse', label: 'Point de vente', short: 'Caisse', module: 'cash', icon: CashRegister, end: true },
      { to: '/caisse/sessions', label: 'Sessions de caisse', short: 'Sessions', module: 'cash', icon: ClockCounterClockwise }
    ]
  },
  {
    title: 'Ventes',
    items: [
      { to: '/docs/DEV', label: 'Devis', module: 'sales', icon: Notepad },
      { to: '/docs/BL', label: 'Bons de livraison', module: 'sales', icon: Truck },
      { to: '/docs/FAC', label: 'Factures', module: 'sales', icon: FileText },
      { to: '/docs/AV', label: 'Avoirs', module: 'sales', icon: ArrowUUpLeft },
      { to: '/clients', label: 'Clients', module: 'clients', icon: Users }
    ]
  },
  {
    title: 'Achats',
    items: [
      { to: '/docs/BC', label: 'Bons de commande', module: 'purchases', icon: ShoppingCart },
      { to: '/docs/BR', label: 'Réceptions', module: 'purchases', icon: Tray },
      { to: '/docs/FF', label: 'Factures fournisseurs', short: 'Achats', module: 'purchases', icon: Receipt },
      { to: '/suppliers', label: 'Fournisseurs', module: 'suppliers', icon: Factory }
    ]
  },
  {
    title: 'Catalogue & stock',
    items: [
      { to: '/products', label: 'Articles & prestations', short: 'Articles', module: 'products', icon: Package },
      { to: '/stock', label: 'État du stock', short: 'Stock', module: 'stock', icon: Warehouse, end: true },
      { to: '/stock/movements', label: 'Mouvements', module: 'stock', icon: ArrowsDownUp },
      { to: '/stock/inventory', label: 'Inventaire', module: 'stock', icon: ClipboardText }
    ]
  },
  {
    title: 'Finance',
    items: [
      { to: '/payments', label: 'Paiements', module: 'payments', icon: Wallet },
      { to: '/reports', label: 'Rapports', module: 'reports', icon: ChartBar }
    ]
  },
  {
    title: 'Comptabilité',
    items: [
      { to: '/compta', label: 'Journaux & écritures', short: 'Compta', module: 'accounting', icon: BookOpen, end: true },
      { to: '/compta/grand-livre', label: 'Grand livre', module: 'accounting', icon: ListNumbers },
      { to: '/compta/balance', label: 'Balance', module: 'accounting', icon: Scales },
      { to: '/compta/resultat', label: 'Compte de résultat', module: 'accounting', icon: ChartLineUp },
      { to: '/compta/comptes', label: 'Plan comptable', module: 'accounting', icon: ListChecks }
    ]
  },
  {
    title: 'Administration',
    items: [
      { to: '/settings', label: 'Société & paramètres', module: 'settings', icon: Buildings },
      { to: '/users', label: 'Utilisateurs', module: 'users', icon: UserGear },
      { to: '/audit', label: "Journal d'activité", module: 'users', icon: ListChecks }
    ]
  }
]

const ALL_ITEMS = NAV.flatMap((s) => s.items)

/** Onglets du bas sur téléphone : les écrans les plus fréquents du rôle, 4 au maximum + « Menu ». */
const TAB_PRIORITY = ['/', '/caisse', '/docs/FAC', '/clients', '/compta', '/docs/FF', '/stock', '/products', '/caisse/sessions', '/payments']

const MODE_LABELS: Record<DataMode, string> = { local: 'poste local', server: 'serveur réseau', remote: 'en ligne' }

const THEMES: { value: ThemeChoice; label: string; icon: Icon }[] = [
  { value: 'system', label: 'Automatique', icon: Desktop },
  { value: 'light', label: 'Clair', icon: Sun },
  { value: 'dark', label: 'Sombre', icon: Moon }
]

export function BrandMark({ size = 38 }: { size?: number }) {
  return <img className="brand-logo" src="./favicon.svg" width={size} height={size} alt="" />
}

export function ThemeSwitch() {
  const [theme, setTheme] = useTheme()
  return (
    <div className="theme-switch" role="radiogroup" aria-label="Thème d'affichage">
      {THEMES.map((t) => (
        <button key={t.value} role="radio" aria-checked={theme === t.value} title={t.label} className={theme === t.value ? 'on' : ''} onClick={() => setTheme(t.value)}>
          <t.icon size={16} aria-hidden="true" />
          <span className="sr-only">{t.label}</span>
        </button>
      ))}
    </div>
  )
}

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, company, logout, dbMode, serverUrl } = useSession()
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const online = useOnline()
  const allowed = ALL_ITEMS.filter((it) => can(user.role, it.module))
  const tabs = TAB_PRIORITY.map((to) => allowed.find((it) => it.to === to)).filter(Boolean).slice(0, 4) as Item[]

  useEffect(() => {
    setOpen(false)
    // Lecteurs d'écran : après un changement de page, le focus va au titre de la nouvelle page.
    const h1 = mainRef.current?.querySelector('h1')
    if (h1) {
      h1.setAttribute('tabindex', '-1')
      h1.focus({ preventScroll: true })
    }
    mainRef.current?.scrollTo?.({ top: 0 })
    window.scrollTo({ top: 0 })
  }, [location.pathname])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const current = ALL_ITEMS
    .filter((it) => (it.end ? location.pathname === it.to : location.pathname.startsWith(it.to)))
    .sort((a, b) => b.to.length - a.to.length)[0]

  return (
    <div className={`app ${open ? 'nav-open' : ''}`}>
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); mainRef.current?.focus() }}>Aller au contenu</a>
      <header className="topbar">
        <BrandMark size={30} />
        <div className="topbar-title">{current?.label ?? 'IAM INVOICER'}</div>
      </header>
      <div className="scrim" onClick={() => setOpen(false)} aria-hidden="true" />
      <aside className="sidebar" aria-label="Navigation principale">
        <div className="brand">
          <BrandMark />
          <div>
            <div className="brand-name">IAM <span>INVOICER</span></div>
            <div className="brand-sub">{company.name || 'IAM Technology'}</div>
          </div>
        </div>
        <div className="weave" />
        <nav>
          {NAV.map((section, i) => {
            const items = section.items.filter((it) => can(user.role, it.module))
            if (items.length === 0) return null
            return (
              <div key={i} className="nav-section">
                {section.title && <div className="nav-title">{section.title}</div>}
                {items.map((it) => (
                  <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    <it.icon className="nav-icon" size={19} aria-hidden="true" />
                    <span>{it.label}</span>
                  </NavLink>
                ))}
              </div>
            )
          })}
        </nav>
        <div className="sidebar-foot">
          <NavLink to="/account" className="user-chip">
            <div className="avatar" aria-hidden="true">{user.full_name.slice(0, 1).toUpperCase()}</div>
            <div>
              <div className="user-name">{user.full_name}</div>
              <div className="user-role" title={serverUrl ?? undefined}>
                {ROLE_LABELS[user.role]} · {MODE_LABELS[dbMode]}
              </div>
            </div>
          </NavLink>
          <div className="foot-row">
            <ThemeSwitch />
            <button className="btn btn-ghost btn-sm logout" onClick={logout}>
              <SignOut size={16} aria-hidden="true" /> Déconnexion
            </button>
          </div>
        </div>
      </aside>
      <main id="main" className="content" ref={mainRef} tabIndex={-1}>
        {!online && dbMode === 'remote' && (
          <div className="offline-bar" role="status">
            <WifiSlash size={18} aria-hidden="true" />
            Hors connexion : les données ne peuvent ni être consultées ni enregistrées. Elles reviendront dès que la connexion sera rétablie.
          </div>
        )}
        {children}
      </main>
      <nav className="tabbar" aria-label="Navigation rapide">
        {tabs.map((it) => (
          <NavLink key={it.to} to={it.to} end={it.end ?? it.to === '/'} className={({ isActive }) => `tab-item ${isActive ? 'active' : ''}`}>
            <it.icon size={24} aria-hidden="true" />
            <span>{it.short ?? it.label}</span>
          </NavLink>
        ))}
        <button className={`tab-item ${open ? 'active' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Menu">
          <DotsThreeOutline size={24} aria-hidden="true" />
          <span>Menu</span>
        </button>
      </nav>
    </div>
  )
}
