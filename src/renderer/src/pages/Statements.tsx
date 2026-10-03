// Bilan SYSCOHADA et déclarations du mois (TVA, retenues à la source, salaires).

import { useState } from 'react'
import { CheckCircle, Printer, WarningCircle } from '@phosphor-icons/react'
import { formatDate, formatMoney, formatNumber, todayISO } from '@shared/format'
import { exportCsv, run, unwrap, useQuery } from '../api'
import { Empty, ErrorBox, Field, Loading, PageHeader } from '../components/ui'
import { reportHtml, type ReportTable } from '../components/reportPrint'
import { useSession } from '../session'

type Section = { code: string; label: string; lines: { number: string; label: string; amount: number }[]; total: number }

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`

export function BalanceSheet() {
  const { company } = useSession()
  const [to, setTo] = useState(todayISO())
  const { data, error, loading, reload } = useQuery<any>('accounting.balanceSheet', { to })
  const side = (title: string, sections: Section[], total: number) => (
    <div className="card bs-side">
      <h3>{title}</h3>
      {sections.map((s) => (
        <div key={s.code} className="bs-section">
          <div className="bs-head"><span>{s.label}</span><strong>{formatNumber(s.total)}</strong></div>
          {s.lines.length === 0 ? <div className="muted small bs-empty">—</div> : (
            <table className="table compact"><tbody>
              {s.lines.map((l) => <tr key={l.number + l.label}><td className="muted nowrap">{l.number}</td><td>{l.label}</td><td className="num money">{formatNumber(l.amount)}</td></tr>)}
            </tbody></table>
          )}
        </div>
      ))}
      <div className="bs-total"><span>Total {title.toLowerCase()}</span><strong>{formatMoney(total)}</strong></div>
    </div>
  )
  const tables = (): ReportTable[] => [
    ...(['actif', 'passif'] as const).map((k) => ({
      title: k === 'actif' ? 'Actif' : 'Passif',
      head: ['Compte', 'Rubrique / intitulé', 'Montant'],
      numeric: [2],
      rows: (data[k] as Section[]).flatMap((s) => [['', s.label.toUpperCase(), s.total] as (string | number)[], ...s.lines.map((l) => [l.number, l.label, l.amount])]),
      foot: ['', `Total ${k}`, k === 'actif' ? data.totalActif : data.totalPassif]
    }))
  ]
  const print = () =>
    run(() => unwrap(window.erp.printHtml(reportHtml(company, 'Bilan', `Au ${formatDate(to || todayISO())} — présentation simplifiée SYSCOHADA`, tables(), 'Établi à partir des écritures comptables. Faites valider les écritures d’inventaire (amortissements, provisions, stocks) avant de déposer les états financiers.'), `Bilan ${to}`)))
  const exportXls = () =>
    exportCsv(`Bilan ${to}.csv`, [{ label: 'Côté', value: (r) => r.side }, { label: 'Rubrique', value: (r) => r.section }, { label: 'Compte', value: (r) => r.number }, { label: 'Intitulé', value: (r) => r.label }, { label: 'Montant', value: (r) => r.amount }],
      (['actif', 'passif'] as const).flatMap((k) => (data[k] as Section[]).flatMap((s) => s.lines.map((l) => ({ side: k, section: s.label, ...l })))))
  return (
    <div className="page">
      <PageHeader
        title="Bilan"
        subtitle="Situation du patrimoine à une date : ce que l'entreprise possède (actif) et ce qu'elle doit (passif)."
        actions={data && <><button className="btn" onClick={exportXls}>Exporter (Excel)</button><button className="btn btn-primary" onClick={print}><Printer size={18} aria-hidden="true" />Imprimer</button></>}
      />
      <div className="toolbar"><Field label="Au"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field></div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Loading /> : (
        <>
          <div className="kpis">
            <div className="kpi"><div className="kpi-label">Total actif</div><div className="kpi-value">{formatMoney(data.totalActif)}</div></div>
            <div className="kpi"><div className="kpi-label">Total passif</div><div className="kpi-value">{formatMoney(data.totalPassif)}</div></div>
            <div className={`kpi ${data.result < 0 ? 'kpi-warn' : 'good'}`}><div className="kpi-label">{data.result >= 0 ? 'Résultat : bénéfice' : 'Résultat : perte'}</div><div className="kpi-value">{formatMoney(data.result)}</div></div>
            <div className={`kpi ${data.balanced ? 'good' : 'kpi-warn'}`}>
              <div className="kpi-label">{data.balanced ? <><CheckCircle size={15} aria-hidden="true" /> Équilibré</> : <><WarningCircle size={15} aria-hidden="true" /> Écart</>}</div>
              <div className="kpi-value">{data.balanced ? 'Actif = passif' : formatMoney(data.totalActif - data.totalPassif)}</div>
            </div>
          </div>
          <div className="dash-grid two">
            {side('Actif', data.actif, data.totalActif)}
            {side('Passif', data.passif, data.totalPassif)}
          </div>
          <p className="muted small">Présentation simplifiée par rubriques du SYSCOHADA révisé. Les comptes de tiers et de trésorerie sont classés à l’actif ou au passif selon leur solde. Le résultat comprend les classes 6, 7 et 8 non encore affectées.</p>
        </>
      )}
    </div>
  )
}

export function Declarations() {
  const { company } = useSession()
  const [month, setMonth] = useState(todayISO().slice(0, 7))
  const { data, error, loading, reload } = useQuery<any>('declarations.month', { month })

  const vatTables = (): ReportTable[] => [
    { title: 'TVA collectée par taux', head: ['Taux', 'Base HT', 'TVA'], numeric: [1, 2], rows: data.vat.rows.map((r: any) => [`${formatNumber(r.rate)} %`, r.base, r.tva]), foot: ['Total', data.vat.rows.reduce((s: number, r: any) => s + r.base, 0), data.vat.collected] },
    {
      title: 'Liquidation', head: ['Élément', 'Montant'], numeric: [1],
      rows: [['TVA collectée', data.vat.collected], ['TVA déductible sur achats et services', -data.vat.deductible], ['TVA retenue à la source par les clients', -data.vat.withheldByClients]],
      foot: [data.vat.net >= 0 ? 'TVA nette à payer' : 'Crédit de TVA à reporter', Math.abs(data.vat.net)]
    }
  ]
  const whTables = (): ReportTable[] => [
    ...(data.withholdings.operated as any[]).map((g) => ({
      title: `Retenues opérées à reverser — ${g.label}`, head: ['Pièce', 'Date', 'Fournisseur', 'Base', 'Retenue'], numeric: [3, 4],
      rows: g.documents.map((d: any) => [d.number, formatDate(d.date), d.party, d.basis, d.amount]), foot: ['Total', '', '', g.basis, g.amount]
    })),
    ...(data.withholdings.suffered as any[]).map((g) => ({
      title: `Retenues subies (à imputer) — ${g.label}`, head: ['Pièce', 'Date', 'Client', 'Base', 'Retenue'], numeric: [3, 4],
      rows: g.documents.map((d: any) => [d.number, formatDate(d.date), d.party, d.basis, d.amount]), foot: ['Total', '', '', g.basis, g.amount]
    }))
  ]
  const payTables = (): ReportTable[] => data.payroll ? [{
    title: `Salaires (${data.payroll.employees} salarié(s), paie ${data.payroll.status === 'valide' ? 'validée' : 'en préparation'})`, head: ['Élément', 'Montant'], numeric: [1],
    rows: [['Salaires bruts', data.payroll.gross], ['Cotisations salariales', data.payroll.cnssEmployee], ['Cotisations patronales', data.payroll.cnssEmployer], ['Impôt sur les salaires (IUTS)', data.payroll.iuts]],
    foot: ['Total à reverser (cotisations + impôt)', data.payroll.cnssEmployee + data.payroll.cnssEmployer + data.payroll.iuts]
  }] : []
  const print = (what: 'tout' | 'tva' | 'retenues' | 'salaires') => {
    const t = what === 'tva' ? vatTables() : what === 'retenues' ? whTables() : what === 'salaires' ? payTables() : [...vatTables(), ...whTables(), ...payTables()]
    const title = what === 'tva' ? 'Déclaration de TVA' : what === 'retenues' ? 'État des retenues à la source' : what === 'salaires' ? 'Déclaration des salaires' : 'Déclarations fiscales et sociales'
    return run(() => unwrap(window.erp.printHtml(reportHtml(company, title, `Période : ${monthLabel(month)}`, t, 'État préparatoire établi à partir des pièces validées : reportez les montants sur les formulaires officiels (télédéclaration, sécurité sociale…) et faites-les vérifier par votre comptable.'), `${title} ${month}`)))
  }

  return (
    <div className="page">
      <PageHeader
        title="Déclarations"
        subtitle="Préparez les déclarations du mois : TVA, retenues à la source et salaires, calculées à partir des pièces validées."
        actions={data && <button className="btn btn-primary" onClick={() => print('tout')}><Printer size={18} aria-hidden="true" />Tout imprimer</button>}
      />
      <div className="toolbar"><Field label="Mois"><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field></div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Loading /> : (
        <>
          <div className="kpis">
            <div className="kpi"><div className="kpi-label">TVA collectée</div><div className="kpi-value">{formatMoney(data.vat.collected)}</div></div>
            <div className="kpi"><div className="kpi-label">TVA déductible</div><div className="kpi-value">{formatMoney(data.vat.deductible)}</div></div>
            <div className={`kpi ${data.vat.net > 0 ? 'kpi-warn' : 'good'}`}><div className="kpi-label">{data.vat.net >= 0 ? 'TVA à payer' : 'Crédit de TVA'}</div><div className="kpi-value">{formatMoney(Math.abs(data.vat.net))}</div></div>
            <div className="kpi"><div className="kpi-label">Retenues à reverser</div><div className="kpi-value">{formatMoney(data.withholdings.totalOperated)}</div></div>
          </div>

          <div className="dash-grid two">
            <div className="card">
              <div className="row space-between"><h3>TVA — {monthLabel(month)}</h3><button className="btn btn-sm" onClick={() => print('tva')}><Printer size={16} aria-hidden="true" />Imprimer</button></div>
              {data.vat.rows.length === 0 && !data.vat.deductible ? <Empty>Aucune facture validée ce mois-ci.</Empty> : (
                <table className="table compact decl">
                  <thead><tr><th>Taux</th><th className="num">Base HT</th><th className="num">TVA</th></tr></thead>
                  <tbody>
                    {data.vat.rows.map((r: any) => <tr key={r.rate}><td>{formatNumber(r.rate)} %</td><td className="num money">{formatNumber(r.base)}</td><td className="num money">{formatNumber(r.tva)}</td></tr>)}
                    <tr className="sep"><td colSpan={2}>TVA collectée</td><td className="num money">{formatNumber(data.vat.collected)}</td></tr>
                    <tr><td colSpan={2}>− TVA déductible (achats {formatNumber(data.vat.purchasesHt)} HT)</td><td className="num money">{formatNumber(data.vat.deductible)}</td></tr>
                    {data.vat.withheldByClients > 0 && <tr><td colSpan={2}>− TVA retenue à la source par les clients</td><td className="num money">{formatNumber(data.vat.withheldByClients)}</td></tr>}
                  </tbody>
                  <tfoot><tr><td colSpan={2}>{data.vat.net >= 0 ? 'TVA nette à payer' : 'Crédit de TVA à reporter'}</td><td className="num">{formatNumber(Math.abs(data.vat.net))}</td></tr></tfoot>
                </table>
              )}
            </div>

            <div className="card">
              <div className="row space-between"><h3>Salaires</h3>{data.payroll && <button className="btn btn-sm" onClick={() => print('salaires')}><Printer size={16} aria-hidden="true" />Imprimer</button>}</div>
              {!data.payroll ? <Empty>Pas de paie pour ce mois. Préparez-la dans Ressources humaines → Paie.</Empty> : (
                <table className="table compact decl">
                  <tbody>
                    <tr><td>Salariés</td><td className="num">{data.payroll.employees}</td></tr>
                    <tr><td>Salaires bruts</td><td className="num money">{formatNumber(data.payroll.gross)}</td></tr>
                    <tr><td>Cotisations salariales</td><td className="num money">{formatNumber(data.payroll.cnssEmployee)}</td></tr>
                    <tr><td>Cotisations patronales</td><td className="num money">{formatNumber(data.payroll.cnssEmployer)}</td></tr>
                    <tr><td>Impôt sur les salaires</td><td className="num money">{formatNumber(data.payroll.iuts)}</td></tr>
                  </tbody>
                  <tfoot><tr><td>Total à reverser</td><td className="num">{formatNumber(data.payroll.cnssEmployee + data.payroll.cnssEmployer + data.payroll.iuts)}</td></tr></tfoot>
                </table>
              )}
              {data.payroll && data.payroll.status !== 'valide' && <p className="muted small">Paie encore en préparation : montants provisoires.</p>}
            </div>
          </div>

          <div className="card">
            <div className="row space-between"><h3>Retenues à la source</h3>{(data.withholdings.operated.length > 0 || data.withholdings.suffered.length > 0) && <button className="btn btn-sm" onClick={() => print('retenues')}><Printer size={16} aria-hidden="true" />Imprimer</button>}</div>
            {data.withholdings.operated.length === 0 && data.withholdings.suffered.length === 0 ? <Empty>Aucune retenue ce mois-ci. Les retenues se choisissent sur les factures (Société & paramètres → Taxes).</Empty> : (
              <div className="dash-grid two">
                {[['À reverser à l’État (opérées sur vos fournisseurs)', data.withholdings.operated], ['Subies (retenues par vos clients, à imputer)', data.withholdings.suffered]].map(([title, groups]: any) => (
                  <div key={title}>
                    <h4>{title}</h4>
                    {groups.length === 0 ? <p className="muted">Aucune.</p> : groups.map((g: any) => (
                      <table key={g.code} className="table compact decl">
                        <thead><tr><th colSpan={3}>{g.label}</th></tr></thead>
                        <tbody>{g.documents.map((d: any) => <tr key={d.number}><td className="nowrap">{d.number}</td><td>{d.party}</td><td className="num money">{formatNumber(d.amount)}</td></tr>)}</tbody>
                        <tfoot><tr><td colSpan={2}>Total (base {formatNumber(g.basis)})</td><td className="num">{formatNumber(g.amount)}</td></tr></tfoot>
                      </table>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
          <p className="muted small">États préparatoires : reportez les montants sur les formulaires officiels (télédéclaration, CNSS…) après vérification par votre comptable.</p>
        </>
      )}
    </div>
  )
}
