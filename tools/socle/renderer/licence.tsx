// Licence de l'espace client (base commune des applications IAM : source iam-erp/tools/socle ; ne pas
// modifier ici) : état, consommation des limites, formules vendues par la console d'IAM Technology et
// paiement Stripe ; remerciement au retour du paiement ; guide d'utilisation montré une fois la
// licence active.
import { useEffect, useState } from 'react'

interface Usage {
  key: string
  label: string
  used: number
  limit: number | null
}
interface State {
  status: 'demo' | 'essai' | 'gratuit' | 'active' | 'expiree' | 'suspendue' | 'aucune'
  plan: string
  label: string
  ends_on: string | null
  trial_left: number | null
  usage: Usage[]
  seen_guide: boolean
}
interface Offer {
  plan: string
  label: string
  amount: number
  currency: string
  period: string
  limits: Record<string, number>
}
interface Data {
  app: string
  state: State | null
  offers: Offer[]
  online: boolean
  can_buy: boolean
}

export interface GuideStep {
  title: string
  text: string
}

interface Hooks {
  server: () => string
  token: () => string | null
}

async function call<T>(h: Hooks, path: string, body?: unknown): Promise<T> {
  const token = h.token()
  const res = await fetch(h.server() + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const json = await res.json().catch(() => null)
  if (!json?.ok) throw new Error(json?.error || 'Service indisponible pour le moment.')
  return json.data as T
}

const money = (n: number, currency: string) => `${new Intl.NumberFormat('fr-FR').format(Math.round(n))} ${currency.toLowerCase() === 'xof' ? 'FCFA' : currency.toUpperCase()}`
const PERIODS: Record<string, string> = { mois: 'par mois', trimestre: 'par trimestre', an: 'par an', unique: 'une fois' }
const date = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

function tone(s: State['status']) {
  return s === 'active' ? 'good' : s === 'essai' || s === 'demo' ? 'info' : s === 'gratuit' ? 'neutral' : 'bad'
}

function summary(s: State): string {
  if (s.status === 'demo') return 'Version de démonstration : aucune limite, aucun paiement.'
  if (s.status === 'essai') return `Tout est ouvert pendant l’essai : encore ${s.trial_left} jour${(s.trial_left ?? 0) > 1 ? 's' : ''}. Ensuite, la version gratuite garde vos données avec des limites réduites.`
  if (s.status === 'active') return s.ends_on ? `Licence valable jusqu’au ${date(s.ends_on)}.` : 'Licence sans date de fin.'
  if (s.status === 'expiree') return 'Licence expirée : vos données restent accessibles avec les limites de la version gratuite. Renouvelez pour retrouver votre formule.'
  if (s.status === 'suspendue') return 'Licence suspendue : contactez IAM Technology au +226 05 14 23 23.'
  return 'Version gratuite : vos données sont gardées, avec des limites réduites. Une formule lève ces limites.'
}

/** Panneau « Licence » des paramètres : état, consommation, formules et paiement. */
export function LicencePanel(props: Hooks & { open: (url: string) => unknown }) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const load = () =>
    call<Data>(props, '/api/socle/licence')
      .then((d) => {
        setData(d)
        setError('')
      })
      .catch((e) => setError(e.message))
  useEffect(() => {
    void load()
    const every = setInterval(() => void load(), 30_000)
    return () => clearInterval(every)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const buy = async (plan: string) => {
    setBusy(plan)
    try {
      const r = await call<{ url: string }>(props, '/api/socle/licence/checkout', { plan })
      await props.open(r.url)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }
  if (!data && !error) return null
  const s = data?.state
  const labelOf = (key: string) => s?.usage.find((u) => u.key === key)?.label ?? key
  return (
    <section className="card form-card socle-lic">
      <h2>Licence</h2>
      {error && <p className="socle-lic-error">{error}</p>}
      {s && (
        <>
          <div className="socle-lic-head">
            <span className={`socle-lic-chip tone-${tone(s.status)}`}>{s.status === 'active' ? data?.offers.find((o) => o.plan === s.plan)?.label ?? s.label : s.label}</span>
            <p>{summary(s)}</p>
          </div>
          {s.usage.length > 0 && (
            <div className="socle-lic-usage">
              {s.usage.map((u) => {
                const pct = u.limit ? Math.min(100, (u.used / u.limit) * 100) : 0
                return (
                  <div key={u.key} className={`socle-lic-row${u.limit && u.used >= u.limit ? ' full' : ''}`}>
                    <span className="socle-lic-name">{u.label}</span>
                    <span className="socle-lic-count">
                      {new Intl.NumberFormat('fr-FR').format(u.used)} {u.limit ? `sur ${new Intl.NumberFormat('fr-FR').format(u.limit)}` : '· illimité'}
                    </span>
                    {u.limit ? (
                      <span className="socle-lic-bar" aria-hidden="true">
                        <i style={{ width: `${pct}%` }} />
                      </span>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
      {data?.can_buy && (
        data.online && data.offers.length ? (
          <div className="socle-lic-offers">
            {data.offers.map((o) => (
              <div key={o.plan} className={`socle-lic-offer${s?.status === 'active' && s.plan === o.plan ? ' current' : ''}`}>
                <b>{o.label}</b>
                <span className="socle-lic-price">
                  {money(o.amount, o.currency)} <small>{PERIODS[o.period] ?? o.period}</small>
                </span>
                <ul>
                  {Object.entries(o.limits ?? {}).map(([k, v]) => (
                    <li key={k}>
                      {labelOf(k)} : {Number(v) > 0 ? new Intl.NumberFormat('fr-FR').format(Number(v)) : 'illimité'}
                    </li>
                  ))}
                </ul>
                <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => void buy(o.plan)}>
                  {busy === o.plan ? 'Ouverture du paiement…' : s?.status === 'active' && s.plan === o.plan ? 'Renouveler' : 'Choisir'}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">Le paiement en ligne des formules arrive bientôt. En attendant, IAM Technology active votre licence au +226 05 14 23 23 ou à info@iamtechnology.store.</p>
        )
      )}
      {data?.can_buy && data.online && data.offers.length > 0 && <p className="muted socle-lic-note">Paiement sécurisé par Stripe (carte bancaire). La licence s’active d’elle-même dès le paiement reçu.</p>}
    </section>
  )
}

/** Retour du paiement et guide d'utilisation (une fois la licence active). */
export function LicenceNotices(props: Hooks & { app: string; guide?: GuideStep[] }) {
  const [thanks, setThanks] = useState(() => /[?&]licence=merci/.test(location.hash))
  const [guide, setGuide] = useState(false)
  useEffect(() => {
    let alive = true
    const check = async () => {
      if (!props.token()) return
      try {
        const d = await call<Data>(props, '/api/socle/licence')
        if (!alive || !d.state) return
        if (d.state.status === 'active') {
          setThanks(false)
          if (!d.state.seen_guide && props.guide?.length) setGuide(true)
        }
      } catch {
        /* hors ligne ou sans licence : rien à montrer */
      }
    }
    void check()
    const every = setInterval(check, thanks ? 8000 : 120_000)
    return () => {
      alive = false
      clearInterval(every)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thanks])
  const done = () => {
    setGuide(false)
    void call(props, '/api/socle/licence/guide', {}).catch(() => {})
  }
  return (
    <>
      {thanks && (
        <div className="socle-card" role="status">
          <div className="socle-update-head">
            <span className="socle-update-dot" aria-hidden="true" />
            <b>Merci pour votre paiement</b>
          </div>
          <p>Votre licence {props.app} s’active dans un instant : cette page se met à jour toute seule.</p>
          <div className="socle-update-actions">
            <button type="button" className="socle-btn" onClick={() => setThanks(false)}>Fermer</button>
          </div>
        </div>
      )}
      {guide && props.guide && (
        <div className="socle-guide" role="dialog" aria-modal="true" aria-labelledby="socle-guide-t">
          <div className="socle-guide-box">
            <span className="socle-lic-chip tone-good">Licence active</span>
            <h2 id="socle-guide-t">Bien démarrer avec {props.app}</h2>
            <ol>
              {props.guide.map((g) => (
                <li key={g.title}>
                  <b>{g.title}</b>
                  <span>{g.text}</span>
                </li>
              ))}
            </ol>
            <p className="socle-guide-help">Une question ? IAM Technology vous accompagne : +226 05 14 23 23 · info@iamtechnology.store</p>
            <div className="socle-update-actions">
              <button type="button" className="socle-btn socle-btn-primary" onClick={done}>C’est parti</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
