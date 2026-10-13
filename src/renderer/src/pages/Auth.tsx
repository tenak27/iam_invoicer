import { useEffect, useState, type FormEvent } from 'react'
import { run, unwrap } from '../api'
import { Field, Modal, notify, useForm } from '../components/ui'
import type { User } from '../session'
import { ArrowLeft, ArrowRight, Buildings, CloudArrowDown, WifiHigh } from '@phosphor-icons/react'
import { BrandMark } from '../components/Layout'
import { Scenery } from '../components/Scenery'
import { ThemeMenu } from '../components/Topbar'
import { CountryField, FiscalFields, ImagePicker } from '../components/CompanyFields'
import { countryDefaults, countryProfile, DEFAULT_COUNTRY } from '@shared/countries'
const isDesktop = () => window.erp.kind === 'desktop'

/**
 * Arrière-plan animé des écrans de connexion : ciel aux couleurs du thème, halos qui dérivent,
 * paysage au pied de l'écran et petites pièces (facture, ticket, graphique, pièce de monnaie)
 * qui montent lentement. Purement décoratif : ignoré des lecteurs d'écran, figé si le système
 * réduit les animations.
 */
export function AuthBackdrop() {
  return (
    <div className="auth-bg" aria-hidden="true">
      <i className="orb o1" /><i className="orb o2" /><i className="orb o3" /><i className="orb o4" />
      <span className="auth-grid" />
      <Scenery className="auth-scene" />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
        <span key={n} className={`auth-float f${n}`}>
          {n % 4 === 0 && <svg viewBox="0 0 48 60"><rect x="1.5" y="1.5" width="45" height="57" rx="5" /><path d="M10 14h16M10 26h28M10 34h28M10 42h18" /><rect x="30" y="10" width="9" height="9" rx="1.5" /></svg>}
          {n % 4 === 1 && <svg viewBox="0 0 56 44"><path d="M4 40V8M4 40h48" /><path className="ln" d="M10 32l10-9 9 6 12-15 9 5" /></svg>}
          {n % 4 === 2 && <svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="20" /><path d="M22 11v22M28 16h-8.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H15" /></svg>}
          {n % 4 === 3 && <svg viewBox="0 0 44 56"><path d="M4 2h36v52l-6-4-6 4-6-4-6 4-6-4-6 4z" /><path d="M12 14h20M12 22h20M12 30h12" /></svg>}
        </span>
      ))}
    </div>
  )
}

function AuthCard(props: { title: string; subtitle?: string; children: React.ReactNode; wide?: boolean; logo?: string }) {
  return (
    <div className="auth-screen">
      <AuthBackdrop />
      <ThemeMenu floating />
      <div className={`auth-card ${props.wide ? 'auth-wide' : ''}`}>
        <div className="auth-brand">
          {props.logo ? <img className="auth-company-logo" src={props.logo} alt="" /> : <BrandMark size={46} />}
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

export function LoginScreen({ onLogin, dbMode, serverUrl, brand }: { onLogin: (u: User) => void; dbMode: DataMode; serverUrl: string | null; brand?: { name: string; logo?: string } | null }) {
  // Navigateur et mobile : sociétés déjà ouvertes sur cet appareil, pour y revenir en un clic
  const recent = window.erp.recent?.() ?? []
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
    <AuthCard title={brand?.name || 'IAM INVOICER'} subtitle={brand?.name ? 'Connexion · IAM INVOICER' : 'Connexion'} logo={brand?.logo}>
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
      {recent.length > 0 && (
        <div className="auth-recent">
          <span className="muted small">Vos autres sociétés</span>
          {recent.slice(0, 4).map((r) => (
            <button key={r.url} type="button" className="auth-recent-item" onClick={() => run(() => window.erp.saveDbConfig({ mode: 'remote', url: r.url }))}>
              <span className="auth-recent-mark" aria-hidden="true">{r.name.slice(0, 1).toUpperCase()}</span>
              <span><strong>{r.name}</strong><small>{r.url.replace(/^https?:\/\//, '')}</small></span>
            </button>
          ))}
        </div>
      )}
      {showDb && (
        <Modal title={isDesktop() ? 'Emplacement des données' : 'Serveur IAM INVOICER'} onClose={() => setShowDb(false)} wide>
          <DbConfigForm />
        </Modal>
      )}
    </AuthCard>
  )
}

/**
 * Première ouverture sur ordinateur : créer une société sur ce poste, ou retrouver une base
 * déjà en ligne. Le choix « serveur du bureau » reste accessible par le lien du bas.
 */
export function FirstRunScreen({ onCreate }: { onCreate: () => void }) {
  const [cloud, setCloud] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  return (
    <AuthCard title="Bienvenue dans IAM INVOICER" subtitle={cloud ? 'Charger une base depuis le cloud' : 'Comment souhaitez-vous commencer ?'} wide>
      {cloud ? <CloudConnect onBack={() => setCloud(false)} /> : (
        <div className="start-grid">
          <button type="button" className="start-card" onClick={onCreate}>
            <span className="start-art start-new" aria-hidden="true"><Buildings size={40} weight="duotone" /></span>
            <strong>Créer une société</strong>
            <span className="start-text">Une nouvelle base sur cet ordinateur : votre société, puis votre compte administrateur. Fonctionne sans Internet.</span>
            <span className="start-go">Commencer <ArrowRight size={18} weight="bold" aria-hidden="true" /></span>
          </button>
          <button type="button" className="start-card" onClick={() => setCloud(true)}>
            <span className="start-art start-cloud" aria-hidden="true"><CloudArrowDown size={40} weight="duotone" /></span>
            <strong>Charger une base depuis le cloud</strong>
            <span className="start-text">Votre société existe déjà en ligne : saisissez son adresse pour retrouver vos données sur cet ordinateur.</span>
            <span className="start-go">Se connecter <ArrowRight size={18} weight="bold" aria-hidden="true" /></span>
          </button>
        </div>
      )}
      {!cloud && (
        <button type="button" className="link-btn auth-foot" onClick={() => setAdvanced(true)}>
          <WifiHigh size={16} aria-hidden="true" /> Autre installation : serveur du bureau (réseau local)
        </button>
      )}
      {advanced && (
        <Modal title="Emplacement des données" onClose={() => setAdvanced(false)} wide>
          <DbConfigForm />
        </Modal>
      )}
    </AuthCard>
  )
}

/** Adresse de la base en ligne : on la cherche, on montre la société trouvée, puis on l'ouvre. */
function CloudConnect({ onBack }: { onBack: () => void }) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [found, setFound] = useState<{ name: string; logo?: string; city?: string } | null>(null)
  const [checked, setChecked] = useState(false)
  const cfg = () => ({ mode: 'remote', url: url.trim() })
  const search = async () => {
    setBusy(true)
    const version = await run(() => unwrap(window.erp.testDbConfig(cfg())))
    if (version !== undefined) {
      setFound((await window.erp.brand?.(url.trim()).catch(() => null)) ?? null)
      setChecked(true)
    }
    setBusy(false)
  }
  const open = async () => {
    setBusy(true)
    // Accueil au nom de la société à la prochaine ouverture (voir App.tsx)
    try {
      localStorage.setItem('iam.bienvenue', '1')
    } catch {}
    await run(() => window.erp.saveDbConfig(cfg()))
    setBusy(false)
  }
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); if (checked) open(); else search() }}>
      <Field label="Adresse de votre base en ligne" hint="L’adresse fournie avec votre accès, par exemple invoice.iamtechnology.store/t/ma_societe (https:// est ajouté).">
        <input autoFocus value={url} onChange={(e) => { setUrl(e.target.value); setFound(null); setChecked(false) }} placeholder="invoice.iamtechnology.store/t/ma_societe" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      </Field>
      {checked && (
        <div className="found-company" role="status">
          {found?.logo ? <img src={found.logo} alt="" /> : <span className="auth-recent-mark" aria-hidden="true">{(found?.name ?? '?').slice(0, 1).toUpperCase()}</span>}
          <div>
            <strong>{found?.name ?? 'Serveur trouvé'}</strong>
            <div className="muted small">{found ? `Base trouvée${found.city ? ` · ${found.city}` : ''}.` : 'Aucune société n’y est encore configurée : vous la créerez après le redémarrage.'} L’application redémarre pour l’ouvrir, puis vous demande vos identifiants.</div>
          </div>
        </div>
      )}
      <div className="form-actions start-actions">
        <button type="button" className="btn" onClick={onBack}><ArrowLeft size={18} aria-hidden="true" />Retour</button>
        <button className="btn btn-primary" disabled={busy || !url.trim()}>{busy ? 'Un instant…' : checked ? 'Ouvrir cette base' : 'Rechercher ma base'}</button>
      </div>
    </form>
  )
}

export function SetupScreen({ onDone, remote = false, onBack }: { onDone: (u: User) => void; remote?: boolean; onBack?: () => void }) {
  const f = useForm<any>({
    name: '',
    legal_form: 'SARL',
    address: '',
    phone: '',
    email: '',
    logo: '',
    rccm: '',
    tax_id: '',
    division_fiscale: '',
    ...countryDefaults(countryProfile(DEFAULT_COUNTRY)),
    full_name: '',
    username: 'admin',
    password: '',
    password2: '',
    setup_code: ''
  })
  const [busy, setBusy] = useState(false)
  const v = f.values
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (v.password !== v.password2) return notify('Les deux mots de passe ne correspondent pas.', 'error')
    setBusy(true)
    const { full_name, username, password, password2: _, setup_code, ...company } = v
    const user = await run(
      () => unwrap<User>(window.erp.setup({ company: { ...company, default_tva: Number(String(company.default_tva).replace(',', '.')) || 0 }, full_name, username, password, ...(setup_code ? { setup_code } : {}) })),
      'Configuration terminée. Bienvenue !'
    )
    setBusy(false)
    if (user) onDone(user)
  }
  return (
    <AuthCard title="Bienvenue dans IAM INVOICER" subtitle="Première configuration : votre société et le compte administrateur" wide>
      <form onSubmit={submit}>
        {onBack && <button type="button" className="link-btn start-back" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /> Revenir au choix de départ</button>}
        {remote && (
          <div className="grid grid-4" style={{ marginBottom: 6 }}>
            <Field label="Code d'activation" span={2} hint="Fourni avec l'adresse de votre base en ligne (ex. ABCD-EFGH-JKLM). Laissez vide sur votre propre serveur.">
              <input {...f.bind('setup_code')} autoComplete="off" spellCheck={false} style={{ textTransform: 'uppercase', letterSpacing: '.08em' }} placeholder="XXXX-XXXX-XXXX" />
            </Field>
          </div>
        )}
        <h3 className="section-title">Société</h3>
        <div className="setup-identity">
          <ImagePicker value={v.logo} onChange={(img) => f.set('logo', img)} label="Logo de la société" hint="Votre logo sur les factures, devis et tickets" />
          <div className="grid grid-4">
            <Field label="Raison sociale" span={2}><input required {...f.bind('name')} placeholder="Nom de votre société" /></Field>
            <Field label="Forme juridique"><input {...f.bind('legal_form')} placeholder="SARL, SA, SUARL…" /></Field>
            <Field label="Téléphone"><input {...f.bind('phone')} /></Field>
            <CountryField f={f} />
            <Field label="Ville"><input {...f.bind('city')} /></Field>
            <Field label="Adresse" span={2}><input {...f.bind('address')} /></Field>
            <Field label="Email" span={2}><input type="email" {...f.bind('email')} /></Field>
          </div>
        </div>
        <h3 className="section-title">Mentions légales et fiscalité</h3>
        <div className="grid grid-4">
          <FiscalFields f={f} />
        </div>
        <p className="muted small">Banque, cachet, signature et modèles de documents se complètent ensuite dans « Société & paramètres ».</p>
        <h3 className="section-title">Compte administrateur</h3>
        <div className="grid grid-4">
          <Field label="Nom complet"><input required {...f.bind('full_name')} /></Field>
          <Field label="Nom d'utilisateur"><input required {...f.bind('username')} /></Field>
          <Field label="Mot de passe" hint="8 caractères minimum"><input type="password" required minLength={8} {...f.bind('password')} /></Field>
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
  const [found, setFound] = useState<{ name: string; logo?: string; city?: string } | null>(null)
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
      if (mode === 'remote') setFound((await window.erp.brand?.(f.values.url).catch(() => null)) ?? null)
    })
    setBusy(false)
  }
  const save = async () => {
    setBusy(true)
    // On vérifie le serveur avant d'enregistrer, pour ne pas bloquer l'application sur une mauvaise adresse.
    const ok = mode === 'local' || (await run(() => unwrap(window.erp.testDbConfig(cfg())))) !== undefined
    if (ok && mode === 'remote') {
      // Accueil au nom de la société à la prochaine ouverture (voir App.tsx)
      try {
        localStorage.setItem('iam.bienvenue', '1')
      } catch {}
    }
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
          {choice('remote', 'Serveur en ligne ou de l’entreprise', 'Base hébergée sur Internet, ou serveur installé dans votre entreprise (son adresse commence par http://).')}
          {choice('server', 'Serveur du bureau (réseau local)', 'Tous les postes du bureau partagent une base PostgreSQL.')}
        </div>
      )}
      {mode === 'remote' && (
        <Field label="Adresse du serveur" hint="Base en ligne : l’adresse fournie avec votre accès, par exemple invoice.iamtechnology.store/t/ma_societe (https:// est ajouté). Serveur de l’entreprise : l’adresse affichée sur ce serveur, par exemple http://192.168.1.20:8080.">
          <input value={f.values.url} onChange={(e) => { f.set('url', e.target.value); setFound(null) }} placeholder="invoice.iamtechnology.store/t/ma_societe" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
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
      {mode === 'remote' && found && (
        <div className="found-company" role="status">
          {found.logo ? <img src={found.logo} alt="" /> : <span className="auth-recent-mark" aria-hidden="true">{found.name.slice(0, 1).toUpperCase()}</span>}
          <div><strong>{found.name}</strong><div className="muted small">Base trouvée{found.city ? ` · ${found.city}` : ''}. Cliquez sur « {desktop ? 'Enregistrer et redémarrer' : 'Se connecter au serveur'} » pour l’ouvrir.</div></div>
        </div>
      )}
      <div className="form-actions">
        {mode !== 'local' && <button type="button" className="btn" disabled={busy} onClick={test}>Tester la connexion</button>}
        <button className="btn btn-primary" disabled={busy}>{desktop ? 'Enregistrer et redémarrer' : 'Se connecter au serveur'}</button>
      </div>
    </form>
  )
}
