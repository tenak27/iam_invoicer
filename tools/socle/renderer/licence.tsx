// Licence de l'espace client (base commune des applications IAM : source iam-erp/tools/socle ; ne pas
// modifier ici) : état, consommation des limites, formules vendues par la console d'IAM Technology,
// paiement par carte (Stripe) quand il est configuré, demande de licence payée par Mobile Money ou
// virement (modalités affichées, confirmation par e-mail), remerciement au retour du paiement, guide
// d'utilisation une fois la licence active.
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
interface Vendor {
  name: string
  city: string
  country: string
  phone: string
  whatsapp_link: string
  email: string
  website: string
  hours: string
  payments: { kind: string; label: string; number: string; name: string }[]
  pay_note: string
}
interface Data {
  app: string
  state: State | null
  offers: Offer[]
  online: boolean
  stripe: boolean
  vendor: Vendor
  can_buy: boolean
}
interface RequestResult {
  id: number
  app: string
  plan: string
  months: number
  amount: number
  payment: string[]
  emailed: boolean
}

export interface GuideStep {
  title: string
  text: string
}

interface Hooks {
  server: () => string
  token: () => string | null
}

const FALLBACK: Vendor = { name: 'IAM Technology', city: 'Ouagadougou', country: 'Burkina Faso', phone: '+226 05 14 23 23', whatsapp_link: '', email: 'info@iamtechnology.store', website: 'https://iamtechnology.store', hours: '', payments: [], pay_note: '' }

async function call<T>(h: Hooks, path: string, body?: unknown): Promise<T> {
  const token = h.token()
  const res = await fetch(h.server() + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body)
  }).catch(() => {
    // Réseau coupé : le navigateur ne donne qu'un message technique en anglais
    throw new Error('Connexion impossible : vérifiez votre réseau, puis réessayez.')
  })
  const json = await res.json().catch(() => null)
  if (!json?.ok) throw new Error(json?.error || 'Service indisponible pour le moment.')
  return json.data as T
}

const money = (n: number, currency: string) => `${new Intl.NumberFormat('fr-FR').format(Math.round(n))} ${currency.toLowerCase() === 'xof' ? 'FCFA' : currency.toUpperCase()}`
const PERIODS: Record<string, string> = { mois: 'par mois', trimestre: 'par trimestre', an: 'par an', unique: 'une fois' }
const date = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
const monthsPerPeriod = (period: string) => (period === 'an' ? 12 : period === 'trimestre' ? 3 : 1)
/** Montant d'une formule pour une durée en mois (période entamée due ; « unique » : montant fixe). */
const amountFor = (o: Offer, months: number) => (o.period === 'unique' ? o.amount : o.amount * Math.max(1, Math.ceil(months / monthsPerPeriod(o.period))))
const DURATIONS: Record<string, number[]> = { mois: [1, 3, 6, 12], trimestre: [3, 6, 12], an: [12, 24, 36], unique: [1] }

function tone(s: State['status']) {
  return s === 'active' ? 'good' : s === 'essai' || s === 'demo' ? 'info' : s === 'gratuit' ? 'neutral' : 'bad'
}

function summary(s: State, v: Vendor): string {
  if (s.status === 'demo') return 'Version de démonstration : aucune limite, aucun paiement.'
  if (s.status === 'essai') return `Tout est ouvert pendant l’essai : encore ${s.trial_left} jour${(s.trial_left ?? 0) > 1 ? 's' : ''}. Ensuite, la version gratuite garde vos données avec des limites réduites.`
  if (s.status === 'active') return s.ends_on ? `Licence valable jusqu’au ${date(s.ends_on)}.` : 'Licence sans date de fin.'
  if (s.status === 'expiree') return 'Licence expirée : vos données restent accessibles avec les limites de la version gratuite. Renouvelez pour retrouver votre formule.'
  if (s.status === 'suspendue') return `Licence suspendue : contactez ${v.name} au ${v.phone}.`
  return 'Version gratuite : vos données sont gardées, avec des limites réduites. Une formule lève ces limites.'
}

/** Panneau « Licence » des paramètres : état, consommation, formules, paiement par carte ou demande Mobile Money. */
export function LicencePanel(props: Hooks & { open: (url: string) => unknown }) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [ask, setAsk] = useState<Offer | null>(null)
  const [done, setDone] = useState<RequestResult | null>(null)
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
  const v = data?.vendor ?? FALLBACK
  const labelOf = (key: string) => s?.usage.find((u) => u.key === key)?.label ?? key
  return (
    <section className="card form-card socle-lic">
      <h2>Licence</h2>
      {error && <p className="socle-lic-error">{error}</p>}
      {s && (
        <>
          <div className="socle-lic-head">
            <span className={`socle-lic-chip tone-${tone(s.status)}`}>{s.status === 'active' ? data?.offers.find((o) => o.plan === s.plan)?.label ?? s.label : s.label}</span>
            <p>{summary(s, v)}</p>
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
      {data?.can_buy &&
        (data.offers.length ? (
          <>
            <div className="socle-lic-offers">
              {data.offers.map((o) => {
                const current = s?.status === 'active' && s.plan === o.plan
                return (
                  <div key={o.plan} className={`socle-lic-offer${current ? ' current' : ''}${ask?.plan === o.plan ? ' asked' : ''}`}>
                    <b>{o.label}</b>
                    <span className="socle-lic-price">
                      {money(o.amount, o.currency)} <small>{PERIODS[o.period] ?? o.period}</small>
                    </span>
                    <ul>
                      {Object.entries(o.limits ?? {}).map(([k, val]) => (
                        <li key={k}>
                          {labelOf(k)} : {Number(val) > 0 ? new Intl.NumberFormat('fr-FR').format(Number(val)) : 'illimité'}
                        </li>
                      ))}
                    </ul>
                    <div className="socle-lic-actions">
                      {data.stripe && (
                        <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => void buy(o.plan)}>
                          {busy === o.plan ? 'Ouverture du paiement…' : 'Payer par carte'}
                        </button>
                      )}
                      <button type="button" className={`btn${data.stripe ? '' : ' btn-primary'}`} onClick={() => { setDone(null); setAsk(o) }}>
                        {data.stripe ? 'Mobile Money ou virement' : current ? 'Renouveler' : 'Choisir'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
            {ask && !done && <RequestForm offer={ask} vendor={v} hooks={props} onDone={setDone} onCancel={() => setAsk(null)} />}
            {done && <RequestDone r={done} vendor={v} onClose={() => { setDone(null); setAsk(null) }} />}
            <p className="muted socle-lic-note">
              {data.stripe ? 'Paiement par carte sécurisé par Stripe : la licence s’active d’elle-même. ' : ''}
              Orange Money, Moov Money, Wave ou virement : envoyez votre demande, les modalités de paiement s’affichent, et {v.name} active votre licence dès réception du paiement.
            </p>
          </>
        ) : (
          <p className="muted">
            {data.online ? 'Aucune formule n’est en vente pour le moment. ' : 'Les formules ne sont pas joignables pour le moment. '}
            {v.name} active votre licence au {v.phone}
            {v.email ? ` ou à ${v.email}` : ''}.
          </p>
        ))}
      {data && !data.can_buy && s && s.status !== 'demo' && <p className="muted socle-lic-note">Seul l’administrateur de votre espace peut choisir une formule.</p>}
    </section>
  )
}

/** Demande de licence payée hors carte : durée, téléphone, message ; les moyens de paiement sont rappelés. */
function RequestForm({ offer, vendor, hooks, onDone, onCancel }: { offer: Offer; vendor: Vendor; hooks: Hooks; onDone: (r: RequestResult) => void; onCancel: () => void }) {
  const durations = DURATIONS[offer.period] ?? [1]
  const [months, setMonths] = useState(durations[0])
  const [phone, setPhone] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const amount = amountFor(offer, months)
  const submit = async () => {
    setBusy(true)
    setErr('')
    try {
      onDone(await call<RequestResult>(hooks, '/api/socle/licence/request', { plan: offer.plan, months, phone, message }))
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="socle-pay" role="region" aria-label="Demande de licence">
      <b>
        {offer.label} — {money(amount, offer.currency)}
        {offer.period !== 'unique' ? ` pour ${months} mois` : ''}
      </b>
      <div className="socle-pay-fields">
        {offer.period !== 'unique' && (
          <label>
            Durée
            <select value={months} onChange={(e) => setMonths(Number(e.target.value))}>
              {durations.map((m) => (
                <option key={m} value={m}>
                  {m} mois · {money(amountFor(offer, m), offer.currency)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Téléphone ou WhatsApp
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+226 70 00 00 00" inputMode="tel" />
        </label>
        <label>
          Message (facultatif)
          <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Une précision, une question…" />
        </label>
      </div>
      {vendor.payments.length > 0 && (
        <ul className="socle-pay-list">
          {vendor.payments.map((p) => (
            <li key={p.kind}>
              <b>{p.label}</b> {p.number}
              {p.name ? ` (${p.name})` : ''}
            </li>
          ))}
        </ul>
      )}
      {err && <p className="socle-lic-error">{err}</p>}
      <div className="socle-update-actions">
        <button type="button" className="socle-btn" onClick={onCancel}>Annuler</button>
        <button type="button" className="socle-btn socle-btn-primary" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Envoi…' : 'Envoyer ma demande'}
        </button>
      </div>
    </div>
  )
}

/** Demande transmise : montant, moyens de paiement, envoi de la référence sur WhatsApp. */
function RequestDone({ r, vendor, onClose }: { r: RequestResult; vendor: Vendor; onClose: () => void }) {
  const wa = vendor.whatsapp_link ? `${vendor.whatsapp_link}?text=${encodeURIComponent(`Bonjour, je viens d'envoyer la demande n° ${r.id} (${r.app}, ${r.plan}, ${r.months} mois${r.amount ? `, ${money(r.amount, 'xof')}` : ''}). Référence du paiement : `)}` : ''
  return (
    <div className="socle-pay done" role="status">
      <span className="socle-lic-chip tone-good">Demande n° {r.id} envoyée</span>
      <p>
        {r.amount ? `Montant à régler : ${money(r.amount, 'xof')}. ` : 'Nous revenons vers vous très vite. '}
        {r.emailed ? 'Les modalités vous ont aussi été envoyées par e-mail.' : ''}
      </p>
      {r.payment.length > 0 && (
        <ol className="socle-pay-list">
          {r.payment.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ol>
      )}
      <p>
        Après paiement, envoyez-nous la référence de la transaction{wa ? ' sur WhatsApp' : ''}
        {vendor.email ? ` ou à ${vendor.email}` : ''} : votre licence est activée dès réception.
      </p>
      <div className="socle-update-actions">
        {wa && (
          <a className="socle-btn socle-btn-primary" href={wa} target="_blank" rel="noopener">
            Envoyer la référence sur WhatsApp
          </a>
        )}
        <button type="button" className="socle-btn" onClick={onClose}>Fermer</button>
      </div>
    </div>
  )
}

/** Retour du paiement et guide d'utilisation (une fois la licence active). */
export function LicenceNotices(props: Hooks & { app: string; guide?: GuideStep[] }) {
  const [thanks, setThanks] = useState(() => /[?&]licence=merci/.test(location.hash))
  const [guide, setGuide] = useState(false)
  const [vendor, setVendor] = useState<Vendor>(FALLBACK)
  useEffect(() => {
    let alive = true
    const check = async () => {
      if (!props.token()) return
      try {
        const d = await call<Data>(props, '/api/socle/licence')
        if (!alive || !d.state) return
        if (d.vendor) setVendor(d.vendor)
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
            <p className="socle-guide-help">
              Une question ? {vendor.name} vous accompagne : {vendor.phone}
              {vendor.email ? ` · ${vendor.email}` : ''}
            </p>
            <div className="socle-update-actions">
              <button type="button" className="socle-btn socle-btn-primary" onClick={done}>C’est parti</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
