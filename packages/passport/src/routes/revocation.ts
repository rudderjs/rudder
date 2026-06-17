import type { MiddlewareHandler } from '@rudderjs/contracts'
import { report } from '@rudderjs/core'
import { Passport } from '../Passport.js'
import type { AccessToken } from '../models/AccessToken.js'
import type { RefreshToken } from '../models/RefreshToken.js'
import { OAuthError } from '../grants/index.js'
import { unsafeDecodeToken } from '../token.js'
import { hashOpaqueToken } from '../opaque-token.js'
import type { Router } from './types.js'
import { authenticateConfidentialClient } from './helpers.js'
import { revokeAccessTokenChain } from './revoke-chain.js'

/**
 * Register `POST /oauth/revoke` — the RFC 7009 OAuth 2 Token Revocation
 * endpoint.
 *
 * This is the spec-compliant complement to `DELETE /oauth/tokens/:id` (the
 * by-database-id, user-bearer-authenticated route). RFC 7009 revocation is
 * how third-party OAuth client SDKs revoke tokens on logout / cleanup:
 *
 *   - Revocation is **by token value**, not database id (§2.1).
 *   - The **client** authenticates (HTTP Basic or body credentials), not an
 *     end user (§2.1).
 *   - The response is **always HTTP 200** when the request is well-formed and
 *     the client authenticates — whether the token was revoked, was already
 *     invalid, was unknown, or belonged to a different client (§2.2). Only
 *     client-authentication failure (401) and a missing `token` parameter
 *     (`invalid_request`) are errors.
 *
 * The presented `token` may be an access token (a JWT — we read its `jti`
 * without verifying the signature, since revocation of an
 * already-invalid-signature token is harmless and we never trust its claims)
 * or a refresh token (an opaque secret — we hash it and look it up). The
 * optional `token_type_hint` (§2.1) only reorders the lookup; a wrong hint
 * still resolves the token by falling through to the other type.
 *
 * Ownership: a client may only revoke tokens issued to itself. A token that
 * resolves to a *different* client is silently left intact and still answered
 * with 200 — revealing nothing about whether the value existed.
 */
export function registerRevocationRoute(router: Router, prefix: string, mw: MiddlewareHandler[]): void {
  router.post(`${prefix}/revoke`, async (req: any, res: any) => {
    try {
      const body = req.body ?? {}
      const client = await authenticateConfidentialClient(req, body)

      const token = body['token']
      if (typeof token !== 'string' || !token) {
        throw new OAuthError('invalid_request', 'token parameter is required.')
      }
      const hint = body['token_type_hint']

      await revokeTokenByValue(token, typeof hint === 'string' ? hint : undefined, client.id)

      // RFC 7009 §2.2 — a successful revocation, an unknown token, an
      // already-revoked token, and a token owned by another client are all
      // answered identically with 200 and an empty body.
      res.status(200).json({})
    } catch (e) {
      if (e instanceof OAuthError) {
        // RFC 6749 §5.2 — client-auth failures carry WWW-Authenticate.
        if (e.statusCode === 401 && typeof res.header === 'function') {
          res.header('WWW-Authenticate', 'Basic realm="oauth"')
        }
        res.status(e.statusCode).json(e.toJSON())
      } else {
        report(e)
        res.status(500).json({ error: 'server_error', error_description: 'Internal server error.' })
      }
    }
  }, mw)
}

/**
 * Resolve a token value to its owning access-token chain and revoke it, scoped
 * to `clientId`. Returns once a matching token of either type is found (or
 * neither). Never throws for a not-found / not-owned token — RFC 7009's
 * always-200 contract is the caller's invariant; this just no-ops.
 */
async function revokeTokenByValue(rawToken: string, hint: string | undefined, clientId: string): Promise<void> {
  // `token_type_hint` only reorders the probes (§2.1) — a wrong hint must still
  // resolve via the fallback, so each probe reports whether it MATCHED a token
  // (regardless of ownership) and we stop at the first match.
  if (hint === 'refresh_token') {
    if (await revokeIfRefresh(rawToken, clientId)) return
    await revokeIfAccess(rawToken, clientId)
    return
  }
  // Default order (and `access_token` hint): access tokens are JWTs, the common
  // case, and cheap to reject for an opaque value (the 3-segment check fails).
  if (await revokeIfAccess(rawToken, clientId)) return
  await revokeIfRefresh(rawToken, clientId)
}

/**
 * Treat `rawToken` as an access-token JWT. Returns `true` when it resolves to a
 * known access token (matched), `false` when it isn't a JWT or no row exists.
 * Only revokes when the token belongs to `clientId`; a foreign-client match
 * still returns `true` (found) but is left intact.
 */
async function revokeIfAccess(rawToken: string, clientId: string): Promise<boolean> {
  let jti: string
  try {
    jti = unsafeDecodeToken(rawToken).jti
  } catch {
    return false // not a JWT — let the refresh-token probe handle it
  }
  if (!jti) return false

  const AccessTokenCls = await Passport.tokenModel()
  const at = await AccessTokenCls.where('id', jti).first() as AccessToken | null
  if (!at) return false
  if (at.clientId === clientId) await revokeAccessTokenChain(at.id)
  return true
}

/**
 * Treat `rawToken` as an opaque refresh token. Returns `true` when the hash
 * resolves to a known refresh token. Ownership is checked against the paired
 * access token's client; revoking the chain by `accessTokenId` also covers the
 * presented refresh token (it points at that access token).
 */
async function revokeIfRefresh(rawToken: string, clientId: string): Promise<boolean> {
  const hash = await hashOpaqueToken(rawToken)
  const RefreshTokenCls = await Passport.refreshTokenModel()
  const rt = await RefreshTokenCls.where('tokenHash', hash).first() as RefreshToken | null
  if (!rt) return false

  const AccessTokenCls = await Passport.tokenModel()
  const at = await AccessTokenCls.where('id', rt.accessTokenId).first() as AccessToken | null
  // Only revoke when ownership is provable via the paired access token. A
  // dangling refresh token whose access row was already pruned can't be
  // attributed to a client, so it's left alone (still answered 200).
  if (at && at.clientId === clientId) await revokeAccessTokenChain(rt.accessTokenId)
  return true
}
