import { useEffect, useState, type FormEvent } from 'react'
import { run, unwrap } from '../api'
import { Field, Modal, notify, useForm } from '../components/ui'
import type { User } from '../session'
import { BrandMark } from '../components/Layout'

export const REGIMES = [
  { value: '', label: '—' },
  { value: 'RNI', label: 'RNI — Réel normal d’imposition' },
  { value: 'RSI', label: 'RSI — Réel simplifié d’imposition' },
  { value: 'CME', label: 'CME — Contribution des micro-entreprises' }
]
export const TAX_ID_LABELS = ['IFU', 'NIF', 'NINEA', 'NCC']
const isDesktop = () => window.erp.kind === 'desktop'

function AuthCard(props: { title: string; subtitle?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="auth-screen">
      <div className={`auth-card ${props.wide ? 'auth-wide' : ''}`}>
        <div className="auth-brand">
          <BrandMark size={46} />
          <div>
            <div className="auth-title">{props.title}</div>
            {props.subtitle && <div className="muted">{props.subtitle}</div>}
          </div>
        </div>
        {props.children}
      </div>
    </div>
  )
}

const MODE_TEXT: Record<DataMode, string> = { local: 'ce poste', server: 'serveur réseau', remote: 'en ligne' }

export function LoginScreen({ onLogin, dbMode, serverUrl }: { onLogin: (u: User) => void; dbMode: DataMode; serverUrl: string | null }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [showDb, setShowDb] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    const user = await run(() => unwrap<User>(window.erp.login(username, password)))
    setBusy(false)
    if (user) onLogin(user)
  }
  return (
    <AuthCard title="IAM INVOICER" subtitle="Connexion">
      <form onSubmit={submit} className="stack">
        <Field label="Nom d'utilisateur">
          <input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </Field>
        <Field label="Mot de passe">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </Field>
        <button className="btn btn-primary btn-block" disabled={busy || !username || !password}>
          {busy ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
      <button className="link-btn auth-foot" onClick={() => setShowDb(true)}>
        {dbMode === 'remote' && serverUrl ? `Serveur : ${serverUrl.replace(/^https?:\/\//, '')}` : `Base de données : ${MODE_TEXT[dbMode]}`} — modifier
      </button>
      {showDb && (
        <Modal title={isDesktop() ? 'Emplacement des données' : 'Serveur IAM INVOICER'} onClose={() => setShowDb(false)} wide>
          <DbConfigForm />
        </Modal>
      )}
    </AuthCard>
  )
}

export function SetupScreen({ onDone }: { onDone: (u: User) => void }) {
  const f = useForm({
    name: 'IAM Technology',
    legal_form: 'SARL',
    address: '',
    city: 'Ouagadougou',
    country: 'Burkina Faso',
    phone: '',
    email: '',
    rccm: '',
    tax_id_label: 'IFU',
    tax_id: '',
    regime_fiscal: '',
    division_fiscale: '',
    full_name: '',
    username: 'admin',
    password: '',
    password2: ''
  })
  const [busy, setBusy] = useState(false)
  const v = f.values
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (v.password !== v.password2) return notify('Les deux mots de passe ne correspondent pas.', 'error')
    setBusy(true)
    const { full_name, username, password, password2: _, ...company } = v
    const user = await run(
      () => unwrap<User>(window.erp.setup({ company: { ...company, currency: 'FCFA', default_tva: 18 }, full_name, username, password })),
      'Configuration terminée. Bienvenue !'
    )
    setBusy(false)
    if (user) onDone(user)
  }
  return (
    <AuthCard title="Bienvenue dans IAM INVOICER" subtitle="Première configuration : votre société et le compte administrateur" wide>
      <form onSubmit={submit}>
        <h3 className="section-title">Société</h3>
        <div className="grid grid-4">
          <Field label="Raison sociale" span={2}><input required {...f.bind('name')} /></Field>
          <Field label="Forme juridique"><input {...f.bind('legal_form')} placeholder="SARL, SA, SUARL…" /></Field>
          <Field label="Téléphone"><input {...f.bind('phone')} /></Field>
          <Field label="Adresse" span={2}><input {...f.bind('address')} /></Field>
          <Field label="Ville"><input {...f.bind('city')} /></Field>
          <Field label="Pays"><input {...f.bind('country')} /></Field>
          <Field label="Email"><input type="email" {...f.bind('email')} /></Field>
          <Field label="RCCM"><input {...f.bind('rccm')} /></Field>
          <Field label="Identifiant fiscal">
            <select {...f.bind('tax_id_label')}>{TAX_ID_LABELS.map((l) => <option key={l}>{l}</option>)}</select>
          </Field>
          <Field label={`N° ${v.tax_id_label}`}><input {...f.bind('tax_id')} /></Field>
          <Field label="Régime fiscal" span={2}>
            <select {...f.bind('regime_fiscal')}>{REGIMES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select>
          </Field>
          <Field label="Service des impôts" span={2}><input {...f.bind('division_fiscale')} placeholder="DGE, DME Centre, CME Ouaga…" /></Field>
        </div>
        <p className="muted small">Logo, banque et autres informations pourront être complétés ensuite dans « Société & paramètres ».</p>
        <h3 className="section-title">Compte administrateur</h3>
        <div className="grid grid-4">
          <Field label="Nom complet"><input required {...f.bind('full_name')} /></Field>
          <Field label="Nom d'utilisateur"><input required {...f.bind('username')} /></Field>
          <Field label="Mot de passe" hint="6 caractères minimum"><input type="password" required minLength={6} {...f.bind('password')} /></Field>
          <Field label="Confirmation"><input type="password" required {...f.bind('password2')} /></Field>
        </div>
        <div className="form-actions">
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Enregistrement…' : 'Terminer la configuration'}</button>
        </div>
      </form>
    </AuthCard>
  )
}

export function DbConfigScreen({ error }: { error: string | null }) {
  const first = !isDesktop() && !error
  return (
    <AuthCard title={first ? 'IAM INVOICER' : 'Serveur indisponible'} subtitle={first ? 'Connexion à votre serveur' : undefined} wide={isDesktop()}>
      {error && <div className="error-box">{error}</div>}
      <p className="muted">
        {first
          ? "Saisissez l'adresse du serveur de votre société (fournie par votre administrateur)."
          : 'Vérifiez la connexion Internet ou réseau et que le serveur est allumé, ou modifiez les paramètres de connexion.'}
      </p>
      <DbConfigForm />
    </AuthCard>
  )
}

export function DbConfigForm() {
  const desktop = isDesktop()
  const f = useForm<any>({ mode: desktop ? 'local' : 'remote', url: '', host: '', port: '5432', database: 'iam_erp', user: 'postgres', password: '' })
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    window.erp.getDbConfig().then((cfg) => f.setValues((v: any) => ({ ...v, ...cfg, port: String(cfg.port ?? v.port) })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const mode = f.values.mode as DataMode
  const cfg = () =>
    mode === 'local'
      ? { mode: 'local' }
      : mode === 'remote'
        ? { mode: 'remote', url: f.values.url }
        : { mode: 'server', host: f.values.host, port: Number(f.values.port) || 5432, database: f.values.database, user: f.values.user, password: f.values.password }
  const test = async () => {
    setBusy(true)
    await run(async () => {
      const version = await unwrap(window.erp.testDbConfig(cfg()))
      notify(typeof version === 'string' ? `Connexion réussie (serveur version ${version}).` : 'Connexion réussie.', 'success')
    })
    setBusy(false)
  }
  const save = async () => {
    setBusy(true)
    // On vérifie le serveur avant d'enregistrer, pour ne pas bloquer l'application sur une mauvaise adresse.
    const ok = mode === 'local' || (await run(() => unwrap(window.erp.testDbConfig(cfg())))) !== undefined
    if (ok) await run(() => window.erp.saveDbConfig(cfg()))
    setBusy(false)
  }
  const choice = (value: DataMode, title: string, text: string) => (
    <label className={`choice ${mode === value ? 'active' : ''}`}>
      <input type="radio" checked={mode === value} onChange={() => f.set('mode', value)} />
      <div>
        <strong>{title}</strong>
        <div className="muted small">{text}</div>
      </div>
    </label>
  )
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); save() }}>
      {desktop && (
        <div className="choice-row three">
          {choice('local', 'Ce poste uniquement', "Base intégrée à l'application. Idéal pour démarrer ou travailler seul.")}
          {choice('remote', 'Serveur en ligne (domaine)', 'Synchronisé avec les autres sites, postes, téléphones et tablettes via Internet.')}
          {choice('server', 'Serveur du bureau (réseau local)', 'Tous les postes du bureau partagent une base PostgreSQL.')}
        </div>
      )}
      {mode === 'remote' && (
        <Field label="Adresse du serveur" hint="Exemple : facturation.iam.bf — https:// est ajouté automatiquement.">
          <input value={f.values.url} onChange={(e) => f.set('url', e.target.value)} placeholder="facturation.iam.bf" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        </Field>
      )}
      {mode === 'server' && (
        <div className="grid grid-4">
          <Field label="Adresse du serveur" span={2}><input {...f.bind('host')} placeholder="192.168.1.10" /></Field>
          <Field label="Port"><input {...f.bind('port')} /></Field>
          <Field label="Base"><input {...f.bind('database')} /></Field>
          <Field label="Utilisateur" span={2}><input {...f.bind('user')} /></Field>
          <Field label="Mot de passe" span={2}><input type="password" {...f.bind('password')} /></Field>
        </div>
      )}
      <div className="form-actions">
        {mode !== 'local' && <button type="button" className="btn" disabled={busy} onClick={test}>Tester la connexion</button>}
        <button className="btn btn-primary" disabled={busy}>{desktop ? 'Enregistrer et redémarrer' : 'Se connecter au serveur'}</button>
      </div>
    </form>
  )
}
