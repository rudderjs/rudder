---
'@rudderjs/passport': patch
---

Two passport-surface review fixes:

- **`HasApiTokens.tokenCan(scope)` now actually works** (P2). The mixin previously read `__currentToken` — a field BearerMiddleware never wrote — so every gate check silently returned `false`. The mixin now reads `__passport_token` to match what the middleware writes on `req.raw`, and `BearerMiddleware` / `RequireBearer` stamp the same key onto the resolved user model before the plain-copy step so it propagates onto `req.user`. Closes finding P2 from the passport-surface review.
- **`rudder passport:keys --force` no longer destroys old keys** (L1). Existing `oauth-private.key` / `oauth-public.key` are renamed to `*.bak.<ISO-timestamp>` before the new pair is written, and the CLI prints both backup paths plus a warning that JWTs signed by the old key now fail verification. `generateKeys()` returns the new `backup` field for programmatic callers. Closes finding L1.
