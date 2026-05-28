---
'@rudderjs/auth': patch
'@rudderjs/session': patch
---

Reworded "lost-context" errors so they name the correct alternative instead of recommending middleware that won't run on the surface where the error fired. Since the web/api route-group split (`AuthMiddleware` and `sessionMiddleware` auto-install on the `web` group only), the previous messages told API / queue / CLI callers to "use AuthMiddleware" — which is exactly the wrong fix on those surfaces.

- **`currentAuth()` (`auth-manager.ts`)** — was: `[RudderJS Auth] No auth context. Use AuthMiddleware.` Now points API callers at `RequireBearer() + req.user` (via `@rudderjs/passport`) and queue/CLI callers at passing the user id explicitly.
- **`Session.current()` (`session/index.ts`)** — was: `[RudderJS Session] No session in context. Use sessionMiddleware.` Now points at `Session.maybeCurrent()` for a non-throwing read on API routes, and mentions per-route `sessionMiddleware()` for the explicit-opt-in case.
- **`AuthorizationError` from `Gate.authorize()` / `Policy.authorize()` (`auth/gate.ts`)** — base message unchanged ("This action is unauthorized. [<ability>]"). In dev (`NODE_ENV !== 'production'`) we now append a one-line hint at the most common cause of an *unexpected* 403: typo'd ability or missing `Gate.define()` / `Policy.<ability>()`. Stripped in prod so the client-facing JSON stays terse.

Tests assertions updated to match the new strings. Found by the Phase 2 error-message audit.
