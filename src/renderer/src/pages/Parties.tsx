import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { DOC_TYPES, type DocType } from '@shared/domain'
import { formatDate, formatMoney } from '@shared/format'
import { api, exportCsv, run, useQuery } from '../api'
import { confirmDialog, Empty, ErrorBox, Field, Loading, Modal, Money, PageHeader, PaymentBadge, RowActions, SearchInput, StatusBadge, useForm } from '../components/ui'
import { ArrowCounterClockwise, ChatCircleText, CheckCircle, Clock, Eye, FilePlus, Handshake, PaperPlaneTilt, PencilSimple, Prohibit, Receipt, UsersThree, UserCheck, UserPlus, Scales, Bell, Wallet } from '@phosphor-icons/react'
import { KpiStrip } from '../components/KpiStrip'
import { useCan, useSession } from '../session'

type Kind = 'client' | 'supplier'
const LABELS = {
  client: { one: 'client', title: 'Clients', balance: 'Solde dû' },
  supplier: { one: 'fournisseur', title: 'Fournisseurs', balance: 'Solde à payer' }
}

export function PartyList({ kind }: { kind: Kind }) {
  const { company } = useSession()
  const taxLabel = company.tax_id_label || 'NIF'
  const nav = useNavigate()
  const [search, setSearch] = useState('')
  const [inactive, setInactive] = useState(false)
  const [prospect, setProspect] = useState('') // '' tous · 'prospect' · 'client'
  const [editing, setEditing] = useState<any | null>(null)
  const { data, error, loading, reload } = useQuery<any[]>('parties.list', { kind, search, includeInactive: inactive, prospect: kind === 'client' ? prospect : '' })
  const L = LABELS[kind]
  const rows = data ?? []
  const total = rows.reduce((s, r) => s + r.balance, 0)
  const newDocType = kind === 'client' ? 'FAC' : 'BC'
  const toggleActive = async (r: any) => {
    if (r.active && !(await confirmDialog(`Désactiver « ${r.name} » ?`, { detail: 'Il ne sera plus proposé dans les nouveaux documents. Son historique est conservé.' }))) return
    if (await run(() => api('parties.save', { ...r, active: !r.active }), r.active ? 'Fiche désactivée.' : 'Fiche réactivée.')) reload()
  }
  return (
    <div className="page" key={kind}>
      <PageHeader
        title={L.title}
        subtitle={`${rows.length} ${L.one}(s) · ${L.balance.toLowerCase()} total : ${Math.round(total).toLocaleString('fr-FR')} FCFA`}
        actions={
          <>
            <button className="btn" disabled={!rows.length} onClick={() => exportCsv(`${L.title}.csv`, [
              { label: 'Code', value: (r) => r.code }, { label: 'Nom', value: (r) => r.name }, { label: 'Contact', value: (r) => r.contact },
              { label: 'Téléphone', value: (r) => r.phone }, { label: 'Email', value: (r) => r.email }, { label: 'Ville', value: (r) => r.city },
              { label: taxLabel, value: (r) => r.tax_id }, { label: 'RCCM', value: (r) => r.rccm }, { label: L.balance, value: (r) => r.balance }
            ], rows)}>Exporter (Excel)</button>
            {kind === 'client' && <button className="btn" onClick={() => setEditing({ kind, is_prospect: true })}>Nouveau prospect</button>}
            <button className="btn btn-primary" onClick={() => setEditing({ kind })}>Nouveau {L.one}</button>
          </>
        }
      />
      <KpiStrip items={[
        { label: L.title, value: rows.length, icon: UsersThree },
        ...(kind === 'client' ? [{ label: 'Prospects', value: rows.filter((r) => r.is_prospect).length, icon: UserPlus }] : []),
        { label: 'Actifs', value: rows.filter((r) => r.active).length, icon: UserCheck, tone: 'good' },
        { label: L.balance, value: total, icon: Scales, money: true },
        { label: kind === 'client' ? 'Clients qui doivent' : 'Fournisseurs à payer', value: rows.filter((r) => r.balance > 0.5).length, icon: Bell, tone: rows.some((r) => r.balance > 0.5) ? 'bad' : 'good' }
      ]} />
      <div className="toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder="Nom, code, téléphone, contact…" />
        {kind === 'client' && (
          <select value={prospect} onChange={(e) => setProspect(e.target.value)} aria-label="Filtrer prospects et clients">
            <option value="">Tous</option>
            <option value="prospect">Prospects</option>
            <option value="client">Clients établis</option>
          </select>
        )}
        <label className="inline check"><input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} /> Afficher les inactifs</label>
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Loading /> : rows.length === 0 ? (
        <Empty>Aucun {L.one}.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Code</th><th>Nom</th><th>Contact</th><th>Téléphone</th><th>Ville</th><th className="num">{L.balance}</th><th className="actions-col">Actions</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={`clickable ${r.active ? '' : 'inactive'}`} onClick={() => nav(`/party/${r.id}`)}>
                  <td className="muted">{r.code}</td>
                  <td className="strong">{r.name}{r.is_prospect && <span className="badge badge-prospect" style={{ marginLeft: 8 }}>Prospect</span>}</td>
                  <td>{r.contact}</td>
                  <td>{r.phone}</td>
                  <td>{r.city}</td>
                  <td className="num"><Money value={r.balance} /></td>
                  <td className="actions-col">
                    <RowActions actions={[
                      { label: 'Voir la fiche', icon: Eye, onClick: () => nav(`/party/${r.id}`) },
                      { label: 'Modifier', icon: PencilSimple, tone: 'primary', onClick: () => setEditing(r) },
                      { label: kind === 'client' ? 'Nouvelle facture' : 'Nouveau bon de commande', icon: FilePlus, tone: 'success', hidden: !r.active, onClick: () => nav(`/docs/${newDocType}/new?party=${r.id}`) },
                      r.active
                        ? { label: 'Désactiver', icon: Prohibit, tone: 'danger', onClick: () => toggleActive(r) }
                        : { label: 'Réactiver', icon: ArrowCounterClockwise, tone: 'warning', onClick: () => toggleActive(r) }
                    ]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <PartyForm party={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </div>
  )
}

export function PartyForm({ party, onClose, onSaved }: { party: any; onClose: () => void; onSaved: (id: number) => void }) {
  const { company } = useSession()
  const f = useForm({
    code: '', name: '', contact: '', phone: '', email: '', address: '', city: '', tax_id: '', rccm: '',
    source: '', is_prospect: false,
    payment_terms: party.kind === 'supplier' ? '30' : '30', notes: '', active: true, ...party,
    ...(party.payment_terms != null ? { payment_terms: String(party.payment_terms) } : {})
  })
  const [busy, setBusy] = useState(false)
  const L = LABELS[party.kind as Kind]
  const submit = async () => {
    setBusy(true)
    const r = await run(() => api<{ id: number }>('parties.save', f.values), party.id ? 'Modifications enregistrées.' : `${L.one[0].toUpperCase() + L.one.slice(1)} créé.`)
    setBusy(false)
    if (r) onSaved(r.id)
  }
  return (
    <Modal
      wide
      title={party.id ? `Modifier ${party.name}` : `Nouveau ${L.one}`}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={busy} onClick={submit}>Enregistrer</button></>}
    >
      <div className="grid grid-4">
        <Field label="Nom / raison sociale" span={2}><input autoFocus {...f.bind('name')} /></Field>
        <Field label="Code" hint={party.id ? undefined : 'Automatique si vide'}><input {...f.bind('code')} disabled={!!party.id} /></Field>
        <Field label="Délai de paiement (jours)"><input inputMode="numeric" {...f.bind('payment_terms')} /></Field>
        <Field label="Contact"><input {...f.bind('contact')} /></Field>
        <Field label="Téléphone"><input {...f.bind('phone')} /></Field>
        <Field label="Email" span={2}><input type="email" {...f.bind('email')} /></Field>
        <Field label="Adresse" span={2}><textarea rows={2} {...f.bind('address')} /></Field>
        <Field label="Ville"><input {...f.bind('city')} /></Field>
        <div />
        <Field label={`N° ${company.tax_id_label || 'NIF'}`}><input {...f.bind('tax_id')} /></Field>
        <Field label="RCCM"><input {...f.bind('rccm')} /></Field>
        <Field label="Notes internes" span={2}><input {...f.bind('notes')} /></Field>
        {party.kind === 'client' && <>
          <Field label="Origine" hint="D'où vient ce prospect ? (salon, recommandation, site web, appel…)"><input {...f.bind('source')} /></Field>
          <Field label="Suivi commercial">
            <label className="inline check"><input type="checkbox" checked={!!f.values.is_prospect} onChange={(e) => f.set('is_prospect', e.target.checked)} /> Prospect (pas encore d'achat ; devient client à sa 1ʳᵉ facture)</label>
          </Field>
        </>}
      </div>
      {party.id && (
        <label className="inline check"><input type="checkbox" checked={!!f.values.active} onChange={(e) => f.set('active', e.target.checked)} /> Actif</label>
      )}
    </Modal>
  )
}

export function PartyDetail() {
  const { company } = useSession()
  const { id } = useParams()
  const nav = useNavigate()
  const { data, error, loading, reload } = useQuery<any>('parties.get', { id: Number(id) })
  const [editing, setEditing] = useState(false)
  const canCrm = useCan('crm')
  if (error) return <div className="page"><ErrorBox error={error} onRetry={reload} /></div>
  if (loading && !data) return <Loading />
  const { party, documents, payments } = data
  const kind = party.kind as Kind
  const L = LABELS[kind]
  const newTypes: DocType[] = kind === 'client' ? ['DEV', 'FAC'] : ['BC', 'FF']
  return (
    <div className="page">
      <PageHeader
        title={party.name}
        subtitle={<span className="row gap"><Link to={kind === 'client' ? '/clients' : '/suppliers'}>← {L.title}</Link><span className="muted">{party.code}</span>{party.is_prospect && <span className="badge badge-prospect">Prospect{party.source ? ` · ${party.source}` : ''}</span>}{!party.active && <span className="badge badge-annule">Inactif</span>}</span>}
        actions={<>
          <button className="btn" onClick={() => setEditing(true)}>Modifier</button>
          {newTypes.map((t) => (
            <button key={t} className="btn btn-primary" onClick={async () => {
              const r = await run(() => api<{ id: number }>('documents.save', { type: t, party_id: party.id, lines: [] }))
              if (r) nav(`/doc/${r.id}`)
            }}>{DOC_TYPES[t].fem ? 'Nouvelle' : 'Nouveau'} {DOC_TYPES[t].label.toLowerCase()}</button>
          ))}
        </>}
      />
      <div className="kpis">
        <div className="kpi"><div className="kpi-label">{L.balance}</div><div className="kpi-value">{Math.round(party.balance).toLocaleString('fr-FR')} FCFA</div></div>
        <div className="kpi"><div className="kpi-label">Contact</div><div className="kpi-text">{party.contact || '—'}<br />{party.phone}<br />{party.email}</div></div>
        <div className="kpi"><div className="kpi-label">Adresse</div><div className="kpi-text pre">{[party.address, party.city].filter(Boolean).join('\n') || '—'}</div></div>
        <div className="kpi"><div className="kpi-label">Fiscal</div><div className="kpi-text">{company.tax_id_label || 'NIF'} : {party.tax_id || '—'}<br />RCCM : {party.rccm || '—'}<br />Délai : {party.payment_terms} j</div></div>
      </div>
      {kind === 'client' && canCrm && <ClientRelation partyId={party.id} documents={documents} payments={payments} />}
      <div className="dash-grid two">
        <section className="card">
          <h3>Documents</h3>
          {documents.length === 0 ? <Empty>Aucun document.</Empty> : (
            <table className="table compact">
              <thead><tr><th>Document</th><th>Date</th><th>Statut</th><th className="num">TTC</th><th /></tr></thead>
              <tbody>
                {documents.map((d: any) => (
                  <tr key={d.id} className="clickable" onClick={() => nav(`/doc/${d.id}`)}>
                    <td>{DOC_TYPES[d.type as DocType].label} <strong>{d.number ?? ''}</strong></td>
                    <td>{formatDate(d.date)}</td>
                    <td><StatusBadge status={d.status} /></td>
                    <td className="num"><Money value={d.total_ttc} /></td>
                    <td>{d.status === 'valide' && DOC_TYPES[d.type as DocType].payable && <PaymentBadge total={d.total_ttc} paid={d.paid} dueDate={d.due_date} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="card">
          <h3>Règlements</h3>
          {payments.length === 0 ? <Empty>Aucun règlement.</Empty> : (
            <table className="table compact">
              <thead><tr><th>Date</th><th>Document</th><th>Mode</th><th className="num">Montant</th></tr></thead>
              <tbody>
                {payments.map((p: any) => (
                  <tr key={p.id}>
                    <td>{formatDate(p.date)}</td><td>{p.document_number}</td><td>{p.method}</td>
                    <td className="num"><Money value={p.direction === 'in' ? p.amount : -p.amount} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
      {editing && <PartyForm party={party} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload() }} />}
    </div>
  )
}

const CRM_STAGE: Record<string, { label: string; tone: string }> = {
  nouveau: { label: 'Nouveau', tone: 'slate' }, qualifie: { label: 'Qualifié', tone: 'info' },
  proposition: { label: 'Proposition', tone: 'primary' }, negociation: { label: 'Négociation', tone: 'warning' },
  gagne: { label: 'Gagné', tone: 'success' }, perdu: { label: 'Perdu', tone: 'danger' }
}
const ACT_ICON: Record<string, any> = { appel: ChatCircleText, reunion: Handshake, email: PaperPlaneTilt, visite: Handshake, note: Receipt, tache: Clock }

/** Relation client : opportunités en cours + chronologie unifiée (documents, règlements, activités, messages). */
function ClientRelation({ partyId, documents, payments }: { partyId: number; documents: any[]; payments: any[] }) {
  const nav = useNavigate()
  const { data } = useQuery<any>('crm.partyTimeline', { party_id: partyId })
  const opportunities = (data?.opportunities ?? []).filter((o: any) => o.stage !== 'gagne' && o.stage !== 'perdu')
  type Ev = { when: string; icon: any; tone: string; title: string; detail: string; to?: string }
  const events: Ev[] = [
    ...documents.map((d: any): Ev => ({ when: (d.date || '') + 'T12', icon: Receipt, tone: 'primary', title: `${DOC_TYPES[d.type as DocType].label} ${d.number ?? 'brouillon'}`, detail: `${formatMoney(d.total_ttc)} · ${d.status}`, to: `/doc/${d.id}` })),
    ...payments.map((p: any): Ev => ({ when: (p.date || '') + 'T12', icon: Wallet, tone: 'success', title: `Règlement ${p.method}`, detail: `${formatMoney(p.direction === 'in' ? p.amount : -p.amount)}${p.document_number ? ` · ${p.document_number}` : ''}` })),
    ...(data?.activities ?? []).map((a: any): Ev => ({ when: a.due_date ? a.due_date + 'T12' : a.created_at, icon: a.done ? CheckCircle : (ACT_ICON[a.kind] ?? Clock), tone: a.done ? 'success' : 'warning', title: a.subject, detail: `${a.kind}${a.opportunity_title ? ` · ${a.opportunity_title}` : ''}${a.user_name ? ` · ${a.user_name}` : ''}` })),
    ...(data?.messages ?? []).map((m: any): Ev => ({ when: m.created_at, icon: m.channel === 'sms' ? ChatCircleText : PaperPlaneTilt, tone: m.status === 'envoye' ? 'info' : 'danger', title: `${m.channel === 'sms' ? 'SMS' : 'E-mail'} ${m.status === 'envoye' ? 'envoyé' : 'échoué'}`, detail: m.subject || m.recipient }))
  ].sort((a, b) => (a.when < b.when ? 1 : -1)).slice(0, 30)

  return (
    <section className="card">
      <div className="dcard-head"><div><h3>Relation client</h3></div><Link className="btn btn-sm btn-tonal" to="/crm">Pipeline CRM</Link></div>
      {opportunities.length > 0 && (
        <ul className="rows">
          {opportunities.map((o: any) => {
            const s = CRM_STAGE[o.stage] ?? { label: o.stage, tone: 'slate' }
            return (
              <li key={o.id}>
                <span className={`tint tint-${s.tone} tint-sm`}><Handshake size={18} weight="duotone" aria-hidden="true" /></span>
                <div className="grow"><b>{o.title}</b><span>{s.label} · {o.probability}%{o.owner_name ? ` · ${o.owner_name}` : ''}</span></div>
                <strong className="money">{formatMoney(o.amount)}</strong>
              </li>
            )
          })}
        </ul>
      )}
      <h4 className="section-title">Activité récente</h4>
      {events.length === 0 ? <Empty>Aucune activité pour ce client.</Empty> : (
        <ul className="rows">
          {events.map((e, i) => (
            <li key={i} className={e.to ? 'clickable' : ''} onClick={() => e.to && nav(e.to)}>
              <span className={`tint tint-${e.tone} tint-sm`}><e.icon size={18} weight="duotone" aria-hidden="true" /></span>
              <div className="grow"><b>{e.title}</b><span>{e.detail}</span></div>
              <span className="muted small nowrap">{formatDate(e.when.slice(0, 10))}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
