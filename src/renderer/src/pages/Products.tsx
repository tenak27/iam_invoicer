import { useState } from 'react'
import { formatMoney, formatQty } from '@shared/format'
import { api, exportCsv, run, useQuery } from '../api'
import { confirmDialog, Empty, ErrorBox, Field, Loading, Modal, Money, PageHeader, RowActions, SearchInput, Tabs, useForm } from '../components/ui'
import { ArrowCounterClockwise, Copy, PencilSimple, Prohibit } from '@phosphor-icons/react'
import { useCan, useSession } from '../session'

/** Copie d'un article : nouvelle référence attribuée à l'enregistrement, sans stock. */
function duplicateOf(r: any) {
  const { id: _id, ref: _ref, stock_qty: _qty, ...rest } = r
  return { ...rest, name: `${r.name} (copie)`, active: true, sale_price: String(r.sale_price), purchase_price: String(r.purchase_price), tva_rate: String(r.tva_rate), min_stock: String(r.min_stock) }
}

export function Products() {
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<'' | 'produit' | 'prestation'>('')
  const [inactive, setInactive] = useState(false)
  const [editing, setEditing] = useState<any | null>(null)
  const { data, error, loading, reload } = useQuery<any[]>('products.list', { search, kind, includeInactive: inactive })
  const toggleActive = async (r: any) => {
    if (r.active && !(await confirmDialog(`Désactiver « ${r.name} » ?`, { detail: 'Il ne sera plus proposé dans les documents ni à la caisse. Son historique et son stock sont conservés.' }))) return
    if (await run(() => api('products.save', { ...r, active: !r.active }), r.active ? 'Article désactivé.' : 'Article réactivé.')) reload()
  }
  const canStock = useCan('stock')
  const rows = data ?? []
  return (
    <div className="page">
      <PageHeader
        title="Articles & prestations"
        subtitle={`${rows.length} élément(s)`}
        actions={
          <>
            <button className="btn" disabled={!rows.length} onClick={() => exportCsv('Articles.csv', [
              { label: 'Référence', value: (r) => r.ref }, { label: 'Type', value: (r) => r.kind }, { label: 'Désignation', value: (r) => r.name },
              { label: 'Catégorie', value: (r) => r.category }, { label: 'Unité', value: (r) => r.unit }, { label: 'Prix de vente HT', value: (r) => r.sale_price },
              { label: "Prix d'achat HT", value: (r) => r.purchase_price }, { label: 'TVA %', value: (r) => r.tva_rate }, { label: 'Stock', value: (r) => r.stock_qty },
              { label: 'Coût moyen', value: (r) => Math.round(r.avg_cost) }
            ], rows)}>Exporter (Excel)</button>
            <button className="btn" onClick={() => setEditing({ kind: 'prestation' })}>Nouvelle prestation</button>
            <button className="btn btn-primary" onClick={() => setEditing({ kind: 'produit' })}>Nouveau produit</button>
          </>
        }
      />
      <div className="toolbar">
        <Tabs value={kind} onChange={setKind} tabs={[{ value: '', label: 'Tout' }, { value: 'produit', label: 'Produits' }, { value: 'prestation', label: 'Prestations' }]} />
        <SearchInput value={search} onChange={setSearch} placeholder="Référence, désignation, catégorie…" />
        <label className="inline check"><input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} /> Afficher les inactifs</label>
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Loading /> : rows.length === 0 ? (
        <Empty>Aucun article. Créez vos produits (stockés) et vos prestations de service.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Réf.</th><th>Désignation</th><th>Catégorie</th><th className="num">Prix de vente HT</th><th className="num">Prix d'achat HT</th><th className="num">TVA</th>{canStock && <th className="num">Stock</th>}<th className="actions-col">Actions</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={`clickable ${r.active ? '' : 'inactive'}`} onClick={() => setEditing(r)}>
                  <td className="muted">{r.ref}</td>
                  <td className="strong">{r.name}<span className={`kind-tag ${r.kind}`}>{r.kind === 'produit' ? 'Produit' : 'Prestation'}</span></td>
                  <td>{r.category}</td>
                  <td className="num"><Money value={r.sale_price} /></td>
                  <td className="num"><Money value={r.purchase_price} /></td>
                  <td className="num">{r.tva_rate} %</td>
                  {canStock && <td className="num">{r.kind === 'produit' ? <span className={r.stock_qty <= r.min_stock ? 'text-warn' : ''}>{formatQty(r.stock_qty)} {r.unit}</span> : '—'}</td>}
                  <td className="actions-col">
                    <RowActions actions={[
                      { label: 'Modifier', icon: PencilSimple, tone: 'primary', onClick: () => setEditing(r) },
                      { label: 'Dupliquer', icon: Copy, tone: 'success', onClick: () => setEditing(duplicateOf(r)) },
                      r.active
                        ? { label: 'Désactiver', icon: Prohibit, tone: 'danger', onClick: () => toggleActive(r) }
                        : { label: 'Réactiver', icon: ArrowCounterClockwise, tone: 'warning', onClick: () => toggleActive(r) }
                    ]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <ProductForm product={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </div>
  )
}

function ProductForm({ product, onClose, onSaved }: { product: any; onClose: () => void; onSaved: () => void }) {
  const { company } = useSession()
  const categories = useQuery<string[]>('products.categories')
  const f = useForm<any>({
    ref: '', name: '', description: '', category: '', unit: product.kind === 'prestation' ? 'forfait' : 'unité',
    sale_price: '0', purchase_price: '0', tva_rate: String(company.default_tva), min_stock: '0', active: true, tracking: 'aucun',
    ...product,
    ...(product.id ? { sale_price: String(product.sale_price), purchase_price: String(product.purchase_price), tva_rate: String(product.tva_rate), min_stock: String(product.min_stock) } : {})
  })
  const [busy, setBusy] = useState(false)
  const isProduct = f.values.kind === 'produit'
  const margin = Number(f.values.sale_price) - Number(f.values.purchase_price)
  const submit = async () => {
    setBusy(true)
    const r = await run(() => api('products.save', f.values), 'Article enregistré.')
    setBusy(false)
    if (r) onSaved()
  }
  return (
    <Modal
      wide
      title={product.id ? `${product.ref} — ${product.name}` : isProduct ? 'Nouveau produit' : 'Nouvelle prestation'}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={busy} onClick={submit}>Enregistrer</button></>}
    >
      <div className="grid grid-4">
        <Field label="Désignation" span={2}><input autoFocus {...f.bind('name')} /></Field>
        <Field label="Référence" hint={product.id ? undefined : 'Automatique si vide'}><input {...f.bind('ref')} disabled={!!product.id} /></Field>
        <Field label="Catégorie">
          <input list="categories" {...f.bind('category')} />
          <datalist id="categories">{categories.data?.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="Description (reprise sur les documents)" span={4}><textarea rows={2} {...f.bind('description')} /></Field>
        <Field label="Prix de vente HT"><input inputMode="decimal" {...f.bind('sale_price')} /></Field>
        <Field label={isProduct ? "Prix d'achat HT" : 'Coût de revient HT'}><input inputMode="decimal" {...f.bind('purchase_price')} /></Field>
        <Field label="TVA %">
          <select {...f.bind('tva_rate')}>
            {['18', '0', '5', '10', '15', '20'].map((t) => <option key={t} value={t}>{t} %</option>)}
          </select>
        </Field>
        <Field label="Unité"><input list="units" {...f.bind('unit')} />
          <datalist id="units">{['unité', 'pièce', 'kg', 'litre', 'mètre', 'carton', 'heure', 'jour', 'mois', 'forfait', 'licence'].map((u) => <option key={u} value={u} />)}</datalist>
        </Field>
        {isProduct && <Field label="Stock minimum (alerte)"><input inputMode="decimal" {...f.bind('min_stock')} /></Field>}
        {isProduct && (
          <Field label="Traçabilité" hint="Numéros à saisir à la réception et à la vente">
            <select {...f.bind('tracking')}><option value="aucun">Aucune</option><option value="lot">Par lot (péremption, fabrication)</option><option value="serie">Par numéro de série (une pièce = un numéro)</option></select>
          </Field>
        )}
        <div className="field span-3 muted small" style={{ alignSelf: 'end' }}>
          Marge brute unitaire : <strong>{formatMoney(margin)}</strong>
          {Number(f.values.sale_price) > 0 && ` (${Math.round((margin / Number(f.values.sale_price)) * 100)} %)`}
          {product.id && isProduct && <> · Stock actuel : <strong>{formatQty(product.stock_qty)} {product.unit}</strong> · coût moyen {formatMoney(product.avg_cost)}</>}
        </div>
      </div>
      {product.id && (
        <label className="inline check"><input type="checkbox" checked={!!f.values.active} onChange={(e) => f.set('active', e.target.checked)} /> Actif (proposé dans les documents)</label>
      )}
      {!product.id && isProduct && <p className="muted small">Le stock se met à jour via les réceptions fournisseurs, les livraisons/factures et l’inventaire. Pour un stock de départ, utilisez « État du stock → Entrée / sortie ».</p>}
    </Modal>
  )
}
