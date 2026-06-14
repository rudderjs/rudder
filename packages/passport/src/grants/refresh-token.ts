import { report } from '@rudderjs/core'
import { Passport } from '../Passport.js'
import type { OAuthClient }  from '../models/OAuthClient.js'
import type { AccessToken }  from '../models/AccessToken.js'
import type { RefreshToken } from '../models/RefreshToken.js'
import { accessTokenHelpers, refreshTokenHelpers } from '../models/helpers.js'
import { hashOpaqueToken } from '../opaque-token.js'
import { issueTokens, type IssuedTokens } from './issue-tokens.js'
import { OAuthError } from './authorization-code.js'
import { parseScopes } from './parse-scopes.js'
import { verifyConfidentialCredentials } from './verify-client.js'

export interface RefreshTokenRequest {
  grantType:    string
  refreshToken: string
  clientId:     string
  clientSecret?: string
  scope?:       string
}

/**
 * Refresh token grant — exchange a refresh token for a new access + refresh token pair.
 * The old refresh token is revoked.
 */
export async function refreshTokenGrant(params: RefreshTokenRequest): Promise<IssuedTokens> {
  if (params.grantType !== 'refresh_token') {
    throw new OAuthError('unsupported_grant_type', 'Expected grant_type=refresh_token.')
  }

  const ClientCls       = await Passport.clientModel()
  const RefreshTokenCls = await Passport.refreshTokenModel()
  const AccessTokenCls  = await Passport.tokenModel()

  // Validate client
  const client = await ClientCls.where('id', params.clientId).first() as OAuthClient | null
  if (!client || client.revoked) {
    throw new OAuthError('invalid_client', 'Client not found.', 401)
  }

  await verifyConfidentialCredentials(client, params.clientSecret)

  // Find refresh token by hashed plaintext (M5/P6) — the row's `id` is no
  // longer the bearer secret, so a DB read leak doesn't yield usable tokens.
  // Pre-migration tokens (which used `id` as the plaintext) won't match
  // because their hashed form was never persisted; affected sessions force-
  // relogin on next refresh, same blast radius as RSA keypair rotation.
  const refreshTokenHash = await hashOpaqueToken(params.refreshToken)
  const refreshToken = await RefreshTokenCls.where('tokenHash', refreshTokenHash).first() as RefreshToken | null
  if (!refreshToken) {
    throw new OAuthError('invalid_grant', 'Refresh token not found.')
  }
  if (refreshToken.revoked) {
    // Reuse detected. RFC 6819 §5.2.2.3 / OAuth 2.0 BCP §4.14: revoke the
    // entire family so a stolen+rotated refresh token can't keep living
    // alongside the legitimate user's session. Legacy rows minted before
    // the familyId column existed have null and are exempt during the
    // migration window — same approach as the redirect_uri rollout.
    if (refreshToken.familyId) {
      await revokeFamily(RefreshTokenCls, AccessTokenCls, refreshToken.familyId)
    }
    throw new OAuthError('invalid_grant', 'Refresh token has been revoked.')
  }
  if (refreshTokenHelpers.isExpired(refreshToken)) {
    throw new OAuthError('invalid_grant', 'Refresh token has expired.')
  }

  // Find the access token this refresh token belongs to
  const accessToken = await AccessTokenCls.where('id', refreshToken.accessTokenId).first() as AccessToken | null
  if (!accessToken) {
    throw new OAuthError('invalid_grant', 'Associated access token not found.')
  }
  if (accessToken.clientId !== params.clientId) {
    throw new OAuthError('invalid_grant', 'Refresh token was not issued to this client.')
  }

  // Determine scopes — can only narrow, not widen
  const originalScopes = accessTokenHelpers.getScopes(accessToken)
  let scopes = originalScopes
  const requested = parseScopes(params.scope)
  if (requested.length > 0) {
    const invalid = requested.filter(s => !originalScopes.includes(s) && !originalScopes.includes('*'))
    if (invalid.length > 0) {
      throw new OAuthError('invalid_scope', `Cannot request scopes not in original token: ${invalid.join(', ')}`)
    }
    scopes = requested
  }

  // Atomically claim the refresh token. Mirrors the auth-code grant pattern:
  // only one of N concurrent requests will flip `revoked` from false → true.
  // The losers' updateAll returns 0 — we treat that as reuse, mint nothing,
  // and (when familyId is present) revoke the whole rotation family. Without
  // this guard the prior read-then-update sequence allowed two concurrent
  // refreshes to both succeed and both mint a new token pair.
  const claimed = await RefreshTokenCls
    .where('id', refreshToken.id)
    .where('revoked', false)
    .updateAll({ revoked: true } as Record<string, unknown>)
  if (claimed === 0) {
    if (refreshToken.familyId) {
      await revokeFamily(RefreshTokenCls, AccessTokenCls, refreshToken.familyId)
    }
    throw new OAuthError('invalid_grant', 'Refresh token has been revoked.')
  }

  // Revoke the paired access token now that we hold the claim. Same shape as
  // the refresh-token write — bulk QueryBuilder.updateAll() to bypass the
  // mass-assignment filter (`revoked` not in fillable).
  await AccessTokenCls.where('id', accessToken.id).updateAll({ revoked: true } as Record<string, unknown>)

  // Issue new pair — propagate the existing familyId so the rotation chain
  // is preserved. Legacy rows with null get a fresh family on next rotation.
  return issueTokens({
    userId:         accessToken.userId,
    clientId:       params.clientId,
    scopes,
    includeRefresh: true,
    familyId:       refreshToken.familyId ?? null,
  })
}

/**
 * Revoke every access + refresh token in a rotation family. Called on
 * detected reuse of an already-revoked refresh token (and from the revoke
 * endpoint, to kill a whole session). Best-effort: ORM errors are not
 * propagated to the caller because the outer flow is already going to throw
 * `invalid_grant` / return 204. But the failure IS reported — family
 * revocation is the security-critical anti-replay action, so a silent no-op
 * (e.g. a transient DB error mid-attack) must not pass unnoticed.
 */
export async function revokeFamily(
  RefreshTokenCls: typeof RefreshToken,
  AccessTokenCls:  typeof AccessToken,
  familyId: string,
): Promise<void> {
  try {
    // Two bulk QueryBuilder.updateAll() calls — one per table — replace
    // the prior read-then-N+1-update loop. Each is idempotent: refresh
    // tokens already revoked are filtered by the inner where, and access
    // tokens scoped by family-membership via their refresh tokens'
    // accessTokenId list. Bypasses the mass-assignment filter (`revoked`
    // is no longer in fillable on either model).
    const family = await RefreshTokenCls.where('familyId', familyId).get() as RefreshToken[]
    if (family.length === 0) return

    await RefreshTokenCls.where('familyId', familyId)
      .where('revoked', false)
      .updateAll({ revoked: true } as Record<string, unknown>)

    const accessTokenIds = family.map(rt => rt.accessTokenId)
    // `Model.where(col, val)` is 2-arg only; operator overloads live on the
    // QueryBuilder returned by `query()`. Use that to express IN(...).
    await AccessTokenCls.query().where('id', 'IN', accessTokenIds)
      .updateAll({ revoked: true } as Record<string, unknown>)
  } catch (e) {
    // Don't propagate (the outer handler already throws invalid_grant / 204),
    // but DO report: a failed family revocation during a detected-reuse event
    // is exactly the signal operators need to see.
    report(e)
  }
}
