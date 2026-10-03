import { useEffect, useState } from 'react'
import { formatDate } from '@shared/format'
import { ROLE_LABELS, PERMISSIONS, type Role } from '@shared/domain'
import { api, run, unwrap, useQuery } from '../api'
import { confirmDialog, Empty, ErrorBox, Field, Loading, Modal, notify, PageHeader, RowActions, Tabs, useForm } from '../components/ui'
import { ArrowCounterClockwise, ArrowsClockwise, CloudArrowDown, CloudCheck, CloudSlash, Database, PencilSimple, Prohibit, Trash, UsersThree, UserCheck, ShieldCheck, CashRegister } from '@phosphor-icons/react'
import { SignaturePad } from '../components/SignaturePad'
import { UserAvatar } from '../components/Topbar'
import { DbConfigForm } from './Auth'
import { CountryField, FiscalFields, ImagePicker } from '../components/CompanyFields'
import { TaxSettings } from '../components/TaxSettings'
import { KpiStrip } from '../components/KpiStrip'
import { useSession } from '../session'

const MODULE_LABELS: Record<string, string> = {
  dashboard: 'Tableau de bord', sales: 'Ventes', purchases: 'Achats', stock: 'Stock', payments: 'Paiements', clients: 'Clients',
  suppliers: 'Fournisseurs', products: 'Articles', reports: 'Rapports', cash: 'Caisse', accounting: 'Comptabilité',
  messages: 'Communications', hr: 'RH et paie', crm: 'CRM', projects: 'Projets', assets: 'Immobilisations', budget: 'Budgets et trésorerie',
  settings: 'Paramètres', users: 'Utilisateurs'
}

const DATA_TEXT: Record<DataMode, string> = {
  local: 'sur ce poste',
  server: 'serveur PostgreSQL du réseau local',
  remote: 'serveur en ligne'
}

type SettingsTab = 'societe' | 'taxes' | 'documents' | 'mail' | 'sms' | 'secef' | 'donnees'

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
  const [secefToken, setSecefToken] = useState('')
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
      await api('settings.save', { ...v, doc_margin_top: Number(v.doc_margin_top) || 14, doc_margin_side: Number(v.doc_margin_side) || 14, doc_margin_bottom: Number(v.doc_margin_bottom) || 22, default_tva: Number(String(v.default_tva).replace(',', '.')), payment_terms: Number(v.payment_terms), smtp_port: Number(v.smtp_port) || 587 })
      const sec: any = {}
      if (smtpPassword) sec.smtp_password = smtpPassword
      if (smsSecret) sec.sms_secret = smsSecret
      if (secefToken) sec.secef_token = secefToken
      if (Object.keys(sec).length) await api('settings.saveSecrets', sec)
      return true
    }, 'Paramètres enregistrés.')
    if (r) {
      setSmtpPassword('')
      setSmsSecret('')
      setSecefToken('')
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
        { value: 'taxes', label: 'Taxes' },
        { value: 'documents', label: 'Documents & signature' },
        { value: 'mail', label: 'Messagerie' },
        { value: 'sms', label: 'SMS' },
        { value: 'secef', label: 'Facture certifiée' },
        { value: 'donnees', label: 'Données' }
      ]} />

      {tab === 'societe' && (
        <div className="tab-panel" key="societe">
          <div className="card">
            <h3>Identité</h3>
            <div className="grid grid-4">
              <div className="span-1"><ImagePicker value={v.logo} onChange={(img) => f.set('logo', img)} label="Logo" /></div>
              <div className="span-3 grid grid-3">
                <Field label="Raison sociale"><input {...f.bind('name')} /></Field>
                <Field label="Forme juridique"><input {...f.bind('legal_form')} /></Field>
                <Field label="Capital social"><input {...f.bind('capital')} placeholder="1 000 000 FCFA" /></Field>
                <Field label="Activité (sous le nom)" span={3}><input {...f.bind('activity')} placeholder="Intégration informatique, réseaux, sécurité électronique…" /></Field>
              </div>
              <Field label="Adresse" span={2}><textarea rows={2} {...f.bind('address')} /></Field>
              <Field label="Ville"><input {...f.bind('city')} /></Field>
              <CountryField f={f} />
              <Field label="Téléphone"><input type="tel" {...f.bind('phone')} /></Field>
              <Field label="Email"><input type="email" {...f.bind('email')} /></Field>
              <Field label="Site web" span={2}><input {...f.bind('website')} /></Field>
            </div>
          </div>
          <div className="card">
            <h3>Mentions légales & banque</h3>
            <div className="grid grid-4">
              <FiscalFields f={f} />
              <Field label="Banque"><input {...f.bind('bank_name')} /></Field>
              <Field label="RIB / IBAN" span={3}><input {...f.bind('bank_account')} /></Field>
            </div>
          </div>
          <div className="card">
            <h3>Règles de gestion</h3>
            <div className="grid grid-4">
              <Field label="Délai de paiement par défaut (jours)"><input inputMode="numeric" {...f.bind('payment_terms')} /></Field>
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
            <h3>Mise en page et impression</h3>
            <div className="grid grid-4">
              <Field label="Marge haute (mm)"><input type="number" min={5} max={40} {...f.bind('doc_margin_top')} /></Field>
              <Field label="Marges gauche et droite (mm)"><input type="number" min={5} max={40} {...f.bind('doc_margin_side')} /></Field>
              <Field label="Marge basse (mm)" hint="Contient le pied de page et le numéro de page"><input type="number" min={12} max={40} {...f.bind('doc_margin_bottom')} /></Field>
              <label className="inline check" style={{ alignSelf: 'end' }}>
                <input type="checkbox" checked={v.doc_line_numbers !== false} onChange={(e) => f.set('doc_line_numbers', e.target.checked)} /> Numéroter les lignes (N°)
              </label>
            </div>
            <p className="muted small">Sur chaque page : en-tête du tableau répété, mentions légales et « Page X / Y » en bas. Les lignes, les totaux et les signatures ne sont jamais coupés entre deux pages.</p>
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

      {tab === 'taxes' && <div className="tab-panel" key="taxes"><TaxSettings /></div>}

      {tab === 'secef' && (
        <div className="tab-panel" key="secef">
          <div className="card">
            <h3>Facture électronique certifiée (SECeF — DGI)</h3>
            <p className="muted">À la validation, chaque facture et chaque avoir est transmis au système de certification. Le code, le compteur et le QR code renvoyés sont imprimés sur le document.</p>
            <div className="choice-row three" style={{ margin: '12px 0' }}>
              {([['', 'Désactivée', 'Factures non certifiées.'], ['simulation', 'Simulation', 'Codes fictifs marqués « non valable », pour tester le circuit.'], ['api', 'Connexion à la DGI', 'Certification réelle avec vos identifiants SECeF.']] as const).map(([val, title, text]) => (
                <label key={val} className={`choice ${(v.secef_mode ?? '') === val ? 'active' : ''}`}>
                  <input type="radio" checked={(v.secef_mode ?? '') === val} onChange={() => f.set('secef_mode', val)} />
                  <div><strong>{title}</strong><div className="muted small">{text}</div></div>
                </label>
              ))}
            </div>
            {v.secef_mode && (
              <div className="grid grid-4">
                <Field label="NIM (identifiant de la machine)"><input {...f.bind('secef_nim')} /></Field>
                {v.secef_mode === 'api' && <Field label="Adresse de l'API" span={2}><input {...f.bind('secef_url')} placeholder="https://…" inputMode="url" /></Field>}
                {v.secef_mode === 'api' && (
                  <Field label="Jeton d'accès" hint={secrets?.secef_token ? 'Enregistré. Laisser vide pour le conserver.' : 'Non renseigné.'}>
                    <input type="password" value={secefToken} onChange={(e) => setSecefToken(e.target.value)} autoComplete="new-password" />
                  </Field>
                )}
              </div>
            )}
            {v.secef_mode === 'api' && <div className="info-box" style={{ marginTop: 14 }}><span>Le connecteur suit le modèle des API e-MCF (envoi puis confirmation). <strong>Faites valider le format exact avec la documentation remise par la DGI</strong> avant la mise en production. Sans certification, la validation d'une facture est refusée.</span></div>}
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
          {desktop && dbMode === 'remote' && <LocalSyncCard />}
          {desktop && dbMode === 'local' && window.erp.backupAuto && <AutoBackupCard />}
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
      {data && <KpiStrip items={[
        { label: 'Comptes', value: data.length, icon: UsersThree },
        { label: 'Actifs', value: data.filter((u) => u.active).length, icon: UserCheck, tone: 'good' },
        { label: 'Administrateurs', value: data.filter((u) => u.active && u.role === 'admin').length, icon: ShieldCheck },
        { label: 'Caissiers', value: data.filter((u) => u.active && u.role === 'caissier').length, icon: CashRegister }
      ]} />}
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Loading /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Nom</th><th>Identifiant</th><th>Rôle</th><th>Statut</th><th className="actions-col">Actions</th></tr></thead>
            <tbody>
              {data!.map((u) => (
                <tr key={u.id} className={`clickable ${u.active ? '' : 'inactive'}`} onClick={() => setEditing(u)}>
                  <td className="strong"><span className="who"><UserAvatar name={u.full_name} size={32} photo={u.avatar} ring={false} />{u.full_name}</span></td><td>{u.username}</td><td>{ROLE_LABELS[u.role as Role]}</td>
                  <td>{u.active ? 'Actif' : 'Désactivé'}</td>
                  <td className="actions-col">
                    <RowActions actions={[
                      { label: 'Modifier', icon: PencilSimple, tone: 'primary', onClick: () => setEditing(u) },
                      u.active
                        ? {
                            label: 'Désactiver', icon: Prohibit, tone: 'danger',
                            onClick: async () => {
                              if (await confirmDialog(`Désactiver le compte de ${u.full_name} ?`, { detail: 'Ses sessions ouvertes sont fermées immédiatement. Son historique est conservé.', danger: true }))
                                if (await run(() => api('users.save', { id: u.id, username: u.username, full_name: u.full_name, role: u.role, active: false }), 'Compte désactivé.')) reload()
                            }
                          }
                        : { label: 'Réactiver', icon: ArrowCounterClockwise, tone: 'warning', onClick: async () => { if (await run(() => api('users.save', { id: u.id, username: u.username, full_name: u.full_name, role: u.role, active: true }), 'Compte réactivé.')) reload() } }
                    ]} />
                  </td>
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

/** Réduit une image à un carré de 256 px (recadrage centré), en JPEG. */
async function squareImage(dataUrl: string, size = 256): Promise<string> {
  const img = new Image()
  img.src = dataUrl
  await img.decode()
  const side = Math.min(img.naturalWidth, img.naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')!
  g.fillStyle = '#fff'
  g.fillRect(0, 0, size, size)
  g.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size)
  return canvas.toDataURL('image/jpeg', 0.86)
}

export function MyAccount() {
  const { user, updateUser } = useSession()
  const choosePhoto = async () => {
    const picked = await run(() => unwrap(window.erp.pickImage()))
    if (!picked) return
    const avatar = await squareImage(picked)
    if (await run(() => api('auth.setAvatar', { avatar }), 'Photo de profil enregistrée.')) updateUser({ avatar })
  }
  const removePhoto = async () => {
    if (await run(() => api('auth.setAvatar', { avatar: '' }), 'Photo retirée.')) updateUser({ avatar: '' })
  }
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
      <div className="card narrow profile-card">
        <h3>Photo de profil</h3>
        <div className="profile-photo">
          <UserAvatar name={user.full_name} size={96} photo={user.avatar} ring={false} />
          <div className="stack">
            <button className="btn btn-primary" onClick={choosePhoto}>{user.avatar ? 'Changer la photo' : 'Ajouter une photo'}</button>
            {user.avatar && <button className="btn btn-ghost" onClick={removePhoto}>Retirer la photo</button>}
            <span className="muted small">PNG ou JPG ; l'image est recadrée et réduite automatiquement.</span>
          </div>
        </div>
      </div>
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

/** Ordinateur relié au serveur en ligne : état de la base locale et de la synchronisation. */
function LocalSyncCard() {
  const off = window.erp.offline
  const [, refresh] = useState(0)
  const [busy, setBusy] = useState<'' | 'sync' | 'load'>('')
  useEffect(() => {
    const on = () => refresh((n) => n + 1)
    window.addEventListener('iam-offline', on)
    return () => window.removeEventListener('iam-offline', on)
  }, [])
  const st = off?.state?.()
  if (!off || !st) return null
  const when = (iso: string | null) => (iso ? `${formatDate(iso.slice(0, 10))} à ${iso.slice(11, 16)}` : 'jamais')
  const size = st.localBytes > 1_048_576 ? `${(st.localBytes / 1_048_576).toFixed(1)} Mo` : `${Math.max(1, Math.round(st.localBytes / 1024))} Ko`
  const sync = async () => {
    setBusy('sync')
    const r = await off.sync()
    setBusy('')
    notify(r.sent ? `${r.sent} saisie(s) envoyée(s).` : off.pending() ? "Serveur injoignable : nouvel essai automatique dans 30 secondes." : 'Tout est à jour.', r.sent || !off.pending() ? 'success' : 'info')
  }
  const load = async () => {
    setBusy('load')
    const n = await run(() => unwrap(off.prefetch!()))
    setBusy('')
    if (n !== undefined) notify(`Base locale mise à jour (${n} jeux de données).`, 'success')
  }
  return (
    <div className="card sync-card">
      <h3>Base locale de ce poste</h3>
      <p className="muted">
        Cet ordinateur garde une copie des données de travail (articles, clients, documents récents, caisse…) et continue de fonctionner sans Internet.
        Les ventes, règlements, temps passés, congés et fiches clients saisis hors connexion partent automatiquement vers le serveur au retour du réseau, sans doublon.
      </p>
      <div className="sync-grid">
        <div className={`sync-stat ${st.reachable ? 'ok' : 'down'}`}>
          {st.reachable ? <CloudCheck size={26} weight="duotone" aria-hidden="true" /> : <CloudSlash size={26} weight="duotone" aria-hidden="true" />}
          <span>Serveur</span><strong>{st.reachable ? 'Connecté' : 'Injoignable'}</strong>
        </div>
        <div className={`sync-stat ${st.pending ? 'warn' : 'ok'}`}>
          <ArrowsClockwise size={26} weight="duotone" aria-hidden="true" />
          <span>Saisies en attente</span><strong>{st.pending}</strong>
        </div>
        <div className="sync-stat">
          <CloudArrowDown size={26} weight="duotone" aria-hidden="true" />
          <span>Données préchargées</span><strong>{when(st.lastPrefetch)}</strong>
        </div>
        <div className="sync-stat">
          <Database size={26} weight="duotone" aria-hidden="true" />
          <span>Taille locale</span><strong>{size}</strong>
        </div>
      </div>
      <p className="muted small">Dernier envoi complet : {when(st.lastSync)}.{st.needsLogin ? ' Session expirée : reconnectez-vous pour envoyer les saisies en attente.' : ''}</p>
      {st.failed.length > 0 && (
        <div className="info-box warn-box"><span>{st.failed.length} saisie(s) refusée(s) par le serveur : {st.failed.slice(0, 3).map((f) => `${f.name} (${f.error})`).join(' ; ')}.</span></div>
      )}
      <div className="row gap wrap">
        <button className="btn btn-primary" disabled={!!busy} onClick={sync}><ArrowsClockwise size={18} aria-hidden="true" className={busy === 'sync' ? 'spin' : ''} />Synchroniser maintenant</button>
        <button className="btn" disabled={!!busy || !st.reachable} onClick={load}><CloudArrowDown size={18} aria-hidden="true" />{busy === 'load' ? 'Chargement…' : 'Mettre à jour la base locale'}</button>
        <button
          className="btn btn-ghost"
          disabled={!!busy}
          onClick={async () => {
            if (await confirmDialog('Vider les données gardées sur ce poste ?', { detail: 'Les saisies en attente sont conservées. Sans réseau, les écrans resteront vides jusqu’au prochain chargement.' })) await off.clearCache!()
          }}
        ><Trash size={18} aria-hidden="true" />Vider les données locales</button>
      </div>
    </div>
  )
}

/** Base de ce poste : sauvegardes automatiques quotidiennes dans un dossier au choix. */
function AutoBackupCard() {
  const api2 = window.erp.backupAuto!
  const [st, setSt] = useState<any | null>(null)
  const [busy, setBusy] = useState(false)
  const load = () => api2.get().then((r) => r.ok && setSt(r.data))
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (!st) return null
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : 'jamais')
  const size = (b: number) => (b > 1_048_576 ? `${(b / 1_048_576).toFixed(1)} Mo` : `${Math.max(1, Math.round(b / 1024))} Ko`)
  return (
    <div className="card">
      <h3>Sauvegardes automatiques</h3>
      <p className="muted">
        Une sauvegarde complète chaque jour (et au démarrage si la dernière date de plus de 24 h). Choisissez de préférence un dossier
        <strong> Google Drive, OneDrive ou Dropbox</strong> : vous aurez ainsi une copie hors de cet ordinateur. Seules des copies y sont déposées ; la base de travail reste sur le poste.
      </p>
      <div className="grid grid-4">
        <Field label="Dossier" span={2}><div className="readonly mono" style={{ overflowWrap: 'anywhere' }}>{st.dir}</div></Field>
        <Field label="Sauvegardes conservées"><input type="number" min={1} max={365} defaultValue={st.keep} onBlur={async (e) => { await run(() => unwrap(api2.set({ keep: Number(e.target.value) }))); load() }} /></Field>
        <label className="inline check" style={{ alignSelf: 'end' }}><input type="checkbox" checked={st.enabled} onChange={async (e) => { await run(() => unwrap(api2.set({ enabled: e.target.checked }))); load() }} /> Activées</label>
      </div>
      <p className="muted small">Dernière sauvegarde : {when(st.last)}.{st.lastError ? ` Dernière erreur : ${st.lastError}` : ''}</p>
      <div className="row gap wrap">
        <button className="btn" onClick={async () => { if (await run(() => unwrap(api2.chooseDir()))) load() }}>Choisir le dossier…</button>
        <button className="btn btn-primary" disabled={busy} onClick={async () => { setBusy(true); const f = await run(() => unwrap(api2.now()), 'Sauvegarde effectuée.'); setBusy(false); if (f !== undefined) load() }}>{busy ? 'Sauvegarde…' : 'Sauvegarder maintenant'}</button>
      </div>
      {st.files.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table className="table compact">
            <thead><tr><th>Sauvegarde</th><th>Date</th><th className="num">Taille</th></tr></thead>
            <tbody>{st.files.slice(0, 8).map((f: any) => <tr key={f.name}><td className="mono">{f.name}</td><td>{when(f.date)}</td><td className="num">{size(f.size)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      <p className="muted small">Pour restaurer : bouton « Restaurer une sauvegarde… » ci-dessus, puis choisir un de ces fichiers.</p>
    </div>
  )
}
