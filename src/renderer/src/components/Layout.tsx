import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  ArrowsDownUp, ArrowUUpLeft, BookOpen, Buildings, CashRegister, ChartBar, ChartLineUp, ClipboardText,
  ClockCounterClockwise, Tray, PaperPlaneTilt, Notebook, DotsThreeOutline, SidebarSimple, Factory, FileText, House, ListChecks, ListNumbers,
  Notepad, Package, Receipt, Scales, ShoppingCart, Truck, UserGear, Users, Wallet, Warehouse,
  WifiSlash, type Icon
} from '@phosphor-icons/react'
import { can, type Module } from '@shared/domain'
import { useSession } from '../session'
import { Navbar } from './Topbar'

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
    title: 'Communications',
    items: [
      { to: '/messages', label: 'E-mails et SMS', module: 'messages', icon: PaperPlaneTilt, end: true },
      { to: '/messages/modeles', label: 'Modèles de messages', module: 'messages', icon: Notebook }
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

export function BrandMark({ size = 38 }: { size?: number }) {
  return <img className="brand-logo" src="./favicon.svg" width={size} height={size} alt="" />
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

const COLLAPSE_KEY = 'iam.nav.collapsed'

function useCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1'
    } catch {
      return false
    }
  })
  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1')
      } catch {
        /* préférence non mémorisée */
      }
      return !c
    })
  return [collapsed, toggle]
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, company, dbMode } = useSession()
  const [open, setOpen] = useState(false)
  const [collapsed, toggleCollapsed] = useCollapsed()
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
    <div className={`app ${open ? 'nav-open' : ''} ${collapsed ? 'nav-collapsed' : ''}`}>
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); mainRef.current?.focus() }}>Aller au contenu</a>
      <div className="scrim" onClick={() => setOpen(false)} aria-hidden="true" />
      <aside className="sidebar" aria-label="Navigation principale">
        <div className="brand">
          <BrandMark size={34} />
          <div className="brand-text">
            <div className="brand-name">IAM <span>INVOICER</span></div>
            <div className="brand-sub">{company.name || 'IAM Technology'}</div>
          </div>
          <button className="collapse-btn" onClick={toggleCollapsed} aria-pressed={collapsed} aria-label={collapsed ? 'Déplier le menu' : 'Replier le menu'} title={collapsed ? 'Déplier le menu' : 'Replier le menu'}>
            <SidebarSimple size={20} aria-hidden="true" />
          </button>
        </div>
        <nav>
          {NAV.map((section, i) => {
            const items = section.items.filter((it) => can(user.role, it.module))
            if (items.length === 0) return null
            return (
              <div key={i} className="nav-section">
                {section.title && <div className="nav-title"><span>{section.title}</span></div>}
                {items.map((it) => (
                  <NavLink key={it.to} to={it.to} end={it.end} title={collapsed ? it.label : undefined} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    <it.icon className="nav-icon" size={21} aria-hidden="true" />
                    <span className="nav-label">{it.label}</span>
                  </NavLink>
                ))}
              </div>
            )
          })}
        </nav>
        <div className="weave sidebar-weave" />
      </aside>
      <div className="main-col">
        <Navbar
          entries={allowed}
          title={current?.label ?? 'IAM INVOICER'}
          online={online}
          left={<BrandMark size={30} />}
        />
        <main id="main" className="content" ref={mainRef} tabIndex={-1}>
          {!online && dbMode === 'remote' && (
            <div className="offline-bar" role="status">
              <WifiSlash size={18} aria-hidden="true" />
              Hors connexion : les données ne peuvent ni être consultées ni enregistrées. Elles reviendront dès que la connexion sera rétablie.
            </div>
          )}
          <div className="route-view" key={location.pathname}>{children}</div>
        </main>
      </div>
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
