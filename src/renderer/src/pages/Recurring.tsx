// Factures récurrentes : contrats de maintenance, abonnements, loyers.

import { useState } from 'react'
import { ArrowsClockwise, CalendarBlank, Coins, FileText, PencilSimple, Plus, Prohibit, Repeat, Trash, ArrowCounterClockwise } from '@phosphor-icons/react'
import { formatDate, formatMoney, todayISO } from '@shared/format'
import { api, run, useQuery } from '../api'
import { KpiStrip } from '../components/KpiStrip'
import { confirmDialog, Empty, ErrorBox, Field, Loading, Modal, PageHeader, RowActions, notify, useForm } from '../components/ui'
import { useSession } from '../session'

const FREQ: Record<string, { label: string; perMonth: number }> = {
  mensuel: { label: 'Mensuelle', perMonth: 1 },
  trimestriel: { label: 'Trimestrielle', perMonth: 1 / 3 },
  semestriel: { label: 'Semestrielle', perMonth: 1 / 6 },
  annuel: { label: 'Annuelle', perMonth: 1 / 12 }
}

export function RecurringPage() {
  const { data, error, loading, reload } = useQuery<any[]>('recurring.list')
  const [editing, setEditing] = useState<any | null>(null)
  const rows = data ?? []
  const active = rows.filter((r) => r.active)
  const soon = active.filter((r) => r.next_date <= todayISO()).length
  const generate = async () => {
    const r = await run(() => api<any>('recurring.runDue'))
    if (!r) return
    notify(r.created.length ? `${r.created.length} facture(s) créée(s).` : 'Aucune facture à créer aujourd’hui.', 'success')
    reload()
  }
  const toggle = async (r: any) => {
    if (await run(() => api('recurring.save', { ...r, active: !r.active }), r.active ? 'Contrat suspendu.' : 'Contrat réactivé.')) reload()
  }
  return (
    <div className="page">
      <PageHeader
        title="Factures récurrentes"
        subtitle="Contrats de maintenance, abonnements et loyers : les factures se créent seules à chaque échéance."
        actions={<>
          <button className="btn" onClick={generate}><ArrowsClockwise size={18} aria-hidden="true" />Créer les factures dues</button>
          <button className="btn btn-primary" onClick={() => setEditing({ frequency: 'mensuel', next_date: todayISO(), lines: [{ description: '', quantity: '1', unit_price: '', tva_rate: '' }] })}><Plus size={18} aria-hidden="true" />Nouveau contrat</button>
        </>}
      />
      <KpiStrip items={[
        { label: 'Contrats actifs', value: active.length, icon: Repeat },
        { label: 'Revenu récurrent mensuel (HT)', value: Math.round(active.reduce((s, r) => s + r.amount_ht * FREQ[r.frequency].perMonth, 0)), icon: Coins, money: true, tone: 'good' },
        { label: 'Factures générées', value: rows.reduce((s, r) => s + r.generated, 0), icon: FileText },
        { label: 'Échéances à traiter', value: soon, icon: CalendarBlank, tone: 'bad' }
      ]} />
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Loading /> : rows.length === 0 ? (
        <Empty>Aucun contrat. Créez-en un ici, ou depuis une facture validée avec « Rendre récurrente ».</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Contrat</th><th>Client</th><th>Fréquence</th><th className="num">Montant HT</th><th>Prochaine facture</th><th>Mode</th><th className="actions-col">Actions</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={`clickable ${r.active ? '' : 'inactive'}`} onClick={() => setEditing(r)}>
                  <td className="strong">{r.label}<div className="muted small">{r.generated} facture(s){r.last_number ? ` · dernière : ${r.last_number}` : ''}</div></td>
                  <td>{r.party_name}</td>
                  <td>{FREQ[r.frequency].label}</td>
                  <td className="num money">{formatMoney(r.amount_ht)}</td>
                  <td className={r.active && r.next_date <= todayISO() ? 'text-warn strong' : ''}>{r.active ? formatDate(r.next_date) : 'Suspendu'}{r.end_date ? <div className="muted small">jusqu'au {formatDate(r.end_date)}</div> : null}</td>
                  <td>{r.auto_validate ? <span className="badge badge-valide">Validée d'office</span> : <span className="badge badge-brouillon">Brouillon à vérifier</span>}</td>
                  <td className="actions-col">
                    <RowActions actions={[
                      { label: 'Modifier', icon: PencilSimple, tone: 'primary', onClick: () => setEditing(r) },
                      r.active ? { label: 'Suspendre', icon: Prohibit, tone: 'warning', onClick: () => toggle(r) } : { label: 'Réactiver', icon: ArrowCounterClockwise, tone: 'success', onClick: () => toggle(r) },
                      { label: 'Supprimer', icon: Trash, tone: 'danger', onClick: async () => { if (await confirmDialog(`Supprimer le contrat « ${r.label} » ?`, { danger: true, detail: 'Les factures déjà créées sont conservées.' })) if (await run(() => api('recurring.delete', { id: r.id }), 'Contrat supprimé.')) reload() } }
                    ]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <RecurringModal r={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload() }} />}
    </div>
  )
}

function RecurringModal({ r, onClose, onDone }: { r: any; onClose: () => void; onDone: () => void }) {
  const { company } = useSession()
  const clients = useQuery<any[]>('parties.options', { kind: 'client' })
  const f = useForm<any>({ label: '', frequency: 'mensuel', next_date: todayISO(), end_date: '', auto_validate: false, ...r, party_id: r.party_id ? String(r.party_id) : '' })
  const [lines, setLines] = useState<any[]>((r.lines ?? []).map((l: any) => ({ ...l, quantity: String(l.quantity ?? 1), unit_price: String(l.unit_price ?? ''), tva_rate: l.tva_rate === '' || l.tva_rate === undefined ? String(company.default_tva) : String(l.tva_rate) })))
  const setLine = (i: number, patch: any) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(String(l.unit_price).replace(/\s/g, '')) || 0), 0)
  const save = async () => {
    const payload = { ...f.values, end_date: f.values.end_date || null, lines: lines.map((l) => ({ ...l, quantity: Number(l.quantity) || 1, unit_price: Number(String(l.unit_price).replace(/\s/g, '')) || 0, tva_rate: Number(l.tva_rate) || 0 })) }
    if (await run(() => api('recurring.save', payload), 'Contrat enregistré.')) onDone()
  }
  return (
    <Modal title={r.id ? r.label : 'Nouveau contrat récurrent'} wide onClose={onClose} footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" onClick={save}>Enregistrer</button></>}>
      <div className="grid grid-4">
        <Field label="Libellé du contrat" span={2}><input autoFocus {...f.bind('label')} placeholder="Maintenance informatique" /></Field>
        <Field label="Client" span={2}><select {...f.bind('party_id')}><option value="">— Choisir —</option>{(clients.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Fréquence"><select {...f.bind('frequency')}>{Object.entries(FREQ).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
        <Field label="Prochaine facture"><input type="date" {...f.bind('next_date')} /></Field>
        <Field label="Fin du contrat (facultatif)"><input type="date" {...f.bind('end_date')} /></Field>
        <label className="inline check" style={{ alignSelf: 'end' }}><input type="checkbox" checked={!!f.values.auto_validate} onChange={(e) => f.set('auto_validate', e.target.checked)} /> Valider d'office</label>
      </div>
      <h4 className="section-title">Lignes facturées à chaque échéance</h4>
      <div className="table-wrap">
        <table className="table compact">
          <thead><tr><th>Désignation</th><th className="num">Qté</th><th className="num">P.U. HT</th><th className="num">TVA %</th><th /></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td><input aria-label="Désignation" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} /></td>
                <td><input aria-label="Quantité" inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} style={{ width: 70 }} /></td>
                <td><input aria-label="Prix unitaire HT" inputMode="numeric" value={l.unit_price} onChange={(e) => setLine(i, { unit_price: e.target.value })} style={{ width: 120 }} /></td>
                <td><input aria-label="TVA" inputMode="decimal" value={l.tva_rate} onChange={(e) => setLine(i, { tva_rate: e.target.value })} style={{ width: 70 }} /></td>
                <td><button className="icon-btn" aria-label="Supprimer la ligne" onClick={() => setLines(lines.filter((_, j) => j !== i))}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row space-between wrap gap" style={{ marginTop: 10 }}>
        <button className="btn btn-sm" onClick={() => setLines([...lines, { description: '', quantity: '1', unit_price: '', tva_rate: String(company.default_tva) }])}>+ Ajouter une ligne</button>
        <strong>Montant HT par échéance : {formatMoney(total)}</strong>
      </div>
    </Modal>
  )
}
