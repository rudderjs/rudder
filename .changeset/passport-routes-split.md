---
"@rudderjs/passport": patch
---

Internal cleanup: split `src/routes.ts` (657 LOC) into a thin orchestrator + six cohesive siblings under `src/routes/`. The public subpath export `@rudderjs/passport/routes` is unchanged — `routes.ts` itself drops to 94 LOC and re-exports the same three public functions (`registerPassportRoutes`, `registerPassportWebRoutes`, `registerPassportApiRoutes`) plus the two public types. New layout:

- `routes/types.ts` — `PassportRouteGroup`, `PassportRouteOptions`, internal `Router` + `RouteHandler`
- `routes/helpers.ts` — `validateClientRedirect`, `resolveClientCredentials`, `resolveVerificationUri`, `authErrorResponse`, `asMiddlewareArray`, and a new `requesterIdFrom(req)` helper collapsing 3 repeated `(req.raw as any)?.__rjs_user?.id ?? (req as any).user?.id` reads
- `routes/authorize.ts` — `GET/POST/DELETE /oauth/authorize`
- `routes/token.ts` — `POST /oauth/token`
- `routes/revoke.ts` — `DELETE /oauth/tokens/:id`
- `routes/scopes.ts` — `GET /oauth/scopes`
- `routes/device.ts` — `POST /oauth/device/code` + `POST /oauth/device/approve`

Source casts: `as any` 6 → 0 inside routes (handled by the new `requesterIdFrom` helper); lint warnings 40 → 34. No public API or behavior change.
