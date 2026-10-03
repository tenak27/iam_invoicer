import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowDownLeft, ArrowRight, ArrowUpRight, Bank, ChartLineUp, CreditCard, DeviceMobile, Money as MoneyIcon,
  Package, TrendDown, TrendUp, Users, Wallet, Warning, type Icon
} from '@phosphor-icons/react'
import { formatDate, formatMoney, formatNumber, formatQty } from '@shared/format'
import { paymentState, PAYMENT_STATE_LABELS } from '@shared/domain'
import { todayISO } from '@shared/format'
import { useQuery } from '../api'
import { AreaChart, compact, Donut, Progress, Sparkline } from '../components/charts'
import { Mascot } from '../components/Mascot'
import { Empty, ErrorBox, Loading } from '../components/ui'
import { useCan, useSession } from '../session'

const MONTHS = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc']

type Tone = 'primary' | 'success' | 'info' | 'warning' | 'danger' | 'secondary'

const METHOD: Record<string, { tone: Tone; icon: Icon; color: string }> = {
  'Espèces': { tone: 'success', icon: MoneyIcon, color: 'var(--c-success)' },
  'Orange Money': { tone: 'warning', icon: DeviceMobile, color: 'var(--c-warning)' },
  'Moov Money': { tone: 'info', icon: DeviceMobile, color: 'var(--c-info)' },
  'Wave': { tone: 'primary', icon: DeviceMobile, color: 'var(--c-primary)' },
  'Virement': { tone: 'secondary', icon: Bank, color: 'var(--c-secondary)' },
  'Chèque': { tone: 'secondary', icon: Bank, color: 'var(--c-secondary)' },
  'Carte bancaire': { tone: 'danger', icon: CreditCard, color: 'var(--c-danger)' }
}
const methodOf = (m: string) => METHOD[m] ?? { tone: 'secondary' as Tone, icon: Wallet, color: 'var(--c-secondary)' }

export function Tint({ tone, icon: I, size = 'md' }: { tone: Tone; icon: Icon; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={`tint tint-${tone} tint-${size}`} aria-hidden="true">
      <I size={size === 'lg' ? 26 : size === 'sm' ? 18 : 22} weight="duotone" />
    </span>
  )
}

function Initials({ name }: { name: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  const hue = [...name].reduce((h, c) => h + c.charCodeAt(0), 0) % 6
  return <span className={`initials hue-${hue}`} aria-hidden="true">{initials || '?'}</span>
}

function Card({ title, sub, action, className = '', children }: { title: string; sub?: ReactNode; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`dcard ${className}`}>
      <header className="dcard-head">
        <div>
          <h2>{title}</h2>
          {sub && <p>{sub}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  )
}

function Growth({ now, before }: { now: number; before: number }) {
  if (!before) return null
  const pct = ((now - before) / Math.abs(before)) * 100
  const up = pct >= 0
  return (
    <span className={`growth ${up ? 'up' : 'down'}`}>
      {up ? <TrendUp size={15} weight="bold" aria-hidden="true" /> : <TrendDown size={15} weight="bold" aria-hidden="true" />}
      {up ? '+' : ''}{formatNumber(pct, 1)} %
      <span className="sr-only">{up ? 'en hausse' : 'en baisse'} par rapport au mois précédent</span>
    </span>
  )
}

export function Dashboard() {
  const { user, company } = useSession()
  const nav = useNavigate()
  const { data, error, loading, reload } = useQuery<any>('reports.dashboard')
  const canSales = useCan('sales')
  const canPayments = useCan('payments')
  if (loading && !data) return <Loading />
  if (error) return <div className="page"><ErrorBox error={error} onRetry={reload} /></div>
  const d = data!
  const first = user.full_name.split(' ')[0]
  const today = todayISO()

  // Séries : 12 derniers mois et 14 derniers jours, périodes sans vente comprises.
  const now = new Date()
  const months = Array.from({ length: 12 }, (_, k) => {
    const dt = new Date(now.getFullYear(), now.getMonth() - 11 + k, 1)
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
    const value = d.monthly.find((m: any) => m.month === key)?.sales ?? 0
    return { label: MONTHS[dt.getMonth()], value, title: `${MONTHS[dt.getMonth()]} ${dt.getFullYear()} : ${formatMoney(value)}` }
  })
  const days = Array.from({ length: 14 }, (_, k) => {
    const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 13 + k)
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
    return d.daily.find((x: any) => x.date === key)?.sales ?? 0
  })
  const days14 = days.reduce((s, v) => s + v, 0)
  const methodsTotal = d.byMethod.reduce((s: number, m: any) => s + m.total, 0)
  const treasury = d.cashIn - d.cashOut
  const finMax = Math.max(d.receivable, d.payable, Math.abs(treasury), 1)
  const up = d.salesMonth >= d.salesPrevMonth && d.salesMonth > 0

  return (
    <div className="page dashboard">
      <h1 className="sr-only">Tableau de bord</h1>
      <div className="bento">
        {/* Accueil animé */}
        <section className="dcard hero span-5">
          <div className="hero-text">
            <h2>{up ? `Bravo ${first} !` : `Bonjour ${first}`}</h2>
            <p>{up ? 'Vos ventes progressent ce mois-ci.' : `Voici l'activité de ${company.name || 'votre société'}.`}</p>
            <div className="hero-figure">{formatMoney(d.salesMonth)}</div>
            <p className="hero-sub">Chiffre d'affaires HT du mois <Growth now={d.salesMonth} before={d.salesPrevMonth} /></p>
            {canSales && <button className="btn btn-primary" onClick={() => nav('/docs/FAC')}>Voir les ventes</button>}
          </div>
          <Mascot className="hero-mascot" />
        </section>

        {/* Statistiques */}
        <Card className="span-7" title="Statistiques" sub={`Mois de ${MONTHS[now.getMonth()].toLowerCase()} ${now.getFullYear()}`}>
          <div className="stats">
            <div className="stat"><Tint tone="primary" icon={ChartLineUp} size="lg" /><div><strong>{compact(d.salesMonth)}</strong><span>Ventes HT</span></div></div>
            <div className="stat"><Tint tone="info" icon={Users} size="lg" /><div><strong>{formatNumber(d.counts.clients)}</strong><span>Clients</span></div></div>
            <div className="stat"><Tint tone="danger" icon={Package} size="lg" /><div><strong>{formatNumber(d.counts.products)}</strong><span>Articles</span></div></div>
            <div className="stat"><Tint tone="success" icon={Wallet} size="lg" /><div><strong>{compact(d.cashIn)}</strong><span>Encaissé</span></div></div>
          </div>
        </Card>

        {/* Ventes 14 jours */}
        <Card className="span-3" title="Ventes" sub="14 derniers jours">
          <div className="metric">
            <strong>{compact(days14)}</strong>
            <span className="muted">FCFA HT</span>
          </div>
          <Sparkline values={days} summary={`Ventes des 14 derniers jours : ${formatMoney(days14)} au total.`} />
          <p className="small muted">{formatNumber(d.counts.invoices_month)} facture(s) validée(s) ce mois-ci</p>
        </Card>

        {/* Encaissements par moyen */}
        <Card className="span-3" title="Encaissements" sub="Par moyen de paiement, ce mois">
          {d.byMethod.length === 0 ? <Empty>Aucun encaissement ce mois-ci.</Empty> : (
            <>
              <Donut
                center={compact(methodsTotal)}
                sub="FCFA"
                summary={`Encaissements du mois : ${d.byMethod.map((m: any) => `${m.method} ${formatMoney(m.total)}`).join(', ')}.`}
                segments={d.byMethod.map((m: any) => ({ value: m.total, color: methodOf(m.method).color, label: m.method }))}
              />
              <ul className="legend">
                {d.byMethod.slice(0, 4).map((m: any) => (
                  <li key={m.method}><i style={{ background: methodOf(m.method).color }} />{m.method}<b>{formatNumber((m.total / methodsTotal) * 100, 0)} %</b></li>
                ))}
              </ul>
            </>
          )}
        </Card>

        {/* Chiffre d'affaires 12 mois */}
        <Card className="span-6" title="Chiffre d'affaires" sub={`Cumul de l'année : ${formatMoney(d.salesYear)} HT`}
          action={canSales ? <Link className="btn btn-sm btn-tonal" to="/reports">Rapports</Link> : undefined}>
          <AreaChart points={months} summary={`Chiffre d'affaires HT des 12 derniers mois. Cumul de l'année ${formatMoney(d.salesYear)}.`} />
        </Card>

        {/* Créances, dettes, trésorerie */}
        <Card className="span-4" title="Créances et trésorerie" sub="Montants restant dus et flux du mois">
          <ul className="rows">
            <li>
              <Tint tone="primary" icon={ArrowDownLeft} size="sm" />
              <div className="grow"><b>Créances clients</b><span>{d.overdue.length} facture(s) en retard</span></div>
              <strong className="money">{formatMoney(d.receivable)}</strong>
              <Progress value={(d.receivable / finMax) * 100} label="Créances clients" />
            </li>
            <li>
              <Tint tone="warning" icon={ArrowUpRight} size="sm" />
              <div className="grow"><b>Dettes fournisseurs</b><span>Factures fournisseurs non réglées</span></div>
              <strong className="money">{formatMoney(d.payable)}</strong>
              <Progress value={(d.payable / finMax) * 100} color="var(--c-warning)" label="Dettes fournisseurs" />
            </li>
            <li>
              <Tint tone={treasury >= 0 ? 'success' : 'danger'} icon={Wallet} size="sm" />
              <div className="grow"><b>Trésorerie du mois</b><span>Encaissé {compact(d.cashIn)} · décaissé {compact(d.cashOut)}</span></div>
              <strong className={`money ${treasury < 0 ? 'neg' : ''}`}>{formatMoney(treasury)}</strong>
              <Progress value={(Math.abs(treasury) / finMax) * 100} color={treasury >= 0 ? 'var(--c-success)' : 'var(--c-danger)'} label="Trésorerie du mois" />
            </li>
          </ul>
        </Card>

        {/* Articles populaires */}
        <Card className="span-4" title="Articles les plus vendus" sub={`Année ${now.getFullYear()}, en chiffre d'affaires HT`}>
          {d.topProducts.length === 0 ? <Empty>Aucune vente d'article cette année.</Empty> : (
            <ul className="rows">
              {d.topProducts.map((p: any) => (
                <li key={p.id}>
                  <Tint tone={p.kind === 'prestation' ? 'info' : 'primary'} icon={Package} size="sm" />
                  <div className="grow"><b>{p.name}</b><span>{p.ref} · {formatQty(p.qty)} vendu(s)</span></div>
                  <strong className="money">{formatMoney(p.sales)}</strong>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Transactions */}
        <Card className="span-4" title="Transactions" sub="Derniers règlements"
          action={canPayments ? <Link className="btn btn-sm btn-tonal" to="/payments">Tout voir</Link> : undefined}>
          {d.transactions.length === 0 ? <Empty>Aucun règlement pour l'instant.</Empty> : (
            <ul className="rows">
              {d.transactions.map((t: any) => {
                const m = methodOf(t.method)
                return (
                  <li key={t.id}>
                    <Tint tone={m.tone} icon={m.icon} size="sm" />
                    <div className="grow"><b>{t.method}</b><span>{t.party_name}{t.document_number ? ` · ${t.document_number}` : ''}</span></div>
                    <strong className={`money ${t.direction === 'in' ? 'plus' : 'neg'}`}>{t.direction === 'in' ? '+' : '−'}{formatMoney(t.amount)}</strong>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        {/* Dernières factures */}
        <Card className="span-8 flush" title="Dernières factures" sub="Factures validées, avec leur état de paiement"
          action={canSales ? <Link className="btn btn-sm btn-primary" to="/docs/FAC/new">Nouvelle facture</Link> : undefined}>
          {d.invoices.length === 0 ? <Empty>Aucune facture validée pour l'instant.</Empty> : (
            <div className="scroll-x">
              <table className="table dtable">
                <thead><tr><th>Facture</th><th>Client</th><th>Date</th><th className="num">Total TTC</th><th>Paiement</th><th><span className="sr-only">Ouvrir</span></th></tr></thead>
                <tbody>
                  {d.invoices.map((f: any) => {
                    const st = paymentState(f.total_ttc, f.paid, f.due_date, today)
                    return (
                      <tr key={f.id} className={canSales ? 'clickable' : ''} onClick={() => canSales && nav(`/doc/${f.id}`)}>
                        <td className="strong link-cell nowrap">{f.number}</td>
                        <td><span className="who"><Initials name={f.party_name} />{f.party_name}</span></td>
                        <td className="nowrap">{formatDate(f.date)}</td>
                        <td className="num money">{formatMoney(f.total_ttc)}</td>
                        <td><span className={`badge pay-${st}`}>{PAYMENT_STATE_LABELS[st]}</span></td>
                        <td className="num">{canSales && <ArrowRight size={16} aria-hidden="true" className="muted" />}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* À surveiller */}
        <Card className="span-4" title="À surveiller" sub="Retards de paiement et stock bas">
          {d.overdue.length === 0 && d.lowStock.length === 0 ? (
            <Empty>Rien à signaler : aucune facture en retard, aucun article sous le seuil.</Empty>
          ) : (
            <ul className="rows">
              {d.overdue.slice(0, 4).map((o: any) => (
                <li key={`o${o.id}`} className={canSales ? 'clickable' : ''} onClick={() => canSales && nav(`/doc/${o.id}`)}>
                  <Tint tone="danger" icon={Warning} size="sm" />
                  <div className="grow"><b>{o.number} · {o.party_name}</b><span>Échue le {formatDate(o.due_date)}</span></div>
                  <strong className="money neg">{formatMoney(o.remaining)}</strong>
                </li>
              ))}
              {d.lowStock.slice(0, 4).map((p: any) => (
                <li key={`s${p.id}`}>
                  <Tint tone="warning" icon={Package} size="sm" />
                  <div className="grow"><b>{p.name}</b><span>Seuil {formatQty(p.min_stock)} {p.unit}</span></div>
                  <strong className="money">{formatQty(p.stock_qty)}</strong>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
