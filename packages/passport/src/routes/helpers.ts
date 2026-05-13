import type { MiddlewareHandler } from '@rudderjs/contracts'
import { config, report } from '@rudderjs/core'
import { Passport } from '../Passport.js'
import type { OAuthClient } from '../models/OAuthClient.js'
import { clientHelpers } from '../models/helpers.js'
import { OAuthError } from '../grants/index.js'
import type { PassportRouteOptions } from './types.js'

/**
 * Re-validate that `redirect_uri` is on the requesting client's whitelist.
 * The consent UI sees the validated URI from `GET /oauth/authorize`, but the
 * subsequent POST/DELETE bodies are attacker-controlled and must be
 * re-checked — otherwise the response leaks an authorization code (POST) or
 * an open redirect (DELETE) to a host the client never registered.
 * Throws `OAuthError` so the surrounding try/catch returns the correct
 * status + payload.
 */
export async function validateClientRedirect(clientId: unknown, redirectUri: unknown): Promise<OAuthClient> {
  if (typeof clientId !== 'string' || !clientId) {
    throw new OAuthError('invalid_request', 'client_id is required.')
  }
  if (typeof redirectUri !== 'string' || !redirectUri) {
    throw new OAuthError('invalid_request', 'redirect_uri is required.')
  }
  const ClientCls = await Passport.clientModel()
  const client = await ClientCls.where('id', clientId).first() as OAuthClient | null
  if (!client || client.revoked) {
    throw new OAuthError('invalid_client', 'Client not found.')
  }
  if (!clientHelpers.hasRedirectUri(client, redirectUri)) {
    throw new OAuthError('invalid_request', 'Invalid redirect_uri.')
  }
  return client
}

/**
 * Resolve client credentials at the token endpoint per RFC 6749 §2.3.
 *
 * Confidential clients can authenticate via:
 *   1. `Authorization: Basic base64(client_id:client_secret)` (§2.3.1, MUST support)
 *   2. `client_id` + `client_secret` in the request body (alternative)
 *
 * §2.3 forbids using both at once — clients MUST NOT pass credentials in
 * the body when the header is present. We reject that combination with
 * `invalid_request` so SDK bugs surface loudly instead of silently
 * accepting one set and ignoring the other.
 *
 * Public clients send only `client_id` in the body; both Basic creds and
 * a body `client_id` mismatch is also rejected.
 */
export function resolveClientCredentials(
  req: { headers?: Record<string, unknown> },
  body: Record<string, unknown>,
): { clientId: string; clientSecret?: string } {
  const authHeader = req.headers?.['authorization']
  const bodyClientId     = body['client_id']     as string | undefined
  const bodyClientSecret = body['client_secret'] as string | undefined

  if (typeof authHeader === 'string' && authHeader.length >= 6 && authHeader.slice(0, 6).toLowerCase() === 'basic ') {
    const encoded = authHeader.slice(6).trim()
    let decoded: string
    try {
      decoded = Buffer.from(encoded, 'base64').toString('utf8')
    } catch {
      throw new OAuthError('invalid_request', 'Malformed HTTP Basic credentials.', 401)
    }
    const sep = decoded.indexOf(':')
    if (sep === -1) {
      throw new OAuthError('invalid_request', 'Malformed HTTP Basic credentials.', 401)
    }
    // RFC 6749 §2.3.1 — client_id and client_secret in Basic are
    // application/x-www-form-urlencoded-encoded before base64. SDKs in
    // the wild often skip the percent-encoding step; we accept the raw
    // form because requiring percent-decoding here would reject every
    // ASCII-only credential pair (which is the overwhelming majority).
    const headerClientId     = decoded.slice(0, sep)
    const headerClientSecret = decoded.slice(sep + 1)

    if (!headerClientId) {
      throw new OAuthError('invalid_request', 'Malformed HTTP Basic credentials.', 401)
    }
    if (bodyClientSecret !== undefined) {
      throw new OAuthError('invalid_request', 'client_secret must not be sent in both Authorization header and request body.', 401)
    }
    if (bodyClientId !== undefined && bodyClientId !== headerClientId) {
      throw new OAuthError('invalid_request', 'client_id in Authorization header does not match request body.', 401)
    }

    return { clientId: headerClientId, clientSecret: headerClientSecret }
  }

  if (typeof bodyClientId !== 'string' || !bodyClientId) {
    throw new OAuthError('invalid_request', 'client_id is required.')
  }
  return bodyClientSecret !== undefined
    ? { clientId: bodyClientId, clientSecret: bodyClientSecret }
    : { clientId: bodyClientId }
}

/**
 * Resolve the device-flow verification URI in this priority order:
 *
 *   1. `opts.verificationUri` — explicit caller override.
 *   2. `config('app.url')` — `${appUrl}${prefix}/device`. Trailing slash on
 *      the configured value is tolerated.
 *   3. `req.protocol` + `req.hostname` — last-resort fallback for dev / when
 *      neither knob is configured. The `Host` header is attacker-controlled
 *      behind a reverse proxy without trust-proxy, so we emit a one-shot
 *      warning the first time we land here. Documented in CLAUDE.md.
 */
let _hostHeaderFallbackWarned = false
export function resolveVerificationUri(opts: PassportRouteOptions, req: { protocol?: string; hostname?: string }, prefix: string): string {
  if (opts.verificationUri) return opts.verificationUri

  const appUrl = config<string | undefined>('app.url', undefined)
  if (typeof appUrl === 'string' && appUrl) {
    return `${appUrl.replace(/\/$/, '')}${prefix}/device`
  }

  if (!_hostHeaderFallbackWarned) {
    _hostHeaderFallbackWarned = true
    console.warn(
      '[@rudderjs/passport] Falling back to req.protocol/req.hostname for the device-flow verification URI. ' +
      'The Host header is attacker-controlled behind a reverse proxy without trust-proxy. ' +
      'Set APP_URL (config(\'app.url\')) or pass an explicit `verificationUri` to registerPassportRoutes() to silence this.',
    )
  }
  return `${req.protocol}://${req.hostname}${prefix}/device`
}

/**
 * Render an error response from a `/oauth/authorize` handler. RFC 6749
 * §4.1.2.1 requires that `state` is echoed back on errors (so the client
 * can reconcile the response against its own session) — independent of
 * whether the response shape is a redirect or JSON, and independent of
 * the underlying error code.
 *
 * We additionally call `report()` on non-`OAuthError` throws so the root
 * cause surfaces through the configured exception reporter instead of
 * being silently collapsed under `server_error`.
 */
export function authErrorResponse(res: any, err: unknown, state: unknown): void {
  const stateEcho = typeof state === 'string' && state ? { state } : {}
  if (err instanceof OAuthError) {
    res.status(err.statusCode).json({ ...err.toJSON(), ...stateEcho })
    return
  }
  report(err)
  res.status(500).json({ error: 'server_error', error_description: 'Internal server error.', ...stateEcho })
}

/**
 * Resolve the authenticated requester's id from a passport-route request,
 * checking both the `__rjs_user` raw-bag stamp (set by server-hono's auth
 * middleware) and the plain `req.user` fallback (set on the universal
 * middleware bridge). Returns `null` when neither is populated — typically
 * means no session / not signed in, and the caller should respond 401.
 */
export function requesterIdFrom(req: { raw?: unknown; user?: unknown }): string | null {
  const fromRaw = (req.raw as { __rjs_user?: { id?: unknown } } | undefined)?.__rjs_user?.id
  const fromReq = (req.user as { id?: unknown } | undefined)?.id
  const id = fromRaw ?? fromReq
  return typeof id === 'string' && id ? id : null
}

/** Normalize an optional middleware option into an array, dropping `undefined`. */
export function asMiddlewareArray(input: MiddlewareHandler | MiddlewareHandler[] | undefined): MiddlewareHandler[] {
  if (!input) return []
  return Array.isArray(input) ? input : [input]
}
