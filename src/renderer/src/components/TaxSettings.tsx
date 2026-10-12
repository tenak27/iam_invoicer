// Société & paramètres → Taxes : taxes additionnelles et retenues à la source.

import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { CalendarCheck, DownloadSimple, PencilSimple, Plus, Trash } from '@phosphor-icons/react'
import { TAX_BASE_LABELS, TAX_KIND_LABELS, taxCaption, type TaxDef, type TaxGuideEntry } from '@shared/taxes'
import { formatMoney } from '@shared/format'
import { api, run, useQuery } from '../api'
import { confirmDialog, Empty, ErrorBox, Field, Loading, Modal, RowActions, useForm } from './ui'

type Tax = TaxDef & { id?: number }

const SIDE_LABELS = { sale: 'Ventes', purchase: 'Achats', both: 'Ventes et achats' }

const HANDLED = { oui: ['Géré', 'badge-valide'], partiel: ['En partie', 'pay-partielle'], non: ['À suivre à part', 'badge-brouillon'] } as const

/** Panorama des impôts et taxes du pays, avec l'endroit où l'application traite chacun. */
function TaxGuide() {
  const { data } = useQuery<{ country: string; code: string; entries: TaxGuideEntry[] }>('taxes.guide')
  if (!data?.entries.length) return null
  return (
    <div className="card">
      <div className="row space-between wrap gap">
        <h3>Impôts et taxes applicables — {data.country}</h3>
        <NavLink className="btn" to="/declarations"><CalendarCheck size={18} aria-hidden="true" />Préparer les déclarations du mois</NavLink>
      </div>
      <p className="muted">Ce que doit déclarer une entreprise, et où l'application le calcule. Les taux et échéances sont des repères de gestion : faites-les confirmer par votre comptable, la DGI ou la CNSS. Ils se modifient ci-dessous (taxes des factures), dans RH et paie (IUTS, CNSS, TPA) et dans l'onglet Société (taux de l'impôt sur les bénéfices).</p>
      <div className="tax-guide">
        {data.entries.map((e, i) => (
          <article key={e.code} className="tax-item" style={{ animationDelay: `${i * 40}ms` }}>
            <header><strong>{e.name}</strong><span className={`badge ${HANDLED[e.handled][1]}`}>{HANDLED[e.handled][0]}</span></header>
            <dl>
              <div><dt>Taux</dt><dd>{e.rate}</dd></div>
              <div><dt>Base</dt><dd>{e.base}</dd></div>
              <div><dt>Échéance</dt><dd>{e.period}</dd></div>
              <div><dt>Dans l'application</dt><dd>{e.where}</dd></div>
            </dl>
          </article>
        ))}
      </div>
    </div>
  )
}

export function TaxSettings() {
  return (
    <>
      <TaxGuide />
      <InvoiceTaxes />
    </>
  )
}

function InvoiceTaxes() {
  // seed : à la première ouverture, les modèles du pays sont installés d'eux-mêmes
  const { data, error, loading, reload } = useQuery<Tax[]>('taxes.list', { seed: true })
  const [editing, setEditing] = useState<Tax | null>(null)
  const importPresets = async () => {
    const n = await run(() => api<number>('taxes.importPresets'))
    if (n !== undefined) reload()
  }
  const remove = async (t: Tax) => {
    if (await confirmDialog(`Supprimer la taxe « ${t.label} » ?`, { danger: true, detail: 'Les documents déjà établis gardent leurs montants.' }))
      if (await run(() => api('taxes.delete', { id: t.id }), 'Taxe supprimée.')) reload()
  }
  return (
    <div className="card">
      <div className="row space-between wrap gap">
        <h3>Taxes et retenues sur les factures</h3>
        <div className="row gap wrap">
          <button className="btn" onClick={importPresets}><DownloadSimple size={18} aria-hidden="true" />Ajouter les modèles du pays</button>
          <button className="btn btn-primary" onClick={() => setEditing({ code: '', label: '', kind: 'addition', base: 'ht', rate: 0, amount: 0, account_sale: '447', account_purchase: '645', applies_to: 'both', auto: false, active: true })}><Plus size={18} aria-hidden="true" />Nouvelle taxe</button>
        </div>
      </div>
      <p className="muted">
        La TVA se règle ligne par ligne. Ici : les <strong>taxes ajoutées au total</strong> (droit de timbre, taxe spécifique…) et les <strong>retenues à la source</strong>,
        déduites du net à payer et enregistrées automatiquement comme règlement à la validation. Une taxe active se choisit sur chaque facture ; aucune n'est appliquée d'office, sauf si vous cochez « automatique ». Faites confirmer les taux par votre comptable.
      </p>
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Loading /> : !data!.length ? (
        <Empty>Aucune taxe paramétrée. Ajoutez les modèles du pays ou créez une taxe.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Code</th><th>Taxe</th><th>Type</th><th>Calcul</th><th>Comptes</th><th>État</th><th className="actions-col">Actions</th></tr></thead>
            <tbody>
              {data!.map((t) => (
                <tr key={t.id} className={`clickable ${t.active ? '' : 'inactive'}`} onClick={() => setEditing(t)}>
                  <td className="strong nowrap">{t.code}</td>
                  <td>{t.label}<div className="muted small">{SIDE_LABELS[t.applies_to]}{t.auto ? ' · automatique' : ''}</div></td>
                  <td><span className={`badge ${t.kind === 'withholding' ? 'pay-partielle' : 'badge-valide'}`}>{t.kind === 'withholding' ? 'Retenue' : 'Ajoutée'}</span></td>
                  <td className="nowrap">{t.base === 'fixed' ? formatMoney(t.amount) : `${String(t.rate).replace('.', ',')} % ${TAX_BASE_LABELS[t.base]}`}</td>
                  <td className="muted nowrap">{[t.applies_to !== 'purchase' && `V : ${t.account_sale}`, t.applies_to !== 'sale' && `A : ${t.account_purchase}`].filter(Boolean).join(' · ')}</td>
                  <td>{t.active ? 'Active' : 'Inactive'}</td>
                  <td className="actions-col">
                    <RowActions actions={[
                      { label: 'Modifier', icon: PencilSimple, tone: 'primary', onClick: () => setEditing(t) },
                      { label: 'Supprimer', icon: Trash, tone: 'danger', onClick: () => remove(t) }
                    ]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <TaxForm tax={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </div>
  )
}

function TaxForm({ tax, onClose, onSaved }: { tax: Tax; onClose: () => void; onSaved: () => void }) {
  const f = useForm<any>({ ...tax, rate: String(tax.rate), amount: String(tax.amount) })
  const v = f.values
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    const r = await run(() => api('taxes.save', { ...v, rate: Number(String(v.rate).replace(',', '.')), amount: Number(v.amount) }), 'Taxe enregistrée.')
    setBusy(false)
    if (r) onSaved()
  }
  const withholding = v.kind === 'withholding'
  return (
    <Modal
      wide
      title={tax.id ? `Taxe ${tax.code}` : 'Nouvelle taxe'}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={busy} onClick={submit}>Enregistrer</button></>}
    >
      <div className="grid grid-4">
        <Field label="Code"><input {...f.bind('code')} placeholder="TIMBRE" /></Field>
        <Field label="Libellé (imprimé sur les documents)" span={3}><input {...f.bind('label')} /></Field>
        <Field label="Type" span={2}>
          <select {...f.bind('kind')}>{Object.entries(TAX_KIND_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </Field>
        <Field label="S'applique aux" span={2}>
          <select {...f.bind('applies_to')}>{Object.entries(SIDE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </Field>
        <Field label="Calcul" span={2}>
          <select {...f.bind('base')}>
            <option value="ht">Pourcentage du montant HT</option>
            <option value="tva">Pourcentage de la TVA</option>
            <option value="ttc">Pourcentage du montant TTC</option>
            <option value="fixed">Montant fixe par document</option>
          </select>
        </Field>
        {v.base === 'fixed'
          ? <Field label="Montant"><input inputMode="numeric" {...f.bind('amount')} /></Field>
          : <Field label="Taux (%)"><input inputMode="decimal" {...f.bind('rate')} /></Field>}
        <div />
        {v.applies_to !== 'purchase' && (
          <Field label="Compte (ventes)" span={2} hint={withholding ? 'Débité : créance sur l’État (ex. 449)' : 'Crédité : taxe à reverser (ex. 447)'}><input {...f.bind('account_sale')} /></Field>
        )}
        {v.applies_to !== 'sale' && (
          <Field label="Compte (achats)" span={2} hint={withholding ? 'Crédité : retenue à reverser à l’État (ex. 447)' : 'Débité : charge (ex. 645, 646)'}><input {...f.bind('account_purchase')} /></Field>
        )}
      </div>
      <div className="row gap wrap" style={{ marginTop: 12 }}>
        <label className="inline check"><input type="checkbox" checked={!!v.active} onChange={(e) => f.set('active', e.target.checked)} /> Active</label>
        {!withholding && <label className="inline check"><input type="checkbox" checked={!!v.auto} onChange={(e) => f.set('auto', e.target.checked)} /> Ajouter automatiquement aux nouveaux documents</label>}
      </div>
      <p className="muted small" style={{ marginTop: 10 }}>
        Aperçu sur une facture : « {taxCaption({ label: v.label || 'Taxe', base: v.base, rate: Number(String(v.rate).replace(',', '.')) || 0 })} »
        {withholding ? ', déduite du net à payer.' : ', ajoutée au total TTC.'}
      </p>
    </Modal>
  )
}
