import { useEffect, useState } from 'react'
import { ROLE_LABELS, PERMISSIONS, type Role } from '@shared/domain'
import { api, run, unwrap, useQuery } from '../api'
import { confirmDialog, Empty, ErrorBox, Field, Loading, Modal, notify, PageHeader, Tabs, useForm } from '../components/ui'
import { SignaturePad } from '../components/SignaturePad'
import { DbConfigForm, REGIMES, TAX_ID_LABELS } from './Auth'
import { useSession } from '../session'

const MODULE_LABELS: Record<string, string> = {
  dashboard: 'Tableau de bord', sales: 'Ventes', purchases: 'Achats', stock: 'Stock', payments: 'Paiements', clients: 'Clients',
  suppliers: 'Fournisseurs', products: 'Articles', reports: 'Rapports', cash: 'Caisse', accounting: 'Comptabilité',
  messages: 'Communications', settings: 'Paramètres', users: 'Utilisateurs'
}

const DATA_TEXT: Record<DataMode, string> = {
  local: 'sur ce poste',
  server: 'serveur PostgreSQL du réseau local',
  remote: 'serveur en ligne'
}

type SettingsTab = 'societe' | 'documents' | 'mail' | 'sms' | 'donnees'

const DOC_COLORS = ['#1d6fd6', '#0b4f8a', '#178a55', '#7367f0', '#c2410c', '#be123c', '#33303f']

export function CompanySettingsPage() {
  const { refreshCompany, dbMode, serverUrl, user } = useSession()
  const desktop = window.erp.kind === 'desktop'
  const { data, error, loading, reload } = useQuery<any>('settings.get')
  const { data: secrets, reload: reloadSecrets } = useQuery<any>('settings.secrets')
  const f = useForm<any>({})
  const [tab, setTab] = useState<SettingsTab>('societe')
  const [showDb, setShowDb] = useState(false)
  const [smtpPassword, setSmtpPassword] = useState('')
  const [smsSecret, setSmsSecret] = useState('')
  const [drawSig, setDrawSig] = useState(false)
  useEffect(() => {
    if (data) f.setValues({ ...data, default_tva: String(data.default_tva), payment_terms: String(data.payment_terms), smtp_port: String(data.smtp_port) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])
  if (error) return <ErrorBox error={error} onRetry={reload} />
  if ((loading && !data) || (!f.values.name && f.values.name !== '')) return <Loading />
  const v = f.values
  const save = async () => {
    const r = await run(async () => {
      await api('settings.save', { ...v, default_tva: Number(v.default_tva), payment_terms: Number(v.payment_terms), smtp_port: Number(v.smtp_port) || 587 })
      const sec: any = {}
      if (smtpPassword) sec.smtp_password = smtpPassword
      if (smsSecret) sec.sms_secret = smsSecret
      if (Object.keys(sec).length) await api('settings.saveSecrets', sec)
      return true
    }, 'Paramètres enregistrés.')
    if (r) {
      setSmtpPassword('')
      setSmsSecret('')
      reloadSecrets()
      refreshCompany()
    }
  }
  const pick = async (key: string) => {
    const img = await run(() => unwrap(window.erp.pickImage()))
    if (img) f.set(key, img)
  }
  const test = async (channel: 'email' | 'sms') => {
    const to = channel === 'email' ? v.smtp_from_email || v.email : v.phone
    if (!to) return notify(channel === 'email' ? "Renseignez d'abord une adresse d'expédition." : "Renseignez d'abord le téléphone de la société (onglet Société).", 'error')
    await save()
    await run(() => api('messages.test', { channel, to }), channel === 'email' ? `E-mail d'essai envoyé à ${to}.` : `SMS d'essai envoyé au ${to}.`)
  }
  const ImageField = ({ k, label, hint }: { k: string; label: string; hint: string }) => (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="logo-box" onClick={() => pick(k)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && pick(k)}>
        {v[k] ? <img src={v[k]} alt={label} /> : <span className="muted small">{hint}</span>}
      </div>
      {v[k] && <button className="link-btn danger small" onClick={() => f.set(k, '')}>Retirer</button>}
    </div>
  )

  return (
    <div className="page">
      <PageHeader title="Société & paramètres" subtitle="Identité, modèles de documents, messagerie et SMS." actions={<button className="btn btn-primary" onClick={save}>Enregistrer</button>} />
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'societe', label: 'Société' },
        { value: 'documents', label: 'Documents & signature' },
        { value: 'mail', label: 'Messagerie' },
        { value: 'sms', label: 'SMS' },
        { value: 'donnees', label: 'Données' }
      ]} />

      {tab === 'societe' && (
        <div className="tab-panel" key="societe">
          <div className="card">
            <h3>Identité</h3>
            <div className="grid grid-4">
              <div className="field span-1 logo-field">
                <span className="field-label">Logo</span>
                <div className="logo-box" onClick={() => pick('logo')} role="button" tabIndex={0}>
                  {v.logo ? <img src={v.logo} alt="Logo" /> : <span className="muted small">Cliquer pour choisir</span>}
                </div>
                {v.logo && <button className="link-btn danger small" onClick={() => f.set('logo', '')}>Retirer</button>}
              </div>
              <div className="span-3 grid grid-3">
                <Field label="Raison sociale"><input {...f.bind('name')} /></Field>
                <Field label="Forme juridique"><input {...f.bind('legal_form')} /></Field>
                <Field label="Capital social"><input {...f.bind('capital')} placeholder="1 000 000 FCFA" /></Field>
                <Field label="Activité (sous le nom)" span={3}><input {...f.bind('activity')} placeholder="Intégration informatique, réseaux, sécurité électronique…" /></Field>
              </div>
              <Field label="Adresse" span={2}><textarea rows={2} {...f.bind('address')} /></Field>
              <Field label="Ville"><input {...f.bind('city')} /></Field>
              <Field label="Pays"><input {...f.bind('country')} /></Field>
              <Field label="Téléphone"><input type="tel" {...f.bind('phone')} /></Field>
              <Field label="Email"><input type="email" {...f.bind('email')} /></Field>
              <Field label="Site web" span={2}><input {...f.bind('website')} /></Field>
            </div>
          </div>
          <div className="card">
            <h3>Mentions légales & banque</h3>
            <div className="grid grid-4">
              <Field label="RCCM"><input {...f.bind('rccm')} /></Field>
              <Field label="Libellé identifiant fiscal">
                <select {...f.bind('tax_id_label')}>{TAX_ID_LABELS.map((l) => <option key={l}>{l}</option>)}</select>
              </Field>
              <Field label={`N° ${v.tax_id_label ?? 'IFU'}`} span={2}><input {...f.bind('tax_id')} /></Field>
              <Field label="Régime fiscal" span={2}>
                <select {...f.bind('regime_fiscal')}>{REGIMES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select>
              </Field>
              <Field label="Service des impôts de rattachement" span={2}><input {...f.bind('division_fiscale')} placeholder="DGE, DME Centre, CME Ouaga…" /></Field>
              <Field label="Banque"><input {...f.bind('bank_name')} /></Field>
              <Field label="RIB / IBAN" span={3}><input {...f.bind('bank_account')} /></Field>
            </div>
          </div>
          <div className="card">
            <h3>Règles de gestion</h3>
            <div className="grid grid-4">
              <Field label="TVA par défaut (%)"><input inputMode="decimal" {...f.bind('default_tva')} /></Field>
              <Field label="Délai de paiement par défaut (jours)"><input inputMode="numeric" {...f.bind('payment_terms')} /></Field>
              <Field label="Devise"><input {...f.bind('currency')} /></Field>
              <label className="inline check" style={{ alignSelf: 'end' }}>
                <input type="checkbox" checked={!!v.allow_negative_stock} onChange={(e) => f.set('allow_negative_stock', e.target.checked)} /> Autoriser le stock négatif
              </label>
            </div>
          </div>
        </div>
      )}

      {tab === 'documents' && (
        <div className="tab-panel" key="documents">
          <div className="card">
            <h3>Modèle des documents</h3>
            <div className="grid grid-2">
              <div className="field">
                <span className="field-label">Mise en page</span>
                <div className="choice-row">
                  {(['moderne', 'classique'] as const).map((l) => (
                    <label key={l} className={`choice ${v.doc_layout === l ? 'active' : ''}`}>
                      <input type="radio" checked={v.doc_layout === l} onChange={() => f.set('doc_layout', l)} />
                      <div><strong>{l === 'moderne' ? 'Moderne' : 'Classique'}</strong><div className="muted small">{l === 'moderne' ? 'Bandeau et en-têtes en couleur.' : 'Sobre, en-têtes gris anthracite.'}</div></div>
                    </label>
                  ))}
                </div>
              </div>
              <div className="field">
                <span className="field-label">Couleur principale</span>
                <div className="swatches" role="radiogroup" aria-label="Couleur des documents">
                  {DOC_COLORS.map((c) => (
                    <button key={c} type="button" role="radio" aria-checked={v.doc_color === c} aria-label={c} className={`swatch ${v.doc_color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => f.set('doc_color', c)} />
                  ))}
                  <input type="color" aria-label="Couleur personnalisée" value={v.doc_color || '#1d6fd6'} onChange={(e) => f.set('doc_color', e.target.value)} />
                </div>
              </div>
              <Field label="Pied de page des documents de vente" span={2}><input {...f.bind('invoice_footer')} /></Field>
              <Field label="Conditions générales (imprimées en bas des documents de vente)" span={2} hint="Pénalités de retard, garantie, réserve de propriété…">
                <textarea rows={4} {...f.bind('doc_terms')} />
              </Field>
            </div>
          </div>
          <div className="card">
            <h3>Cachet et signature de la société</h3>
            <div className="grid grid-4">
              <ImageField k="stamp" label="Cachet (PNG transparent)" hint="Choisir le cachet" />
              <div className="field">
                <span className="field-label">Signature du responsable</span>
                <div className="logo-box" onClick={() => setDrawSig(true)} role="button" tabIndex={0}>
                  {v.signature_image ? <img src={v.signature_image} alt="Signature" /> : <span className="muted small">Dessiner la signature</span>}
                </div>
                <div className="row gap">
                  <button className="link-btn small" onClick={() => pick('signature_image')}>Importer une image</button>
                  {v.signature_image && <button className="link-btn danger small" onClick={() => f.set('signature_image', '')}>Retirer</button>}
                </div>
              </div>
              <Field label="Nom du signataire"><input {...f.bind('signatory_name')} placeholder={user.full_name} /></Field>
              <Field label="Qualité"><input {...f.bind('signatory_title')} placeholder="Le Directeur Général" /></Field>
            </div>
            <label className="inline check" style={{ marginTop: 12 }}>
              <input type="checkbox" checked={!!v.doc_show_stamp} onChange={(e) => f.set('doc_show_stamp', e.target.checked)} /> Apposer le cachet et la signature sur les documents de vente validés
            </label>
          </div>
          <div className="card">
            <h3>Signature électronique des clients</h3>
            <Field label="Adresse publique du serveur" hint={dbMode === 'remote' ? `Laisser vide pour utiliser ${serverUrl}.` : 'Nécessaire pour envoyer des liens de signature (ex. https://facturation.iam.bf).'}>
              <input {...f.bind('public_url')} placeholder="https://facturation.iam.bf" inputMode="url" />
            </Field>
          </div>
        </div>
      )}

      {tab === 'mail' && (
        <div className="tab-panel" key="mail">
          <div className="card">
            <h3>Serveur d'envoi (SMTP)</h3>
            <p className="muted small">Gmail : smtp.gmail.com, port 587, avec un « mot de passe d'application ». Office 365 : smtp.office365.com, port 587.</p>
            <div className="grid grid-4">
              <Field label="Serveur SMTP" span={2}><input {...f.bind('smtp_host')} placeholder="smtp.gmail.com" autoCapitalize="off" /></Field>
              <Field label="Port"><input inputMode="numeric" {...f.bind('smtp_port')} /></Field>
              <label className="inline check" style={{ alignSelf: 'end' }}>
                <input type="checkbox" checked={!!v.smtp_secure} onChange={(e) => f.set('smtp_secure', e.target.checked)} /> SSL direct (port 465)
              </label>
              <Field label="Identifiant" span={2}><input {...f.bind('smtp_user')} autoComplete="off" autoCapitalize="off" /></Field>
              <Field label="Mot de passe" span={2} hint={secrets?.smtp_password ? 'Enregistré. Laisser vide pour le conserver.' : 'Non renseigné.'}>
                <input type="password" value={smtpPassword} onChange={(e) => setSmtpPassword(e.target.value)} autoComplete="new-password" />
              </Field>
              <Field label="Nom de l'expéditeur" span={2}><input {...f.bind('smtp_from_name')} placeholder={v.name} /></Field>
              <Field label="Adresse de l'expéditeur" span={2}><input type="email" {...f.bind('smtp_from_email')} placeholder="facturation@iam.bf" /></Field>
            </div>
            <div className="form-actions"><button className="btn" onClick={() => test('email')}>Envoyer un e-mail d'essai</button></div>
          </div>
        </div>
      )}

      {tab === 'sms' && (
        <div className="tab-panel" key="sms">
          <div className="card">
            <h3>Fournisseur SMS</h3>
            <div className="grid grid-4">
              <Field label="Fournisseur" span={2}>
                <select {...f.bind('sms_provider')}>
                  <option value="">Désactivé</option>
                  <option value="orange">Orange (API SMS Orange Developer)</option>
                  <option value="twilio">Twilio</option>
                  <option value="http">Autre passerelle (URL HTTP)</option>
                </select>
              </Field>
              {v.sms_provider && (
                <Field label={v.sms_provider === 'orange' ? 'Numéro expéditeur (tel:+226…)' : v.sms_provider === 'twilio' ? 'Numéro Twilio (+1…)' : 'Nom expéditeur'} span={2}>
                  <input {...f.bind('sms_sender')} placeholder={v.sms_provider === 'orange' ? 'tel:+22600000000' : v.sms_provider === 'twilio' ? '+15550000000' : 'IAM'} />
                </Field>
              )}
              {(v.sms_provider === 'orange' || v.sms_provider === 'twilio') && (
                <Field label={v.sms_provider === 'orange' ? 'Client ID' : 'Account SID'} span={2}><input {...f.bind('sms_account')} autoComplete="off" /></Field>
              )}
              {v.sms_provider === 'http' && (
                <Field label="URL de la passerelle" span={4} hint="Variables : {to} numéro, {message} texte, {sender} expéditeur, {key} clé secrète.">
                  <input {...f.bind('sms_http_url')} placeholder="https://api.passerelle.bf/send?to={to}&text={message}&key={key}" />
                </Field>
              )}
              {v.sms_provider && (
                <Field label={v.sms_provider === 'orange' ? 'Client secret' : v.sms_provider === 'twilio' ? 'Auth token' : 'Clé secrète'} span={2} hint={secrets?.sms_secret ? 'Enregistrée. Laisser vide pour la conserver.' : 'Non renseignée.'}>
                  <input type="password" value={smsSecret} onChange={(e) => setSmsSecret(e.target.value)} autoComplete="new-password" />
                </Field>
              )}
            </div>
            {v.sms_provider && <div className="form-actions"><button className="btn" onClick={() => test('sms')}>Envoyer un SMS d'essai au {v.phone || '…'}</button></div>}
          </div>
        </div>
      )}

      {tab === 'donnees' && (
        <div className="tab-panel" key="donnees">
          <div className="card">
            <h3>Données</h3>
            <p className="muted">Données : <strong>{DATA_TEXT[dbMode]}</strong>{serverUrl ? <> — {serverUrl}</> : null}.</p>
            <div className="row gap wrap">
              {desktop && dbMode === 'local' && (
                <>
                  <button className="btn" onClick={() => run(async () => { const r = await unwrap(window.erp.backup()); if (r) notify('Sauvegarde créée : ' + r, 'success') })}>Créer une sauvegarde</button>
                  <button className="btn" onClick={() => run(() => unwrap(window.erp.restore()))}>Restaurer une sauvegarde…</button>
                </>
              )}
              <button className="btn" onClick={() => setShowDb(true)}>{desktop ? 'Emplacement des données…' : 'Changer de serveur…'}</button>
            </div>
            <p className="muted small">
              {dbMode === 'local'
                ? 'Conseil : faites une sauvegarde chaque semaine sur une clé USB ou un disque externe.'
                : 'Les sauvegardes se font sur le serveur (pg_dump) : voir le guide de déploiement.'}
            </p>
          </div>
        </div>
      )}
      {showDb && <Modal title={desktop ? 'Emplacement des données' : 'Serveur IAM INVOICER'} onClose={() => setShowDb(false)} wide><DbConfigForm /></Modal>}
      {drawSig && (
        <SignatureModal
          title="Signature du responsable"
          name={v.signatory_name || user.full_name}
          onClose={() => setDrawSig(false)}
          onDone={(png) => {
            f.set('signature_image', png)
            setDrawSig(false)
          }}
        />
      )}
    </div>
  )
}

/** Fenêtre de signature réutilisable (responsable, client sur place). */
export function SignatureModal({ title, name, onClose, onDone, askName = false }: { title: string; name?: string; onClose: () => void; onDone: (png: string, name: string) => void; askName?: boolean }) {
  const [png, setPng] = useState<string | null>(null)
  const [signer, setSigner] = useState(name ?? '')
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Annuler</button>
      <button className="btn btn-primary" disabled={!png || (askName && signer.trim().length < 2)} onClick={() => png && onDone(png, signer.trim())}>Valider la signature</button>
    </>}>
      {askName && <Field label="Nom et prénom du signataire"><input autoFocus value={signer} onChange={(e) => setSigner(e.target.value)} autoComplete="name" /></Field>}
      <SignaturePad onChange={setPng} typedName={signer} />
    </Modal>
  )
}

export function Users() {
  const { data, error, loading, reload } = useQuery<any[]>('users.list')
  const [editing, setEditing] = useState<any | null>(null)
  return (
    <div className="page">
      <PageHeader title="Utilisateurs" actions={<button className="btn btn-primary" onClick={() => setEditing({ role: 'commercial' })}>Nouvel utilisateur</button>} />
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Loading /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Nom</th><th>Identifiant</th><th>Rôle</th><th>Statut</th><th /></tr></thead>
            <tbody>
              {data!.map((u) => (
                <tr key={u.id} className={`clickable ${u.active ? '' : 'inactive'}`} onClick={() => setEditing(u)}>
                  <td className="strong">{u.full_name}</td><td>{u.username}</td><td>{ROLE_LABELS[u.role as Role]}</td>
                  <td>{u.active ? 'Actif' : 'Désactivé'}</td><td className="num"><button className="link-btn">Modifier</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="card">
        <h3>Droits par rôle</h3>
        <table className="table compact">
          <thead><tr><th>Rôle</th><th>Accès</th></tr></thead>
          <tbody>
            {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
              <tr key={r}><td className="strong">{ROLE_LABELS[r]}</td><td>{PERMISSIONS[r].map((m) => MODULE_LABELS[m]).join(', ')}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <UserForm user={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </div>
  )
}

function UserForm({ user, onClose, onSaved }: { user: any; onClose: () => void; onSaved: () => void }) {
  const f = useForm<any>({ username: '', full_name: '', active: true, ...user, password: '' })
  const submit = async () => {
    const r = await run(() => api('users.save', { ...f.values, password: f.values.password || undefined }), 'Utilisateur enregistré.')
    if (r) onSaved()
  }
  return (
    <Modal title={user.id ? `Modifier ${user.full_name}` : 'Nouvel utilisateur'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" onClick={submit}>Enregistrer</button></>}>
      <div className="grid grid-2">
        <Field label="Nom complet"><input autoFocus {...f.bind('full_name')} /></Field>
        <Field label="Identifiant de connexion"><input {...f.bind('username')} /></Field>
        <Field label="Rôle">
          <select {...f.bind('role')}>{(Object.keys(ROLE_LABELS) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select>
        </Field>
        <Field label={user.id ? 'Nouveau mot de passe (facultatif)' : 'Mot de passe'}><input type="password" {...f.bind('password')} /></Field>
      </div>
      {user.id && <label className="inline check"><input type="checkbox" checked={!!f.values.active} onChange={(e) => f.set('active', e.target.checked)} /> Compte actif</label>}
    </Modal>
  )
}

const ACTION_LABELS: Record<string, string> = {
  creation: 'Création', modification: 'Modification', suppression: 'Suppression', validation: 'Validation', annulation: 'Annulation',
  paiement: 'Paiement', connexion: 'Connexion', inventaire: 'Inventaire', ajustement: 'Ajustement de stock'
}

export function AuditLog() {
  const { data, error, loading, reload } = useQuery<any[]>('reports.audit', { limit: 500 })
  return (
    <div className="page">
      <PageHeader title="Journal d'activité" subtitle="500 dernières actions" />
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Loading /> : !data!.length ? <Empty>Aucune activité.</Empty> : (
        <div className="table-wrap">
          <table className="table compact">
            <thead><tr><th>Date</th><th>Utilisateur</th><th>Action</th><th>Objet</th><th>Détail</th></tr></thead>
            <tbody>
              {data!.map((a) => (
                <tr key={a.id}>
                  <td>{new Date(a.created_at).toLocaleString('fr-FR')}</td><td>{a.user_name}</td>
                  <td>{ACTION_LABELS[a.action] ?? a.action}</td><td>{a.entity}{a.entity_id ? ` #${a.entity_id}` : ''}</td><td className="muted">{a.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function MyAccount() {
  const { user } = useSession()
  const f = useForm({ current: '', next: '', confirm: '' })
  const submit = async () => {
    if (f.values.next !== f.values.confirm) return notify('Les deux mots de passe ne correspondent pas.', 'error')
    if (!(await confirmDialog('Changer votre mot de passe ?'))) return
    const r = await run(() => api('auth.changePassword', { current: f.values.current, next: f.values.next }), 'Mot de passe modifié.')
    if (r) f.setValues({ current: '', next: '', confirm: '' })
  }
  return (
    <div className="page">
      <PageHeader title="Mon compte" subtitle={`${user.full_name} · ${user.username} · ${ROLE_LABELS[user.role]}`} />
      <div className="card narrow">
        <h3>Changer mon mot de passe</h3>
        <div className="stack">
          <Field label="Mot de passe actuel"><input type="password" {...f.bind('current')} /></Field>
          <Field label="Nouveau mot de passe"><input type="password" {...f.bind('next')} /></Field>
          <Field label="Confirmation"><input type="password" {...f.bind('confirm')} /></Field>
          <div className="form-actions"><button className="btn btn-primary" onClick={submit}>Modifier</button></div>
        </div>
      </div>
    </div>
  )
}
