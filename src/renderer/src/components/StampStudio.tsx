// Atelier de cachet : forme, encre et textes choisis en direct, aperçu immédiat, puis conversion
// en PNG à fond transparent enregistrée comme cachet de la société.
import { useMemo, useState } from 'react'
import { defaultStampSpec, stampSvg, STAMP_COLORS, STAMP_SHAPES, type StampSpec } from '@shared/stamp'
import { Field, Modal } from './ui'

const NL = String.fromCharCode(10)

/** Image à fond transparent (WebP, sinon PNG) d'un SVG dessiné dans un canevas ; le plus grand côté fait `maxSide` pixels. */
export function svgToPng(svg: string, maxSide = 1000): Promise<string> {
  return new Promise((resolve, reject) => {
    const m = /viewBox="0 0 ([0-9]+) ([0-9]+)"/.exec(svg)
    const w = m ? Number(m[1]) : 600
    const h = m ? Number(m[2]) : 600
    const k = maxSide / Math.max(w, h)
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(w * k)
      canvas.height = Math.round(h * k)
      const ctx = canvas.getContext('2d')
      if (!ctx) return reject(new Error('Canevas indisponible sur cet appareil.'))
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      try {
        // WebP à fond transparent quand le navigateur sait l'écrire (environ dix fois plus léger qu'un PNG), sinon PNG
        const webp = canvas.toDataURL('image/webp', 0.92)
        resolve(webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png'))
      } catch (e) {
        reject(e)
      }
    }
    img.onerror = () => reject(new Error("Le cachet n'a pas pu être dessiné."))
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  })
}

export function StampStudio({ company, onClose, onDone }: { company: Record<string, any>; onClose: () => void; onDone: (png: string) => void }) {
  const [spec, setSpec] = useState<StampSpec>(() => defaultStampSpec(company))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const svg = useMemo(() => stampSvg(spec), [spec])
  const src = useMemo(() => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), [svg])
  const set = <K extends keyof StampSpec>(k: K, v: StampSpec[K]) => setSpec((s) => ({ ...s, [k]: v }))
  const use = async () => {
    setBusy(true)
    setErr('')
    try {
      onDone(await svgToPng(svg))
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title="Créer un cachet"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={busy || !spec.top.trim()} onClick={use}>{busy ? 'Préparation…' : 'Utiliser ce cachet'}</button>
        </>
      }
    >
      <div className="stamp-studio">
        <div className="stamp-preview" aria-live="polite">
          <img key={spec.shape + spec.color} src={src} alt="Aperçu du cachet" />
        </div>
        <div className="stamp-form">
          <div className="field">
            <span className="field-label">Forme</span>
            <div className="chips">
              {STAMP_SHAPES.map((s) => (
                <button type="button" key={s.id} className={`chip ${spec.shape === s.id ? 'on' : ''}`} aria-pressed={spec.shape === s.id} onClick={() => set('shape', s.id)}>{s.label}</button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="field-label">Encre</span>
            <div className="swatches">
              {STAMP_COLORS.map((c) => (
                <button type="button" key={c.id} className={`swatch ${spec.color === c.hex ? 'on' : ''}`} style={{ background: c.hex }} title={c.label} aria-label={c.label} aria-pressed={spec.color === c.hex} onClick={() => set('color', c.hex)} />
              ))}
              <label className="swatch custom" title="Autre couleur">
                <input type="color" value={spec.color} onChange={(e) => set('color', e.target.value)} aria-label="Autre couleur" />
              </label>
            </div>
          </div>
          <Field label="Texte du haut (nom de la société)">
            <input value={spec.top} maxLength={60} onChange={(e) => set('top', e.target.value)} />
          </Field>
          <Field label="Texte du bas (ville, pays)">
            <input value={spec.bottom} maxLength={60} onChange={(e) => set('bottom', e.target.value)} />
          </Field>
          <Field label="Lignes du centre (une par ligne, quatre au plus)" hint="Forme juridique, RCCM, IFU, téléphone…">
            <textarea rows={4} value={spec.lines.join(NL)} onChange={(e) => set('lines', e.target.value.split(NL).slice(0, 4).map((l) => l.slice(0, 40)))} />
          </Field>
          <div className="row gap wrap">
            <label className="inline check"><input type="checkbox" checked={spec.worn} onChange={(e) => set('worn', e.target.checked)} /> Encre irrégulière (effet tampon)</label>
            <label className="inline check"><input type="checkbox" checked={spec.stars} onChange={(e) => set('stars', e.target.checked)} /> Étoiles</label>
          </div>
          {err && <p className="error small">{err}</p>}
          <p className="muted small">Le cachet est enregistré en image à fond transparent, puis apposé sur les documents de vente validés et les bons de commande.</p>
        </div>
      </div>
    </Modal>
  )
}
