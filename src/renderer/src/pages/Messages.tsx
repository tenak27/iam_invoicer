import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BellRinging, ChatCircleText, EnvelopeSimple, PencilSimple } from '@phosphor-icons/react'
import { api, run, useQuery } from '../api'
import { confirmDialog, Empty, ErrorBox, Field, Loading, Modal, notify, PageHeader, SearchInput, Tabs } from '../components/ui'
import { useCan } from '../session'

const VARIABLES: [string, string][] = [
  ['{client}', 'Contact ou nom du client'],
  ['{tiers}', 'Raison sociale du client'],
  ['{type}', 'Type de document (Facture…)'],
  ['{type_min}', 'Type en minuscules'],
  ['{numero}', 'Numéro du document'],
  ['{date}', 'Date du document'],
  ['{echeance}', "Date d'échéance"],
  ['{montant}', 'Montant TTC'],
  ['{reste}', 'Reste à payer'],
  ['{societe}', 'Nom de votre société'],
  ['{telephone}', 'Téléphone de la société'],
  ['{utilisateur}', "Nom de l'utilisateur"],
  ['{lien}', 'Lien de signature']
]

const KIND_LABELS: Record<string, string> = { document: 'Document', relance: 'Relance', essai: 'Essai', manuel: 'Manuel' }

export function MessagesLog() {
  const [channel, setChannel] = useState<'' | 'email' | 'sms'>('')
  const [search, setSearch] = useState('')
  const { data, error, loading, reload } = useQuery<any[]>('messages.log', { channel, search })
  const rows = data ?? []
  const sent = rows.filter((r) => r.status === 'envoye').length
  const remindAll = async (ch: 'email' | 'sms') => {
    if (!(await confirmDialog(`Relancer par ${ch === 'email' ? 'e-mail' : 'SMS'} toutes les factures échues non soldées ?`, { detail: 'Le modèle de relance est utilisé pour chaque client.' }))) return
    const r = await run(() => api('messages.remindAll', { channel: ch }))
    if (r) {
      notify(`${r.sent} relance(s) envoyée(s)${r.failed.length ? `, ${r.failed.length} échec(s) : ${r.failed.map((f: any) => `${f.number} (${f.error})`).join(' ; ')}` : '.'}`, r.failed.length ? 'error' : 'success')
      reload()
    }
  }
  return (
    <div className="page">
      <PageHeader
        title="Communications"
        subtitle={`E-mails et SMS envoyés depuis IAM INVOICER · ${sent} envoyé(s), ${rows.length - sent} échec(s) affichés`}
        actions={<>
          <button className="btn" onClick={() => remindAll('sms')}><ChatCircleText size={18} aria-hidden="true" />Relancer par SMS</button>
          <button className="btn btn-primary" onClick={() => remindAll('email')}><BellRinging size={18} aria-hidden="true" />Relancer les retards par e-mail</button>
        </>}
      />
      <div className="toolbar">
        <Tabs value={channel} onChange={setChannel} tabs={[{ value: '', label: 'Tous' }, { value: 'email', label: 'E-mails' }, { value: 'sms', label: 'SMS' }]} />
        <SearchInput value={search} onChange={setSearch} placeholder="Destinataire, objet, client…" />
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Loading /> : rows.length === 0 ? (
        <Empty>Aucun message pour l'instant. Configurez la messagerie dans « Société & paramètres », puis envoyez un document depuis sa page.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Date</th><th>Canal</th><th>Destinataire</th><th>Objet / message</th><th>Document</th><th>Type</th><th>Statut</th></tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td className="nowrap">{new Date(m.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td>{m.channel === 'email' ? <span className="who"><EnvelopeSimple size={18} aria-hidden="true" />E-mail</span> : <span className="who"><ChatCircleText size={18} aria-hidden="true" />SMS</span>}</td>
                  <td>{m.recipient}<div className="muted small">{m.party_name}</div></td>
                  <td style={{ maxWidth: 340 }}>{m.channel === 'email' ? m.subject : m.body}{m.error && <div className="text-danger small">{m.error}</div>}</td>
                  <td>{m.document_id ? <Link to={`/doc/${m.document_id}`}>{m.document_number}</Link> : '—'}</td>
                  <td>{KIND_LABELS[m.kind] ?? m.kind}</td>
                  <td><span className={`badge ${m.status === 'envoye' ? 'pay-payee' : 'pay-en_retard'}`}>{m.status === 'envoye' ? 'Envoyé' : 'Échec'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function MessageTemplates() {
  const { data, error, loading, reload } = useQuery<any[]>('messages.templates')
  const canEdit = useCan('settings')
  const [editing, setEditing] = useState<any | null>(null)
  return (
    <div className="page">
      <PageHeader title="Modèles de messages" subtitle="Textes utilisés pour l'envoi des documents, les relances et les demandes de signature." />
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Loading /> : (
        <div className="tpl-grid">
          {data!.map((t) => (
            <article key={t.id} className="dcard tpl-card">
              <header className="dcard-head">
                <div className="row gap">
                  <span className={`tint tint-sm tint-${t.channel === 'email' ? 'primary' : 'info'}`} aria-hidden="true">
                    {t.channel === 'email' ? <EnvelopeSimple size={18} weight="duotone" /> : <ChatCircleText size={18} weight="duotone" />}
                  </span>
                  <div><h2>{t.name}</h2><p>{t.channel === 'email' ? 'E-mail' : 'SMS'}</p></div>
                </div>
                {canEdit && <button className="btn btn-sm btn-tonal" onClick={() => setEditing(t)}><PencilSimple size={16} aria-hidden="true" />Modifier</button>}
              </header>
              {t.subject && <p className="tpl-subject">{t.subject}</p>}
              <p className="tpl-body">{t.body}</p>
            </article>
          ))}
        </div>
      )}
      {editing && <TemplateModal tpl={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload() }} />}
    </div>
  )
}

function TemplateModal({ tpl, onClose, onDone }: { tpl: any; onClose: () => void; onDone: () => void }) {
  const [subject, setSubject] = useState(tpl.subject)
  const [body, setBody] = useState(tpl.body)
  const insert = (v: string) => setBody((b: string) => b + v)
  const save = async () => {
    if (await run(() => api('messages.saveTemplate', { id: tpl.id, subject, body }), 'Modèle enregistré.')) onDone()
  }
  return (
    <Modal title={tpl.name} wide onClose={onClose} footer={<>
      {tpl.channel === 'sms' && <span className="grow muted small">{body.length} / 480 caractères</span>}
      <button className="btn" onClick={onClose}>Annuler</button>
      <button className="btn btn-primary" onClick={save}>Enregistrer</button>
    </>}>
      {tpl.channel === 'email' && <Field label="Objet"><input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>}
      <Field label="Message"><textarea rows={tpl.channel === 'email' ? 11 : 5} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      <div>
        <span className="field-label">Variables (cliquer pour insérer)</span>
        <div className="chips var-chips">
          {VARIABLES.map(([v, label]) => (
            <button key={v} type="button" className="chip" title={label} onClick={() => insert(v)}>{v}<span className="muted">{label}</span></button>
          ))}
        </div>
      </div>
    </Modal>
  )
}
