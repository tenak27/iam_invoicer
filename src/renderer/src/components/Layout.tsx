import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { can, ROLE_LABELS, type Module } from '@shared/domain'
import { useSession } from '../session'

type Item = { to: string; label: string; module: Module; end?: boolean }
type Section = { title?: string; items: Item[] }

const NAV: Section[] = [
  { items: [{ to: '/', label: 'Tableau de bord', module: 'dashboard', end: true }] },
  {
    title: 'Caisse',
    items: [
      { to: '/caisse', label: 'Point de vente', module: 'cash', end: true },
      { to: '/caisse/sessions', label: 'Sessions de caisse', module: 'cash' }
    ]
  },
  {
    title: 'Ventes',
    items: [
      { to: '/docs/DEV', label: 'Devis', module: 'sales' },
      { to: '/docs/BL', label: 'Bons de livraison', module: 'sales' },
      { to: '/docs/FAC', label: 'Factures', module: 'sales' },
      { to: '/docs/AV', label: 'Avoirs', module: 'sales' },
      { to: '/clients', label: 'Clients', module: 'clients' }
    ]
  },
  {
    title: 'Achats',
    items: [
      { to: '/docs/BC', label: 'Bons de commande', module: 'purchases' },
      { to: '/docs/BR', label: 'Réceptions', module: 'purchases' },
      { to: '/docs/FF', label: 'Factures fournisseurs', module: 'purchases' },
      { to: '/suppliers', label: 'Fournisseurs', module: 'suppliers' }
    ]
  },
  {
    title: 'Catalogue & stock',
    items: [
      { to: '/products', label: 'Articles & prestations', module: 'products' },
      { to: '/stock', label: 'État du stock', module: 'stock', end: true },
      { to: '/stock/movements', label: 'Mouvements', module: 'stock' },
      { to: '/stock/inventory', label: 'Inventaire', module: 'stock' }
    ]
  },
  {
    title: 'Finance',
    items: [
      { to: '/payments', label: 'Paiements', module: 'payments' },
      { to: '/reports', label: 'Rapports', module: 'reports' }
    ]
  },
  {
    title: 'Comptabilité',
    items: [
      { to: '/compta', label: 'Journaux & écritures', module: 'accounting', end: true },
      { to: '/compta/grand-livre', label: 'Grand livre', module: 'accounting' },
      { to: '/compta/balance', label: 'Balance', module: 'accounting' },
      { to: '/compta/resultat', label: 'Compte de résultat', module: 'accounting' },
      { to: '/compta/comptes', label: 'Plan comptable', module: 'accounting' }
    ]
  },
  {
    title: 'Administration',
    items: [
      { to: '/settings', label: 'Société & paramètres', module: 'settings' },
      { to: '/users', label: 'Utilisateurs', module: 'users' },
      { to: '/audit', label: "Journal d'activité", module: 'users' }
    ]
  }
]

const MODE_LABELS: Record<DataMode, string> = { local: 'poste local', server: 'serveur réseau', remote: 'en ligne' }

export function BrandMark({ size = 38 }: { size?: number }) {
  return <img className="brand-logo" src="./favicon.svg" width={size} height={size} alt="" />
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, company, logout, dbMode, serverUrl } = useSession()
  const [open, setOpen] = useState(false)
  const location = useLocation()
  // Sur petit écran, le menu se referme après chaque navigation.
  useEffect(() => setOpen(false), [location.pathname])
  const current = NAV.flatMap((s) => s.items)
    .filter((it) => (it.end ? location.pathname === it.to : location.pathname.startsWith(it.to)))
    .sort((a, b) => b.to.length - a.to.length)[0]
  return (
    <div className={`app ${open ? 'nav-open' : ''}`}>
      <header className="topbar">
        <button className="menu-btn" onClick={() => setOpen(!open)} aria-label="Menu" aria-expanded={open}>
          <span /><span /><span />
        </button>
        <BrandMark size={28} />
        <div className="topbar-title">{current?.label ?? 'IAM INVOICER'}</div>
      </header>
      <div className="scrim" onClick={() => setOpen(false)} />
      <aside className="sidebar">
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
                    {it.label}
                  </NavLink>
                ))}
              </div>
            )
          })}
        </nav>
        <div className="sidebar-foot">
          <NavLink to="/account" className="user-chip">
            <div className="avatar">{user.full_name.slice(0, 1).toUpperCase()}</div>
            <div>
              <div className="user-name">{user.full_name}</div>
              <div className="user-role" title={serverUrl ?? undefined}>
                {ROLE_LABELS[user.role]} · {MODE_LABELS[dbMode]}
              </div>
            </div>
          </NavLink>
          <button className="btn btn-ghost btn-sm" onClick={logout}>Déconnexion</button>
        </div>
      </aside>
      <main className="content">{children}</main>
    </div>
  )
}
