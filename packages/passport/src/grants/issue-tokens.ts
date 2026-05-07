import { Passport } from '../Passport.js'
import type { AccessToken }  from '../models/AccessToken.js'
import { createToken } from '../token.js'
import { hashOpaqueToken, newOpaqueToken } from '../opaque-token.js'

export interface IssuedTokens {
  access_token:  string
  token_type:    'Bearer'
  expires_in:    number
  refresh_token?: string
}

/**
 * Issue an access token (+ optional refresh token) and persist to DB.
 *
 * `familyId` ties a refresh token to its rotation chain. On the first
 * refresh-emitting grant for a session (auth-code, device-code, password)
 * the caller leaves it undefined and a fresh family identifier is
 * generated. On subsequent rotations the refresh-token grant passes the
 * existing familyId through, so reuse-detection in `refreshTokenGrant`
 * can revoke the entire chain in a single query (RFC 6819 §5.2.2.3).
 */
export async function issueTokens(opts: {
  userId:       string | null
  clientId:     string
  scopes:       string[]
  includeRefresh?: boolean
  /** Override access token lifetime in ms */
  lifetime?:    number
  /** Existing rotation-family id to copy onto the new refresh token. */
  familyId?:    string | null
}): Promise<IssuedTokens> {
  const lifetime = opts.lifetime ?? Passport.tokenLifetime()
  // Single wall-clock snapshot for the entire issuance — `iat` (in JWT),
  // `exp` (= expiresAt), `expires_in` (lifetime/1000), and the refresh
  // token's `expiresAt` all derive from this instant so a downstream
  // verifier never sees `iat + expires_in !== exp` (sub-second drift between
  // independent `Date.now()` reads is otherwise possible across the
  // intervening async DB writes + key load).
  const now = Date.now()
  const expiresAt = new Date(now + lifetime)

  const AccessTokenCls  = await Passport.tokenModel()
  const RefreshTokenCls = await Passport.refreshTokenModel()

  // Create DB record
  const tokenRecord = await AccessTokenCls.create({
    userId:    opts.userId,
    clientId:  opts.clientId,
    scopes:    JSON.stringify(opts.scopes),
    revoked:   false,
    expiresAt,
  } as Record<string, unknown>) as AccessToken

  const tokenId = tokenRecord.id

  // Sign JWT
  const jwt = await createToken({
    tokenId,
    userId:   opts.userId,
    clientId: opts.clientId,
    scopes:   opts.scopes,
    expiresAt,
    iatMs:    now,
  })

  const result: IssuedTokens = {
    access_token: jwt,
    token_type:   'Bearer',
    expires_in:   Math.floor(lifetime / 1000),
  }

  // Issue refresh token. M5/P6: the plaintext returned to the client is a
  // fresh CSPRNG opaque string; only its SHA-256 is persisted (`tokenHash`).
  // The previous shape — `result.refresh_token = refreshRecord.id` — handed
  // every active refresh token to anyone with `SELECT * ON oauth_refresh_tokens`
  // privilege on the database.
  if (opts.includeRefresh !== false) {
    const refreshExpiresAt = new Date(now + Passport.refreshTokenLifetime())
    const familyId = opts.familyId ?? await newFamilyId()
    const refreshPlaintext = await newOpaqueToken()
    const refreshHash      = await hashOpaqueToken(refreshPlaintext)

    await RefreshTokenCls.create({
      accessTokenId: tokenId,
      tokenHash:     refreshHash,
      familyId,
      revoked:       false,
      expiresAt:     refreshExpiresAt,
    } as Record<string, unknown>)

    result.refresh_token = refreshPlaintext
  }

  return result
}

/**
 * Generate an opaque rotation-family id. Lazy-loads `node:crypto` so the
 * package stays importable from non-Node runtimes that don't issue tokens
 * themselves (the caller will have already loaded crypto when it got here).
 */
async function newFamilyId(): Promise<string> {
  const { randomUUID } = await import('node:crypto')
  return randomUUID()
}
