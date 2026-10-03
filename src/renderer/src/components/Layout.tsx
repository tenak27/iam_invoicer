import { useEffect, useRef, useState, type ReactNode } from 'react'
import { PageContext, type Tone } from './pageContext'
import { NavLink, useLocation } from 'react-router-dom'
import {
  ArrowsDownUp, ArrowUUpLeft, BookOpen, Buildings, CashRegister, ChartBar, ChartLineUp, ClipboardText,
  ClockCounterClockwise, Tray, PaperPlaneTilt, Notebook, Handshake, IdentificationBadge, Kanban, Bank, ChartPieSlice, Stack, DotsThreeOutline, SidebarSimple, Factory, FileText, House, ListChecks, ListNumbers,
  Notepad, Package, Receipt, Scales, ShoppingCart, Truck, UserGear, Users, Wallet, Warehouse,
  WifiSlash, CloudArrowUp, ArrowsClockwise, UserCircle, type Icon
} from '@phosphor-icons/react'
import { can, type Module } from '@shared/domain'
import { useSession } from '../session'
import { Navbar } from './Topbar'
import { OFFLINE_LABELS } from '@shared/offline'
import { useCountUpEnhancer } from './motion'

type Item = { to: string; label: string; short?: string; module: Module; icon: Icon; end?: boolean; tone?: Tone }
type Section = { title?: string; tone: Tone; items: Item[] }

const NAV: Section[] = [
  { tone: 'blue', items: [{ to: '/', label: 'Tableau de bord', short: 'Accueil', module: 'dashboard', icon: House, end: true }] },
  {
    title: 'Caisse',
    tone: 'green',
    items: [
      { to: '/caisse', label: 'Point de vente', short: 'Caisse', module: 'cash', icon: CashRegister, end: true },
      { to: '/caisse/sessions', label: 'Sessions de caisse', short: 'Sessions', module: 'cash', icon: ClockCounterClockwise }
    ]
  },
  {
    title: 'Ventes',
    tone: 'blue',
    items: [
      { to: '/docs/DEV', label: 'Devis', module: 'sales', icon: Notepad },
      { to: '/docs/BL', label: 'Bons de livraison', module: 'sales', icon: Truck },
      { to: '/docs/FAC', label: 'Factures', module: 'sales', icon: FileText },
      { to: '/docs/AV', label: 'Avoirs', module: 'sales', icon: ArrowUUpLeft },
      { to: '/clients', label: 'Clients', module: 'clients', icon: Users },
      { to: '/crm', label: 'CRM et opportunités', short: 'CRM', module: 'crm', icon: Handshake, tone: 'amber' }
    ]
  },
  {
    title: 'Achats',
    tone: 'amber',
    items: [
      { to: '/docs/BC', label: 'Bons de commande', module: 'purchases', icon: ShoppingCart },
      { to: '/docs/BR', label: 'Réceptions', module: 'purchases', icon: Tray },
      { to: '/docs/FF', label: 'Factures fournisseurs', short: 'Achats', module: 'purchases', icon: Receipt },
      { to: '/suppliers', label: 'Fournisseurs', module: 'suppliers', icon: Factory }
    ]
  },
  {
    title: 'Catalogue & stock',
    tone: 'teal',
    items: [
      { to: '/products', label: 'Articles & prestations', short: 'Articles', module: 'products', icon: Package },
      { to: '/stock', label: 'État du stock', short: 'Stock', module: 'stock', icon: Warehouse, end: true },
      { to: '/stock/movements', label: 'Mouvements', module: 'stock', icon: ArrowsDownUp },
      { to: '/stock/inventory', label: 'Inventaire', module: 'stock', icon: ClipboardText },
      { to: '/stock/depots', label: 'Dépôts, transferts, lots', short: 'Dépôts', module: 'stock', icon: Stack }
    ]
  },
  {
    title: 'Finance',
    tone: 'violet',
    items: [
      { to: '/payments', label: 'Paiements', module: 'payments', icon: Wallet },
      { to: '/reports', label: 'Rapports', module: 'reports', icon: ChartBar }
    ]
  },
  {
    title: 'Gestion',
    tone: 'indigo',
    items: [
      { to: '/projets', label: 'Projets et chantiers', short: 'Projets', module: 'projects', icon: Kanban },
      { to: '/rh', label: 'Ressources humaines', short: 'RH', module: 'hr', icon: IdentificationBadge, tone: 'rose' },
      { to: '/immobilisations', label: 'Immobilisations', module: 'assets', icon: Bank, tone: 'slate' },
      { to: '/budget', label: 'Budgets et trésorerie', short: 'Trésorerie', module: 'budget', icon: ChartPieSlice, tone: 'violet' }
    ]
  },
  {
    title: 'Communications',
    tone: 'cyan',
    items: [
      { to: '/messages', label: 'E-mails et SMS', module: 'messages', icon: PaperPlaneTilt, end: true },
      { to: '/messages/modeles', label: 'Modèles de messages', module: 'messages', icon: Notebook }
    ]
  },
  {
    title: 'Comptabilité',
    tone: 'teal',
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
    tone: 'slate',
    items: [
      { to: '/settings', label: 'Société & paramètres', module: 'settings', icon: Buildings },
      { to: '/users', label: 'Utilisateurs', module: 'users', icon: UserGear },
      { to: '/audit', label: "Journal d'activité", module: 'users', icon: ListChecks }
    ]
  }
]

const ALL_ITEMS = NAV.flatMap((s) => s.items.map((it) => ({ ...it, tone: it.tone ?? s.tone })))

/** Correspondance entre une adresse et l'écran du menu (le plus précis l'emporte). */
export function currentItem(pathname: string) {
  const match = ALL_ITEMS.filter((it) => (it.end ? pathname === it.to : pathname === it.to || pathname.startsWith(it.to + '/'))).sort((a, b) => b.to.length - a.to.length)[0]
  if (match) return match
  // Pages de détail : document, tiers… rattachées à leur section
  if (pathname.startsWith('/doc/') || pathname.startsWith('/party/')) return { ...ALL_ITEMS.find((it) => it.to === '/docs/FAC')!, label: undefined }
  if (pathname.startsWith('/caisse/session')) return ALL_ITEMS.find((it) => it.to === '/caisse/sessions')
  if (pathname === '/account') return { to: '/account', label: 'Mon compte', module: 'dashboard' as Module, icon: UserCircle, tone: 'slate' as Tone }
  return undefined
}

/** Onglets du bas sur téléphone : les écrans les plus fréquents du rôle, 4 au maximum + « Menu ». */
const TAB_PRIORITY = ['/', '/caisse', '/docs/FAC', '/crm', '/rh', '/projets', '/clients', '/compta', '/docs/FF', '/stock', '/products', '/caisse/sessions', '/payments']

/** Écran d'accueil d'un rôle sans tableau de bord : son premier écran autorisé. */
export function homeFor(role: Parameters<typeof can>[0]): string {
  return ALL_ITEMS.find((it) => it.to !== '/' && can(role, it.module))?.to ?? '/account'
}

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

/** Bandeau hors ligne : saisies en attente, synchronisation, saisies refusées. */
function OfflineBar({ online, remote }: { online: boolean; remote: boolean }) {
  const off = window.erp.offline
  const [, refresh] = useState(0)
  const [syncing, setSyncing] = useState(false)
  useEffect(() => {
    const on = () => refresh((n) => n + 1)
    window.addEventListener('iam-offline', on)
    return () => window.removeEventListener('iam-offline', on)
  }, [])
  if (!remote) return null
  const pending = off?.pending() ?? 0
  const failed = off?.failed() ?? []
  // Sur ordinateur, le serveur peut être injoignable alors que le réseau fonctionne.
  const reachable = online && !(off?.serverDown?.() ?? false)
  const needsLogin = off?.state?.()?.needsLogin ?? false
  if (reachable && pending === 0 && failed.length === 0) return null
  const sync = async () => {
    if (!off) return
    setSyncing(true)
    await off.sync()
    setSyncing(false)
    refresh((n) => n + 1)
  }
  return (
    <div className={`offline-bar ${reachable ? 'pending' : ''}`} role="status">
      {reachable ? <CloudArrowUp size={18} aria-hidden="true" /> : <WifiSlash size={18} aria-hidden="true" />}
      <span className="grow">
        {!reachable ? 'Hors connexion : vous consultez les dernières données de cet appareil. ' : ''}
        {pending > 0 ? `${pending} saisie(s) en attente d'envoi.` : !reachable ? 'Les ventes, règlements et temps saisis seront envoyés au retour du réseau.' : ''}
        {reachable && pending > 0 && needsLogin ? ' Reconnectez-vous pour les envoyer (session expirée).' : ''}
        {failed.length > 0 && ` ${failed.length} saisie(s) refusée(s) par le serveur : ${failed.slice(0, 2).map((f) => `${OFFLINE_LABELS[f.name] ?? f.name} (${f.error})`).join(' ; ')}.`}
      </span>
      {reachable && pending > 0 && <button className="btn btn-sm" onClick={sync} disabled={syncing}><ArrowsClockwise size={16} aria-hidden="true" className={syncing ? 'spin' : ''} />{syncing ? 'Envoi…' : 'Synchroniser'}</button>}
      {failed.length > 0 && <button className="btn btn-sm btn-ghost" onClick={() => off?.clearFailed()}>Effacer</button>}
    </div>
  )
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, company, dbMode } = useSession()
  const [open, setOpen] = useState(false)
  const [collapsed, toggleCollapsed] = useCollapsed()
  const location = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  useCountUpEnhancer(mainRef, location.pathname)
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

  const current = currentItem(location.pathname)
  const tone: Tone = current?.tone ?? 'blue'

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
          <OfflineBar online={online} remote={dbMode === 'remote'} />
          <PageContext.Provider value={{ icon: current?.icon, tone, label: current?.label }}>
            <div className="route-view" data-tone={tone} key={location.pathname}>{children}</div>
          </PageContext.Provider>
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
