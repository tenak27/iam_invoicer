import { createContext } from 'react'
import type { Icon } from '@phosphor-icons/react'

export type Tone = 'blue' | 'green' | 'amber' | 'violet' | 'teal' | 'rose' | 'cyan' | 'indigo' | 'slate'

/** Écran courant (icône, couleur) transmis aux en-têtes de page. */
export const PageContext = createContext<{ icon?: Icon; tone: Tone; label?: string }>({ tone: 'blue' })
