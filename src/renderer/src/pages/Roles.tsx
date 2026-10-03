// Matrice des rôles et des fonctionnalités : qui peut faire quoi.

import { useEffect, useState } from 'react'
import { ArrowCounterClockwise, Check, FloppyDisk, ShieldCheck } from '@phosphor-icons/react'
import { ROLE_LABELS, setRolePermissions, type Module, type Role } from '@shared/domain'
import { MODULE_NAMES, moduleLicensed } from '@shared/licence'
import { api, run, useQuery } from '../api'
import { confirmDialog, ErrorBox, Loading, PageHeader } from '../components/ui'
import { KpiStrip } from '../components/KpiStrip'
import { useSession } from '../session'

/** Ce que permet chaque module. */
const FEATURES: Record<Module, string> = {
  dashboard: 'Indicateurs, ventes du mois, créances, trésorerie',
  sales: 'Devis, bons de livraison, factures, avoirs, relances',
  purchases: 'Bons de commande, réceptions, factures fournisseurs',
  stock: 'État du stock, mouvements, inventaire, dépôts, lots',
  payments: 'Encaissements et décaissements, soldes',
  clients: 'Fiches clients, historique, import',
  suppliers: 'Fiches fournisseurs, import',
  products: 'Articles et prestations, prix, TVA',
  reports: 'Chiffre d’affaires, marges, TVA',
  cash: 'Point de vente, sessions et clôture de caisse',
  accounting: 'Journaux, grand livre, balance, bilan, déclarations',
  messages: 'E-mails, SMS, relances, modèles',
  hr: 'Salariés, paie, bulletins, congés, déclarations sociales',
  crm: 'Opportunités, activités, agenda commercial',
  projects: 'Projets, temps passés, facturation des heures',
  assets: 'Immobilisations, amortissements, cessions',
  budget: 'Budgets, trésorerie prévisionnelle',
  settings: 'Société, taxes, documents, messagerie, licence',
  users: 'Comptes utilisateurs, rôles et droits, journal d’activité',
  licensing: 'Émission des licences clients, registre, renouvellements (poste de l’éditeur)'
}

const ALL_ROLES = Object.keys(ROLE_LABELS) as Role[]

export function RolesPage() {
  const { user, licence } = useSession()
  const { data, error, loading, reload } = useQuery<{ defaults: Record<Role, Module[]>; current: Record<Role, Module[]>; customized: boolean }>('roles.get')
  const [matrix, setMatrix] = useState<Record<Role, Module[]> | null>(null)
  useEffect(() => {
    if (data) setMatrix(data.current)
  }, [data])
  if (error) return <ErrorBox error={error} onRetry={reload} />
  if (loading || !data || !matrix) return <Loading />

  const editable = user.role === 'admin'
  // Profil « Gestionnaire de licences » : uniquement chez l'éditeur
  const vendor = !!licence?.vendor
  const ROLES = ALL_ROLES.filter((r) => r !== 'licences' || vendor)
  const modules = data.defaults.admin.filter((m) => m !== 'licensing' || vendor)
  const dirty = JSON.stringify(matrix) !== JSON.stringify(data.current)
  const toggle = (role: Role, m: Module) =>
    setMatrix({ ...matrix, [role]: matrix[role].includes(m) ? matrix[role].filter((x) => x !== m) : [...matrix[role], m] })
  const save = async (current: Record<Role, Module[]> | null) => {
    const r = await run(() => api<any>('roles.save', { current }), current ? 'Droits enregistrés.' : 'Droits par défaut rétablis.')
    if (r) {
      setRolePermissions(r.current)
      reload()
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Rôles et droits"
        subtitle="Qui peut faire quoi : cochez les modules accessibles à chaque rôle. L'administrateur a toujours tous les droits."
        actions={editable && (
          <>
            <button className="btn" disabled={!data.customized} onClick={async () => { if (await confirmDialog('Rétablir les droits par défaut ?')) save(null) }}><ArrowCounterClockwise size={18} aria-hidden="true" />Droits par défaut</button>
            <button className="btn btn-primary" disabled={!dirty} onClick={() => save(matrix)}><FloppyDisk size={18} aria-hidden="true" />Enregistrer</button>
          </>
        )}
      />
      <KpiStrip items={[
        { label: 'Rôles', value: ROLES.length, icon: ShieldCheck },
        { label: 'Modules', value: modules.length, icon: Check },
        { label: 'Droits accordés', value: ROLES.reduce((s, r) => s + matrix[r].length, 0), icon: Check, tone: 'good' }
      ]} />
      <div className="table-wrap">
        <table className="table compact role-matrix">
          <thead>
            <tr>
              <th>Module et fonctionnalités</th>
              {ROLES.map((r) => <th key={r} className="center">{ROLE_LABELS[r]}</th>)}
            </tr>
          </thead>
          <tbody>
            {modules.map((m) => {
              const outOfLicence = licence && !moduleLicensed(licence, m)
              return (
                <tr key={m} className={outOfLicence ? 'inactive' : ''}>
                  <td>
                    <strong>{MODULE_NAMES[m]}</strong>{outOfLicence && <span className="muted small"> · hors licence</span>}
                    <div className="muted small">{FEATURES[m]}</div>
                  </td>
                  {ROLES.map((r) => {
                    const on = matrix[r].includes(m)
                    const changed = on !== data.defaults[r].includes(m)
                    return (
                      <td key={r} className="center">
                        <input
                          type="checkbox"
                          className={`role-check ${changed ? 'changed' : ''}`}
                          checked={on}
                          disabled={!editable || r === 'admin'}
                          aria-label={`${ROLE_LABELS[r]} : ${MODULE_NAMES[m]}`}
                          onChange={() => toggle(r, m)}
                        />
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">Les cases entourées diffèrent des droits par défaut. Les changements s'appliquent immédiatement sur le serveur ; les autres utilisateurs les voient à leur prochaine connexion ou au rechargement de la page.</p>
    </div>
  )
}
