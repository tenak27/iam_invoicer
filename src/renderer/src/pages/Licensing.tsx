// Émission des licences clients (profil « Gestionnaire de licences », poste de l'éditeur) :
// registre, nouvelle licence, renouvellement, révocation, clé à copier ou enregistrer.

import { useMemo, useState } from 'react'
import { ArrowCounterClockwise, ArrowsClockwise, Certificate, CloudArrowUp, ClockCountdown, Copy, DownloadSimple, FileArrowUp, Key, Plus, Prohibit, SealCheck, WarningCircle } from '@phosphor-icons/react'
import { formatDate, todayISO } from '@shared/format'
import { api, run, unwrap, useQuery } from '../api'
import { KpiStrip } from '../components/KpiStrip'
import { confirmDialog, Empty, ErrorBox, Field, Loading, Modal, notify, PageHeader, RowActions, SearchInput, Tabs, useForm } from '../components/ui'
import { CloudTab } from './LicensingCloud'

interface VendorStatus {
  available: boolean
  reason: string | null
  registry: string | null
  tiers: { id: string; label: string; pitch: string; users: number; whiteLabel: boolean; modules: string[] }[]
  modules: { id: string; label: string }[]
}
export interface Issued {
  id: number; number: string; company: string; tax_id: string | null; tier: string; modules: string[]; users: number
  issued: string; expires: string | null; white_label: boolean; licence_key: string; contact: string | null; notes: string | null
  revoked: boolean; revoked_reason: string | null; issued_by_name: string | null
}

const TIER_LABEL: Record<string, string> = { essentiel: 'Essentiel', pro: 'Pro', entreprise: 'Entreprise', 'sur-mesure': 'Sur mesure' }
const daysTo = (d: string) => Math.round((Date.parse(d + 'T12:00:00Z') - Date.parse(todayISO() + 'T12:00:00Z')) / 86_400_000)

function stateOf(l: Issued): { label: string; cls: string; key: 'active' | 'soon' | 'expired' | 'revoked' } {
  if (l.revoked) return { label: 'Révoquée', cls: 'badge badge-annule', key: 'revoked' }
  if (!l.expires) return { label: 'Perpétuelle', cls: 'badge pay-payee', key: 'active' }
  const d = daysTo(l.expires)
  if (d < 0) return { label: 'Expirée', cls: 'badge badge-brouillon', key: 'expired' }
  if (d <= 30) return { label: `Expire dans ${d} j`, cls: 'badge pay-partielle', key: 'soon' }
  return { label: 'Active', cls: 'badge pay-payee', key: 'active' }
}

const copyKey = async (key: string) => {
  try {
    await navigator.clipboard.writeText(key)
    notify('Clé copiée dans le presse-papiers.', 'success')
  } catch {
    notify('Copie impossible : sélectionnez la clé et copiez-la.', 'error')
  }
}
const saveKey = (l: Pick<Issued, 'number' | 'company' | 'licence_key' | 'tier' | 'expires' | 'users'>) =>
  run(() => unwrap(window.erp.saveText(`${l.number}.txt`,
    `Licence IAM INVOICER ${l.number}\r\nClient : ${l.company}\r\nPalier : ${TIER_LABEL[l.tier] ?? l.tier} · ${l.users || 'utilisateurs illimités'}${l.users ? ' utilisateur(s)' : ''}\r\n` +
    `Validité : ${l.expires ? `jusqu'au ${formatDate(l.expires)}` : 'perpétuelle'}\r\n\r\n` +
    `Activation : Société & paramètres → Licence → coller la clé ci-dessous.\r\nLa raison sociale configurée doit être exactement « ${l.company} ».\r\n\r\n${l.licence_key}\r\n`)))

export function LicensingPage() {
  const status = useQuery<VendorStatus>('licensing.status')
  const list = useQuery<Issued[]>('licensing.list')
  const [q, setQ] = useState('')
  const [form, setForm] = useState<Partial<Issued> | null>(null)
  const [shown, setShown] = useState<Issued | null>(null)
  const [tab, setTab] = useState<'licences' | 'cloud'>('licences')
  const [cloudSeed, setCloudSeed] = useState<{ name: string; contact?: string; licence_id?: number } | null>(null)
  const rows = list.data ?? []
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? rows.filter((l) => [l.number, l.company, l.tax_id, l.contact].some((v) => String(v ?? '').toLowerCase().includes(t))) : rows
  }, [rows, q])
  const counts = rows.reduce((c, l) => ({ ...c, [stateOf(l).key]: (c[stateOf(l).key] ?? 0) + 1 }), {} as Record<string, number>)

  if (status.error) return <ErrorBox error={status.error} onRetry={status.reload} />
  if (!status.data) return <Loading />
  const st = status.data

  const importCsv = async () => {
    const r = await run(() => api<{ added: number; total: number }>('licensing.importRegistry'))
    if (r) {
      notify(`${r.added} licence(s) reprise(s) sur ${r.total} dans le registre CSV.`, 'success')
      list.reload()
    }
  }
  const revoke = async (l: Issued) => {
    const ok = await confirmDialog(l.revoked ? `Rétablir la licence ${l.number} ?` : `Marquer la licence ${l.number} comme révoquée ?`, {
      danger: !l.revoked,
      detail: l.revoked ? undefined : "Le registre la signale comme révoquée et elle ne sera pas renouvelée. Une licence déjà activée hors ligne reste valable jusqu'à sa date de fin : préférez des licences annuelles pour les clients à risque."
    })
    if (ok && (await run(() => api('licensing.revoke', { id: l.id }), l.revoked ? 'Licence rétablie.' : 'Licence révoquée.'))) list.reload()
  }
  const renew = (l: Issued) => {
    const base = l.expires && l.expires > todayISO() ? l.expires : todayISO()
    const d = new Date(base + 'T12:00:00Z')
    d.setUTCFullYear(d.getUTCFullYear() + 1)
    setForm({ ...l, expires: d.toISOString().slice(0, 10), renews_id: l.id } as any)
  }

  return (
    <div className="page">
      <PageHeader
        title="Émission de licences"
        subtitle="Licences clients signées par IAM Technology : palier, modules, utilisateurs et durée. Chaque licence est inscrite au registre."
        actions={st.available && tab === 'licences' ? <>
          {st.registry && <button className="btn" onClick={importCsv}><FileArrowUp size={18} aria-hidden="true" />Reprendre le registre CSV</button>}
          <button className="btn btn-primary" onClick={() => setForm({ tier: 'pro' })}><Plus size={18} aria-hidden="true" />Nouvelle licence</button>
        </> : undefined}
      />
      {!st.available && (
        <div className="card notice-card" role="alert">
          <h3><WarningCircle size={20} aria-hidden="true" /> Émission indisponible sur ce poste</h3>
          <p>{st.reason}</p>
          <p className="muted">Les licences se signent avec la clé privée de l'éditeur, qui ne doit se trouver que sur le poste de l'éditeur
            (<code>%USERPROFILE%\.iam-invoicer\licence-private.pem</code>) ou sur son serveur (variable <code>LICENCE_PRIVATE_KEY_FILE</code>).</p>
        </div>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'licences', label: 'Licences' }, { value: 'cloud', label: 'Bases clients en ligne' }]} />
      {tab === 'cloud' ? <CloudTab licences={rows} seed={cloudSeed} onSeedUsed={() => setCloudSeed(null)} /> : <>
      <KpiStrip items={[
        { label: 'Licences émises', value: rows.length, icon: Certificate },
        { label: 'Actives', value: (counts.active ?? 0) + (counts.soon ?? 0), icon: SealCheck, tone: 'good' },
        { label: 'À renouveler (30 j)', value: counts.soon ?? 0, icon: ClockCountdown, tone: 'bad' },
        { label: 'Expirées ou révoquées', value: (counts.expired ?? 0) + (counts.revoked ?? 0), icon: Prohibit }
      ]} />
      <div className="toolbar"><SearchInput value={q} onChange={setQ} placeholder="Rechercher un client, un numéro, un IFU…" /></div>
      {list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : list.loading && !list.data ? <Loading /> : filtered.length === 0 ? (
        <Empty>{rows.length ? 'Aucune licence ne correspond à la recherche.' : 'Aucune licence émise pour le moment. Créez la première avec « Nouvelle licence ».'}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Numéro</th><th>Client</th><th>Palier</th><th>Émise le</th><th>Validité</th><th>État</th><th className="actions-col">Actions</th></tr></thead>
            <tbody>
              {filtered.map((l) => {
                const s = stateOf(l)
                return (
                  <tr key={l.id} className={`clickable ${l.revoked ? 'inactive' : ''}`} onClick={() => setShown(l)}>
                    <td className="strong">{l.number}</td>
                    <td className="strong">{l.company}<div className="muted small">{[l.tax_id && `IFU ${l.tax_id}`, l.contact].filter(Boolean).join(' · ')}</div></td>
                    <td>{TIER_LABEL[l.tier] ?? l.tier}<div className="muted small">{l.users ? `${l.users} utilisateur(s)` : 'Utilisateurs illimités'}{l.white_label ? ' · marque blanche' : ''}</div></td>
                    <td>{formatDate(l.issued)}<div className="muted small">{l.issued_by_name ?? ''}</div></td>
                    <td>{l.expires ? formatDate(l.expires) : 'Perpétuelle'}</td>
                    <td><span className={s.cls}>{s.label}</span></td>
                    <td className="actions-col">
                      <RowActions actions={[
                        { label: 'Copier la clé', icon: Copy, tone: 'primary', onClick: () => copyKey(l.licence_key) },
                        { label: 'Enregistrer la clé', icon: DownloadSimple, onClick: () => saveKey(l) },
                        ...(st.available ? [{ label: 'Renouveler', icon: ArrowsClockwise, tone: 'success' as const, onClick: () => renew(l) }] : []),
                        l.revoked ? { label: 'Rétablir', icon: ArrowCounterClockwise, tone: 'success' as const, onClick: () => revoke(l) } : { label: 'Révoquer', icon: Prohibit, tone: 'danger' as const, onClick: () => revoke(l) }
                      ]} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      </>}
      {form && <IssueModal st={st} initial={form} onClose={() => setForm(null)} onDone={(l) => { setForm(null); list.reload(); setShown(l) }} />}
      {shown && <KeyModal l={shown} onClose={() => setShown(null)} onCloud={() => { setCloudSeed({ name: shown.company, contact: shown.contact ?? undefined, licence_id: shown.id }); setShown(null); setTab('cloud') }} />}
    </div>
  )
}

type Duration = '12' | '24' | '36' | '1' | '3' | 'perpetual' | 'date'

function IssueModal({ st, initial, onClose, onDone }: { st: VendorStatus; initial: any; onClose: () => void; onDone: (l: Issued) => void }) {
  const renewal = !!initial.renews_id
  const f = useForm<any>({
    company: '', tax_id: '', contact: '', notes: '', white_label: false, ...initial,
    users: initial.users === undefined ? '' : String(initial.users),
    duration: (renewal ? 'date' : '12') as Duration,
    until: initial.expires ?? ''
  })
  const tier = st.tiers.find((t) => t.id === f.values.tier)
  const [modules, setModules] = useState<string[]>(initial.tier === 'sur-mesure' ? initial.modules ?? [] : ['sales', 'clients', 'products', 'payments'])
  const expires = useMemo(() => {
    const dur = f.values.duration as Duration
    if (dur === 'perpetual') return null
    if (dur === 'date') return f.values.until || null
    const d = new Date(todayISO() + 'T12:00:00Z')
    d.setUTCMonth(d.getUTCMonth() + Number(dur))
    return d.toISOString().slice(0, 10)
  }, [f.values.duration, f.values.until])
  const submit = async () => {
    if (f.values.duration === 'date' && !f.values.until) return notify('Choisissez la date de fin.', 'error')
    const r = await run(() => api<Issued>('licensing.issue', {
      company: f.values.company, tax_id: f.values.tax_id, tier: f.values.tier, modules, users: f.values.users,
      expires, white_label: f.values.white_label, contact: f.values.contact, notes: f.values.notes, renews_id: initial.renews_id
    }), 'Licence émise et inscrite au registre.')
    if (r) onDone(r)
  }
  const defaultUsers = tier ? (tier.users || 'illimité') : 3
  return (
    <Modal title={renewal ? `Renouveler ${initial.number}` : 'Nouvelle licence'} wide onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" onClick={submit}><Key size={18} aria-hidden="true" />Émettre la licence</button></>}>
      <div className="grid grid-4">
        <Field label="Raison sociale du client" span={2} hint="Exactement comme dans « Société & paramètres » chez le client (majuscules et SARL, SA… sont ignorés)."><input autoFocus {...f.bind('company')} placeholder="Pharmacie du Progrès SARL" /></Field>
        <Field label="Identifiant fiscal (facultatif)" hint="Contrôlé s'il est renseigné chez le client."><input {...f.bind('tax_id')} placeholder="00012345A" /></Field>
        <Field label="Contact du client"><input {...f.bind('contact')} placeholder="Téléphone ou e-mail" /></Field>
        <Field label="Palier" span={2} hint={tier?.pitch ?? 'Choisissez les modules un par un.'}>
          <select {...f.bind('tier')}>
            {st.tiers.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            <option value="sur-mesure">Sur mesure</option>
          </select>
        </Field>
        <Field label="Utilisateurs actifs" hint="0 = illimité ; vide = valeur du palier."><input inputMode="numeric" {...f.bind('users')} placeholder={String(defaultUsers)} /></Field>
        <Field label="Durée">
          <select {...f.bind('duration')}>
            <option value="1">1 mois</option>
            <option value="3">3 mois</option>
            <option value="12">1 an</option>
            <option value="24">2 ans</option>
            <option value="36">3 ans</option>
            <option value="perpetual">Perpétuelle</option>
            <option value="date">Jusqu'à une date…</option>
          </select>
        </Field>
        {f.values.duration === 'date' && <Field label="Date de fin"><input type="date" min={todayISO()} {...f.bind('until')} /></Field>}
        <Field label="Note interne" span={f.values.duration === 'date' ? 3 : 4}><input {...f.bind('notes')} placeholder="Facture n°, revendeur, conditions…" /></Field>
        <label className="inline check" style={{ gridColumn: '1 / -1' }}>
          <input type="checkbox" checked={!!f.values.white_label || !!tier?.whiteLabel} disabled={!!tier?.whiteLabel} onChange={(e) => f.set('white_label', e.target.checked)} /> Marque blanche : nom et logo du client à la place d'IAM Technology{tier?.whiteLabel ? ' (incluse dans ce palier)' : ''}
        </label>
      </div>
      {f.values.tier === 'sur-mesure' && (
        <>
          <h4 className="section-title">Modules inclus</h4>
          <div className="check-grid">
            {st.modules.filter((m) => !['dashboard', 'settings', 'users'].includes(m.id)).map((m) => (
              <label key={m.id} className="inline check">
                <input type="checkbox" checked={modules.includes(m.id)} onChange={(e) => setModules(e.target.checked ? [...modules, m.id] : modules.filter((x) => x !== m.id))} /> {m.label}
              </label>
            ))}
          </div>
          <p className="muted small">Tableau de bord, paramètres et utilisateurs sont toujours inclus.</p>
        </>
      )}
      <p className="muted" style={{ marginTop: 12 }}>
        Récapitulatif : <strong>{tier?.label ?? 'Sur mesure'}</strong>, {f.values.users === '' ? defaultUsers : f.values.users === '0' ? 'illimité' : f.values.users} utilisateur(s),{' '}
        {expires ? <>valable jusqu'au <strong>{formatDate(expires)}</strong></> : <strong>perpétuelle</strong>}.
      </p>
    </Modal>
  )
}

function KeyModal({ l, onClose, onCloud }: { l: Issued; onClose: () => void; onCloud: () => void }) {
  return (
    <Modal title={`Licence ${l.number}`} wide onClose={onClose}
      footer={<>
        <button className="btn" onClick={onCloud}><CloudArrowUp size={18} aria-hidden="true" />Créer sa base en ligne</button>
        <button className="btn" onClick={() => saveKey(l)}><DownloadSimple size={18} aria-hidden="true" />Enregistrer (.txt)</button>
        <button className="btn btn-primary" onClick={() => copyKey(l.licence_key)}><Copy size={18} aria-hidden="true" />Copier la clé</button>
      </>}>
      <p><strong>{l.company}</strong>{l.tax_id ? ` · IFU ${l.tax_id}` : ''} — {TIER_LABEL[l.tier] ?? l.tier}, {l.users || 'illimité'} utilisateur(s),{' '}
        {l.expires ? `jusqu'au ${formatDate(l.expires)}` : 'perpétuelle'}{l.white_label ? ', marque blanche' : ''}.</p>
      {l.revoked && <p className="text-warn strong">Licence marquée révoquée{l.revoked_reason ? ` : ${l.revoked_reason}` : ''}.</p>}
      <Field label="Clé à transmettre au client">
        <textarea readOnly rows={6} value={l.licence_key} onFocus={(e) => e.currentTarget.select()} style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12.5, wordBreak: 'break-all' }} />
      </Field>
      <p className="muted small">Chez le client : <strong>Société & paramètres → Licence</strong>, coller la clé puis « Activer ». La raison sociale configurée doit correspondre à « {l.company} ».</p>
    </Modal>
  )
}
