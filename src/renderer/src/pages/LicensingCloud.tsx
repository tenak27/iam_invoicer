// Bases clients en ligne : chaque client hébergé sur le serveur de l'éditeur a sa propre base
// PostgreSQL (nom, utilisateur, mot de passe). Création, fiche de connexion à transmettre,
// code d'activation, suspension, nouveau mot de passe, suppression.

import { useEffect, useMemo, useState } from 'react'
import { ArrowCounterClockwise, Copy, Database, DownloadSimple, Gear, HardDrives, Info, Key, Pause, Plus, Trash, UsersThree } from '@phosphor-icons/react'
import { formatDate } from '@shared/format'
import { api, run, unwrap, useQuery } from '../api'
import { KpiStrip } from '../components/KpiStrip'
import { confirmDialog, Empty, ErrorBox, Field, Loading, Modal, notify, RowActions, SearchInput, useForm } from '../components/ui'
import type { Issued } from './Licensing'

interface Tenant {
  slug: string
  name: string
  db_name: string
  db_user: string
  status: 'active' | 'suspended'
  setup_code: string | null
  contact: string | null
  licence_number: string | null
  notes: string | null
  created_at: string
  size: number | null
}
interface Created {
  slug: string; name: string; path: string; url: string
  db_name: string; db_user: string; db_password: string; db_host: string; db_port: number; setup_code: string
}

const mo = (n: number | null | undefined) => (n == null ? '—' : `${(n / 1048576).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`)
const copy = async (text: string, what = 'Copié') => {
  try {
    await navigator.clipboard.writeText(text)
    notify(`${what} dans le presse-papiers.`, 'success')
  } catch {
    notify('Copie impossible : sélectionnez le texte et copiez-le.', 'error')
  }
}

export function CloudTab({ licences, seed, onSeedUsed }: { licences: Issued[]; seed: { name: string; contact?: string; licence_id?: number } | null; onSeedUsed: () => void }) {
  const cfg = useQuery<{ url: string; hasToken: boolean }>('licensing.cloudConfig')
  const [editCfg, setEditCfg] = useState(false)
  if (cfg.error) return <ErrorBox error={cfg.error} onRetry={cfg.reload} />
  if (!cfg.data) return <Loading />
  if (!cfg.data.url || !cfg.data.hasToken || editCfg)
    return <ConfigCard initial={cfg.data} onCancel={cfg.data.url && cfg.data.hasToken ? () => setEditCfg(false) : undefined} onSaved={() => { setEditCfg(false); cfg.reload() }} />
  return <CloudList url={cfg.data.url} licences={licences} seed={seed} onSeedUsed={onSeedUsed} onConfig={() => setEditCfg(true)} />
}

function ConfigCard({ initial, onSaved, onCancel }: { initial: { url: string; hasToken: boolean }; onSaved: () => void; onCancel?: () => void }) {
  const f = useForm<any>({ url: initial.url, token: '' })
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    const r = await run(() => api<{ tenants: number }>('licensing.cloudSaveConfig', f.values))
    setBusy(false)
    if (r) {
      notify(`Serveur connecté : ${r.tenants} base(s) client(s).`, 'success')
      onSaved()
    }
  }
  return (
    <div className="card" style={{ maxWidth: 820 }}>
      <h3><HardDrives size={20} aria-hidden="true" /> Serveur d'hébergement des clients</h3>
      <p className="muted">
        Votre VPS héberge une base par client. Renseignez son adresse et le <strong>jeton d'administration</strong> (valeur <code>ADMIN_TOKEN</code> du fichier
        <code> /opt/iam-invoicer/.env</code>, affichée à la fin de l'installation). Le jeton reste sur ce poste et n'est jamais affiché.
      </p>
      <div className="grid grid-4">
        <Field label="Adresse du serveur" span={2} hint="Exemple : cloud.iam.bf"><input {...f.bind('url')} placeholder="cloud.iam.bf" /></Field>
        <Field label="Jeton d'administration" span={2} hint={initial.hasToken ? 'Laissez vide pour garder le jeton enregistré.' : '64 caractères'}>
          <input type="password" autoComplete="off" {...f.bind('token')} placeholder={initial.hasToken ? '••••••••' : ''} />
        </Field>
      </div>
      <div className="form-actions">
        {onCancel && <button className="btn" onClick={onCancel}>Annuler</button>}
        <button className="btn btn-primary" disabled={busy} onClick={save}><Gear size={18} aria-hidden="true" />{busy ? 'Connexion…' : 'Enregistrer et tester'}</button>
      </div>
    </div>
  )
}

function CloudList({ url, licences, seed, onSeedUsed, onConfig }: { url: string; licences: Issued[]; seed: { name: string; contact?: string; licence_id?: number } | null; onSeedUsed: () => void; onConfig: () => void }) {
  const list = useQuery<Tenant[]>('licensing.cloudList')
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState<any | null>(null)
  const [sheet, setSheet] = useState<Created | null>(null)
  const [info, setInfo] = useState<Tenant | null>(null)
  const [removing, setRemoving] = useState<Tenant | null>(null)
  useEffect(() => {
    if (seed) {
      setCreating(seed)
      onSeedUsed()
    }
  }, [seed, onSeedUsed])
  const rows = list.data ?? []
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? rows.filter((r) => [r.name, r.slug, r.contact, r.licence_number].some((v) => String(v ?? '').toLowerCase().includes(t))) : rows
  }, [rows, q])
  const address = (t: Pick<Tenant, 'slug'>) => `${url}/t/${t.slug}`

  const act = async (t: Tenant, action: 'suspend' | 'resume' | 'password' | 'setup-code') => {
    if (action === 'suspend' && !(await confirmDialog(`Suspendre l'accès de « ${t.name} » ?`, { danger: true, detail: "Les applications du client ne pourront plus se connecter. Les données sont conservées ; réactivez à tout moment." }))) return
    if (action === 'password' && !(await confirmDialog(`Nouveau mot de passe pour la base de « ${t.name} » ?`, { detail: "À faire en cas de fuite. Les applications du client continuent de fonctionner : seul l'accès direct à PostgreSQL change." }))) return
    const r = await run(() => api<any>('licensing.cloudAction', { slug: t.slug, action }))
    if (!r) return
    if (action === 'setup-code') setSheet({ ...emptySheet(t, url), setup_code: r.setup_code })
    else if (action === 'password') setSheet({ ...emptySheet(t, url), db_password: r.db_password })
    else notify(action === 'suspend' ? 'Accès suspendu.' : 'Accès réactivé.', 'success')
    list.reload()
  }

  return (
    <>
      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder="Rechercher un client, une adresse, une licence…" />
        <span className="grow" />
        <button className="btn" onClick={onConfig}><Gear size={18} aria-hidden="true" />{url.replace(/^https?:\/\//, '')}</button>
        <button className="btn btn-primary" onClick={() => setCreating({})}><Plus size={18} aria-hidden="true" />Nouvelle base client</button>
      </div>
      <KpiStrip items={[
        { label: 'Bases clients', value: rows.length, icon: Database },
        { label: 'Actives', value: rows.filter((r) => r.status === 'active').length, icon: UsersThree, tone: 'good' },
        { label: 'Suspendues', value: rows.filter((r) => r.status !== 'active').length, icon: Pause, tone: 'bad' },
        { label: 'Espace utilisé (Mo)', value: Math.round(rows.reduce((s, r) => s + (r.size ?? 0), 0) / 1048576), icon: HardDrives }
      ]} />
      {list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : list.loading && !list.data ? <Loading /> : filtered.length === 0 ? (
        <Empty>{rows.length ? 'Aucune base ne correspond à la recherche.' : 'Aucune base client sur ce serveur. Créez la première avec « Nouvelle base client ».'}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Client</th><th>Adresse à saisir dans l'application</th><th>Base</th><th className="num">Taille</th><th>État</th><th>Créée le</th><th className="actions-col">Actions</th></tr></thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.slug} className={`clickable ${t.status === 'active' ? '' : 'inactive'}`} onClick={() => setInfo(t)}>
                  <td className="strong">{t.name}<div className="muted small">{[t.licence_number, t.contact].filter(Boolean).join(' · ')}</div></td>
                  <td><code className="small">{address(t).replace(/^https?:\/\//, '')}</code>{t.setup_code && <div className="muted small">Code d'activation : {t.setup_code}</div>}</td>
                  <td><code className="small">{t.db_name}</code></td>
                  <td className="num">{mo(t.size)}</td>
                  <td><span className={`badge ${t.status === 'active' ? 'pay-payee' : 'badge-annule'}`}>{t.status === 'active' ? 'Active' : 'Suspendue'}</span></td>
                  <td>{formatDate(String(t.created_at).slice(0, 10))}</td>
                  <td className="actions-col">
                    <RowActions actions={[
                      { label: "Copier l'adresse", icon: Copy, tone: 'primary', onClick: () => copy(address(t), 'Adresse copiée') },
                      { label: 'Fiche et activité', icon: Info, onClick: () => setInfo(t) },
                      { label: "Nouveau code d'activation", icon: Key, onClick: () => act(t, 'setup-code') },
                      { label: 'Nouveau mot de passe de la base', icon: ArrowCounterClockwise, onClick: () => act(t, 'password') },
                      t.status === 'active' ? { label: 'Suspendre', icon: Pause, tone: 'warning' as const, onClick: () => act(t, 'suspend') } : { label: 'Réactiver', icon: ArrowCounterClockwise, tone: 'success' as const, onClick: () => act(t, 'resume') },
                      { label: 'Supprimer', icon: Trash, tone: 'danger' as const, onClick: () => setRemoving(t) }
                    ]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && <CreateModal initial={creating} licences={licences} onClose={() => setCreating(null)} onDone={(c) => { setCreating(null); setSheet(c); list.reload() }} />}
      {sheet && <SheetModal c={sheet} onClose={() => setSheet(null)} />}
      {info && <InfoModal t={info} address={address(info)} onClose={() => setInfo(null)} />}
      {removing && <RemoveModal t={removing} onClose={() => setRemoving(null)} onDone={() => { setRemoving(null); list.reload() }} />}
    </>
  )
}

const emptySheet = (t: Tenant, url: string): Created => ({ slug: t.slug, name: t.name, path: `/t/${t.slug}`, url: `${url}/t/${t.slug}`, db_name: t.db_name, db_user: t.db_user, db_password: '', db_host: '', db_port: 0, setup_code: '' })

function CreateModal({ initial, licences, onClose, onDone }: { initial: any; licences: Issued[]; onClose: () => void; onDone: (c: Created) => void }) {
  const f = useForm<any>({ name: '', slug: '', contact: '', notes: '', ...initial, licence_id: initial.licence_id ? String(initial.licence_id) : '' })
  const [busy, setBusy] = useState(false)
  const usable = licences.filter((l) => !l.revoked && (!l.expires || l.expires >= new Date().toISOString().slice(0, 10)))
  const preview = String(f.values.slug || f.values.name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\b(sarl|sa|sas|sasu|suarl|snc|gie|ets|etablissements?)\b/g, ' ').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30)
  const submit = async () => {
    setBusy(true)
    const r = await run(() => api<Created>('licensing.cloudCreate', { ...f.values, licence_id: f.values.licence_id ? Number(f.values.licence_id) : undefined }), 'Base client créée.')
    setBusy(false)
    if (r) onDone(r)
  }
  return (
    <Modal title="Nouvelle base client" wide onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={busy} onClick={submit}><Database size={18} aria-hidden="true" />{busy ? 'Création de la base…' : 'Créer la base'}</button></>}>
      <p className="muted">Le serveur crée une base PostgreSQL réservée à ce client, avec son propre utilisateur et un mot de passe aléatoire, puis un code d'activation pour sa première configuration.</p>
      <div className="grid grid-4">
        <Field label="Raison sociale du client" span={2}><input autoFocus {...f.bind('name')} placeholder="Pharmacie du Progrès SARL" /></Field>
        <Field label="Identifiant d'adresse (facultatif)" span={2} hint={preview ? `Adresse : …/t/${/^[a-z]/.test(preview) ? preview : 'c_' + preview}` : 'Déduit de la raison sociale'}>
          <input {...f.bind('slug')} placeholder="pharmacie_progres" />
        </Field>
        <Field label="Licence à installer" span={2} hint="Facultatif : la licence du registre est préinstallée dans sa base.">
          <select {...f.bind('licence_id')}>
            <option value="">— Aucune (évaluation) —</option>
            {usable.map((l) => <option key={l.id} value={l.id}>{l.number} · {l.company}</option>)}
          </select>
        </Field>
        <Field label="Contact" span={2}><input {...f.bind('contact')} placeholder="Téléphone ou e-mail" /></Field>
        <Field label="Note interne" span={4}><input {...f.bind('notes')} /></Field>
      </div>
    </Modal>
  )
}

function sheetText(c: Created) {
  return [
    `IAM INVOICER — accès en ligne de ${c.name}`,
    '',
    '1. Installez IAM INVOICER (ordinateur, téléphone) ou ouvrez l\'adresse dans un navigateur.',
    '2. Au premier lancement, choisissez « Serveur en ligne » et saisissez :',
    `   Adresse du serveur : ${c.url.replace(/^https?:\/\//, '')}`,
    ...(c.setup_code ? [`3. Première configuration : code d'activation ${c.setup_code}`] : []),
    '',
    'Accès technique à la base (à conserver par l\'éditeur, ne pas transmettre) :',
    `   Base : ${c.db_name}`,
    `   Utilisateur : ${c.db_user}`,
    ...(c.db_password ? [`   Mot de passe : ${c.db_password}`] : []),
    ...(c.db_host ? [`   Serveur PostgreSQL : ${c.db_host}:${c.db_port} (interne au VPS)`] : [])
  ].join('\r\n')
}

function SheetModal({ c, onClose }: { c: Created; onClose: () => void }) {
  return (
    <Modal title={`Fiche de connexion — ${c.name}`} wide onClose={onClose}
      footer={<>
        <button className="btn" onClick={() => run(() => unwrap(window.erp.saveText(`acces-${c.slug}.txt`, sheetText(c))))}><DownloadSimple size={18} aria-hidden="true" />Enregistrer (.txt)</button>
        <button className="btn btn-primary" onClick={() => copy(sheetText(c), 'Fiche copiée')}><Copy size={18} aria-hidden="true" />Copier la fiche</button>
      </>}>
      <h4 className="section-title">À transmettre au client</h4>
      <div className="grid grid-4">
        <Field label="Adresse du serveur (à saisir dans l'application)" span={c.setup_code ? 3 : 4}><input readOnly value={c.url.replace(/^https?:\/\//, '')} onFocus={(e) => e.currentTarget.select()} /></Field>
        {c.setup_code && <Field label="Code d'activation"><input readOnly value={c.setup_code} onFocus={(e) => e.currentTarget.select()} style={{ letterSpacing: '.08em', fontWeight: 700 }} /></Field>}
      </div>
      <h4 className="section-title">Accès technique à la base (éditeur uniquement)</h4>
      <div className="grid grid-4">
        <Field label="Base"><input readOnly value={c.db_name} /></Field>
        <Field label="Utilisateur"><input readOnly value={c.db_user} /></Field>
        {c.db_password && <Field label="Mot de passe" span={2}><input readOnly value={c.db_password} onFocus={(e) => e.currentTarget.select()} className="mono" /></Field>}
      </div>
      {c.db_password && <p className="text-warn small">Ce mot de passe n'est affiché qu'une fois : enregistrez la fiche. En cas de perte, générez-en un nouveau (les applications du client ne sont pas concernées).</p>}
    </Modal>
  )
}

function InfoModal({ t, address, onClose }: { t: Tenant; address: string; onClose: () => void }) {
  const info = useQuery<any>('licensing.cloudInfo', { slug: t.slug })
  const d = info.data
  return (
    <Modal title={t.name} onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Fermer</button>}>
      {info.error ? <ErrorBox error={info.error} onRetry={info.reload} /> : !d ? <Loading /> : (
        <div className="kv-list">
          <p><strong>Adresse :</strong> <code>{address}</code></p>
          <p><strong>Base :</strong> <code>{d.db_name}</code> · {mo(d.size)} · {d.status === 'active' ? 'active' : 'suspendue'}</p>
          <p><strong>Société configurée :</strong> {d.configured ? d.company || 'oui' : <span className="text-warn">pas encore (code d'activation {d.setup_code ?? '—'})</span>}</p>
          <p><strong>Utilisateurs actifs :</strong> {d.users ?? '—'} · <strong>Documents :</strong> {d.documents ?? '—'}</p>
          {d.licence_number && <p><strong>Licence :</strong> {d.licence_number}</p>}
          {d.contact && <p><strong>Contact :</strong> {d.contact}</p>}
          {d.notes && <p><strong>Note :</strong> {d.notes}</p>}
          {d.error && <p className="text-warn">{d.error}</p>}
        </div>
      )}
    </Modal>
  )
}

function RemoveModal({ t, onClose, onDone }: { t: Tenant; onClose: () => void; onDone: () => void }) {
  const [typed, setTyped] = useState('')
  const remove = async () => {
    if (await run(() => api('licensing.cloudAction', { slug: t.slug, action: 'delete', confirm: typed.trim() }), 'Base supprimée.')) onDone()
  }
  return (
    <Modal title={`Supprimer la base de « ${t.name} »`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-danger" disabled={typed.trim() !== t.slug} onClick={remove}><Trash size={18} aria-hidden="true" />Supprimer définitivement</button></>}>
      <p>La base <code>{t.db_name}</code>, son utilisateur et <strong>toutes les données du client</strong> seront effacés. Cette action est irréversible.</p>
      <p className="muted">Préférez « Suspendre » si le client peut revenir. Faites une sauvegarde avant (script <code>sauvegarde.sh</code> du serveur).</p>
      <Field label={`Tapez « ${t.slug} » pour confirmer`}><input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" /></Field>
    </Modal>
  )
}
