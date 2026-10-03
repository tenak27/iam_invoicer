import { Link, useNavigate } from 'react-router-dom'
import { DOC_TYPES, type DocType } from '@shared/domain'
import { formatDate, formatMoney, formatNumber, formatQty } from '@shared/format'
import { useQuery } from '../api'
import { Empty, ErrorBox, Loading, Money, PageHeader, StatusBadge } from '../components/ui'
import { useCan, useSession } from '../session'

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

function SalesChart({ data }: { data: { month: string; sales: number }[] }) {
  // 12 derniers mois, mois sans vente compris
  const now = new Date()
  const months: { key: string; label: string; value: number }[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    months.push({ key, label: MONTHS[d.getMonth()], value: data.find((m) => m.month === key)?.sales ?? 0 })
  }
  const max = Math.max(...months.map((m) => m.value), 1)
  const W = 640, H = 200, pad = 24, bw = (W - pad * 2) / 12
  return (
    <svg viewBox={`0 0 ${W} ${H + 24}`} className="chart" role="img" aria-label="Chiffre d'affaires HT des 12 derniers mois">
      <line x1={pad} x2={W - pad} y1={H} y2={H} className="chart-axis" />
      {months.map((m, i) => {
        const h = (m.value / max) * (H - 24)
        return (
          <g key={m.key}>
            <rect x={pad + i * bw + bw * 0.18} y={H - h} width={bw * 0.64} height={Math.max(h, 0)} rx={3} className="chart-bar">
              <title>{`${m.label} ${m.key.slice(0, 4)} : ${formatMoney(m.value)}`}</title>
            </rect>
            {m.value > 0 && h > 14 && (
              <text x={pad + i * bw + bw / 2} y={H - h - 4} className="chart-value">{compact(m.value)}</text>
            )}
            <text x={pad + i * bw + bw / 2} y={H + 16} className="chart-label">{m.label}</text>
          </g>
        )
      })}
    </svg>
  )
}

function compact(n: number): string {
  if (Math.abs(n) >= 1e6) return formatNumber(n / 1e6, 1) + ' M'
  if (Math.abs(n) >= 1e3) return formatNumber(n / 1e3, 0) + ' k'
  return formatNumber(n)
}

export function Dashboard() {
  const { user, company } = useSession()
  const nav = useNavigate()
  const { data, error, loading, reload } = useQuery<any>('reports.dashboard')
  const canSales = useCan('sales')
  const canPurchases = useCan('purchases')
  if (loading && !data) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const d = data!
  const hello = new Date().getHours() < 18 ? 'Bonjour' : 'Bonsoir'
  return (
    <div className="page">
      <PageHeader
        title={`${hello}, ${user.full_name.split(' ')[0]}`}
        subtitle={`${company.name} — ${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`}
        actions={
          <>
            {canSales && <button className="btn" onClick={() => nav('/docs/DEV/new')}>Nouveau devis</button>}
            {canPurchases && <button className="btn" onClick={() => nav('/docs/BC/new')}>Nouvelle commande</button>}
            {canSales && <button className="btn btn-primary" onClick={() => nav('/docs/FAC/new')}>Nouvelle facture</button>}
          </>
        }
      />
      <div className="kpis">
        <div className="kpi"><div className="kpi-label">CA HT du mois</div><div className="kpi-value">{formatMoney(d.salesMonth)}</div></div>
        <div className="kpi"><div className="kpi-label">CA HT de l'année</div><div className="kpi-value">{formatMoney(d.salesYear)}</div></div>
        <div className="kpi"><div className="kpi-label">Encaissé ce mois</div><div className="kpi-value">{formatMoney(d.cashIn)}</div><div className="kpi-sub">Décaissé : {formatMoney(d.cashOut)}</div></div>
        <div className="kpi kpi-warn"><div className="kpi-label">Créances clients</div><div className="kpi-value">{formatMoney(d.receivable)}</div><div className="kpi-sub">{d.overdue.length} facture(s) en retard</div></div>
        <div className="kpi"><div className="kpi-label">Dettes fournisseurs</div><div className="kpi-value">{formatMoney(d.payable)}</div></div>
      </div>

      <div className="dash-grid">
        <section className="card span-2">
          <h3>Chiffre d'affaires HT — 12 derniers mois</h3>
          <SalesChart data={d.monthly} />
        </section>
        <section className="card">
          <h3>Meilleurs clients de l'année</h3>
          {d.topClients.length === 0 ? <Empty>Aucune vente cette année.</Empty> : (
            <table className="table compact">
              <tbody>
                {d.topClients.map((c: any) => (
                  <tr key={c.id} className="clickable" onClick={() => nav(`/party/${c.id}`)}>
                    <td>{c.name}</td><td className="num"><Money value={c.sales} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card">
          <h3>Factures en retard</h3>
          {d.overdue.length === 0 ? <Empty>Aucune facture en retard.</Empty> : (
            <table className="table compact">
              <tbody>
                {d.overdue.map((o: any) => (
                  <tr key={o.id} className="clickable" onClick={() => nav(`/doc/${o.id}`)}>
                    <td>{o.number}<div className="muted small">{o.party_name}</div></td>
                    <td className="muted small">échue le {formatDate(o.due_date)}</td>
                    <td className="num"><Money value={o.remaining} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="card">
          <h3>Alertes de stock</h3>
          {d.lowStock.length === 0 ? <Empty>Aucun article sous le seuil minimum.</Empty> : (
            <table className="table compact">
              <tbody>
                {d.lowStock.map((p: any) => (
                  <tr key={p.id}>
                    <td>{p.name}<div className="muted small">{p.ref}</div></td>
                    <td className="num"><span className={p.stock_qty <= 0 ? 'text-danger' : 'text-warn'}>{formatQty(p.stock_qty)}</span> / min {formatQty(p.min_stock)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="card">
          <h3>Activité récente</h3>
          {d.recent.length === 0 ? <Empty>Aucun document pour l'instant. <Link to="/products">Commencez par créer vos articles.</Link></Empty> : (
            <table className="table compact">
              <tbody>
                {d.recent.map((r: any) => (
                  <tr key={r.id} className="clickable" onClick={() => nav(`/doc/${r.id}`)}>
                    <td><span className="nowrap strong">{r.number ?? DOC_TYPES[r.type as DocType].label}</span><div className="muted small">{r.party_name}</div></td>
                    <td><StatusBadge status={r.status} /></td>
                    <td className="num"><Money value={r.total_ttc} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  )
}
