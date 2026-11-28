// Confirmation biométrique (Face ID / empreinte / Windows Hello) via clé d'accès WebAuthn.
// L'enregistrement se fait une fois (Mon compte) ; chaque action sensible demande une assertion,
// vérifiée côté serveur (voir src/main/services/webauthn.ts). Repli sur mot de passe ailleurs
// (application installée : WebAuthn n'est disponible que sur le serveur web).
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { api } from './api'
import { passwordDialog } from './components/ui'

/** Vrai si le navigateur/appareil peut faire du WebAuthn (biométrie). */
export function biometricSupported(): boolean {
  try { return browserSupportsWebAuthn() } catch { return false }
}

/** Enregistre une clé d'accès sur cet appareil (déclenche Face ID / empreinte). */
export async function enablePasskey(): Promise<void> {
  const options = await api('auth.passkey.registerStart')
  const response = await startRegistration({ optionsJSON: options })
  await api('auth.passkey.registerFinish', { response, label: (navigator.userAgent || 'Appareil').slice(0, 60) })
}

/** Demande une assertion biométrique à envoyer avec une action sensible. */
export async function biometricAssertion(): Promise<unknown> {
  const options = await api('auth.passkey.authStart')
  return startAuthentication({ optionsJSON: options })
}

/**
 * Confirme une action sensible : Face ID / empreinte si une clé d'accès est enregistrée (serveur
 * web), sinon mot de passe. Renvoie les éléments à joindre à l'appel, ou null si l'utilisateur
 * annule. À appeler après la boîte d'avertissement (confirmDialog).
 */
export async function confirmSensitive(
  message = 'Confirmez cette action sensible.'
): Promise<{ password?: string; assertion?: unknown } | null> {
  if (biometricSupported()) {
    let hasKey = false
    try { hasKey = ((await api<any[]>('auth.passkey.list')) ?? []).length > 0 } catch { hasKey = false }
    if (hasKey) {
      try { return { assertion: await biometricAssertion() } } catch { return null }
    }
  }
  const pw = await passwordDialog(message, { detail: 'Saisissez votre mot de passe pour confirmer.' })
  return pw ? { password: pw } : null
}
