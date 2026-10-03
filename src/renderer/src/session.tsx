import { createContext, useContext } from 'react'
import { can, type Module, type Role } from '@shared/domain'
import type { LicenceStatus } from '@shared/licence'

export interface User {
  id: number
  username: string
  full_name: string
  role: Role
  /** Photo de profil (image encodée), vide sinon. */
  avatar?: string
}

export interface Session {
  user: User
  company: { name: string; currency: string; default_tva: number; tax_id_label: string; logo: string; country?: string; country_code?: string }
  dbMode: DataMode
  /** Adresse du serveur IAM INVOICER quand les données sont sur un domaine. */
  serverUrl: string | null
  logout: () => void
  /** Recharge la société et la licence. */
  refreshCompany: () => void
  licence: LicenceStatus | null
  /** Met à jour l'utilisateur connecté (photo de profil…). */
  updateUser: (patch: Partial<User>) => void
}

export const SessionContext = createContext<Session | null>(null)

export function useSession(): Session {
  const s = useContext(SessionContext)
  if (!s) throw new Error('Session absente')
  return s
}

/** Module licencié (toujours vrai si l'état de licence est inconnu, hors connexion par exemple). */
export function useLicensed(module: Module): boolean {
  const l = useSession().licence
  return !l || l.modules.includes(module)
}

export function useCan(module: Module): boolean {
  return can(useSession().user.role, module)
}
