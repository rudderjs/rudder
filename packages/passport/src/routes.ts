import { Passport } from './Passport.js'
import { AccessToken } from './models/AccessToken.js'
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

type RouteHandler = (req: any, res: any) => Promise<void>

interface Router {
  get(path: string, handler: RouteHandler, ...middleware: any[]): void
  post(path: string, handler: RouteHandler, ...middleware: any[]): void
  delete(path: string, handler: RouteHandler, ...middleware: any[]): void
}

export interface PassportRouteOptions {
  /** Base path for OAuth routes (default: '/oauth') */
  prefix?: string
  /** Verification URI for device auth (default: '{origin}/oauth/device') */
  verificationUri?: string
}

/**
 * Register all Passport OAuth routes on the given router.
 *
 * @example
 * import { registerPassportRoutes } from '@rudderjs/passport/routes'
 * registerPassportRoutes(router)
 */
export function registerPassportRoutes(router: Router, opts: PassportRouteOptions = {}): void {
  const prefix = opts.prefix ?? '/oauth'

  // ── GET /oauth/authorize — show consent (returns validation data, app renders UI)
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

      // Return validation data — the app's consent screen reads this
      res.json({
        client: {
          id:   (validated.client as any).id,
          name: validated.client.name,
        },
        scopes:      validated.scopes,
        state:       validated.state,
        redirectUri: validated.redirectUri,
      })
    } catch (e) {
      if (e instanceof OAuthError) {
        res.status(e.statusCode).json(e.toJSON())
      } else {
        res.status(500).json({ error: 'server_error', error_description: 'Internal server error.' })
      }
    }
  })

  // ── POST /oauth/authorize — user approves
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

  // ── DELETE /oauth/authorize — user denies
  router.delete(`${prefix}/authorize`, async (req: any, res: any) => {
    const body = req.body ?? {}
    const redirectUri = new URL(body['redirect_uri'] ?? 'http://localhost')
    redirectUri.searchParams.set('error', 'access_denied')
    redirectUri.searchParams.set('error_description', 'The user denied the request.')
    if (body['state']) redirectUri.searchParams.set('state', body['state'])

    res.json({ redirect_uri: redirectUri.toString() })
  })

  // ── POST /oauth/token — issue tokens (all grant types)
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

  // ── DELETE /oauth/tokens/:id — revoke a specific token
  router.delete(`${prefix}/tokens/:id`, async (req: any, res: any) => {
    const tokenId = req.params?.['id'] ?? ''
    const token = await AccessToken.where('id', tokenId).first() as AccessToken | null
    if (!token) {
      res.status(404).json({ error: 'not_found', error_description: 'Token not found.' })
      return
    }
    await token.revoke()
    res.status(204).send()
  })

  // ── GET /oauth/scopes — list available scopes
  router.get(`${prefix}/scopes`, async (_req: any, res: any) => {
    res.json(Passport.scopes())
  })

  // ── POST /oauth/device/code — request device authorization
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

  // ── POST /oauth/device/approve — user approves/denies device
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
