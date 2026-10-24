// Récupération des comptes (base commune des applications IAM : source iam-erp/tools/socle ; ne pas
// modifier ici) : « Mot de passe oublié ? » sur l'écran de connexion, et coordonnées de récupération
// (e-mail, WhatsApp) dans les paramètres. Les codes sont envoyés par la console d'IAM Technology.
import { useEffect, useState, type FormEvent } from 'react'

interface Ready {
  email: boolean
  whatsapp: boolean
  min_length?: number
}
interface Contacts {
  email: string
  phone: string
  account_email: string
  account_phone: string
  demo: boolean
  channels: Ready
  min_length: number
}

async function call<T>(server: () => string, path: string, body?: unknown, token?: string | null): Promise<T> {
  const res = await fetch(server() + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const json = await res.json().catch(() => null)
  if (!json?.ok) throw Object.assign(new Error(json?.error || 'Service indisponible pour le moment.'), { status: res.status })
  return json.data as T
}

const ways = (r: Ready | null) => (r?.email && r?.whatsapp ? 'par e-mail ou WhatsApp' : r?.whatsapp ? 'par WhatsApp' : 'par e-mail')

/** « Mot de passe oublié » : code reçu par e-mail ou WhatsApp, puis nouveau mot de passe. */
export function ForgotPassword(props: { server: () => string; app: string; initial?: string; onDone: (identifier: string) => void; onCancel: () => void }) {
  const [step, setStep] = useState<'ask' | 'code' | 'done'>('ask')
  const [ready, setReady] = useState<Ready | null>(null)
  const [identifier, setIdentifier] = useState(props.initial ?? '')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [wait, setWait] = useState(0)
  useEffect(() => {
    call<Ready>(props.server, '/api/socle/recovery')
      .then(setReady)
      .catch(() => setReady({ email: false, whatsapp: false }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!wait) return
    const t = setTimeout(() => setWait((w) => Math.max(0, w - 1)), 1000)
    return () => clearTimeout(t)
  }, [wait])
  const min = ready?.min_length ?? 8

  const ask = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!identifier.trim()) return
    setBusy(true)
    setError('')
    try {
      await call(props.server, '/api/socle/recovery/request', { identifier: identifier.trim() })
      setStep('code')
      setWait(60)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  const reset = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (password !== confirm) return setError('Les deux mots de passe ne correspondent pas.')
    setBusy(true)
    try {
      await call(props.server, '/api/socle/recovery/reset', { identifier: identifier.trim(), code, password })
      setStep('done')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (ready && !ready.email && !ready.whatsapp)
    return (
      <div className="auth-form socle-recovery">
        <h1>Mot de passe oublié</h1>
        <p className="muted">La réinitialisation en ligne n’est pas encore activée pour {props.app}. Demandez à l’administrateur de votre espace de vous attribuer un nouveau mot de passe.</p>
        <button type="button" className="btn btn-block" onClick={props.onCancel}>Retour à la connexion</button>
      </div>
    )
  if (step === 'done')
    return (
      <div className="auth-form socle-recovery">
        <h1>Mot de passe changé</h1>
        <p className="socle-int-ok" role="status">Votre nouveau mot de passe est enregistré. Par sécurité, vos autres appareils ont été déconnectés.</p>
        <button type="button" className="btn btn-primary btn-block" onClick={() => props.onDone(identifier.trim())}>Se connecter</button>
      </div>
    )
  if (step === 'code')
    return (
      <form className="auth-form socle-recovery" onSubmit={reset}>
        <h1>Nouveau mot de passe</h1>
        <p className="muted">
          Si un compte correspond à « {identifier.trim()} », un code à 6 chiffres vient d’être envoyé {ways(ready)} à ses coordonnées de récupération. Il est valable 15 minutes.
        </p>
        <label className="field">
          <span className="field-label">Code reçu</span>
          <input className="socle-recovery-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" required autoFocus />
        </label>
        <label className="field">
          <span className="field-label">Nouveau mot de passe</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={min} required />
          <span className="field-hint">{min} caractères au moins.</span>
        </label>
        <label className="field">
          <span className="field-label">Confirmez le mot de passe</span>
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
        </label>
        {error && <p className="error-box" role="alert">{error}</p>}
        <button className="btn btn-primary btn-block" disabled={busy || code.length !== 6 || !password}>{busy ? 'Un instant…' : 'Changer le mot de passe'}</button>
        <p className="muted small socle-recovery-help">
          Rien reçu ? Vérifiez vos courriers indésirables,{' '}
          {wait ? `renvoi possible dans ${wait} s` : <button type="button" className="socle-link" onClick={() => void ask()}>renvoyer un code</button>}, ou demandez à l’administrateur de votre espace de réinitialiser votre mot de passe.
        </p>
        <button type="button" className="socle-link" onClick={props.onCancel}>Retour à la connexion</button>
      </form>
    )
  return (
    <form className="auth-form socle-recovery" onSubmit={ask}>
      <h1>Mot de passe oublié</h1>
      <p className="muted">Saisissez votre identifiant, votre e-mail ou votre numéro de téléphone : vous recevrez un code {ways(ready)} pour choisir un nouveau mot de passe.</p>
      <label className="field">
        <span className="field-label">Identifiant, e-mail ou téléphone</span>
        <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" autoCapitalize="none" required autoFocus />
      </label>
      {error && <p className="error-box" role="alert">{error}</p>}
      <button className="btn btn-primary btn-block" disabled={busy || !ready || !identifier.trim()}>{busy ? 'Un instant…' : 'Recevoir un code'}</button>
      <button type="button" className="socle-link" onClick={props.onCancel}>Retour à la connexion</button>
    </form>
  )
}

/** Paramètres : e-mail et numéro WhatsApp où recevoir un code en cas d'oubli du mot de passe. */
export function RecoveryContacts(props: { server: () => string; token: () => string | null }) {
  const [data, setData] = useState<Contacts | null>(null)
  const [hidden, setHidden] = useState(false)
  const [f, setF] = useState({ email: '', phone: '', password: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  useEffect(() => {
    call<Contacts>(props.server, '/api/socle/recovery/contacts', undefined, props.token())
      .then((d) => {
        setData(d)
        setF({ email: d.email, phone: d.phone, password: '' })
      })
      .catch((e) => {
        // Serveur d'une version antérieure : pas encore de récupération
        if (e.status === 404) setHidden(true)
        else setError(e.message)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (hidden || (!data && !error)) return null
  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    setDone('')
    try {
      const d = await call<Contacts>(props.server, '/api/socle/recovery/contacts', f, props.token())
      setData(d)
      setF({ email: d.email, phone: d.phone, password: '' })
      setDone('Coordonnées de récupération enregistrées.')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  const any = data && (data.channels.email || data.channels.whatsapp)
  return (
    <section className="card form-card socle-recovery-card">
      <h2>Récupération du mot de passe</h2>
      <p className="muted">En cas d’oubli, un code à 6 chiffres vous est envoyé à ces coordonnées pour choisir un nouveau mot de passe, depuis « Mot de passe oublié ? » sur l’écran de connexion.</p>
      {data?.demo ? (
        <p className="muted">Version de démonstration : pas de récupération de mot de passe.</p>
      ) : (
        data && (
          <form onSubmit={save} className="socle-recovery-form">
            {!any && <p className="socle-recovery-note">IAM Technology n’a pas encore activé l’envoi des codes : vos coordonnées serviront dès que ce sera fait.</p>}
            <label className="field">
              <span className="field-label">E-mail de récupération</span>
              <input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder={data.account_email || 'vous@exemple.bf'} autoComplete="email" autoCapitalize="none" />
              {!f.email && data.account_email && <span className="field-hint">Sans saisie : {data.account_email}, l’e-mail de votre compte.</span>}
            </label>
            <label className="field">
              <span className="field-label">Numéro WhatsApp de récupération</span>
              <input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder={data.account_phone || '+226 70 00 00 00'} autoComplete="tel" />
              {!f.phone && data.account_phone && <span className="field-hint">Sans saisie : {data.account_phone}, le téléphone de votre compte.</span>}
            </label>
            <label className="field">
              <span className="field-label">Votre mot de passe actuel</span>
              <input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="current-password" required />
            </label>
            {error && <p className="socle-lic-error" role="alert">{error}</p>}
            {done && <p className="socle-int-ok" role="status">{done}</p>}
            <div>
              <button className="btn btn-primary" disabled={busy || !f.password}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
            </div>
          </form>
        )
      )}
      {!data && error && <p className="socle-lic-error">{error}</p>}
    </section>
  )
}
