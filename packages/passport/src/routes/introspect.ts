import type { MiddlewareHandler } from '@rudderjs/contracts'
import { report } from '@rudderjs/core'
import { Passport } from '../Passport.js'
import type { AccessToken } from '../models/AccessToken.js'
import type { RefreshToken } from '../models/RefreshToken.js'
import { OAuthError } from '../grants/index.js'
import { verifyToken } from '../token.js'
import { hashOpaqueToken } from '../opaque-token.js'
import type { Router } from './types.js'
import { authenticateConfidentialClient } from './helpers.js'

/** RFC 7662 §2.2 — the introspection response. `active` is the only required field. */
interface IntrospectionResponse {
  active: boolean
  scope?:      string
  client_id?:  string
  token_type?: string
  exp?:        number
  iat?:        number
  sub?:        string
  aud?:        string
  jti?:        string
}

const INACTIVE: IntrospectionResponse = { active: false }

/**
 * Register `POST /oauth/token/introspect` — the RFC 7662 OAuth 2.0 Token
 * Introspection endpoint.
 *
 * Lets a resource server in a multi-service deployment validate a bearer token
 * against the authorization server without sharing the RS256 private key or
 * direct database access. Laravel Passport ships this; without it every
 * resource server is forced into a non-standard public-key + DB arrangement.
 *
 *   - The **introspecting client** authenticates (confidential — HTTP Basic or
 *     body credentials), §2.1.
 *   - Unlike `POST /oauth/revoke`, introspection is **NOT ownership-scoped**:
 *     a resource server legitimately validates access tokens issued to OTHER
 *     clients (the actual API consumers). Any authenticated confidential client
 *     may introspect any token — that's the whole point of the endpoint.
 *   - The response reflects **live state** (§2.2): `active: false` for an
 *     invalid-signature, expired, revoked, or unknown token; otherwise
 *     `active: true` with `scope` taken from the live DB row (an operator may
 *     have narrowed it after issuance — same authority bearer middleware uses),
 *     plus `client_id`, `token_type`, `exp`, `iat`, `sub`, `aud`, `jti`.
 *   - A malformed/unknown token is **not** an error — it's `{ active: false }`
 *     with HTTP 200 (§2.2). Only client-auth failure and a missing `token`
 *     parameter are errors.
 */
export function registerIntrospectionRoute(router: Router, prefix: string, mw: MiddlewareHandler[]): void {
  router.post(`${prefix}/token/introspect`, async (req: any, res: any) => {
    try {
      const body = req.body ?? {}
      await authenticateConfidentialClient(req, body)

      const token = body['token']
      if (typeof token !== 'string' || !token) {
        throw new OAuthError('invalid_request', 'token parameter is required.')
      }
      const hint = body['token_type_hint']

      res.status(200).json(await introspect(token, typeof hint === 'string' ? hint : undefined))
    } catch (e) {
      if (e instanceof OAuthError) {
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

async function introspect(rawToken: string, hint: string | undefined): Promise<IntrospectionResponse> {
  // `token_type_hint` only reorders the probes (§2.1) — a wrong hint still
  // resolves via the fallback.
  if (hint === 'refresh_token') {
    const refresh = await introspectRefresh(rawToken)
    return refresh.active ? refresh : introspectAccess(rawToken)
  }
  const access = await introspectAccess(rawToken)
  return access.active ? access : introspectRefresh(rawToken)
}

/**
 * Introspect a value as an access-token JWT. Verifies the signature and
 * expiry, then confirms the token's DB row still exists and isn't revoked
 * (revocation is authoritative — a structurally-valid JWT for a revoked row is
 * `active: false`). Scope comes from the live row, not the JWT claim.
 */
async function introspectAccess(rawToken: string): Promise<IntrospectionResponse> {
  let payload
  try {
    payload = await verifyToken(rawToken)
  } catch {
    return INACTIVE // bad signature / expired / not a JWT
  }

  const AccessTokenCls = await Passport.tokenModel()
  const row = await AccessTokenCls.where('id', payload.jti).first() as AccessToken | null
  if (!row || (row as { revoked?: boolean }).revoked) return INACTIVE

  return {
    active:     true,
    scope:      rowScopes(row, payload.scopes).join(' '),
    client_id:  payload.aud,
    token_type: 'Bearer',
    exp:        payload.exp,
    iat:        payload.iat,
    ...(payload.sub ? { sub: payload.sub } : {}),
    aud:        payload.aud,
    jti:        payload.jti,
  }
}

/**
 * Introspect a value as an opaque refresh token. Active when the hash resolves
 * to an unrevoked, unexpired row. `client_id` is read off the paired access
 * token when available.
 */
async function introspectRefresh(rawToken: string): Promise<IntrospectionResponse> {
  const hash = await hashOpaqueToken(rawToken)
  const RefreshTokenCls = await Passport.refreshTokenModel()
  const rt = await RefreshTokenCls.where('tokenHash', hash).first() as (RefreshToken & { revoked?: boolean; expiresAt?: Date }) | null
  if (!rt || rt.revoked) return INACTIVE

  const expSecs = rt.expiresAt ? Math.floor(new Date(rt.expiresAt).getTime() / 1000) : undefined
  if (expSecs !== undefined && expSecs <= Math.floor(Date.now() / 1000)) return INACTIVE

  const AccessTokenCls = await Passport.tokenModel()
  const at = await AccessTokenCls.where('id', rt.accessTokenId).first() as AccessToken | null

  return {
    active:     true,
    token_type: 'refresh_token',
    ...(at ? { client_id: (at as { clientId?: string }).clientId } : {}),
    ...(expSecs !== undefined ? { exp: expSecs } : {}),
  }
}

/**
 * Read scopes off a token row, preferring the live DB value (a JSON string or
 * an already-hydrated array) and falling back to the JWT claim when the row
 * carries neither. Mirrors how bearer middleware treats the DB row as the
 * scope authority.
 */
function rowScopes(row: unknown, fallback: string[]): string[] {
  const raw = (row as { scopes?: unknown })?.scopes
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as string[] } catch { return fallback }
  }
  if (Array.isArray(raw)) return raw as string[]
  return fallback
}
