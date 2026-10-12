// Société et paramètres → Données, sur le poste qui détient la base :
//  - « Serveur de l'entreprise » : ce poste partage la base sur le réseau local, les autres
//    ordinateurs, tablettes et téléphones s'y connectent par son adresse ;
//  - « Copie en ligne » : la base est recopiée à intervalles réguliers vers la base hébergée
//    de la société, pour la consulter de l'extérieur.

import { useEffect, useState } from 'react'
import { ArrowsClockwise, CloudArrowUp, CloudCheck, CloudSlash, Copy, DesktopTower, WifiHigh } from '@phosphor-icons/react'
import { formatDate } from '@shared/format'
import { run, unwrap } from '../api'
import { Field, Loading, notify } from './ui'

const copy = (text: string) => navigator.clipboard.writeText(text).then(() => notify('Adresse copiée.', 'success'), () => notify('Copie impossible : sélectionnez le texte.', 'error'))
const size = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`)

export function EnterpriseCard() {
  const [info, setInfo] = useState<EnterpriseInfo | null>(null)
  const [form, setForm] = useState({ port: '8080', cloudUrl: '', cloudKey: '', cloudMinutes: '15' })
  const [busy, setBusy] = useState(false)

  const load = async (fill = false) => {
    const r = await window.erp.enterprise!.get()
    if (!r.ok) return
    setInfo(r.data)
    if (fill) setForm({ port: String(r.data.port ?? 8080), cloudUrl: r.data.cloudUrl ?? '', cloudKey: '', cloudMinutes: String(r.data.cloudMinutes ?? 15) })
  }
  useEffect(() => {
    void load(true)
    const on = () => void load()
    window.addEventListener('iam-enterprise', on)
    return () => window.removeEventListener('iam-enterprise', on)
  }, [])

  if (!info) return <div className="card"><Loading /></div>
  if (!info.available) return null
  const save = async (patch: Record<string, unknown>, done: string) => {
    setBusy(true)
    const r = await run(() => unwrap(window.erp.enterprise!.save(patch)), done)
    setBusy(false)
    if (r) {
      setInfo(r)
      setForm((f) => ({ ...f, cloudKey: '' }))
    }
  }
  const m = info.mirror
  return (
    <>
      <div className="card ent-card">
        <div className="row space-between wrap gap">
          <h3><DesktopTower size={22} aria-hidden="true" /> Serveur de l'entreprise</h3>
          <span className={`badge ${info.listening ? 'badge-valide' : 'badge-brouillon'}`}>{info.listening ? 'En service sur le réseau' : 'Arrêté'}</span>
        </div>
        <p className="muted">Ce poste partage sa base sur le réseau de l'entreprise : les autres ordinateurs, tablettes et téléphones s'y connectent, sans rien installer d'autre. Laissez l'application ouverte sur ce poste pendant les heures de travail.</p>
        {info.error && <p className="error-text" role="alert">{info.error}</p>}
        {info.listening && (
          <div className="ent-addresses">
            {(info.addresses ?? []).length === 0 ? <p className="muted">Aucune adresse réseau détectée : branchez ce poste au réseau ou au Wi-Fi de l'entreprise.</p> : info.addresses!.map((a) => (
              <button key={a} type="button" className="ent-address" onClick={() => copy(a)} title="Copier l'adresse"><WifiHigh size={20} aria-hidden="true" /><code>{a}</code><Copy size={18} aria-hidden="true" /></button>
            ))}
            <ol className="muted small">
              <li><strong>Sur un autre ordinateur</strong> : ouvrez IAM INVOICER, choisissez « Serveur en ligne ou de l'entreprise » et saisissez cette adresse.</li>
              <li><strong>Sur un téléphone ou dans un navigateur</strong> : saisissez la même adresse, sur le même réseau.</li>
              <li>Au premier démarrage, autorisez IAM INVOICER dans le pare-feu de Windows s'il le demande.</li>
            </ol>
          </div>
        )}
        <div className="row gap wrap ent-actions">
          <Field label="Port"><input inputMode="numeric" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} style={{ width: 110 }} /></Field>
          {info.serve
            ? <button className="btn" disabled={busy} onClick={() => save({ serve: false }, 'Serveur arrêté : les autres postes ne peuvent plus se connecter.')}>Arrêter le partage</button>
            : <button className="btn btn-primary" disabled={busy} onClick={() => save({ serve: true, port: Number(form.port) }, 'Serveur démarré.')}>Partager sur le réseau</button>}
          {info.serve && <button className="btn" disabled={busy} onClick={() => save({ serve: true, port: Number(form.port) }, 'Port enregistré.')}>Appliquer le port</button>}
        </div>
      </div>

      <div className="card ent-card">
        <div className="row space-between wrap gap">
          <h3>{m?.enabled ? (m.lastError ? <CloudSlash size={22} aria-hidden="true" /> : <CloudCheck size={22} aria-hidden="true" />) : <CloudArrowUp size={22} aria-hidden="true" />} Copie en ligne</h3>
          <span className={`badge ${!m?.enabled ? 'badge-brouillon' : m.lastError ? 'pay-partielle' : 'badge-valide'}`}>{!m?.enabled ? 'Désactivée' : m.running ? 'Envoi en cours…' : m.lastError ? 'Dernier envoi en échec' : m.last ? 'À jour' : 'En attente du premier envoi'}</span>
        </div>
        <p className="muted">La base de ce serveur est recopiée automatiquement vers la base en ligne de votre société : vous la consultez de l'extérieur, sur téléphone ou navigateur. La saisie reste sur ce serveur ; une coupure d'Internet ne gêne pas le travail, l'envoi reprend ensuite.</p>
        {m?.enabled && (
          <p className="small">
            {m.last ? <>Dernier envoi : <strong>{formatDate(m.last.slice(0, 10))} à {new Date(m.last).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</strong> · {m.rows.toLocaleString('fr-FR')} lignes{m.bytes ? ` · ${size(m.bytes)}` : ''}</> : 'Aucun envoi pour l’instant.'}
            {m.lastError && <span className="error-text"> — {m.lastError}</span>}
          </p>
        )}
        <div className="grid grid-4">
          <Field label="Adresse de la base en ligne" span={2} hint="Fournie par IAM Technology, elle se termine par /t/ suivi de l'identifiant de votre société."><input value={form.cloudUrl} onChange={(e) => setForm({ ...form, cloudUrl: e.target.value })} placeholder="https://invoice.iamtechnology.store/t/ma_societe" autoCapitalize="off" spellCheck={false} /></Field>
          <Field label="Clé de synchronisation" hint={info.hasCloudKey ? 'Enregistrée. Laisser vide pour la conserver.' : 'Fournie avec l’adresse.'}><input type="password" value={form.cloudKey} onChange={(e) => setForm({ ...form, cloudKey: e.target.value })} autoComplete="off" /></Field>
          <Field label="Toutes les (minutes)"><input inputMode="numeric" value={form.cloudMinutes} onChange={(e) => setForm({ ...form, cloudMinutes: e.target.value })} /></Field>
        </div>
        <div className="form-actions row gap wrap">
          <button className="btn btn-primary" disabled={busy} onClick={() => save({ cloudUrl: form.cloudUrl, cloudKey: form.cloudKey, cloudMinutes: Number(form.cloudMinutes) }, form.cloudUrl ? 'Copie en ligne enregistrée.' : 'Copie en ligne désactivée.')}>Enregistrer</button>
          {m?.enabled && <button className="btn" disabled={busy || m.running} onClick={async () => { setBusy(true); await run(() => unwrap(window.erp.enterprise!.push()), 'Copie envoyée à la base en ligne.'); setBusy(false); void load() }}><ArrowsClockwise size={18} aria-hidden="true" className={m.running ? 'spin' : ''} />Envoyer maintenant</button>}
        </div>
        <p className="muted small">Attention : la base en ligne est remplacée par la copie de ce serveur à chaque envoi. N'y saisissez rien directement.</p>
      </div>
    </>
  )
}
