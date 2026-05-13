import type { MiddlewareHandler } from '@rudderjs/contracts'
import { report } from '@rudderjs/core'
import {
  exchangeAuthCode,
  clientCredentialsGrant,
  refreshTokenGrant,
  pollDeviceCode,
  OAuthError,
} from '../grants/index.js'
import type { Router } from './types.js'
import { resolveClientCredentials } from './helpers.js'

/**
 * Register `POST /oauth/token` — the OAuth 2 token endpoint.
 *
 * Dispatches to one of the four supported grants:
 *   - `authorization_code` — exchanges an auth code for tokens
 *   - `client_credentials` — machine-to-machine, confidential clients only
 *   - `refresh_token`      — rotates an access+refresh pair
 *   - `urn:ietf:params:oauth:grant-type:device_code` — polls device flow
 *
 * `mw` runs ahead of the handler. The token endpoint is the canonical
 * brute-force target for client_secret guessing — every production app
 * SHOULD pass a per-route rate limiter here. See
 * `PassportRouteOptions.tokenMiddleware` jsdoc for the recommended config.
 *
 * RFC 6749 §5.2 — client-auth failures (HTTP 401) are signalled with a
 * `WWW-Authenticate: Basic` header alongside the body. RFC 8628 §3.5 —
 * device-flow polling errors (`authorization_pending`, `slow_down`,
 * `expired_token`, `access_denied`) return HTTP 400; 429 is for transport-
 * level rate-limiting, not the OAuth `slow_down` signal.
 */
export function registerTokenRoute(router: Router, prefix: string, mw: MiddlewareHandler[]): void {
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
  }, mw)
}
