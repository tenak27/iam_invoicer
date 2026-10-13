// Verrou de sécurité des exercices : champs de confirmation (mot de passe, code) et réglage de la protection.

import { useEffect, useState } from 'react'
import { DeviceMobile, EnvelopeSimple, Key, PaperPlaneTilt, Password, ShieldCheck } from '@phosphor-icons/react'
import { api, run } from '../api'
import { Field, Modal } from './ui'

export type GuardMode = 'password' | 'email' | 'totp'
export interface Guard { mode: GuardMode; email: string; totp: boolean; smtp: boolean; admin: boolean; code_minutes: number }
export interface GuardAuth { password: string; code: string }
export const emptyAuth: GuardAuth = { password: '', code: '' }

export const GUARD_LABELS: Record<GuardMode, string> = { password: 'Mot de passe', email: 'Mot de passe et code par e-mail', totp: "Mot de passe et application d'authentification" }

/** Le formulaire est-il assez rempli pour tenter l'opération ? */
export function authReady(guard: Guard | undefined, auth: GuardAuth): boolean {
  return !!guard && auth.password.length > 0 && (guard.mode === 'password' || auth.code.replace(/\D/g, '').length === 6)
}

function CodeInput({ value, onChange, label, hint }: { value: string; onChange: (v: string) => void; label: string; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      <input className="guard-code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="000 000" value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))} />
    </Field>
  )
}

/** Bouton « Recevoir un code » avec délai avant un nouvel envoi. */
function SendCode({ args, label = 'Recevoir un code', disabled }: { args: Record<string, unknown>; label?: string; disabled?: boolean }) {
  const [wait, setWait] = useState(0)
  const [sentTo, setSentTo] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!wait) return
    const t = setTimeout(() => setWait((w) => Math.max(0, w - 1)), 1000)
    return () => clearTimeout(t)
  }, [wait])
  const send = async () => {
    setBusy(true)
    const r = await run(() => api<any>('fiscalGuard.challenge', args))
    setBusy(false)
    if (r?.sent) { setSentTo(r.to); setWait(30) }
  }
  return (
    <div className="guard-send">
      <button type="button" className="btn" onClick={send} disabled={disabled || busy || wait > 0}><PaperPlaneTilt size={18} aria-hidden="true" />{wait ? `Nouvel envoi dans ${wait} s` : sentTo ? 'Renvoyer un code' : label}</button>
      {sentTo && <span className="muted small" role="status">Code envoyé à {sentTo}.</span>}
    </div>
  )
}

/** Confirmation d'une opération sur un exercice : mot de passe, puis code selon la protection réglée. */
export function GuardFields({ guard, action, id, auth, onChange }: { guard: Guard | undefined; action: 'open' | 'close' | 'reopen' | 'delete'; id?: number; auth: GuardAuth; onChange: (a: GuardAuth) => void }) {
  if (!guard) return null
  return (
    <fieldset className="guard">
      <legend><ShieldCheck size={18} weight="fill" aria-hidden="true" />Confirmation de sécurité</legend>
      <div className="grid grid-2">
        <Field label="Votre mot de passe">
          <input type="password" autoComplete="current-password" value={auth.password} onChange={(e) => onChange({ ...auth, password: e.target.value })} />
        </Field>
        {guard.mode === 'email' && <CodeInput label="Code reçu par e-mail" hint={`Envoyé à ${guard.email}, valable ${guard.code_minutes} minutes.`} value={auth.code} onChange={(code) => onChange({ ...auth, code })} />}
        {guard.mode === 'totp' && <CodeInput label="Code de l'application" hint="Six chiffres affichés par votre application d'authentification." value={auth.code} onChange={(code) => onChange({ ...auth, code })} />}
      </div>
      {guard.mode === 'email' && <SendCode args={{ action, id }} />}
    </fieldset>
  )
}

const MODES: { mode: GuardMode; icon: typeof Key; title: string; text: string }[] = [
  { mode: 'password', icon: Password, title: 'Mot de passe', text: 'La personne connectée ressaisit son mot de passe. Une session restée ouverte ne suffit pas.' },
  { mode: 'email', icon: EnvelopeSimple, title: 'Code par e-mail', text: "En plus, un code à usage unique part à une adresse de sécurité, par exemple celle du dirigeant, qui garde la main sur la clôture." },
  { mode: 'totp', icon: DeviceMobile, title: "Application d'authentification", text: 'En plus, un code à six chiffres (Google Authenticator, Microsoft Authenticator…). Fonctionne sans Internet.' }
]

/** Réglage de la protection (administrateur). */
export function GuardModal({ guard, onClose, onDone }: { guard: Guard; onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<GuardMode>(guard.mode)
  const [email, setEmail] = useState(guard.email)
  const [auth, setAuth] = useState<GuardAuth>(emptyAuth)
  const [newCode, setNewCode] = useState('')
  const [totp, setTotp] = useState<{ secret: string; qr: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const mail = email.trim().toLowerCase()
  const newEmail = mode === 'email' && (guard.mode !== 'email' || guard.email !== mail)
  const newTotp = mode === 'totp' && guard.mode !== 'totp'
  useEffect(() => {
    setNewCode('')
    if (newTotp && !totp) run(() => api<any>('fiscalGuard.totp')).then((t) => t && setTotp(t))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])
  const ready = authReady(guard, auth) && (!(newEmail || newTotp) || newCode.length === 6) && (mode !== 'email' || /^\S+@\S+\.\S+$/.test(mail))
  const save = async () => {
    setBusy(true)
    const r = await run(() => api('fiscalGuard.save', { mode, email: mail, password: auth.password, code: auth.code, new_code: newCode }), 'Protection des exercices enregistrée.')
    setBusy(false)
    if (r) onDone()
  }
  return (
    <Modal title="Protection des exercices" onClose={onClose} wide footer={<>
      <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Annuler</button>
      <button className="btn btn-primary" onClick={save} disabled={busy || !ready}><ShieldCheck size={18} aria-hidden="true" />Enregistrer</button>
    </>}>
      <p className="muted">Choisissez ce qui est exigé pour ouvrir, clôturer, rouvrir ou supprimer un exercice. Après cinq essais manqués, ces opérations sont suspendues quinze minutes pour le compte concerné, et chaque tentative est inscrite au journal d'activité.</p>
      <div className="choice-row three" role="radiogroup" aria-label="Niveau de protection">
        {MODES.map((m) => (
          <label key={m.mode} className={`choice ${mode === m.mode ? 'active' : ''}`}>
            <input type="radio" name="guard-mode" checked={mode === m.mode} onChange={() => setMode(m.mode)} />
            <span><strong><m.icon size={18} aria-hidden="true" /> {m.title}</strong><span className="muted small" style={{ display: 'block' }}>{m.text}</span></span>
          </label>
        ))}
      </div>

      {mode === 'email' && (
        <div className="guard-step">
          {!guard.smtp && <p className="wf-reject">L'envoi des e-mails n'est pas encore configuré : réglez-le dans « Société et paramètres », onglet « E-mail d’envoi », puis revenez ici.</p>}
          <div className="grid grid-2">
            <Field label="Adresse de sécurité" hint="Les codes y sont envoyés. Choisissez une boîte que seule la personne responsable consulte."><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="direction@societe.bf" /></Field>
            {newEmail && <CodeInput label="Code reçu à cette adresse" hint="Prouve que l'adresse reçoit bien les codes." value={newCode} onChange={setNewCode} />}
          </div>
          {newEmail && <SendCode args={{ action: 'config', email: mail }} label="Envoyer un code à cette adresse" disabled={!guard.smtp || !/^\S+@\S+\.\S+$/.test(mail)} />}
        </div>
      )}

      {newTotp && (
        <div className="guard-step guard-totp">
          {totp ? <img src={totp.qr} width={180} height={180} alt="Code QR à scanner avec l'application d'authentification" /> : <div className="guard-qr-wait" />}
          <div>
            <ol>
              <li>Installez une application d'authentification sur le téléphone de la personne responsable.</li>
              <li>Scannez ce code QR, ou saisissez la clé : <code>{totp?.secret ?? '…'}</code></li>
              <li>Saisissez le code à six chiffres affiché.</li>
            </ol>
            <CodeInput label="Code affiché par l'application" value={newCode} onChange={setNewCode} />
            <p className="muted small">Conservez la clé en lieu sûr : elle permet de réinstaller l'application sur un autre téléphone.</p>
          </div>
        </div>
      )}

      <fieldset className="guard">
        <legend><ShieldCheck size={18} weight="fill" aria-hidden="true" />Pour valider ce changement</legend>
        <div className="grid grid-2">
          <Field label="Votre mot de passe"><input type="password" autoComplete="current-password" value={auth.password} onChange={(e) => setAuth({ ...auth, password: e.target.value })} /></Field>
          {guard.mode === 'email' && <CodeInput label="Code de la protection actuelle" hint={`Envoyé à ${guard.email}.`} value={auth.code} onChange={(code) => setAuth({ ...auth, code })} />}
          {guard.mode === 'totp' && <CodeInput label="Code de l'application actuelle" value={auth.code} onChange={(code) => setAuth({ ...auth, code })} />}
        </div>
        {guard.mode === 'email' && <SendCode args={{ action: 'config' }} />}
      </fieldset>
    </Modal>
  )
}
