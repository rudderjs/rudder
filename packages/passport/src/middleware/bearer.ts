import type { MiddlewareHandler, AppRequest } from '@rudderjs/contracts'
import { verifyToken } from '../token.js'
import { Passport } from '../Passport.js'
import type { AccessToken } from '../models/AccessToken.js'

/**
 * Extract the Bearer-scheme credential from an Authorization header.
 * RFC 6750 §2.1 / RFC 7235 §2.1 — the auth scheme is a token and must be
 * matched case-insensitively, so `bearer xyz` and `BEARER xyz` are valid.
 * Returns the trimmed credential, or null if the header is absent or the
 * scheme is not "Bearer".
 */
function extractBearer(authHeader: string | undefined): string | null {
  if (!authHeader) return null
  if (authHeader.length < 7) return null
  if (authHeader.slice(0, 7).toLowerCase() !== 'bearer ') return null
  return authHeader.slice(7).trim() || null
}

/**
 * Discriminated outcome of attempting bearer authentication on a request.
 * `BearerMiddleware` ignores every non-`authenticated` case and continues
 * unauthenticated; `RequireBearer` translates each into a distinct 401.
 */
type BearerAuthOutcome =
  | { kind: 'authenticated' }
  | { kind: 'no-bearer' }
  | { kind: 'revoked' }
  | { kind: 'invalid' }

/**
 * Verify the JWT, look up the row by `jti`, and — on success — stamp
 * `__passport_token` / `__passport_scopes` / `__passport_user_id` onto
 * `req.raw`. If the JWT also carries a `sub`, resolve the user via the
 * auth manager and copy a plain (function-stripped, password-stripped)
 * snapshot onto `req.raw.__rjs_user` plus best-effort onto `req.user`.
 *
 * Returns the discriminated outcome so the two middleware exports can
 * share the verification path without duplicating it. See `BearerMiddleware`
 * and `RequireBearer` below for the failure-handling branches.
 */
async function authenticateBearer(req: AppRequest): Promise<BearerAuthOutcome> {
  const authHeader = req.headers['authorization'] as string | undefined
  const jwt = extractBearer(authHeader)
  if (!jwt) return { kind: 'no-bearer' }

  let payload: Awaited<ReturnType<typeof verifyToken>>
  try {
    // Pass expectedIssuer when configured so verifyToken rejects
    // tokens minted by an unrelated issuer sharing the same keypair
    // (multi-tenant / staging+prod). Tokens with no `iss` claim are
    // legacy and exempt — see verifyToken jsdoc.
    const issuer = Passport.issuer()
    payload = await verifyToken(jwt, issuer ? { expectedIssuer: issuer } : undefined)
  } catch {
    return { kind: 'invalid' }
  }

  // Revocation lookup — JWT signature is necessary but not sufficient.
  const AccessTokenCls = await Passport.tokenModel()
  const token = await AccessTokenCls.query()
    .where('id', payload.jti)
    .first() as AccessToken | null

  if (!token || token.revoked) return { kind: 'revoked' }

  const raw = req.raw as RawAuthBag
  raw.__passport_token = token
  raw.__passport_scopes = payload.scopes
  raw.__passport_user_id = payload.sub

  if (payload.sub) {
    await resolveAndStampUser(req, raw, payload.sub, token)
  }

  return { kind: 'authenticated' }
}

/**
 * Resolve the user via `auth.manager` and stamp `__passport_token` onto
 * the resolved instance + a plain copy onto `raw.__rjs_user` and `req.user`.
 *
 * The plain copy strips functions + the `password` field so consumers reading
 * `req.user` over an API can't accidentally leak the password hash. The
 * `req.user` write is wrapped in try/catch because some adapters expose
 * `req` as a frozen / read-only object (universal-middleware bridge); the
 * raw-bag stamp is always reachable, the `req.user` write is best-effort.
 *
 * Failures inside this helper are swallowed — `@rudderjs/auth` is an
 * optional peer, so a missing `auth.manager` binding is expected in apps
 * that use bearer-only flows. The token bag on `req.raw` is already set
 * by the caller; only the resolved-user convenience is missing.
 */
async function resolveAndStampUser(
  req: AppRequest,
  raw: RawAuthBag,
  userId: string,
  token: AccessToken,
): Promise<void> {
  try {
    const { app } = await import('@rudderjs/core')
    const manager = app().make<{ guard(): { provider: { retrieveById(id: string): Promise<unknown> } } }>('auth.manager')
    const user = await manager.guard().provider.retrieveById(userId)
    if (!user) return

    ;(user as Record<string, unknown>)['__passport_token'] = token
    const plain: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(user as Record<string, unknown>)) {
      if (typeof v !== 'function' && k !== 'password') plain[k] = v
    }
    raw.__rjs_user = plain
    try {
      ;(req as unknown as Record<string, unknown>)['user'] = plain
    } catch {
      // Some adapters expose `req` as read-only — the raw-bag stamp above
      // is the authoritative read path; this is the convenience copy.
    }
  } catch {
    // auth.manager not bound — bearer-only flows are fine without it.
  }
}

/**
 * Typed view of `req.raw` for the bearer-stamp side. The raw shape is
 * `unknown` on the contracts side, so we narrow it locally rather than
 * cast at each callsite.
 */
type RawAuthBag = Record<string, unknown> & {
  __passport_token?:   AccessToken
  __passport_scopes?:  string[]
  __passport_user_id?: string | null
  __rjs_user?:         Record<string, unknown>
}

/**
 * Middleware that authenticates via Bearer token (JWT).
 * Validates the JWT signature, checks expiration, checks revocation in DB.
 * Attaches user to the request if valid. Does not block unauthenticated requests.
 */
export function BearerMiddleware(): MiddlewareHandler {
  return async function BearerMiddleware(req, _res, next) {
    await authenticateBearer(req)
    await next()
  }
}

/**
 * Middleware that requires a valid Bearer token. Returns 401 if missing/invalid.
 */
export function RequireBearer(): MiddlewareHandler {
  return async function RequireBearer(req, res, next) {
    const outcome = await authenticateBearer(req)
    switch (outcome.kind) {
      case 'authenticated':
        await next()
        return
      case 'no-bearer':
        res.status(401).json({ error: 'unauthenticated', message: 'Bearer token required.' })
        return
      case 'revoked':
        res.status(401).json({ error: 'unauthenticated', message: 'Token has been revoked.' })
        return
      case 'invalid':
        res.status(401).json({ error: 'unauthenticated', message: 'Invalid or expired token.' })
        return
    }
  }
}
