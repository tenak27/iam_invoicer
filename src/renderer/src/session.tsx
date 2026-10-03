import { createContext, useContext } from 'react'
import { can, type Module, type Role } from '@shared/domain'

export interface User {
  id: number
  username: string
  full_name: string
  role: Role
}

export interface Session {
  user: User
  company: { name: string; currency: string; default_tva: number; tax_id_label: string; logo: string }
  dbMode: DataMode
  /** Adresse du serveur IAM INVOICER quand les données sont sur un domaine. */
  serverUrl: string | null
  logout: () => void
  refreshCompany: () => void
}

export const SessionContext = createContext<Session | null>(null)

export function useSession(): Session {
  const s = useContext(SessionContext)
  if (!s) throw new Error('Session absente')
  return s
}

export function useCan(module: Module): boolean {
  return can(useSession().user.role, module)
}
