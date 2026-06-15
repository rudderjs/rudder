---
"@rudderjs/middleware": patch
---

Gate the RateLimit and ThrottleMiddleware asset-skip on safe HTTP methods.

Both limiters skip requests whose last path segment contains a dot (the static-asset/Vite heuristic), but the skip ran for every method. An unsafe request to a dotted-segment path (`POST /users/john.doe`, `POST /auth/forgot/a@b.com`, `POST /auth/login.json`) therefore bypassed rate limiting and throttling entirely, silently voiding brute-force protection on those routes. The skip now only applies to safe methods (GET/HEAD/OPTIONS), matching the CSRF middleware's existing asset-gate. The `/@` and `/node_modules` Vite prefixes are GET-only in practice, so dev HMR and static assets stay uncovered as before.
