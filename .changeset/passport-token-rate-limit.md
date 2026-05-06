---
'@rudderjs/passport': minor
---

`tokenMiddleware` option on `registerPassportRoutes()` — closes finding E8 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`.

`POST /oauth/token` is the canonical brute-force target for client_secret guessing — without a per-route rate limit, only the app's global limiter (if any) stands between an attacker and the entire client registry. Passport now surfaces `PassportRouteOptions.tokenMiddleware`, an opt-in slot for any middleware to mount on `/oauth/token` ahead of the handler. Pass a single handler or an array; the most common use is a rate limiter:

```ts
import { RateLimit } from '@rudderjs/middleware'
import { registerPassportRoutes } from '@rudderjs/passport'

registerPassportRoutes(router, {
  tokenMiddleware: [
    RateLimit.perMinute(10).by((req) => `${req.ip}:${req.body?.client_id}`),
  ],
})
```

The composite key `${ip}:${client_id}` prevents one noisy client from exhausting the budget for legitimate co-tenants behind a shared NAT, AND prevents a single IP from churning through every client_id in the registry. `RateLimit` requires `@rudderjs/cache` to be registered — without a cache provider the middleware silently passes through.

`tokenMiddleware` is scoped to the token endpoint only; other passport endpoints (`/oauth/authorize`, `/oauth/device/code`, `/oauth/device/approve`, `/oauth/tokens/:id`) are unaffected. Omitting the option is fully back-compat — the default registration is unchanged.

CLAUDE.md "Pitfalls" updated with the recommended config.
