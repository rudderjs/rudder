---
'@rudderjs/middleware': patch
---

Three middleware error / silent-gap improvements:

- **`ThrottleMiddleware`'s 429 response** now sets a `Retry-After` header (already done on `RateLimit`; was missing on `ThrottleMiddleware`) and the JSON message includes the seconds-to-retry: `Too many requests. Retry after <N>s.` instead of the un-actionable `Too many requests. Please slow down.`
- **`CsrfMiddleware`'s 419 mismatch response** now spells out what the developer must do: which header / form field / cookie didn't match, and how to fix from a `fetch()` call (`getCsrfToken()` + `X-CSRF-Token`). Was: bare `CSRF token mismatch.`
- **`RateLimit` silent bypass** (when no cache provider is registered) now emits a one-time `console.warn` on the first hit: `RateLimit installed but no cache provider is registered — limits are NOT being enforced.` The middleware still falls through to `next()` to avoid 500ing every request, but a deployment that *thinks* it has rate limits when it doesn't is a security-relevant gap, and a single stderr line per process surfaces it without log-spamming.

All 50 middleware tests pass. Found by the Phase 2 error-message audit.
