import type { MiddlewareHandler } from '@rudderjs/contracts'
import { report } from '@rudderjs/core'
import { requestDeviceCode, approveDeviceCode, OAuthError } from '../grants/index.js'
import type { PassportRouteOptions, Router } from './types.js'
import { requesterIdFrom, resolveVerificationUri } from './helpers.js'

/**
 * Register `POST /oauth/device/code` + `POST /oauth/device/approve` — the
 * RFC 8628 device authorization flow.
 *
 * - `POST /oauth/device/code` is stateless: a device requests a `device_code`
 *   + `user_code` pair, plus the `verification_uri` for the user to visit.
 * - `POST /oauth/device/approve` is session-backed: the signed-in user
 *   approves or denies the device after typing the user_code.
 *
 * `mw` runs ahead of both handlers. The RFC 8628 §5.2 brute-force concern
 * on user_code is already covered by a typical 60/min api-group rate
 * limiter; pass a tighter per-route limiter via `deviceMiddleware` if your
 * threat model warrants it.
 *
 * `verification_uri` resolution priority: explicit `opts.verificationUri`
 * > `config('app.url')` > `req.protocol + req.hostname` (last resort with
 * a one-shot warning, since `Host` is attacker-controlled behind a
 * reverse proxy without trust-proxy).
 */
export function registerDeviceRoutes(
  router: Router,
  opts: PassportRouteOptions,
  prefix: string,
  mw: MiddlewareHandler[],
): void {
  // POST /oauth/device/code — request device authorization
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
  }, mw)

  // POST /oauth/device/approve — user approves/denies device
  router.post(`${prefix}/device/approve`, async (req: any, res: any) => {
    try {
      const body = req.body ?? {}
      const userId = requesterIdFrom(req)
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
  }, mw)
}
