---
'@rudderjs/passport': minor
---

Split Passport routes between web and api groups + opt-in CSRF — closes finding E7 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`.

`POST /oauth/authorize` is a state-changing endpoint reached from a logged-in browser session — the canonical CSRF target. The previous default (`registerPassportRoutes` on a single router) had no clean home for the consent flow when the app maintains separate web + api routers, and the playground mounted everything on the api group, where session/AuthMiddleware don't run, so the consent flow couldn't even resolve `req.user`.

**Two new exports** carve out the right pairing:

- `registerPassportWebRoutes(router, opts)` — mounts the consent flow (`GET/POST/DELETE /oauth/authorize`) and the revoke endpoint (`DELETE /oauth/tokens/:id`). Goes in `routes/web.ts`.
- `registerPassportApiRoutes(router, opts)` — mounts `POST /oauth/token`, `POST /oauth/device/code`, `POST /oauth/device/approve`, and `GET /oauth/scopes`. Goes in `routes/api.ts`.

Both are thin wrappers around `registerPassportRoutes(...)` with the appropriate `except` set, so they share every other option (`prefix`, `verificationUri`, `tokenMiddleware`, etc.). The original `registerPassportRoutes` keeps its everything-on-one-router behavior for back-compat.

**`PassportRouteOptions.authorizeMiddleware`** — new opt-in slot for middleware to mount on the consent endpoints (parallel to the existing `tokenMiddleware`). Most apps should NOT use this option; the recommended pattern is to mount CSRF on the entire web group in `bootstrap/app.ts`:

```ts
.withMiddleware((m) => m.web(CsrfMiddleware()))
```

which automatically covers `/oauth/authorize` along with every other state-changing web route. `authorizeMiddleware` is the per-route fallback for apps that don't have group-level CSRF:

```ts
import { CsrfMiddleware } from '@rudderjs/middleware'
import { registerPassportWebRoutes } from '@rudderjs/passport'

registerPassportWebRoutes(router, {
  authorizeMiddleware: [CsrfMiddleware()],
})
```

Don't do both — CsrfMiddleware running twice emits duplicate `Set-Cookie`s on GETs and runs validation twice on POSTs.

Playground updated end-to-end: `routes/web.ts` mounts `registerPassportWebRoutes` (CSRF already covered by `m.web(CsrfMiddleware(...))` in `bootstrap/app.ts`); `routes/api.ts` switches to `registerPassportApiRoutes` and includes the recommended `tokenMiddleware` rate limiter.

CLAUDE.md Architecture Rules + the file index updated to reflect the split and the don't-double-mount-CSRF guidance.
