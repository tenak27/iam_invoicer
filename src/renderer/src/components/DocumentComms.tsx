import { useEffect, useState } from 'react'
import { ChatCircleText, CheckCircle, Copy, EnvelopeSimple, LinkSimple, PenNib, ShieldCheck, WarningCircle } from '@phosphor-icons/react'
import { formatDate } from '@shared/format'
import { api, run, unwrap, useQuery } from '../api'
import { Field, Loading, Modal, notify } from './ui'
import { SignatureModal } from '../pages/Admin'
import { useCan } from '../session'

type Doc = { id: number; type: string; number: string; status: string; party: any; due_date: string | null; total_ttc: number; paid: number }

/** Modèle conseillé : relance si la facture est échue et non soldée. */
function defaultCode(doc: Doc, channel: 'email' | 'sms') {
  const overdue = doc.type === 'FAC' && doc.due_date && doc.due_date < new Date().toISOString().slice(0, 10) && doc.total_ttc - doc.paid > 0.5
  return `${overdue ? 'reminder' : 'doc'}_${channel}`
}

export function SendEmailModal({ doc, onClose, onSent, code, link }: { doc: Doc; onClose: () => void; onSent: () => void; code?: string; link?: string }) {
  const [form, setForm] = useState<{ to: string; subject: string; body: string } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api('messages.preview', { code: code ?? defaultCode(doc, 'email'), documentId: doc.id, link })
      .then((p) => setForm({ to: p.to, subject: p.subject, body: p.body }))
      .catch((e) => notify(e.message, 'error'))
  }, [doc.id, code, link])
  const send = async () => {
    setBusy(true)
    const r = await run(() => unwrap(window.erp.sendDocumentEmail({ documentId: doc.id, ...form! })), `E-mail envoyé à ${form!.to}.`)
    setBusy(false)
    if (r !== undefined) onSent()
  }
  return (
    <Modal title={`Envoyer ${doc.number} par e-mail`} wide onClose={onClose} footer={<>
      <span className="grow muted small">{window.erp.kind === 'desktop' ? 'Le document est joint au format PDF.' : 'Le document est joint (version imprimable).'}</span>
      <button className="btn" onClick={onClose}>Annuler</button>
      <button className="btn btn-primary" disabled={!form || busy || !form.to} onClick={send}><EnvelopeSimple size={18} aria-hidden="true" />{busy ? 'Envoi…' : 'Envoyer'}</button>
    </>}>
      {!form ? <Loading /> : (
        <>
          <Field label="Destinataire(s)" hint="Plusieurs adresses : séparez-les par une virgule.">
            <input type="email" multiple value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} placeholder="client@exemple.bf" />
          </Field>
          <Field label="Objet"><input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></Field>
          <Field label="Message"><textarea rows={10} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></Field>
        </>
      )}
    </Modal>
  )
}

export function SendSmsModal({ doc, onClose, onSent, code, link }: { doc: Doc; onClose: () => void; onSent: () => void; code?: string; link?: string }) {
  const [form, setForm] = useState<{ to: string; body: string } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api('messages.preview', { code: code ?? defaultCode(doc, 'sms'), documentId: doc.id, link })
      .then((p) => setForm({ to: p.to, body: p.body }))
      .catch((e) => notify(e.message, 'error'))
  }, [doc.id, code, link])
  const parts = form ? Math.max(1, Math.ceil(form.body.length / 160)) : 1
  const send = async () => {
    setBusy(true)
    const r = await run(() => api('messages.sendSms', { documentId: doc.id, ...form }), `SMS envoyé au ${form!.to}.`)
    setBusy(false)
    if (r) onSent()
  }
  return (
    <Modal title={`Envoyer un SMS — ${doc.number}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Annuler</button>
      <button className="btn btn-primary" disabled={!form || busy || !form.to} onClick={send}><ChatCircleText size={18} aria-hidden="true" />{busy ? 'Envoi…' : 'Envoyer le SMS'}</button>
    </>}>
      {!form ? <Loading /> : (
        <>
          <Field label="Numéro" hint="8 chiffres pour un numéro du Burkina, sinon format international +…">
            <input type="tel" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} placeholder="70 00 00 00" />
          </Field>
          <Field label="Message" hint={`${form.body.length} caractères · ${parts} SMS`}>
            <textarea rows={5} maxLength={480} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          </Field>
        </>
      )}
    </Modal>
  )
}

/** Signatures du document : sur place, lien à distance, preuves. */
export function SignaturesPanel({ doc }: { doc: Doc }) {
  const { data, reload } = useQuery<any>('signatures.list', { documentId: doc.id })
  const canMessages = useCan('messages')
  const [onSite, setOnSite] = useState(false)
  const [link, setLink] = useState<string | null>(null)
  const [sendBy, setSendBy] = useState<'email' | 'sms' | null>(null)
  if (doc.status !== 'valide') return null
  const sigs: any[] = data?.signatures ?? []
  const createLink = async () => {
    const r = await run(() => api('signatures.request', { documentId: doc.id }))
    if (r) {
      setLink(r.url)
      reload()
    }
  }
  return (
    <div className="card sig-panel">
      <div className="row gap wrap">
        <h3 className="grow" style={{ margin: 0 }}>Signatures</h3>
        <button className="btn" onClick={() => setOnSite(true)}><PenNib size={18} aria-hidden="true" />Faire signer sur place</button>
        <button className="btn btn-tonal" onClick={createLink}><LinkSimple size={18} aria-hidden="true" />Lien de signature à distance</button>
      </div>
      {link && (
        <div className="link-box">
          <code>{link}</code>
          <div className="row gap wrap">
            <button className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(link).then(() => notify('Lien copié.', 'success'))}><Copy size={16} aria-hidden="true" />Copier</button>
            {canMessages && <button className="btn btn-sm" onClick={() => setSendBy('email')}><EnvelopeSimple size={16} aria-hidden="true" />Envoyer par e-mail</button>}
            {canMessages && <button className="btn btn-sm" onClick={() => setSendBy('sms')}><ChatCircleText size={16} aria-hidden="true" />Envoyer par SMS</button>}
          </div>
        </div>
      )}
      {sigs.length === 0 ? (
        <p className="muted">Aucune signature.{data?.pendingRequests ? ` ${data.pendingRequests} lien(s) en attente de signature.` : ''}</p>
      ) : (
        <div className="sig-list">
          {sigs.map((s) => (
            <figure key={s.id} className="sig-item">
              <img src={s.image} alt={`Signature de ${s.signer_name}`} />
              <figcaption>
                <strong>{s.signer_name}</strong>
                <span>{s.method === 'a_distance' ? 'En ligne' : 'Sur place'} · {new Date(s.signed_at).toLocaleString('fr-FR')}</span>
                {s.valid
                  ? <span className="sig-ok"><ShieldCheck size={16} weight="fill" aria-hidden="true" />Contenu identique au document signé</span>
                  : <span className="sig-bad"><WarningCircle size={16} weight="fill" aria-hidden="true" />Le document a changé depuis la signature</span>}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      {onSite && (
        <SignatureModal
          title={`Signature du client — ${doc.number}`}
          askName
          name={doc.party?.contact ?? ''}
          onClose={() => setOnSite(false)}
          onDone={async (png, name) => {
            if (await run(() => api('signatures.signOnSite', { documentId: doc.id, name, image: png, device: navigator.userAgent }), 'Document signé.')) {
              setOnSite(false)
              reload()
            }
          }}
        />
      )}
      {sendBy === 'email' && link && <SendEmailModal doc={doc} code="sign_email" link={link} onClose={() => setSendBy(null)} onSent={() => setSendBy(null)} />}
      {sendBy === 'sms' && link && <SendSmsModal doc={doc} code="sign_sms" link={link} onClose={() => setSendBy(null)} onSent={() => setSendBy(null)} />}
    </div>
  )
}

/** Historique des e-mails et SMS liés au document. */
export function DocumentMessages({ documentId }: { documentId: number }) {
  const { data } = useQuery<any[]>('messages.log', { documentId })
  if (!data || data.length === 0) return null
  return (
    <div className="card">
      <h3>Envois</h3>
      <ul className="rows">
        {data.map((m) => (
          <li key={m.id}>
            <span className={`tint tint-sm tint-${m.status === 'envoye' ? (m.channel === 'email' ? 'primary' : 'info') : 'danger'}`} aria-hidden="true">
              {m.channel === 'email' ? <EnvelopeSimple size={18} weight="duotone" /> : <ChatCircleText size={18} weight="duotone" />}
            </span>
            <div className="grow"><b>{m.channel === 'email' ? m.subject : m.body.slice(0, 60)}</b><span>{m.recipient} · {formatDate(m.created_at)} · {m.user_name ?? ''}</span></div>
            <strong className={m.status === 'envoye' ? 'text-ok' : 'text-danger'}>{m.status === 'envoye' ? <><CheckCircle size={16} weight="fill" aria-hidden="true" /> Envoyé</> : 'Échec'}</strong>
          </li>
        ))}
      </ul>
    </div>
  )
}
