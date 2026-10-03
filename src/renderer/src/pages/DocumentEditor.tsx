import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { DOC_TYPES, lineHT, PAYMENT_METHODS, type DocType, type LineInput } from '@shared/domain'
import { computeFullTotals, taxCaption, type AppliedTax, type TaxDef } from '@shared/taxes'
import { amountInWords, formatDate, formatMoney, formatNumber, todayISO } from '@shared/format'
import { api, run, unwrap, useQuery } from '../api'
import { confirmDialog, ErrorBox, Field, Loading, Modal, Money, PageHeader, PaymentBadge, StatusBadge, useForm } from '../components/ui'
import { useCan, useSession } from '../session'
import { DocumentMessages, SendEmailModal, SendSmsModal, SignaturesPanel } from '../components/DocumentComms'
import { ChatCircleText, Copy, DownloadSimple, EnvelopeSimple, Eye, FloppyDisk, Printer, SealCheck, Trash } from '@phosphor-icons/react'
import { DocumentPreview } from '../components/DocumentPreview'

type Line = LineInput & { key: number; product_ref?: string; lot_refs?: string; tracking?: string }
let lineKey = 0
const emptyLine = (tva: number): Line => ({ key: ++lineKey, product_id: null, description: '', quantity: 1, unit_price: 0, discount: 0, tva_rate: tva })

export function DocumentEditor() {
  const { id, type } = useParams<{ id?: string; type?: string }>()
  if (id) return <ExistingDocument key={id} id={Number(id)} />
  if (type && type in DOC_TYPES) return <Editor key={'new-' + type} type={type as DocType} doc={null} onReload={() => {}} />
  return <Navigate to="/" />
}

function ExistingDocument({ id }: { id: number }) {
  const { data, error, loading, reload } = useQuery<any>('documents.get', { id })
  if (error) return <div className="page"><ErrorBox error={error} onRetry={reload} /></div>
  if (loading && !data) return <Loading />
  return <Editor key={`${data.id}-${data.status}-${data.updated_at}`} type={data.type} doc={data} onReload={reload} />
}

function Editor({ type, doc, onReload }: { type: DocType; doc: any | null; onReload: () => void }) {
  const info = DOC_TYPES[type]
  const nav = useNavigate()
  const { company } = useSession()
  const editable = !doc || doc.status === 'brouillon'
  const partyKind = info.side === 'sale' ? 'client' : 'supplier'
  const parties = useQuery<any[]>('parties.options', { kind: partyKind })
  const products = useQuery<any[]>('products.list', {})
  const warehouses = useQuery<any[]>('warehouses.options')
  const projects = useQuery<any[]>('projects.options')
  const [params] = useSearchParams()

  const [header, setHeader] = useState({
    warehouse_id: String(doc?.warehouse_id ?? 1),
    project_id: doc?.project_id ? String(doc.project_id) : '',
    party_id: doc?.party_id ? String(doc.party_id) : (params.get('party') ?? ''),
    date: doc?.date ?? todayISO(),
    due_date: doc?.due_date ?? '',
    reference: doc?.reference ?? '',
    notes: doc?.notes ?? ''
  })
  const [lines, setLines] = useState<Line[]>(() =>
    doc?.lines?.length ? doc.lines.map((l: any) => ({ ...l, key: ++lineKey })) : [emptyLine(company.default_tva)]
  )
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [payOpen, setPayOpen] = useState(false)
  const [sending, setSending] = useState<'email' | 'sms' | null>(null)
  const [msgKey, setMsgKey] = useState(0)
  const canMessages = useCan('messages')

  // Taxes du document : choisies sur un brouillon, figées une fois validé.
  const taxDefs = useQuery<TaxDef[]>('taxes.list', { activeOnly: true, side: info.side === 'purchase' ? 'purchase' : 'sale' })
  const availableTaxes = (taxDefs.data ?? []).filter((t) => type !== 'AV' || t.kind !== 'withholding')
  const [taxCodes, setTaxCodes] = useState<string[] | null>(doc ? ((doc.taxes ?? []) as AppliedTax[]).map((t) => t.code) : null)
  const chosenCodes = taxCodes ?? availableTaxes.filter((t) => t.auto && t.kind === 'addition').map((t) => t.code)
  const toggleTax = (code: string) => {
    setTaxCodes(chosenCodes.includes(code) ? chosenCodes.filter((c) => c !== code) : [...chosenCodes, code])
    setDirty(true)
  }
  const totals = useMemo(
    () => computeFullTotals(
      lines.filter((l) => l.description),
      editable ? availableTaxes.filter((t) => chosenCodes.includes(t.code)) : ((doc?.taxes ?? []) as AppliedTax[])
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, taxDefs.data, chosenCodes.join(','), editable]
  )
  const trackingOf = (l: Line) => l.tracking ?? products.data?.find((x) => x.id === l.product_id)?.tracking ?? 'aucun'

  const setH = (k: keyof typeof header, v: string) => {
    setHeader((h) => ({ ...h, [k]: v }))
    setDirty(true)
  }
  const updateLine = (key: number, patch: Partial<Line>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
    setDirty(true)
  }
  const pickProduct = (key: number, productId: string) => {
    const p = products.data?.find((x) => String(x.id) === productId)
    if (!p) return updateLine(key, { product_id: null })
    updateLine(key, {
      product_id: p.id,
      product_ref: p.ref,
      description: p.name + (p.description ? '\n' + p.description : ''),
      unit_price: info.side === 'sale' ? p.sale_price : p.purchase_price,
      tva_rate: p.tva_rate,
      tracking: p.tracking,
      lot_refs: ''
    })
  }

  const save = async (): Promise<number | undefined> => {
    setBusy(true)
    const r = await run(() =>
      api<{ id: number }>('documents.save', {
        id: doc?.id,
        type,
        ...header,
        party_id: Number(header.party_id) || null,
        warehouse_id: Number(header.warehouse_id) || 1,
        project_id: Number(header.project_id) || null,
        source_id: doc?.source_id ?? null,
        lines: lines.map(({ key: _k, ...l }) => l),
        taxes: chosenCodes
      })
    )
    setBusy(false)
    if (!r) return undefined
    setDirty(false)
    return r.id
  }

  const onSave = async () => {
    const savedId = await save()
    if (!savedId) return
    if (!doc) nav(`/doc/${savedId}`, { replace: true })
    else onReload()
  }

  const onValidate = async () => {
    let applyStock: boolean | undefined
    if (type === 'AV') {
      const hasProducts = lines.some((l) => l.product_id && products.data?.find((p) => p.id === l.product_id)?.kind === 'produit')
      if (hasProducts) applyStock = await confirmDialog('Remettre en stock les articles de cet avoir ?', { detail: 'Choisissez « Annuler » s’il s’agit d’un geste commercial sans retour de marchandise.' })
    }
    const ok = await confirmDialog(`Valider ${info.fem ? 'cette' : 'ce'} ${info.label.toLowerCase()} ?`, {
      detail: info.stock !== 0 ? 'Un numéro définitif sera attribué et le stock sera mis à jour. Le document ne sera plus modifiable.' : 'Un numéro définitif sera attribué. Le document ne sera plus modifiable.'
    })
    if (!ok) return
    const savedId = await save()
    if (!savedId) return
    const r = await run(() => api('documents.validate', { id: savedId, applyStock }), `${info.label} validé${info.fem ? 'e' : ''}.`)
    if (!doc) nav(`/doc/${savedId}`, { replace: true })
    else if (r) onReload()
  }

  const action = async (name: string, msg: string, confirmMsg?: string, detail?: string) => {
    if (confirmMsg && !(await confirmDialog(confirmMsg, { detail, danger: true }))) return
    const r = await run(() => api(name, { id: doc.id }), msg)
    if (r) onReload()
  }

  const convert = async (to: DocType) => {
    const r = await run(() => api<{ id: number }>('documents.convert', { id: doc.id, to }), `${DOC_TYPES[to].label} créé${DOC_TYPES[to].fem ? 'e' : ''} en brouillon.`)
    if (r) nav(`/doc/${r.id}`)
  }

  const duplicate = async () => {
    const r = await run(() => api<{ id: number }>('documents.duplicate', { id: doc.id }), 'Copie créée en brouillon.')
    if (r) nav(`/doc/${r.id}`)
  }

  const remove = async () => {
    if (!(await confirmDialog('Supprimer ce brouillon ?', { danger: true }))) return
    if (await run(() => api('documents.delete', { id: doc.id }), 'Brouillon supprimé.')) nav(`/docs/${type}`)
  }

  const [preview, setPreview] = useState(false)
  const openPreview = async () => {
    if (dirty && editable && doc) await save()
    setPreview(true)
  }

  const pdf = async (mode: 'open' | 'save' | 'print') => {
    if (dirty && editable && doc) await save()
    await run(() => unwrap(window.erp.pdf(doc.id, mode)))
  }

  // Ctrl+S pour enregistrer un brouillon
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editable && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        onSave()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const remaining = doc ? doc.total_ttc - doc.paid : 0
  const title = doc?.number ? `${info.label} ${doc.number}` : doc ? `${info.label} — brouillon` : `${info.fem ? 'Nouvelle' : 'Nouveau'} ${info.label.toLowerCase()}`
  const party = parties.data?.find((p) => String(p.id) === header.party_id)

  return (
    <div className="page">
      <PageHeader
        title={title}
        subtitle={
          <span className="row gap">
            <Link to={`/docs/${type}`}>← {info.plural}</Link>
            {doc && <StatusBadge status={doc.status} />}
            {doc && info.payable && doc.status === 'valide' && <PaymentBadge total={doc.total_ttc} paid={doc.paid} dueDate={doc.due_date} />}
            {doc?.source_id && <span className="muted">issu de <Link to={`/doc/${doc.source_id}`}>{doc.source_number ?? DOC_TYPES[doc.source_type as DocType]?.label}</Link></span>}
            {dirty && <span className="muted">· modifications non enregistrées</span>}
          </span>
        }
        actions={
          editable ? (
            <>
              {doc && <button className="btn btn-ghost" onClick={remove}><Trash size={18} aria-hidden="true" />Supprimer</button>}
              {doc && <button className="btn" onClick={openPreview}><Eye size={18} aria-hidden="true" />Aperçu</button>}
              <button className="btn" onClick={onSave} disabled={busy}><FloppyDisk size={18} aria-hidden="true" />Enregistrer</button>
              <button className="btn btn-primary" onClick={onValidate} disabled={busy}><SealCheck size={18} aria-hidden="true" />Valider</button>
            </>
          ) : (
            <>
              {doc.status === 'valide' && type !== 'FAC' && type !== 'AV' && (
                <button className="btn btn-ghost" onClick={() => action('documents.cancel', 'Document annulé.', `Annuler ${doc.number} ?`, info.stock !== 0 ? 'Les mouvements de stock seront inversés.' : undefined)}>Annuler le document</button>
              )}
              {canMessages && doc.status === 'valide' && info.side === 'sale' && (
                <>
                  <button className="btn" onClick={() => setSending('email')}><EnvelopeSimple size={18} aria-hidden="true" />E-mail</button>
                  <button className="btn" onClick={() => setSending('sms')}><ChatCircleText size={18} aria-hidden="true" />SMS</button>
                </>
              )}
              <button className="btn" onClick={duplicate}><Copy size={18} aria-hidden="true" />Dupliquer</button>
              <button className="btn" onClick={openPreview}><Eye size={18} aria-hidden="true" />Aperçu</button>
              <button className="btn" onClick={openPreview}><Printer size={18} aria-hidden="true" />Imprimer</button>
              <button className="btn" onClick={() => pdf('save')}><DownloadSimple size={18} aria-hidden="true" />PDF</button>
              {doc.status === 'valide' && info.convertsTo.map((to) => (
                <button key={to} className="btn btn-accent" onClick={() => convert(to)}>→ {DOC_TYPES[to].label}</button>
              ))}
              {doc.status === 'valide' && info.payable && remaining > 0.5 && (
                <button className="btn btn-primary" onClick={() => setPayOpen(true)}>{type === 'FAC' ? 'Encaisser' : type === 'AV' ? 'Rembourser' : 'Payer'}</button>
              )}
            </>
          )
        }
      />

      {doc?.secef_code && (
        <div className={`secef-banner ${doc.secef_code.startsWith('SIM-') ? 'sim' : ''}`}>
          <strong>{doc.secef_code.startsWith('SIM-') ? 'Certification SECeF simulée' : 'Facture certifiée SECeF'}</strong>
          <span>Code {doc.secef_code} · NIM {doc.secef_nim} · {doc.secef_counters} · {doc.secef_date}</span>
        </div>
      )}
      <div className="card doc-head">
        <div className="grid grid-4">
          <Field label={info.side === 'sale' ? 'Client' : 'Fournisseur'} span={2}>
            {editable ? (
              <div className="row gap">
                <select value={header.party_id} onChange={(e) => setH('party_id', e.target.value)} className="grow" autoFocus={!doc}>
                  <option value="">— Choisir —</option>
                  {parties.data?.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
                </select>
                <Link className="btn btn-sm" to={partyKind === 'client' ? '/clients' : '/suppliers'} title="Gérer la liste">+</Link>
              </div>
            ) : (
              <div className="readonly"><Link to={`/party/${doc.party_id}`}>{doc.party.name}</Link> <span className="muted">({doc.party.code})</span></div>
            )}
          </Field>
          <Field label="Date">
            {editable ? <input type="date" value={header.date} onChange={(e) => setH('date', e.target.value)} /> : <div className="readonly">{formatDate(doc.date)}</div>}
          </Field>
          {info.payable ? (
            <Field label="Échéance" hint={editable && !header.due_date && party ? `Par défaut : ${party.payment_terms} jours` : undefined}>
              {editable ? <input type="date" value={header.due_date} onChange={(e) => setH('due_date', e.target.value)} /> : <div className="readonly">{formatDate(doc.due_date)}</div>}
            </Field>
          ) : <div />}
          <Field label={info.side === 'sale' ? 'Référence client (commande, marché…)' : 'Référence fournisseur'} span={2}>
            {editable ? <input value={header.reference} onChange={(e) => setH('reference', e.target.value)} /> : <div className="readonly">{doc.reference || '—'}</div>}
          </Field>
          {info.stock !== 0 && (warehouses.data?.length ?? 0) > 1 && (
            <Field label="Dépôt">
              {editable ? (
                <select value={header.warehouse_id} onChange={(e) => setH('warehouse_id', e.target.value)}>{warehouses.data!.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
              ) : <div className="readonly">{warehouses.data!.find((w) => w.id === doc.warehouse_id)?.name}</div>}
            </Field>
          )}
          {(projects.data?.length ?? 0) > 0 && (
            <Field label="Projet">
              {editable ? (
                <select value={header.project_id} onChange={(e) => setH('project_id', e.target.value)}><option value="">—</option>{projects.data!.map((pr) => <option key={pr.id} value={pr.id}>{pr.code} — {pr.name}</option>)}</select>
              ) : <div className="readonly">{doc.project_id ? <Link to={`/projets/${doc.project_id}`}>{projects.data!.find((pr) => pr.id === doc.project_id)?.name ?? 'Voir le projet'}</Link> : '—'}</div>}
            </Field>
          )}
          <Field label="Observations (imprimées sur le document)" span={2}>
            {editable ? <textarea rows={2} value={header.notes} onChange={(e) => setH('notes', e.target.value)} /> : <div className="readonly pre">{doc.notes || '—'}</div>}
          </Field>
        </div>
      </div>

      <div className="card">
        <div className="scroll-x">
        <table className="table lines-table" data-cards="lines">
          <thead>
            <tr>
              {editable && <th style={{ width: 220 }}>Article</th>}
              <th>Désignation</th>
              <th className="num" style={{ width: 90 }}>Qté</th>
              <th className="num" style={{ width: 130 }}>P.U. HT</th>
              <th className="num" style={{ width: 80 }}>Remise %</th>
              <th className="num" style={{ width: 80 }}>TVA %</th>
              <th className="num" style={{ width: 130 }}>Total HT</th>
              {editable && <th style={{ width: 36 }} />}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key}>
                {editable && (
                  <td>
                    <select value={l.product_id ?? ''} onChange={(e) => pickProduct(l.key, e.target.value)} aria-label="Article">
                      <option value="">Ligne libre</option>
                      {products.data?.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.ref} — {p.name}{p.kind === 'produit' ? ` (stock ${formatNumber(p.stock_qty)})` : ''}
                        </option>
                      ))}
                    </select>
                  </td>
                )}
                <td>
                  {editable ? (
                    <>
                      <textarea rows={Math.min(4, (l.description.match(/\n/g)?.length ?? 0) + 1)} value={l.description} onChange={(e) => updateLine(l.key, { description: e.target.value })} placeholder="Désignation" />
                      {trackingOf(l) !== 'aucun' && info.stock !== 0 && (
                        <input className="lot-input" value={l.lot_refs ?? ''} onChange={(e) => updateLine(l.key, { lot_refs: e.target.value })}
                          placeholder={trackingOf(l) === 'serie' ? `${l.quantity} numéro(s) de série, séparés par des virgules` : 'Numéro de lot'}
                          aria-label={trackingOf(l) === 'serie' ? 'Numéros de série' : 'Numéro de lot'} />
                      )}
                    </>
                  ) : (
                    <div className="pre">{l.product_ref && <span className="muted small">{l.product_ref} · </span>}{l.description}{l.lot_refs && <div className="muted small">{trackingOf(l) === 'serie' ? 'N° de série' : 'Lot'} : {l.lot_refs}</div>}</div>
                  )}
                </td>
                <NumCell editable={editable} value={l.quantity} onChange={(v) => updateLine(l.key, { quantity: v })} />
                <NumCell editable={editable} value={l.unit_price} onChange={(v) => updateLine(l.key, { unit_price: v })} />
                <NumCell editable={editable} value={l.discount} onChange={(v) => updateLine(l.key, { discount: v })} />
                <NumCell editable={editable} value={l.tva_rate} onChange={(v) => updateLine(l.key, { tva_rate: v })} />
                <td className="num strong">{formatNumber(lineHT(l))}</td>
                {editable && (
                  <td>
                    <button className="icon-btn" title="Supprimer la ligne" onClick={() => { setLines((ls) => ls.filter((x) => x.key !== l.key)); setDirty(true) }}>×</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {editable && (
          <button className="btn btn-sm add-line" onClick={() => setLines((ls) => [...ls, emptyLine(company.default_tva)])}>+ Ajouter une ligne</button>
        )}

        {editable && availableTaxes.length > 0 && (
          <div className="tax-picker" role="group" aria-label="Taxes et retenues">
            <span className="field-label">Taxes et retenues</span>
            {availableTaxes.map((t) => {
              const on = chosenCodes.includes(t.code)
              return (
                <button key={t.code} type="button" className={`tax-chip ${t.kind} ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggleTax(t.code)}>
                  <span className="tax-dot" aria-hidden="true" />{taxCaption(t)}
                </button>
              )
            })}
          </div>
        )}

        <div className="doc-totals">
          <div className="words muted">{totals.ttc > 0 && info.side === 'sale' && <>Arrêté à la somme de : <em>{amountInWords(totals.ttc)}</em></>}</div>
          <table className="totals">
            <tbody>
              <tr><td>Total HT</td><td><Money value={totals.ht} /></td></tr>
              {totals.byRate.filter((r) => r.rate > 0).map((r) => (
                <tr key={r.rate}><td>TVA {formatNumber(r.rate)} %</td><td><Money value={r.tva} /></td></tr>
              ))}
              {totals.taxes.filter((t) => t.kind === 'addition' && t.value > 0).map((t) => (
                <tr key={t.code}><td>{t.label}</td><td><Money value={t.value} /></td></tr>
              ))}
              <tr className={totals.withheld > 0 ? 'strong' : 'grand'}><td>Total TTC</td><td><Money value={totals.ttc} /></td></tr>
              {totals.taxes.filter((t) => t.kind === 'withholding' && t.value > 0).map((t) => (
                <tr key={t.code} className="withheld"><td>− {taxCaption(t)}</td><td><Money value={-t.value} /></td></tr>
              ))}
              {totals.withheld > 0 && <tr className="grand"><td>Net à payer</td><td><Money value={totals.net} /></td></tr>}
              {doc && info.payable && doc.status === 'valide' && (
                <>
                  <tr><td>Déjà réglé</td><td><Money value={doc.paid} /></td></tr>
                  <tr className="strong"><td>Reste à régler</td><td><Money value={remaining} /></td></tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {doc && info.payable && doc.payments.length > 0 && (
        <div className="card">
          <h3>Règlements</h3>
          <table className="table compact">
            <thead><tr><th>Date</th><th>Mode</th><th>Référence</th><th>Note</th><th className="num">Montant</th><th /></tr></thead>
            <tbody>
              {doc.payments.map((p: any) => (
                <tr key={p.id}>
                  <td>{formatDate(p.date)}</td><td>{p.method}</td><td>{p.reference}</td><td className="muted">{p.note}</td>
                  <td className="num"><Money value={p.amount} /></td>
                  <td className="num">
                    <button className="link-btn danger" onClick={async () => {
                      if (await confirmDialog(`Supprimer le règlement de ${formatMoney(p.amount)} ?`, { danger: true }))
                        if (await run(() => api('payments.delete', { id: p.id }), 'Règlement supprimé.')) onReload()
                    }}>Supprimer</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {doc && info.side === 'sale' && <SignaturesPanel doc={doc} />}
      {doc && canMessages && <DocumentMessages key={msgKey} documentId={doc.id} />}

      {doc && doc.children.length > 0 && (
        <div className="card">
          <h3>Documents liés</h3>
          <div className="row gap wrap">
            {doc.children.map((c: any) => (
              <Link key={c.id} to={`/doc/${c.id}`} className="chip">
                {DOC_TYPES[c.type as DocType].label} {c.number ?? '(brouillon)'} · {formatMoney(c.total_ttc)} <StatusBadge status={c.status} />
              </Link>
            ))}
          </div>
        </div>
      )}

      {doc && <p className="muted small">Créé par {doc.created_by_name ?? '—'}{doc.validated_at ? ` · validé le ${new Date(doc.validated_at).toLocaleString('fr-FR')}` : ''}</p>}

      {sending === 'email' && <SendEmailModal doc={doc} onClose={() => setSending(null)} onSent={() => { setSending(null); setMsgKey((k) => k + 1) }} />}
      {sending === 'sms' && <SendSmsModal doc={doc} onClose={() => setSending(null)} onSent={() => { setSending(null); setMsgKey((k) => k + 1) }} />}
      {preview && doc && <DocumentPreview id={doc.id} ticket={type === 'FAC'} onClose={() => setPreview(false)} />}
      {payOpen && <PaymentModal doc={doc} remaining={remaining} onClose={() => setPayOpen(false)} onDone={() => { setPayOpen(false); onReload() }} />}
    </div>
  )
}

function NumCell({ editable, value, onChange }: { editable: boolean; value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value ?? 0))
  useEffect(() => {
    if (parseFloat(text.replace(',', '.')) !== value) setText(String(value ?? 0))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  if (!editable) return <td className="num">{formatNumber(value, value % 1 ? 2 : 0)}</td>
  return (
    <td>
      <input
        className="num-input"
        inputMode="decimal"
        value={text}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          setText(e.target.value)
          const n = parseFloat(e.target.value.replace(/\s/g, '').replace(',', '.'))
          onChange(Number.isFinite(n) ? n : 0)
        }}
      />
    </td>
  )
}

export function PaymentModal({ doc, remaining, onClose, onDone }: { doc: any; remaining: number; onClose: () => void; onDone: () => void }) {
  const f = useForm({ amount: String(Math.round(remaining)), date: todayISO(), method: 'Espèces', reference: '', note: '' })
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    const r = await run(() => api('payments.add', { document_id: doc.id, ...f.values, amount: Number(f.values.amount.replace(/\s/g, '')) }), 'Règlement enregistré.')
    setBusy(false)
    if (r) onDone()
  }
  return (
    <Modal
      title={`Règlement — ${doc.number}`}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={busy} onClick={submit}>Enregistrer</button></>}
    >
      <p className="muted">Reste à régler : <strong>{formatMoney(remaining)}</strong></p>
      <div className="grid grid-2">
        <Field label="Montant"><input autoFocus inputMode="numeric" {...f.bind('amount')} /></Field>
        <Field label="Date"><input type="date" {...f.bind('date')} /></Field>
        <Field label="Mode de paiement">
          <select {...f.bind('method')}>{PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}</select>
        </Field>
        <Field label="Référence (n° chèque, transaction…)"><input {...f.bind('reference')} /></Field>
        <Field label="Note" span={2}><input {...f.bind('note')} /></Field>
      </div>
    </Modal>
  )
}
