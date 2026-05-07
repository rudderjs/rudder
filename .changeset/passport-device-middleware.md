---
'@rudderjs/passport': minor
---

`deviceMiddleware` option on `registerPassportRoutes()` — closes finding P8 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`.

RFC 8628 §5.2 calls for brute-force protection on the user_code surface. With a 32^8 ≈ 1.1×10^12 keyspace, the typical api-group rate limit (`m.api(RateLimit.perMinute(60))` in `bootstrap/app.ts`) already makes exhaustion infeasible — ~35,000 years of constant attack per IP — so most apps are already covered.

For apps that want a tighter device-specific limit, Passport now surfaces `PassportRouteOptions.deviceMiddleware`, an opt-in slot for any middleware to mount on `POST /oauth/device/code` and `POST /oauth/device/approve` ahead of the handler. Pass a single handler or an array; the most common use is a tighter rate limiter:

```ts
import { RateLimit } from '@rudderjs/middleware'
import { registerPassportApiRoutes } from '@rudderjs/passport'

registerPassportApiRoutes(router, {
  deviceMiddleware: [
    RateLimit.perMinute(5).by((req) => req.ip),
  ],
})
```

Layered limits compose in sequence — group + per-route both run, with the tightest budget winning. The "lock individual user_codes after N misses" half of RFC 8628 §5.2's guidance isn't covered here (it's per-userCode state, not per-IP throttling); apps that need it can wrap their own middleware.

`deviceMiddleware` is scoped to the device endpoints only; `/oauth/token`, `/oauth/authorize`, `/oauth/tokens/:id`, and `/oauth/scopes` are unaffected. Omitting the option is fully back-compat — the default registration is unchanged.

CLAUDE.md "Pitfalls" updated with the recommended config.
