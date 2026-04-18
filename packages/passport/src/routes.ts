import { Passport } from './Passport.js'
import type { AccessToken } from './models/AccessToken.js'
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

  // ── /oauth/authorize ─────────────────────────────────────
  if (!skip.has('authorize')) {
    // GET /oauth/authorize — show consent (returns JSON or renders custom view)
    router.get(`${prefix}/authorize`, async (req: any, res: any) => {
      try {
        const query = req.query ?? {}
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
            id:   (validated.client as any).id as string,
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
        if (e instanceof OAuthError) {
          res.status(e.statusCode).json(e.toJSON())
        } else {
          res.status(500).json({ error: 'server_error', error_description: 'Internal server error.' })
        }
      }
    })

    // POST /oauth/authorize — user approves
    router.post(`${prefix}/authorize`, async (req: any, res: any) => {
      try {
        const body = req.body ?? {}
        const userId = (req.raw as any)?.__rjs_user?.id ?? (req as any).user?.id
        if (!userId) {
          res.status(401).json({ error: 'unauthenticated', error_description: 'User must be signed in.' })
          return
        }

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
        if (e instanceof OAuthError) {
          res.status(e.statusCode).json(e.toJSON())
        } else {
          res.status(500).json({ error: 'server_error', error_description: 'Internal server error.' })
        }
      }
    })

    // DELETE /oauth/authorize — user denies
    router.delete(`${prefix}/authorize`, async (req: any, res: any) => {
      const body = req.body ?? {}
      const redirectUri = new URL(body['redirect_uri'] ?? 'http://localhost')
      redirectUri.searchParams.set('error', 'access_denied')
      redirectUri.searchParams.set('error_description', 'The user denied the request.')
      if (body['state']) redirectUri.searchParams.set('state', body['state'])

      res.json({ redirect_uri: redirectUri.toString() })
    })
  }

  // ── POST /oauth/token ────────────────────────────────────
  if (!skip.has('token')) {
    router.post(`${prefix}/token`, async (req: any, res: any) => {
      try {
        const body = req.body ?? {}
        const grantType = body['grant_type'] as string

        let result

        switch (grantType) {
          case 'authorization_code':
            result = await exchangeAuthCode({
              grantType,
              code:          body['code'],
              clientId:      body['client_id'],
              clientSecret:  body['client_secret'],
              redirectUri:   body['redirect_uri'],
              codeVerifier:  body['code_verifier'],
            })
            break

          case 'client_credentials':
            result = await clientCredentialsGrant({
              grantType,
              clientId:     body['client_id'],
              clientSecret: body['client_secret'],
              scope:        body['scope'],
            })
            break

          case 'refresh_token':
            result = await refreshTokenGrant({
              grantType,
              refreshToken: body['refresh_token'],
              clientId:     body['client_id'],
              clientSecret: body['client_secret'],
              scope:        body['scope'],
            })
            break

          case 'urn:ietf:params:oauth:grant-type:device_code': {
            const pollResult = await pollDeviceCode({
              grantType,
              deviceCode: body['device_code'],
              clientId:   body['client_id'],
            })
            if (pollResult.status === 'authorized') {
              result = pollResult.tokens
            } else {
              res.status(pollResult.status === 'slow_down' ? 429 : 400).json({
                error: pollResult.status,
              })
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
          res.status(e.statusCode).json(e.toJSON())
        } else {
          res.status(500).json({ error: 'server_error', error_description: 'Internal server error.' })
        }
      }
    })
  }

  // ── DELETE /oauth/tokens/:id — revoke a specific token ──
  if (!skip.has('revoke')) {
    router.delete(`${prefix}/tokens/:id`, async (req: any, res: any) => {
      const tokenId = req.params?.['id'] ?? ''
      const AccessTokenCls = await Passport.tokenModel()
      const token = await AccessTokenCls.where('id', tokenId).first() as AccessToken | null
      if (!token) {
        res.status(404).json({ error: 'not_found', error_description: 'Token not found.' })
        return
      }
      await AccessTokenCls.update((token as any).id as string, { revoked: true } as any)
      res.status(204).send()
    })
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
    router.post(`${prefix}/device/code`, async (req: any, res: any) => {
      try {
        const body = req.body ?? {}
        const verificationUri = opts.verificationUri ?? `${req.protocol}://${req.hostname}${prefix}/device`
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
          res.status(500).json({ error: 'server_error', error_description: 'Internal server error.' })
        }
      }
    })

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
          res.status(500).json({ error: 'server_error', error_description: 'Internal server error.' })
        }
      }
    })
  }
}
