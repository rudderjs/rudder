import type { MiddlewareHandler } from '@rudderjs/contracts'
import { Passport } from '../Passport.js'
import { validateAuthorizationRequest, issueAuthCode } from '../grants/index.js'
import type { Router } from './types.js'
import { authErrorResponse, requesterIdFrom, validateClientRedirect } from './helpers.js'

/**
 * Register `GET/POST/DELETE /oauth/authorize` — the consent flow.
 *
 * - `GET` validates the authorization request and renders the consent screen
 *   (custom via `Passport.authorizationView()` or JSON by default).
 * - `POST` requires a signed-in user and issues an authorization code on
 *   approval, redirecting back to `redirect_uri` with `code` + `state`.
 * - `DELETE` issues an `access_denied` redirect on rejection.
 *
 * The redirect_uri on POST/DELETE bodies is attacker-controlled and is
 * re-validated against the client's registered list (see
 * `validateClientRedirect` in `helpers.ts`).
 */
export function registerAuthorizeRoutes(router: Router, prefix: string, mw: MiddlewareHandler[]): void {
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
  }, mw)

  // POST /oauth/authorize — user approves
  router.post(`${prefix}/authorize`, async (req: any, res: any) => {
    const body = req.body ?? {}
    try {
      const userId = requesterIdFrom(req)
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
  }, mw)

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
  }, mw)
}
