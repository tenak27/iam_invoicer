// Société de démonstration (site web, données fictives remises à neuf toutes les 3 heures) : réglage
// demo_mode posé à sa création par le serveur en ligne (server/demo.ts), jamais modifiable depuis
// l'application. Elle n'envoie rien (e-mails, SMS) et ne certifie qu'en simulation.
import type { Db } from '../db'
import { fail } from './context'

export async function isDemoDb(db: Db): Promise<boolean> {
  const r = await db.one<{ value: string }>("SELECT value FROM settings WHERE key = 'demo_mode'")
  return r?.value === '"1"'
}

export async function refuseInDemo(db: Db, what: string): Promise<void> {
  if (await isDemoDb(db)) fail(`${what} : désactivé dans la version de démonstration. Créez votre compte pour l’utiliser avec vos vrais clients.`)
}
