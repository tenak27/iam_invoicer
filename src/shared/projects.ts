// Gestion de projet : postes de dépenses, statuts des tâches, calculs de suivi.

export type ExpenseCategory = 'materiel' | 'transport' | 'sous_traitance' | 'main_oeuvre' | 'location' | 'hebergement' | 'frais_divers'

/** Postes de dépenses et compte de charge SYSCOHADA associé. */
export const EXPENSE_CATEGORIES: Record<ExpenseCategory, { label: string; account: string }> = {
  materiel: { label: 'Matériel et fournitures', account: '604' },
  transport: { label: 'Transport et déplacements', account: '618' },
  sous_traitance: { label: 'Sous-traitance', account: '621' },
  main_oeuvre: { label: "Main-d'œuvre extérieure", account: '637' },
  location: { label: 'Location (engins, matériel, locaux)', account: '622' },
  hebergement: { label: 'Hébergement et restauration', account: '638' },
  frais_divers: { label: 'Frais divers', account: '605' }
}

export type TaskStatus = 'a_faire' | 'en_cours' | 'bloque' | 'termine'

export const TASK_STATUS: Record<TaskStatus, { label: string; tone: string }> = {
  a_faire: { label: 'À faire', tone: 'info' },
  en_cours: { label: 'En cours', tone: 'primary' },
  bloque: { label: 'Bloqué', tone: 'danger' },
  termine: { label: 'Terminé', tone: 'success' }
}

export interface TaskLike {
  status: TaskStatus
  progress: number
  estimated_hours: number
  due_date?: string | null
}

/** Avancement du projet : moyenne des tâches pondérée par les heures estimées (1 h par défaut). */
export function projectProgress(tasks: TaskLike[]): number {
  if (!tasks.length) return 0
  let weight = 0
  let done = 0
  for (const t of tasks) {
    const w = t.estimated_hours > 0 ? t.estimated_hours : 1
    weight += w
    done += w * (t.status === 'termine' ? 100 : Math.min(100, Math.max(0, t.progress)))
  }
  return Math.round(done / weight)
}

/** Tâche en retard : échéance passée et non terminée. */
export function isLate(t: TaskLike, today: string): boolean {
  return t.status !== 'termine' && !!t.due_date && t.due_date < today
}
