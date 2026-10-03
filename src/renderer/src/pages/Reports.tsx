import { useState } from 'react'
import { formatQty, todayISO } from '@shared/format'
import { exportCsv, useQuery } from '../api'
import { Empty, ErrorBox, Loading, Money, PageHeader, Tabs } from '../components/ui'

type Tab = 'month' | 'client' | 'product' | 'tva' | 'purchases'
const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`

export function Reports() {
  const year = todayISO().slice(0, 4)
  const [from, setFrom] = useState(`${year}-01-01`)
  const [to, setTo] = useState(`${year}-12-31`)
  const [tab, setTab] = useState<Tab>('month')
  const { data, error, loading, reload } = useQuery<any>('reports.sales', { from, to })
  const preset = (f: string, t: string) => { setFrom(f); setTo(t) }
  const m = todayISO().slice(0, 7)

  const body = () => {
    if (error) return <ErrorBox error={error} onRetry={reload} />
    if (loading && !data) return <Loading />
    const d = data
    const range = `${from}_${to}`
    switch (tab) {
      case 'month': {
        const tot = d.byMonth.reduce((s: any, r: any) => ({ ht: s.ht + r.ht, ttc: s.ttc + r.ttc, n: s.n + r.count }), { ht: 0, ttc: 0, n: 0 })
        return <ReportTable
          rows={d.byMonth}
          file={`CA par mois ${range}.csv`}
          cols={[
            { label: 'Mois', value: (r) => monthLabel(r.month) },
            { label: 'Documents', value: (r) => r.count, num: true },
            { label: 'CA HT', value: (r) => r.ht, money: true },
            { label: 'CA TTC', value: (r) => r.ttc, money: true }
          ]}
          total={['Total', tot.n, tot.ht, tot.ttc]}
        />
      }
      case 'client': {
        const total = d.byClient.reduce((s: number, r: any) => s + r.ht, 0)
        return <ReportTable
          rows={d.byClient}
          file={`CA par client ${range}.csv`}
          cols={[
            { label: 'Code', value: (r) => r.code },
            { label: 'Client', value: (r) => r.name },
            { label: 'Documents', value: (r) => r.count, num: true },
            { label: 'CA HT', value: (r) => r.ht, money: true },
            { label: 'Part', value: (r) => (total ? Math.round((r.ht / total) * 1000) / 10 : 0), pct: true }
          ]}
          total={['', 'Total', '', total, 100]}
        />
      }
      case 'product': {
        const t = d.byProduct.reduce((s: any, r: any) => ({ ht: s.ht + r.ht, cost: s.cost + r.cost }), { ht: 0, cost: 0 })
        return <>
          <ReportTable
            rows={d.byProduct}
            file={`Ventes par article ${range}.csv`}
            cols={[
              { label: 'Réf.', value: (r) => r.ref },
              { label: 'Article', value: (r) => r.name },
              { label: 'Quantité', value: (r) => r.qty, num: true },
              { label: 'CA HT', value: (r) => r.ht, money: true },
              { label: 'Coût estimé', value: (r) => r.cost, money: true },
              { label: 'Marge', value: (r) => r.ht - r.cost, money: true },
              { label: 'Taux de marge', value: (r) => (r.ht ? Math.round(((r.ht - r.cost) / r.ht) * 1000) / 10 : 0), pct: true }
            ]}
            total={['', 'Total', '', t.ht, t.cost, t.ht - t.cost, t.ht ? Math.round(((t.ht - t.cost) / t.ht) * 1000) / 10 : 0]}
          />
          <p className="muted small">Coût estimé au coût moyen pondéré actuel de chaque article ; pour les prestations, coût de revient saisi sur la fiche.</p>
        </>
      }
      case 'tva': {
        const t = d.tva.reduce((s: any, r: any) => ({ c: s.c + r.collected, d: s.d + r.deductible }), { c: 0, d: 0 })
        return <>
          <ReportTable
            rows={d.tva}
            file={`TVA ${range}.csv`}
            cols={[
              { label: 'Mois', value: (r) => monthLabel(r.month) },
              { label: 'TVA collectée (ventes)', value: (r) => r.collected, money: true },
              { label: 'TVA déductible (achats)', value: (r) => r.deductible, money: true },
              { label: 'TVA nette à reverser', value: (r) => r.collected - r.deductible, money: true }
            ]}
            total={['Total', t.c, t.d, t.c - t.d]}
          />
          <p className="muted small">Calcul indicatif à partir des factures validées (date de facture). À rapprocher de votre déclaration auprès de l’administration fiscale.</p>
        </>
      }
      case 'purchases': {
        const total = d.purchases.reduce((s: number, r: any) => s + r.ht, 0)
        return <ReportTable
          rows={d.purchases}
          file={`Achats par fournisseur ${range}.csv`}
          cols={[
            { label: 'Code', value: (r) => r.code },
            { label: 'Fournisseur', value: (r) => r.name },
            { label: 'Factures', value: (r) => r.count, num: true },
            { label: 'Achats HT', value: (r) => r.ht, money: true }
          ]}
          total={['', 'Total', '', total]}
        />
      }
    }
  }

  return (
    <div className="page">
      <PageHeader title="Rapports" subtitle="Chiffre d’affaires net des avoirs, sur les documents validés." />
      <div className="toolbar">
        <label className="inline">Du <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="inline">au <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button className="btn btn-sm" onClick={() => preset(`${m}-01`, `${m}-31`)}>Ce mois</button>
        <button className="btn btn-sm" onClick={() => preset(`${year}-01-01`, `${year}-12-31`)}>Cette année</button>
        <button className="btn btn-sm" onClick={() => preset(`${Number(year) - 1}-01-01`, `${Number(year) - 1}-12-31`)}>Année {Number(year) - 1}</button>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'month', label: 'CA par mois' },
        { value: 'client', label: 'CA par client' },
        { value: 'product', label: 'Ventes & marges par article' },
        { value: 'tva', label: 'TVA' },
        { value: 'purchases', label: 'Achats par fournisseur' }
      ]} />
      <div className="card">{body()}</div>
    </div>
  )
}

type Col = { label: string; value: (r: any) => any; money?: boolean; num?: boolean; pct?: boolean }

function ReportTable({ rows, cols, total, file }: { rows: any[]; cols: Col[]; total?: any[]; file: string }) {
  if (!rows.length) return <Empty>Aucune donnée sur la période.</Empty>
  const cell = (c: Col, v: any) => (c.money ? <Money value={v} /> : c.pct ? `${String(v).replace('.', ',')} %` : c.num ? formatQty(v) : v)
  const right = (c: Col) => c.money || c.num || c.pct
  return (
    <>
      <div className="row end"><button className="btn btn-sm" onClick={() => exportCsv(file, cols.map((c) => ({ label: c.label, value: (r: any) => (c.money ? Math.round(c.value(r)) : c.value(r)) })), rows)}>Exporter (Excel)</button></div>
      <table className="table">
        <thead><tr>{cols.map((c) => <th key={c.label} className={right(c) ? 'num' : ''}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c.label} className={right(c) ? 'num' : ''}>{cell(c, c.value(r))}</td>)}</tr>)}
        </tbody>
        {total && (
          <tfoot><tr>{cols.map((c, i) => <td key={c.label} className={right(c) ? 'num' : ''}>{total[i] === '' ? '' : typeof total[i] === 'number' ? cell(c, total[i]) : total[i]}</td>)}</tr></tfoot>
        )}
      </table>
    </>
  )
}

