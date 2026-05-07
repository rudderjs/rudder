import { config, report } from '@rudderjs/core'
import type { MiddlewareHandler } from '@rudderjs/contracts'
import { Passport } from './Passport.js'
import type { AccessToken } from './models/AccessToken.js'
import type { OAuthClient } from './models/OAuthClient.js'
import { clientHelpers } from './models/helpers.js'
import { RequireBearer } from './middleware/bearer.js'
import {
  validateAuthorizationRequest,
  issueAuthCode,
  exchangeAuthCode,
  clientCredentialsGrant,
  refreshTokenGrant,
  requestDeviceCode,
  pollDeviceCode,
  approveDeviceCode,
  OAuthError,
} from './grants/index.js'

/**
 * Re-validate that `redirect_uri` is on the requesting client's whitelist.
 * The consent UI sees the validated URI from `GET /oauth/authorize`, but the
 * subsequent POST/DELETE bodies are attacker-controlled and must be
 * re-checked — otherwise the response leaks an authorization code (POST) or
 * an open redirect (DELETE) to a host the client never registered.
 * Throws `OAuthError` so the surrounding try/catch returns the correct
 * status + payload.
 */
async function validateClientRedirect(clientId: unknown, redirectUri: unknown): Promise<OAuthClient> {
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
  if (!clientHelpers.hasRedirectUri(client as any, redirectUri)) {
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
function resolveClientCredentials(
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
function resolveVerificationUri(opts: PassportRouteOptions, req: { protocol?: string; hostname?: string }, prefix: string): string {
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
function authErrorResponse(res: any, err: unknown, state: unknown): void {
  const stateEcho = typeof state === 'string' && state ? { state } : {}
  if (err instanceof OAuthError) {
    res.status(err.statusCode).json({ ...err.toJSON(), ...stateEcho })
    return
  }
  report(err)
  res.status(500).json({ error: 'server_error', error_description: 'Internal server error.', ...stateEcho })
}

type RouteHandler = (req: any, res: any) => Promise<any> | any

interface Router {
  get(path: string, handler: RouteHandler, ...middleware: any[]): void
  post(path: string, handler: RouteHandler, ...middleware: any[]): void
  delete(path: string, handler: RouteHandler, ...middleware: any[]): void
}

/** Groups of routes that can be selectively excluded. */
export type PassportRouteGroup =
  | 'authorize'  // GET/POST/DELETE /oauth/authorize
  | 'token'      // POST /oauth/token
  | 'revoke'     // DELETE /oauth/tokens/:id
  | 'scopes'     // GET /oauth/scopes
  | 'device'     // POST /oauth/device/code + /oauth/device/approve

export interface PassportRouteOptions {
  /** Base path for OAuth routes (default: '/oauth') */
  prefix?: string
  /** Verification URI for device auth (default: '{origin}/oauth/device') */
  verificationUri?: string
  /** Route groups to skip when registering. */
  except?: PassportRouteGroup[]
  /**
   * Middleware applied to `POST /oauth/token`. The token endpoint is the
   * canonical brute-force target for client_secret guessing — every
   * production app SHOULD mount a per-route rate limiter here.
   *
   * Recommended setup:
   *
   * ```ts
   * import { RateLimit } from '@rudderjs/middleware'
   * import { registerPassportRoutes } from '@rudderjs/passport'
   *
   * registerPassportRoutes(router, {
   *   tokenMiddleware: [
   *     RateLimit.perMinute(10).by((req) => `${req.ip}:${req.body?.client_id}`),
   *   ],
   * })
   * ```
   *
   * The composite key (`ip + client_id`) prevents one noisy client from
   * exhausting the budget for legitimate co-tenants behind a shared NAT,
   * and prevents a single IP from churning through every client_id in the
   * registry. RateLimit also requires a cache provider to be registered —
   * see `@rudderjs/cache`. Without one the middleware silently passes
   * through.
   *
   * Accepts a single handler or an array. Empty / omitted means no
   * additional middleware is applied (the same as before this option
   * existed).
   */
  tokenMiddleware?: MiddlewareHandler | MiddlewareHandler[]
  /**
   * Middleware applied to the consent endpoints — `GET/POST/DELETE
   * /oauth/authorize` and `DELETE /oauth/tokens/:id`. POST /oauth/authorize
   * is the canonical CSRF target (an attacker page that auto-submits a
   * hidden form would mint authorization codes for the victim's logged-in
   * session).
   *
   * Most apps should NOT use this option. The recommended pattern is to
   * mount CSRF on the entire web group from `bootstrap/app.ts`:
   *
   * ```ts
   * .withMiddleware((m) => m.web(CsrfMiddleware()))
   * ```
   *
   * which automatically covers `/oauth/authorize` along with every other
   * state-changing web route. `authorizeMiddleware` is the per-route
   * fallback for apps that do NOT mount CSRF at the group level:
   *
   * ```ts
   * import { CsrfMiddleware } from '@rudderjs/middleware'
   * import { registerPassportWebRoutes } from '@rudderjs/passport'
   *
   * registerPassportWebRoutes(router, {
   *   authorizeMiddleware: [CsrfMiddleware()],
   * })
   * ```
   *
   * Don't do both — CsrfMiddleware running twice on the same request
   * emits duplicate `Set-Cookie`s on GETs and runs validation twice on
   * POSTs.
   *
   * Accepts a single handler or an array. Empty / omitted means no
   * additional middleware is applied — the typical case for apps that
   * already CSRF-guard at the group level.
   */
  authorizeMiddleware?: MiddlewareHandler | MiddlewareHandler[]
  /**
   * Middleware applied to the device-flow endpoints — `POST /oauth/device/code`
   * and `POST /oauth/device/approve`. RFC 8628 §5.2 calls for brute-force
   * protection on the user_code surface (8-char alphabet → 32^8 ≈ 1.1×10^12
   * keyspace; per-IP throttling makes exhaustion infeasible).
   *
   * Most apps should NOT need this option. The recommended pattern is to
   * mount a rate limiter on the entire api group from `bootstrap/app.ts`
   * (`withMiddleware((m) => m.api(RateLimit.perMinute(60)))`) — that single
   * hook covers the device endpoints alongside every other api route, and
   * 60/min per-IP is already enough that exhausting the user_code keyspace
   * would take tens of thousands of years.
   *
   * `deviceMiddleware` is the per-route fallback for apps that want a
   * tighter device-specific limit (e.g. `RateLimit.perMinute(5)`) on top of
   * — or in place of — the group default:
   *
   * ```ts
   * import { RateLimit } from '@rudderjs/middleware'
   * import { registerPassportApiRoutes } from '@rudderjs/passport'
   *
   * registerPassportApiRoutes(router, {
   *   deviceMiddleware: [RateLimit.perMinute(5).by((req) => req.ip)],
   * })
   * ```
   *
   * Layered limits compose in sequence — group + per-route both run, with
   * the tightest budget winning. Locking individual user_codes after N
   * misses (the stateful half of the original RFC 8628 §5.2 guidance)
   * isn't covered by RateLimit; if you need it, wrap your own middleware.
   *
   * Accepts a single handler or an array. Empty / omitted means no
   * additional middleware is applied — the typical case for apps that
   * already throttle the api group.
   */
  deviceMiddleware?: MiddlewareHandler | MiddlewareHandler[]
}

function asMiddlewareArray(input: MiddlewareHandler | MiddlewareHandler[] | undefined): MiddlewareHandler[] {
  if (!input) return []
  return Array.isArray(input) ? input : [input]
}

/**
 * Register all Passport OAuth routes on the given router.
 *
 * Becomes a no-op when `Passport.ignoreRoutes()` has been called — in that
 * case the application wires OAuth routes manually.
 *
 * @example
 * import { registerPassportRoutes } from '@rudderjs/passport'
 * registerPassportRoutes(router)
 *
 * @example
 * // Skip the built-in consent + scopes endpoints; mount your own
 * registerPassportRoutes(router, { except: ['authorize', 'scopes'] })
 */
export function registerPassportRoutes(router: Router, opts: PassportRouteOptions = {}): void {
  if (Passport.routesIgnored()) return

  const prefix = opts.prefix ?? '/oauth'
  const skip = new Set(opts.except ?? [])
  const tokenMiddleware     = asMiddlewareArray(opts.tokenMiddleware)
  const authorizeMiddleware = asMiddlewareArray(opts.authorizeMiddleware)
  const deviceMiddleware    = asMiddlewareArray(opts.deviceMiddleware)

  // ── /oauth/authorize ─────────────────────────────────────
  if (!skip.has('authorize')) {
    // GET /oauth/authorize — show consent (returns JSON or renders custom view)
    router.get(`${prefix}/authorize`, async (req: any, res: any) => {
      const query = req.query ?? {}
      try {
        const validated = await validateAuthorizationRequest({
          clientId:            query['client_id'] ?? '',
          redirectUri:         query['redirect_uri'] ?? '',
          responseType:        query['response_type'] ?? '',
          scope:               query['scope'] ?? '',
          state:               query['state'],
          codeChallenge:       query['code_challenge'],
          codeChallengeMethod: query['code_challenge_method'],
        })

        const ctx = {
          client: {
            id:   validated.client.id,
            name: validated.client.name,
          },
          scopes:      validated.scopes,
          redirectUri: validated.redirectUri,
          ...(validated.state !== undefined ? { state: validated.state } : {}),
          ...(validated.codeChallenge !== undefined ? { codeChallenge: validated.codeChallenge } : {}),
          ...(validated.codeChallengeMethod !== undefined ? { codeChallengeMethod: validated.codeChallengeMethod } : {}),
          request: req,
        }

        const viewFn = Passport.authorizationViewFn()
        if (viewFn) {
          return await viewFn(ctx)
        }

        // Default: JSON response — the app's consent screen reads this
        res.json({
          client:      ctx.client,
          scopes:      ctx.scopes,
          state:       ctx.state,
          redirectUri: ctx.redirectUri,
        })
      } catch (e) {
        authErrorResponse(res, e, query['state'])
      }
    }, authorizeMiddleware)

    // POST /oauth/authorize — user approves
    router.post(`${prefix}/authorize`, async (req: any, res: any) => {
      const body = req.body ?? {}
      try {
        const userId = (req.raw as any)?.__rjs_user?.id ?? (req as any).user?.id
        if (!userId) {
          // Echo state on the unauthenticated branch too — the consent UI
          // round-trips the same payload regardless of the auth gate result.
          const stateEcho = typeof body['state'] === 'string' && body['state'] ? { state: body['state'] } : {}
          res.status(401).json({ error: 'unauthenticated', error_description: 'User must be signed in.', ...stateEcho })
          return
        }

        await validateClientRedirect(body['client_id'], body['redirect_uri'])

        const code = await issueAuthCode({
          userId,
          clientId:            body['client_id'],
          scopes:              body['scopes'] ?? [],
          redirectUri:         body['redirect_uri'],
          codeChallenge:       body['code_challenge'],
          codeChallengeMethod: body['code_challenge_method'],
        })

        const redirectUri = new URL(body['redirect_uri'])
        redirectUri.searchParams.set('code', code)
        if (body['state']) redirectUri.searchParams.set('state', body['state'])

        res.json({ redirect_uri: redirectUri.toString() })
      } catch (e) {
        authErrorResponse(res, e, body['state'])
      }
    }, authorizeMiddleware)

    // DELETE /oauth/authorize — user denies
    router.delete(`${prefix}/authorize`, async (req: any, res: any) => {
      const body = req.body ?? {}
      try {
        await validateClientRedirect(body['client_id'], body['redirect_uri'])

        const redirectUri = new URL(body['redirect_uri'])
        redirectUri.searchParams.set('error', 'access_denied')
        redirectUri.searchParams.set('error_description', 'The user denied the request.')
        if (body['state']) redirectUri.searchParams.set('state', body['state'])

        res.json({ redirect_uri: redirectUri.toString() })
      } catch (e) {
        authErrorResponse(res, e, body['state'])
      }
    }, authorizeMiddleware)
  }

  // ── POST /oauth/token ────────────────────────────────────
  if (!skip.has('token')) {
    // `tokenMiddleware` runs ahead of the handler — primary intended use is
    // a per-route rate limiter so client_secret guessing can't churn through
    // the registry without backoff. See PassportRouteOptions.tokenMiddleware
    // jsdoc for the recommended config.
    router.post(`${prefix}/token`, async (req: any, res: any) => {
      try {
        const body = req.body ?? {}
        const grantType = body['grant_type'] as string

        // RFC 6749 §2.3.1 — confidential clients MUST be able to
        // authenticate via HTTP Basic; body params are an alternative.
        // §2.3 forbids using both at once. Resolve credentials once for
        // all grants instead of repeating the parsing in each branch.
        const credentials = resolveClientCredentials(req, body)

        let result

        switch (grantType) {
          case 'authorization_code':
            result = await exchangeAuthCode({
              grantType,
              code:          body['code'],
              ...credentials,
              redirectUri:   body['redirect_uri'],
              codeVerifier:  body['code_verifier'],
            })
            break

          case 'client_credentials':
            // ClientCredentialsRequest requires clientSecret (the grant
            // is confidential-only by spec). Surface the missing-secret
            // case as invalid_request rather than letting it surface
            // downstream as "Invalid client secret."
            if (credentials.clientSecret === undefined) {
              throw new OAuthError('invalid_request', 'client_secret is required for the client_credentials grant.', 401)
            }
            result = await clientCredentialsGrant({
              grantType,
              clientId:     credentials.clientId,
              clientSecret: credentials.clientSecret,
              scope:        body['scope'],
            })
            break

          case 'refresh_token':
            result = await refreshTokenGrant({
              grantType,
              refreshToken: body['refresh_token'],
              ...credentials,
              scope:        body['scope'],
            })
            break

          case 'urn:ietf:params:oauth:grant-type:device_code': {
            const pollResult = await pollDeviceCode({
              grantType,
              deviceCode: body['device_code'],
              clientId:   credentials.clientId,
            })
            if (pollResult.status === 'authorized') {
              result = pollResult.tokens
            } else {
              // RFC 8628 §3.5 — device-flow polling errors (including
              // slow_down) are §5.2-shaped errors and MUST return HTTP
              // 400. 429 is for transport-level rate-limiting, not the
              // OAuth `slow_down` signal.
              //
              // On slow_down, forward the escalated `interval` so a
              // well-behaved client uses the new value instead of having
              // to add 5 itself. Other variants don't need it.
              if (pollResult.status === 'slow_down') {
                res.status(400).json({ error: 'slow_down', interval: pollResult.interval })
              } else {
                res.status(400).json({ error: pollResult.status })
              }
              return
            }
            break
          }

          default:
            res.status(400).json({
              error: 'unsupported_grant_type',
              error_description: `Grant type "${grantType}" is not supported.`,
            })
            return
        }

        res.json(result)
      } catch (e) {
        if (e instanceof OAuthError) {
          // RFC 6749 §5.2 — client-auth failures at the token endpoint
          // are signalled with WWW-Authenticate alongside the 401 status.
          if (e.statusCode === 401 && typeof res.header === 'function') {
            res.header('WWW-Authenticate', 'Basic realm="oauth"')
          }
          res.status(e.statusCode).json(e.toJSON())
        } else {
          report(e)
          res.status(500).json({ error: 'server_error', error_description: 'Internal server error.' })
        }
      }
    }, tokenMiddleware)
  }

  // ── DELETE /oauth/tokens/:id — revoke a specific token ──
  // Requires a valid bearer token AND ownership of the token being revoked.
  // Token ids appear in JWT `jti` claims (semi-public), so without an
  // ownership check anyone with a single captured JWT could DoS arbitrary
  // users. Returns 404 (not 403) on ownership mismatch to avoid leaking
  // whether a given id exists.
  if (!skip.has('revoke')) {
    router.delete(`${prefix}/tokens/:id`, async (req: any, res: any) => {
      const tokenId = req.params?.['id'] ?? ''
      const AccessTokenCls = await Passport.tokenModel()
      const token = await AccessTokenCls.where('id', tokenId).first() as AccessToken | null

      const requesterId = (req.raw as any)?.__rjs_user?.id ?? (req as any).user?.id
      if (!token || !requesterId || token.userId !== requesterId) {
        res.status(404).json({ error: 'not_found', error_description: 'Token not found.' })
        return
      }

      // QueryBuilder.updateAll() bypasses the mass-assignment filter;
      // `revoked` is no longer in `AccessToken.fillable`.
      await AccessTokenCls.where('id', token.id)
        .updateAll({ revoked: true } as Record<string, unknown>)
      res.status(204).send()
    }, [RequireBearer(), ...authorizeMiddleware])
  }

  // ── GET /oauth/scopes ────────────────────────────────────
  if (!skip.has('scopes')) {
    router.get(`${prefix}/scopes`, async (_req: any, res: any) => {
      res.json(Passport.scopes())
    })
  }

  // ── /oauth/device ────────────────────────────────────────
  if (!skip.has('device')) {
    // POST /oauth/device/code — request device authorization
    // `deviceMiddleware` runs ahead of the handler — primary intended use is
    // a per-route rate limiter tighter than the api-group default. See
    // PassportRouteOptions.deviceMiddleware jsdoc.
    router.post(`${prefix}/device/code`, async (req: any, res: any) => {
      try {
        const body = req.body ?? {}
        const verificationUri = resolveVerificationUri(opts, req, prefix)
        const result = await requestDeviceCode({
          clientId: body['client_id'],
          scope:    body['scope'],
          verificationUri,
        })
        res.json(result)
      } catch (e) {
        if (e instanceof OAuthError) {
          res.status(e.statusCode).json(e.toJSON())
        } else {
          report(e)
          res.status(500).json({ error: 'server_error', error_description: 'Internal server error.' })
        }
      }
    }, deviceMiddleware)

    // POST /oauth/device/approve — user approves/denies device
    router.post(`${prefix}/device/approve`, async (req: any, res: any) => {
      try {
        const body = req.body ?? {}
        const userId = (req.raw as any)?.__rjs_user?.id ?? (req as any).user?.id
        if (!userId) {
          res.status(401).json({ error: 'unauthenticated', error_description: 'User must be signed in.' })
          return
        }
        await approveDeviceCode(body['user_code'], userId, body['approved'] !== false)
        res.json({ status: 'ok' })
      } catch (e) {
        if (e instanceof OAuthError) {
          res.status(e.statusCode).json(e.toJSON())
        } else {
          report(e)
          res.status(500).json({ error: 'server_error', error_description: 'Internal server error.' })
        }
      }
    }, deviceMiddleware)
  }
}

/**
 * Register the **web-group** Passport routes — `GET/POST/DELETE
 * /oauth/authorize` (the consent flow) and `DELETE /oauth/tokens/:id`
 * (revoke). These endpoints depend on session + authenticated user
 * resolution, so they belong on the same router that handles your
 * application's logged-in pages.
 *
 * `POST /oauth/authorize` requires CSRF protection. The recommended
 * pattern is to mount `CsrfMiddleware` on the entire web group from
 * `bootstrap/app.ts` (`withMiddleware((m) => m.web(CsrfMiddleware()))`)
 * — that single hook covers /oauth/authorize plus every other
 * state-changing web route. Apps that don't have group-level CSRF can
 * use the per-route fallback via `authorizeMiddleware: [CsrfMiddleware()]`
 * — see PassportRouteOptions.authorizeMiddleware. Don't do both.
 *
 * Thin wrapper around `registerPassportRoutes(router, { except: ['token',
 * 'scopes', 'device'] })`. Use `registerPassportApiRoutes()` for the
 * stateless half on the api group.
 */
export function registerPassportWebRoutes(router: Router, opts: PassportRouteOptions = {}): void {
  const except = new Set([...(opts.except ?? []), 'token', 'scopes', 'device'] as PassportRouteGroup[])
  registerPassportRoutes(router, { ...opts, except: Array.from(except) })
}

/**
 * Register the **api-group** Passport routes — `POST /oauth/token`,
 * `POST /oauth/device/code`, `POST /oauth/device/approve`, and `GET
 * /oauth/scopes`. These endpoints are stateless (machine-to-machine), so
 * they belong on the api router alongside your other JSON endpoints.
 *
 * `POST /oauth/token` is the canonical brute-force target — pass a rate
 * limiter via `tokenMiddleware`:
 *
 * ```ts
 * import { RateLimit } from '@rudderjs/middleware'
 * import { registerPassportApiRoutes } from '@rudderjs/passport'
 *
 * // routes/api.ts
 * registerPassportApiRoutes(router, {
 *   tokenMiddleware: [
 *     RateLimit.perMinute(10).by((req) => `${req.ip}:${req.body?.client_id}`),
 *   ],
 * })
 * ```
 *
 * Thin wrapper around `registerPassportRoutes(router, { except:
 * ['authorize', 'revoke'] })`. Use `registerPassportWebRoutes()` for the
 * stateful half on the web group.
 */
export function registerPassportApiRoutes(router: Router, opts: PassportRouteOptions = {}): void {
  const except = new Set([...(opts.except ?? []), 'authorize', 'revoke'] as PassportRouteGroup[])
  registerPassportRoutes(router, { ...opts, except: Array.from(except) })
}
