// Signatures enregistrées de la société : liste (vignette, nom, qualité, signature par défaut) et
// fenêtre d'ajout ou de modification (dessin au doigt ou à la souris, nom tapé, image importée).
import { useState } from 'react'
import { MAX_SIGNATORIES, type Signatory } from '@shared/signatories'
import { PencilSimple, Plus, Star, Trash } from '@phosphor-icons/react'
import { Field, Modal } from './ui'
import { SignaturePad } from './SignaturePad'

const newId = () => (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, 36)
const withDefault = (list: Signatory[]) => (list.length && !list.some((s) => s.default) ? list.map((s, i) => ({ ...s, default: i === 0 })) : list)

export function Signatories({ value, onChange, defaultName, pickImage }: {
  value: Signatory[]
  onChange: (list: Signatory[]) => void
  /** Nom proposé pour la première signature (l'utilisateur connecté). */
  defaultName?: string
  pickImage: () => Promise<string | null | undefined>
}) {
  const [editing, setEditing] = useState<Signatory | null>(null)
  const save = (s: Signatory) => {
    const exists = value.some((x) => x.id === s.id)
    onChange(withDefault(exists ? value.map((x) => (x.id === s.id ? s : x)) : [...value, s]))
    setEditing(null)
  }
  const remove = (id: string) => onChange(withDefault(value.filter((x) => x.id !== id)))
  const makeDefault = (id: string) => onChange(value.map((x) => ({ ...x, default: x.id === id })))
  const add = () => setEditing({ id: newId(), name: value.length ? '' : defaultName ?? '', title: value.length ? '' : 'Le Directeur', image: '', default: value.length === 0 })
  return (
    <div className="signers">
      <div className="row between wrap gap">
        <span className="field-label">Signatures enregistrées</span>
        {value.length < MAX_SIGNATORIES && <button type="button" className="btn btn-sm" onClick={add}><Plus weight="bold" /> Ajouter une signature</button>}
      </div>
      {value.length === 0 ? (
        <div className="signers-empty muted small">Aucune signature. Ajoutez celle du responsable : elle sera apposée sur les documents validés.</div>
      ) : (
        <ul className="signers-list">
          {value.map((s) => (
            <li key={s.id} className={`signer ${s.default ? 'is-default' : ''}`}>
              <div className="signer-thumb">{s.image ? <img src={s.image} alt="" /> : <span className="signer-typed">{s.name || '—'}</span>}</div>
              <div className="signer-text">
                <strong>{s.name || 'Sans nom'}</strong>
                <span className="muted small">{s.title || 'Qualité non précisée'}</span>
                {s.default && <span className="tag">Par défaut</span>}
              </div>
              <div className="signer-actions">
                {!s.default && <button type="button" className="link-btn small" title="Signature apposée quand le document n'en précise pas" onClick={() => makeDefault(s.id)}><Star /> Par défaut</button>}
                <button type="button" className="link-btn small" onClick={() => setEditing(s)}><PencilSimple /> Modifier</button>
                <button type="button" className="link-btn danger small" onClick={() => remove(s.id)}><Trash /> Retirer</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && <SignerModal value={editing} isNew={!value.some((x) => x.id === editing.id)} onClose={() => setEditing(null)} onSave={save} pickImage={pickImage} />}
    </div>
  )
}

function SignerModal({ value, isNew, onClose, onSave, pickImage }: { value: Signatory; isNew: boolean; onClose: () => void; onSave: (s: Signatory) => void; pickImage: () => Promise<string | null | undefined> }) {
  const [name, setName] = useState(value.name)
  const [title, setTitle] = useState(value.title)
  const [image, setImage] = useState(value.image)
  const [drawing, setDrawing] = useState(!value.image)
  const importImage = async () => {
    const img = await pickImage()
    if (img) {
      setImage(img)
      setDrawing(false)
    }
  }
  return (
    <Modal
      title={isNew ? 'Nouvelle signature' : 'Modifier la signature'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={name.trim().length < 2} onClick={() => onSave({ ...value, name: name.trim(), title: title.trim(), image })}>Enregistrer</button>
        </>
      }
    >
      <div className="grid grid-2">
        <Field label="Nom du signataire"><input autoFocus value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={120} /></Field>
        <Field label="Qualité"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Le Directeur Général" maxLength={120} /></Field>
      </div>
      <div className="field" style={{ marginTop: 10 }}>
        <span className="field-label">Signature</span>
        {drawing ? (
          <SignaturePad onChange={(png) => setImage(png ?? '')} typedName={name} />
        ) : (
          <div className="signer-preview">{image ? <img src={image} alt="Signature" /> : <span className="muted small">Aucune image : seule la mention sera imprimée.</span>}</div>
        )}
        <div className="row gap wrap" style={{ marginTop: 8 }}>
          {!drawing && <button type="button" className="link-btn small" onClick={() => { setImage(''); setDrawing(true) }}>Dessiner à nouveau</button>}
          <button type="button" className="link-btn small" onClick={importImage}>Importer une image</button>
          {image && !drawing && <button type="button" className="link-btn danger small" onClick={() => setImage('')}>Retirer l'image</button>}
        </div>
      </div>
    </Modal>
  )
}
