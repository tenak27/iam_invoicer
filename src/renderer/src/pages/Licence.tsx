// Licence : état, activation d'une clé, comparaison des paliers.

import { useState } from 'react'
import { CheckCircle, Crown, Key, LockSimple, Phone, Rocket, Storefront, XCircle } from '@phosphor-icons/react'
import type { Module } from '@shared/domain'
import { formatDate } from '@shared/format'
import { MODULE_NAMES, TIERS, VENDOR, type Tier } from '@shared/licence'
import { api, run, useQuery } from '../api'
import { Field, PageHeader, notify } from '../components/ui'
import { useSession } from '../session'

const STATE_TEXT = { trial: 'Évaluation', active: 'Active', expired: 'Expirée', trial_over: 'Évaluation terminée', invalid: 'Invalide' }
const TIER_ICON = { essentiel: Storefront, pro: Rocket, entreprise: Crown }
const TIER_TONE = { essentiel: 'kpi-blue', pro: 'kpi-violet', entreprise: 'kpi-amber' }
const SHOWN: Module[] = ['sales', 'cash', 'clients', 'products', 'stock', 'payments', 'reports', 'purchases', 'suppliers', 'accounting', 'messages', 'hr', 'crm', 'projects', 'assets', 'budget']

export function LicencePage() {
  const { licence, user, refreshCompany, company } = useSession()
  const users = useQuery<any[]>('users.list')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const isAdmin = user.role === 'admin'
  const activeUsers = (users.data ?? []).filter((u) => u.active).length

  const activate = async () => {
    setBusy(true)
    const st = await run(() => api<any>('licence.activate', { key }))
    setBusy(false)
    if (st) {
      setKey('')
      notify(`Licence ${st.label} activée. Merci de votre confiance !`, 'success')
      refreshCompany()
    }
  }

  return (
    <div className="page">
      <PageHeader title="Licence" subtitle="Votre offre, les modules inclus et l'activation d'une clé de licence." />
      {licence && (
        <div className="kpi-row">
          <div className="mini-kpi"><span>Offre</span><strong>{licence.label}</strong></div>
          <div className={`mini-kpi ${licence.canWrite ? 'good' : 'bad'}`}><span>État</span><strong>{STATE_TEXT[licence.state]}</strong></div>
          <div className="mini-kpi"><span>Utilisateurs actifs</span><strong>{activeUsers}{licence.users ? ` / ${licence.users}` : ' (illimité)'}</strong></div>
          <div className="mini-kpi">
            <span>{licence.state === 'trial' ? 'Fin de l’évaluation' : 'Échéance'}</span>
            <strong>{licence.state === 'trial' ? `${licence.daysLeft} jour(s)` : licence.expires ? formatDate(licence.expires) : 'Perpétuelle'}</strong>
          </div>
        </div>
      )}
      {licence && <p className={`licence-msg ${licence.canWrite ? '' : 'blocked'}`}>{licence.message}{licence.licenceId ? ` Licence n° ${licence.licenceId}, au nom de ${licence.company}.` : ''}</p>}

      <div className="dash-grid two">
        <div className="card">
          <h3>Modules de votre offre</h3>
          <div className="module-chips">
            {SHOWN.map((m) => {
              const on = !licence || licence.modules.includes(m)
              return (
                <span key={m} className={`module-chip ${on ? 'on' : 'off'}`}>
                  {on ? <CheckCircle size={16} weight="fill" aria-hidden="true" /> : <LockSimple size={16} weight="fill" aria-hidden="true" />}
                  {MODULE_NAMES[m]}
                  <span className="sr-only">{on ? ' (inclus)' : ' (non inclus)'}</span>
                </span>
              )
            })}
          </div>
        </div>
        <div className="card">
          <h3><Key size={20} aria-hidden="true" /> Activer une licence</h3>
          {isAdmin ? (
            <>
              <p className="muted">Collez la clé reçue de {VENDOR.name}. Elle est établie au nom de <strong>{company.name || 'votre société'}</strong> : la raison sociale doit correspondre à celle des paramètres.</p>
              <Field label="Clé de licence"><textarea rows={4} value={key} onChange={(e) => setKey(e.target.value)} placeholder="eyJ2Ijox…" spellCheck={false} className="mono" /></Field>
              <button className="btn btn-primary" disabled={busy || key.trim().length < 40} onClick={activate}><Key size={18} aria-hidden="true" />{busy ? 'Vérification…' : 'Activer'}</button>
            </>
          ) : <p className="muted">Seul un administrateur peut activer une licence.</p>}
        </div>
      </div>

      <h2 className="section-heading">Les offres IAM INVOICER</h2>
      <div className="tier-grid">
        {(Object.keys(TIERS) as Exclude<Tier, 'sur-mesure'>[]).map((t) => {
          const def = TIERS[t]
          const I = TIER_ICON[t]
          const current = licence?.tier === t && licence.state === 'active'
          return (
            <div key={t} className={`tier-card ${current ? 'current' : ''}`}>
              <div className={`tier-head ${TIER_TONE[t]}`}>
                <I size={30} weight="duotone" aria-hidden="true" />
                <div><div className="tier-name">{def.label}</div><div className="tier-users">{def.users ? `${def.users} utilisateurs` : 'Utilisateurs illimités'}</div></div>
                {current && <span className="tier-badge">Votre offre</span>}
              </div>
              <p className="tier-pitch">{def.pitch}</p>
              <ul className="tier-list">
                {SHOWN.map((m) => (
                  <li key={m} className={def.modules.includes(m) ? 'yes' : 'no'}>
                    {def.modules.includes(m) ? <CheckCircle size={16} weight="fill" aria-hidden="true" /> : <XCircle size={16} aria-hidden="true" />}
                    {MODULE_NAMES[m]}
                  </li>
                ))}
                {def.whiteLabel && <li className="yes"><CheckCircle size={16} weight="fill" aria-hidden="true" />Application à votre nom et à votre logo</li>}
              </ul>
            </div>
          )
        })}
      </div>
      <div className="card vendor-card">
        <Phone size={26} weight="duotone" aria-hidden="true" />
        <div>
          <strong>Acheter, compléter ou renouveler une licence</strong>
          <div className="muted">{[VENDOR.name, VENDOR.city, VENDOR.phone, VENDOR.email, VENDOR.website].filter(Boolean).join(' · ')}</div>
          <div className="muted small">Offre sur mesure possible : choisissez seulement les modules dont vous avez besoin.</div>
        </div>
      </div>
    </div>
  )
}
