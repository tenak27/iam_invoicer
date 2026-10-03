// Champs d'identité de la société partagés entre la configuration initiale et
// « Société & paramètres » : logo, pays (qui règle libellés fiscaux, devise, TVA,
// régimes) et mentions légales.

import { ImageSquare, Warning } from '@phosphor-icons/react'
import { COUNTRIES, countryDefaults, countryProfile } from '@shared/countries'
import { run, unwrap } from '../api'
import { Field } from './ui'

type Form = {
  values: Record<string, any>
  set: (key: string, value: any) => void
  setValues: (fn: (v: any) => any) => void
  bind: (key: string) => { value: any; onChange: (e: { target: { value: string } }) => void }
}

/** Zone de choix d'une image (logo, cachet…), avec aperçu. */
export function ImagePicker({ value, onChange, label = 'Logo', hint = 'Cliquer pour choisir (PNG, JPG ou SVG, 1 Mo max.)' }: { value: string; onChange: (v: string) => void; label?: string; hint?: string }) {
  const pick = async () => {
    const img = await run(() => unwrap(window.erp.pickImage()))
    if (img) onChange(img)
  }
  return (
    <div className="field logo-field">
      <span className="field-label">{label}</span>
      <div className="logo-box" onClick={pick} role="button" tabIndex={0} aria-label={`Choisir : ${label}`} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && pick()}>
        {value ? <img src={value} alt={label} /> : <span className="logo-empty"><ImageSquare size={30} weight="duotone" aria-hidden="true" /><span className="muted small">{hint}</span></span>}
      </div>
      {value && <button type="button" className="link-btn danger small" onClick={() => onChange('')}>Retirer</button>}
    </div>
  )
}

/** Choix du pays : applique devise, TVA, libellé fiscal et ville par défaut. */
export function CountryField({ f, span }: { f: Form; span?: 1 | 2 | 3 | 4 }) {
  const p = countryProfile(f.values.country_code, f.values.country)
  return (
    <Field label="Pays" span={span}>
      <select
        value={p.code}
        onChange={(e) => {
          const next = countryProfile(e.target.value)
          f.setValues((v: any) => ({ ...v, ...countryDefaults(next), city: next.capital || v.city }))
        }}
      >
        {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
      </select>
    </Field>
  )
}

/** Mentions fiscales selon le pays : identifiant fiscal, registre, régime, service des impôts. */
export function FiscalFields({ f }: { f: Form }) {
  const p = countryProfile(f.values.country_code, f.values.country)
  const other = p.code === 'XX'
  return (
    <>
      {other && <Field label="Nom du pays"><input {...f.bind('country')} /></Field>}
      {other && <Field label="Libellé de l'identifiant fiscal" hint="Ex. NIF, NIU, IFU"><input {...f.bind('tax_id_label')} /></Field>}
      <Field label={`${p.register}`}><input {...f.bind('rccm')} placeholder={p.code === 'BF' ? 'BF-OUA-01-2024-B12-01234' : ''} /></Field>
      <Field label={`N° ${other ? f.values.tax_id_label || 'identifiant fiscal' : p.taxId.short}`} hint={other ? undefined : p.taxId.long}>
        <input {...f.bind('tax_id')} />
      </Field>
      <Field label="Régime fiscal" span={2}>
        <select {...f.bind('regime_fiscal')}>
          {p.regimes.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          {f.values.regime_fiscal && !p.regimes.some((r) => r.value === f.values.regime_fiscal) && <option value={f.values.regime_fiscal}>{f.values.regime_fiscal}</option>}
        </select>
      </Field>
      <Field label="Service des impôts de rattachement" span={2}><input {...f.bind('division_fiscale')} placeholder={p.taxOfficeHint} /></Field>
      <Field label="Devise"><input {...f.bind('currency')} /></Field>
      <Field label={`${p.vatName} par défaut (%)`}><input inputMode="decimal" {...f.bind('default_tva')} /></Field>
      {!p.verified && (
        <p className="span-4 country-note">
          <Warning size={16} weight="fill" aria-hidden="true" />
          Valeurs proposées pour {p.name} ({p.vatName} {p.defaultTva} %, {p.socialSecurity}, {p.wageTax}) : faites-les confirmer par votre comptable. Elles restent modifiables.
        </p>
      )}
    </>
  )
}
