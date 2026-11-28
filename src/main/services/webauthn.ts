// Clés d'accès (passkeys WebAuthn) : confirment une action sensible par Face ID / empreinte /
// Windows Hello, vérifié côté serveur. L'enregistrement se fait une fois (Mon compte) ; chaque
// action sensible demande une assertion. Le mot de passe reste le repli (voir auth.requireConfirm).
// WebAuthn ne fonctionne que sur le serveur web (navigateur) : sur l'application installée
// (Electron, fichier local), on retombe sur le mot de passe.
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import { audit, fail, str, type Ctx, type SessionUser } from './context'

function requireUser(ctx: Ctx): SessionUser {
  if (!ctx.user) fail('Session expirée, veuillez vous reconnecter.')
  return ctx.user
}

// Nom de domaine (rpID) et origine attendue, déduits de l'URL publique du serveur.
function rp(ctx: Ctx): { rpID: string; origin: string; rpName: string } {
  const origin = ctx.origin || 'http://localhost'
  let host = 'localhost'
  try { host = new URL(origin).hostname } catch { /* origine inconnue : localhost */ }
  return { rpID: host, origin, rpName: 'IAM INVOICER' }
}

const parseTransports = (t: string | null): any => { try { return t ? JSON.parse(t) : undefined } catch { return undefined } }

/** Démarre l'enregistrement d'une clé d'accès pour l'utilisateur courant. */
export async function passkeyRegisterStart(ctx: Ctx) {
  const user = requireUser(ctx)
  const { rpID, rpName } = rp(ctx)
  const existing = await ctx.db.query<{ credential_id: string; transports: string | null }>(
    'SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = $1', [user.id]
  )
  const options = await generateRegistrationOptions({
    rpName, rpID,
    userName: user.username,
    userDisplayName: user.full_name || user.username,
    userID: new TextEncoder().encode(String(user.id)),
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    excludeCredentials: existing.map((c) => ({ id: c.credential_id, transports: parseTransports(c.transports) })),
  })
  await ctx.db.query(
    `INSERT INTO webauthn_challenges (user_id, challenge, kind, expires_at) VALUES ($1, $2, 'reg', now() + interval '5 minutes')
     ON CONFLICT (user_id) DO UPDATE SET challenge = EXCLUDED.challenge, kind = 'reg', expires_at = EXCLUDED.expires_at`,
    [user.id, options.challenge]
  )
  return options
}

/** Termine l'enregistrement : vérifie la réponse du navigateur et stocke la clé publique. */
export async function passkeyRegisterFinish(ctx: Ctx, input: { response: any; label?: string }) {
  const user = requireUser(ctx)
  const { rpID, origin } = rp(ctx)
  const ch = await ctx.db.one<{ challenge: string }>(
    `SELECT challenge FROM webauthn_challenges WHERE user_id = $1 AND kind = 'reg' AND expires_at > now()`, [user.id]
  )
  if (!ch) fail("Session d'enregistrement expirée. Réessayez.")
  let verification
  try {
    verification = await verifyRegistrationResponse({
      response: input?.response,
      expectedChallenge: ch!.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    })
  } catch { return fail("Enregistrement de la clé d'accès refusé.") }
  if (!verification.verified || !verification.registrationInfo) fail("Enregistrement de la clé d'accès échoué.")
  const cred = verification.registrationInfo!.credential
  await ctx.db.query(
    `INSERT INTO webauthn_credentials (user_id, credential_id, public_key, counter, transports, label)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (credential_id) DO NOTHING`,
    [user.id, cred.id, Buffer.from(cred.publicKey).toString('base64url'), cred.counter ?? 0,
     JSON.stringify(cred.transports ?? []), str(input?.label).slice(0, 60) || 'Appareil']
  )
  await ctx.db.query('DELETE FROM webauthn_challenges WHERE user_id = $1', [user.id])
  await audit(ctx.db, ctx, 'modification', 'cle_acces', user.id, 'Clé d’accès (biométrie) activée')
  return { ok: true }
}

/** Démarre une demande de confirmation biométrique (assertion) pour une action sensible. */
export async function passkeyAuthStart(ctx: Ctx) {
  const user = requireUser(ctx)
  const { rpID } = rp(ctx)
  const creds = await ctx.db.query<{ credential_id: string; transports: string | null }>(
    'SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = $1', [user.id]
  )
  if (!creds.length) fail("Aucune clé d'accès enregistrée.")
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'required',
    allowCredentials: creds.map((c) => ({ id: c.credential_id, transports: parseTransports(c.transports) })),
  })
  await ctx.db.query(
    `INSERT INTO webauthn_challenges (user_id, challenge, kind, expires_at) VALUES ($1, $2, 'auth', now() + interval '5 minutes')
     ON CONFLICT (user_id) DO UPDATE SET challenge = EXCLUDED.challenge, kind = 'auth', expires_at = EXCLUDED.expires_at`,
    [user.id, options.challenge]
  )
  return options
}

/** Vérifie une assertion biométrique (appelée par auth.requireConfirm). Vrai si valide. */
export async function verifyAssertion(ctx: Ctx, response: any): Promise<boolean> {
  const user = requireUser(ctx)
  const { rpID, origin } = rp(ctx)
  if (!response) return false
  const ch = await ctx.db.one<{ challenge: string }>(
    `SELECT challenge FROM webauthn_challenges WHERE user_id = $1 AND kind = 'auth' AND expires_at > now()`, [user.id]
  )
  if (!ch) return false
  const credId = String(response?.id ?? '')
  const row = await ctx.db.one<{ public_key: string; counter: string }>(
    'SELECT public_key, counter FROM webauthn_credentials WHERE user_id = $1 AND credential_id = $2', [user.id, credId]
  )
  if (!row) return false
  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: ch.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: credId,
        publicKey: new Uint8Array(Buffer.from(row.public_key, 'base64url')),
        counter: Number(row.counter) || 0,
      },
    })
  } catch { return false }
  if (!verification.verified) return false
  await ctx.db.query('UPDATE webauthn_credentials SET counter = $3 WHERE user_id = $1 AND credential_id = $2',
    [user.id, credId, verification.authenticationInfo.newCounter])
  await ctx.db.query('DELETE FROM webauthn_challenges WHERE user_id = $1', [user.id])
  return true
}

/** Liste les clés d'accès de l'utilisateur (pour « Mon compte »). */
export async function passkeyList(ctx: Ctx) {
  const user = requireUser(ctx)
  const rows = await ctx.db.query<{ credential_id: string; label: string | null; created_at: string }>(
    'SELECT credential_id, label, created_at FROM webauthn_credentials WHERE user_id = $1 ORDER BY created_at DESC', [user.id]
  )
  return rows.map((r) => ({ id: r.credential_id.slice(0, 16), label: r.label || 'Appareil', created_at: r.created_at }))
}

/** Supprime une clé d'accès. */
export async function passkeyRemove(ctx: Ctx, input: { id: string }) {
  const user = requireUser(ctx)
  await ctx.db.query('DELETE FROM webauthn_credentials WHERE user_id = $1 AND left(credential_id, 16) = $2',
    [user.id, String(input?.id ?? '')])
  return true
}
