// API et webhooks de l'espace client (base commune des applications IAM : source iam-erp/tools/socle ;
// ne pas modifier ici) : clés d'API, webhooks signés et leur verrouillage. Une fois verrouillés, toute
// modification redemande le mot de passe de l'administrateur et ne reste possible que 15 minutes.
import { useEffect, useState, type FormEvent } from 'react'

export interface IntegrationLockState {
  locked: boolean
  editable: boolean
  locked_at: string | null
  locked_by_name?: string
  /** Double authentification activée sur le compte : son code est demandé au déverrouillage. */
  needs_code?: boolean
  unlocked_until: string | null
}
interface ApiKey {
  id: number
  name: string
  prefix: string
  scope: 'lecture' | 'ecriture'
  created_at: string
  last_used_at: string | null
  revoked: boolean
  created_by_name: string
}
interface Delivery {
  id: number
  event: string
  status: string
  code: number
  error: string
  created_at: string
}
interface Webhook {
  id: number
  url: string
  events: string[]
  active: boolean
  created_at: string
  deliveries: Delivery[]
}
interface Data {
  demo: boolean
  lock: IntegrationLockState
  keys: ApiKey[]
  webhooks: Webhook[]
  events: Record<string, string>
  api: string
  examples: string[]
  /** Faux : clés en lecture seule uniquement. */
  writable?: boolean
}
interface Hooks {
  server: () => string
  token: () => string | null
}
type HookForm = { id?: number; url: string; events: string[]; active: boolean }

async function call<T>(h: Hooks, path: string, body?: unknown): Promise<T> {
  const token = h.token()
  const res = await fetch(h.server() + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const json = await res.json().catch(() => null)
  if (!json?.ok) throw Object.assign(new Error(json?.error || 'Service indisponible pour le moment.'), { status: res.status })
  return json.data as T
}

const when = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const hour = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** Bouton en deux temps : le premier appui arme, le second confirme (dans les 4 secondes). */
function Confirm(props: { label: string; confirm: string; disabled?: boolean; onConfirm: () => unknown }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <button
      type="button"
      className={`btn btn-sm ${armed ? 'btn-danger' : 'btn-ghost'}`}
      disabled={props.disabled}
      onClick={() => {
        if (!armed) return setArmed(true)
        setArmed(false)
        void props.onConfirm()
      }}
    >
      {armed ? props.confirm : props.label}
    </button>
  )
}

/** Verrou des intégrations : verrouiller, déverrouiller 15 minutes avec le mot de passe (et le code de double
 * authentification quand le compte l'a activée), reverrouiller. */
export function IntegrationLockBar(props: { lock: IntegrationLockState; disabled?: boolean; onLock: () => Promise<unknown>; onUnlock: (password: string, code?: string) => Promise<unknown> }) {
  const { lock } = props
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      setPassword('')
      setCode('')
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }
  const ready = !!password && (!lock.needs_code || /^\d{6}$/.test(code))
  const unlock = (e: FormEvent) => {
    e.preventDefault()
    if (ready) void run(() => props.onUnlock(password, lock.needs_code ? code : undefined))
  }
  if (!lock.locked)
    return (
      <div className="socle-int-lock">
        <span className="socle-lic-chip">Non verrouillées</span>
        <p>Une fois vos clés et webhooks réglés, verrouillez-les : chaque modification demandera alors votre mot de passe, restera possible 15 minutes, sera inscrite au journal et signalée aux autres administrateurs.</p>
        <div className="socle-int-row">
          <button type="button" className="btn btn-primary" disabled={busy || props.disabled} onClick={() => void run(props.onLock)}>
            Verrouiller
          </button>
        </div>
        {error && <p className="socle-lic-error">{error}</p>}
      </div>
    )
  if (lock.editable && lock.unlocked_until)
    return (
      <div className="socle-int-lock open">
        <span className="socle-lic-chip tone-info">Déverrouillées jusqu’à {hour(lock.unlocked_until)}</span>
        <p>Les modifications sont possibles jusqu’à {hour(lock.unlocked_until)} ; le verrou se remet ensuite de lui-même.</p>
        <div className="socle-int-row">
          <button type="button" className="btn" disabled={busy} onClick={() => void run(props.onLock)}>
            Reverrouiller maintenant
          </button>
        </div>
        {error && <p className="socle-lic-error">{error}</p>}
      </div>
    )
  return (
    <form className="socle-int-lock locked" onSubmit={unlock}>
      <span className="socle-lic-chip tone-good">Verrouillées</span>
      <p>
        Verrouillées{lock.locked_at ? ` le ${when(lock.locked_at)}` : ''}
        {lock.locked_by_name ? ` par ${lock.locked_by_name}` : ''}. Pour modifier une clé ou un webhook, confirmez votre mot de passe{lock.needs_code ? ' et le code de votre application d’authentification' : ''} : la modification reste possible 15 minutes et les autres administrateurs sont prévenus.
      </p>
      <div className="socle-int-row">
        <input type="password" autoComplete="current-password" placeholder="Votre mot de passe" aria-label="Votre mot de passe" value={password} onChange={(e) => setPassword(e.target.value)} />
        {lock.needs_code && (
          <input
            className="socle-int-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="Code à 6 chiffres"
            aria-label="Code de l’application d’authentification"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
        )}
        <button type="submit" className="btn btn-primary" disabled={busy || !ready}>
          {busy ? 'Vérification…' : 'Déverrouiller'}
        </button>
      </div>
      {error && <p className="socle-lic-error">{error}</p>}
    </form>
  )
}

/** Exemple « GET sites.list » → ligne d'appel complète. */
function example(api: string, line: string) {
  const m = /^(GET|POST)\s+(\S+)\s*(.*)$/.exec(line.trim())
  if (!m) return line
  return `${m[1].padEnd(4)} ${api}${m[2]}${m[3] ? `\n     ${m[3]}` : ''}`
}

/** Panneau « API et webhooks » des paramètres (administrateur). */
export function IntegrationsPanel(props: Hooks & { app: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [hidden, setHidden] = useState(false)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [keyForm, setKeyForm] = useState<{ name: string; scope: 'lecture' | 'ecriture' } | null>(null)
  const [hookForm, setHookForm] = useState<HookForm | null>(null)
  const [secret, setSecret] = useState<{ title: string; value: string; hint: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const load = () =>
    call<Data>(props, '/api/socle/integrations')
      .then((d) => {
        setData(d)
        setError('')
      })
      .catch((e) => {
        // Serveur d'une version antérieure : pas encore d'intégrations
        if (e.status === 404) setHidden(true)
        else setError(e.message)
      })
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Fin de la fenêtre de déverrouillage : l'état se recharge de lui-même
  const until = data?.lock.unlocked_until
  useEffect(() => {
    if (!until) return
    const t = setTimeout(() => void load(), Math.max(1000, new Date(until).getTime() - Date.now() + 1000))
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [until])

  const act = async <T,>(path: string, body: unknown, done?: string): Promise<T | null> => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const r = await call<T>(props, path, body)
      if (done) setNotice(done)
      await load()
      return r
    } catch (e: any) {
      setError(e.message)
      return null
    } finally {
      setBusy(false)
    }
  }
  const reveal = (title: string, value: string, hint: string) => {
    setCopied(false)
    setSecret({ title, value, hint })
  }

  if (hidden || (!data && !error)) return null
  const editable = !!data?.lock.editable && !data?.demo
  const events = data?.events ?? {}
  const label = (e: string) => (e === '*' ? 'tous les événements' : events[e] ?? e)

  const saveKey = async (e: FormEvent) => {
    e.preventDefault()
    if (!keyForm) return
    const r = await act<{ key: string }>('/api/socle/integrations/key', keyForm)
    if (r) {
      setKeyForm(null)
      reveal('Votre clé d’API', r.key, 'Copiez-la maintenant : elle ne sera plus jamais affichée. Gardez-la secrète, comme un mot de passe.')
    }
  }
  const saveHook = async (e: FormEvent) => {
    e.preventDefault()
    if (!hookForm) return
    const r = await act<{ id: number; secret?: string }>('/api/socle/integrations/webhook', hookForm, hookForm.id ? 'Webhook enregistré.' : undefined)
    if (r) {
      setHookForm(null)
      if (r.secret) reveal('Secret de signature', r.secret, 'Chaque envoi porte l’en-tête X-IAM-Signature : sha256=HMAC-SHA256(secret, corps). Vérifiez-le avant de faire confiance au message.')
    }
  }
  const test = async (id: number) => {
    const r = await act<{ status: string; code: number; error: string }>('/api/socle/integrations/webhook/test', { id })
    if (!r) return
    if (r.status === 'ok') setNotice(`Essai reçu par votre adresse (HTTP ${r.code}).`)
    else setError(`Échec de l’essai : ${r.error || `HTTP ${r.code}`}`)
  }
  const showSecret = async (id: number) => {
    const r = await act<{ secret: string }>('/api/socle/integrations/webhook/secret', { id })
    if (r) reveal('Secret de signature', r.secret, 'Vérifiez l’en-tête X-IAM-Signature : sha256=HMAC-SHA256(secret, corps de la requête).')
  }
  const all = !!hookForm?.events.includes('*')
  const toggle = (k: string) =>
    hookForm && setHookForm({ ...hookForm, events: hookForm.events.includes(k) ? hookForm.events.filter((x) => x !== k) : [...hookForm.events.filter((x) => x !== '*'), k] })

  return (
    <section className="card form-card socle-int">
      <h2>API et webhooks</h2>
      <p className="muted">
        Reliez {props.app} à un autre logiciel (comptabilité, site internet, paiement en ligne) : une <b>clé d’API</b> lui permet de lire ou d’enregistrer des données, un <b>webhook</b> le prévient dès qu’un événement survient.
      </p>
      {data?.demo && <p className="socle-int-ok">Version de démonstration : API et webhooks se configurent sur votre compte réel.</p>}
      {data && !data.demo && (
        <IntegrationLockBar
          lock={data.lock}
          onLock={async () => {
            await call(props, '/api/socle/integrations/lock', {})
            await load()
          }}
          onUnlock={async (password, code) => {
            await call(props, '/api/socle/integrations/unlock', { password, code })
            await load()
          }}
        />
      )}
      {error && <p className="socle-lic-error" role="alert">{error}</p>}
      {notice && <p className="socle-int-ok" role="status">{notice}</p>}
      {secret && (
        <div className="socle-int-secret" role="status">
          <b>{secret.title}</b>
          <div className="socle-int-row">
            <code>{secret.value}</code>
            <button type="button" className="btn btn-sm" onClick={async () => setCopied(await copy(secret.value))}>
              {copied ? 'Copié' : 'Copier'}
            </button>
          </div>
          <small>{secret.hint}</small>
          <div className="socle-int-row end">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setSecret(null)}>
              J’ai copié
            </button>
          </div>
        </div>
      )}

      {data && (
        <>
          <div className="socle-int-head">
            <h3>Clés d’API</h3>
            <button type="button" className="btn btn-sm" disabled={!editable || busy || !!keyForm} onClick={() => setKeyForm({ name: '', scope: 'lecture' })}>
              Nouvelle clé
            </button>
          </div>
          {keyForm && (
            <form className="socle-int-form" onSubmit={saveKey}>
              <label>
                Nom
                <input value={keyForm.name} maxLength={80} onChange={(e) => setKeyForm({ ...keyForm, name: e.target.value })} placeholder="Logiciel de comptabilité" autoFocus />
              </label>
              {data.writable === false ? (
                <small>Lecture seule : les clés de {props.app} consultent des données agrégées, elles n’enregistrent rien.</small>
              ) : (
                <label>
                  Droits
                  <select value={keyForm.scope} onChange={(e) => setKeyForm({ ...keyForm, scope: e.target.value === 'ecriture' ? 'ecriture' : 'lecture' })}>
                    <option value="lecture">Lecture seule (consulter)</option>
                    <option value="ecriture">Lecture et écriture (consulter et enregistrer)</option>
                  </select>
                </label>
              )}
              <div className="socle-int-row end">
                <button type="button" className="btn" onClick={() => setKeyForm(null)}>
                  Annuler
                </button>
                <button type="submit" className="btn btn-primary" disabled={busy || !keyForm.name.trim()}>
                  Créer la clé
                </button>
              </div>
            </form>
          )}
          {data.keys.length === 0 ? (
            <p className="socle-int-empty">Aucune clé d’API.</p>
          ) : (
            <ul className="socle-int-list">
              {data.keys.map((k) => (
                <li key={k.id} className={k.revoked ? 'off' : undefined}>
                  <div className="socle-int-main">
                    <b>{k.name}</b>
                    <code>iak_{k.prefix}_…</code>
                    <span className={`socle-int-tag ${k.scope}`}>{k.scope === 'ecriture' ? 'Lecture et écriture' : 'Lecture seule'}</span>
                    {k.revoked && <span className="socle-int-tag off">Révoquée</span>}
                    <small>
                      Créée le {when(k.created_at)}
                      {k.created_by_name ? ` par ${k.created_by_name}` : ''} · {k.last_used_at ? `utilisée le ${when(k.last_used_at)}` : 'jamais utilisée'}
                    </small>
                  </div>
                  {!k.revoked && (
                    <div className="socle-int-actions">
                      <Confirm label="Révoquer" confirm="Confirmer la révocation" disabled={!editable || busy} onConfirm={() => act('/api/socle/integrations/key/revoke', { id: k.id }, 'Clé révoquée : le logiciel qui l’utilisait n’a plus accès.')} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <details className="socle-int-doc">
            <summary>Comment utiliser l’API</summary>
            <p>
              Chaque fonction de {props.app} est un appel nommé. Envoyez la clé dans l’en-tête <code>Authorization: Bearer &lt;clé&gt;</code> (ou <code>X-Api-Key</code>) :
            </p>
            <pre>{(data.examples.length ? data.examples : ['GET exemple.list']).map((x) => example(data.api, x)).join('\n')}</pre>
            <p>
              Réponse : <code>{'{ "ok": true, "data": … }'}</code> ou <code>{'{ "ok": false, "error": "…" }'}</code>, 120 appels par minute au plus. Une clé en lecture seule ne fait que consulter. Aucune clé ne gère les comptes, la sécurité, les réglages ni les intégrations ; elle agit au nom de l’administrateur qui l’a créée et cesse de fonctionner si ce compte est désactivé.
            </p>
            <p>
              Webhooks : chaque envoi est un POST JSON <code>{'{ id, app, event, created_at, space_id, data }'}</code>, signé par l’en-tête <code>X-IAM-Signature: sha256=…</code> (HMAC-SHA256 du corps avec le secret du webhook).
            </p>
          </details>

          <div className="socle-int-head">
            <h3>Webhooks</h3>
            <button type="button" className="btn btn-sm" disabled={!editable || busy || !!hookForm} onClick={() => setHookForm({ url: '', events: Object.keys(events).slice(0, 1), active: true })}>
              Nouveau webhook
            </button>
          </div>
          {hookForm && (
            <form className="socle-int-form" onSubmit={saveHook}>
              <label>
                Adresse de réception (https://…)
                <input type="url" inputMode="url" value={hookForm.url} onChange={(e) => setHookForm({ ...hookForm, url: e.target.value })} placeholder="https://monsite.bf/iam/webhook" autoFocus />
              </label>
              <fieldset>
                <legend>Événements</legend>
                <div className="socle-int-chips">
                  <button type="button" className={`socle-int-chip${all ? ' on' : ''}`} aria-pressed={all} onClick={() => setHookForm({ ...hookForm, events: all ? [] : ['*'] })}>
                    Tous
                  </button>
                  {Object.entries(events).map(([k, v]) => {
                    const on = all || hookForm.events.includes(k)
                    return (
                      <button key={k} type="button" className={`socle-int-chip${on ? ' on' : ''}`} aria-pressed={on} title={k} onClick={() => toggle(k)}>
                        {v}
                      </button>
                    )
                  })}
                </div>
              </fieldset>
              {hookForm.id ? (
                <label className="socle-int-check">
                  <input type="checkbox" checked={hookForm.active} onChange={(e) => setHookForm({ ...hookForm, active: e.target.checked })} /> Actif
                </label>
              ) : null}
              <small>{props.app} y envoie une requête POST en JSON à chaque événement choisi (3 essais en cas d’échec).</small>
              <div className="socle-int-row end">
                <button type="button" className="btn" onClick={() => setHookForm(null)}>
                  Annuler
                </button>
                <button type="submit" className="btn btn-primary" disabled={busy || !hookForm.url.trim() || !hookForm.events.length}>
                  Enregistrer
                </button>
              </div>
            </form>
          )}
          {data.webhooks.length === 0 ? (
            <p className="socle-int-empty">Aucun webhook.</p>
          ) : (
            <ul className="socle-int-list">
              {data.webhooks.map((h) => (
                <li key={h.id} className={h.active ? undefined : 'off'}>
                  <div className="socle-int-main">
                    <b className="socle-int-url">{h.url}</b>
                    {!h.active && <span className="socle-int-tag off">En pause</span>}
                    <small>{h.events.map(label).join(', ')}</small>
                    {h.deliveries.length > 0 && (
                      <span className="socle-int-deliveries" aria-label="Derniers envois">
                        {h.deliveries.map((d) => (
                          <span key={d.id} className={`socle-int-dot ${d.status === 'ok' ? 'ok' : 'bad'}`} title={`${label(d.event)} · ${when(d.created_at)}${d.error ? ` · ${d.error}` : ''}`}>
                            {d.code || '×'}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                  <div className="socle-int-actions">
                    <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void test(h.id)}>
                      Tester
                    </button>
                    <button type="button" className="btn btn-sm btn-ghost" disabled={!editable || busy} onClick={() => void showSecret(h.id)}>
                      Secret
                    </button>
                    <button type="button" className="btn btn-sm btn-ghost" disabled={!editable || busy || !!hookForm} onClick={() => setHookForm({ id: h.id, url: h.url, events: h.events, active: h.active })}>
                      Modifier
                    </button>
                    <Confirm label="Supprimer" confirm="Confirmer la suppression" disabled={!editable || busy} onConfirm={() => act('/api/socle/integrations/webhook/remove', { id: h.id }, 'Webhook supprimé.')} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
