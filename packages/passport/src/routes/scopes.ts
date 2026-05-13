import { Passport } from '../Passport.js'
import type { Router } from './types.js'

/**
 * Register `GET /oauth/scopes` — list the OAuth scopes the app has declared
 * via `Passport.tokensCan({...})`. Stateless, no auth required — useful for
 * client SDKs that want to render the consent screen's scope list without
 * round-tripping `/oauth/authorize`.
 */
export function registerScopesRoute(router: Router, prefix: string): void {
  router.get(`${prefix}/scopes`, async (_req: any, res: any) => {
    res.json(Passport.scopes())
  })
}
