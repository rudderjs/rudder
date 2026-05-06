---
'@rudderjs/passport': patch
---

Endpoint hardening — three RFC conformance fixes from the passport-surface review.

**E5 — Bearer scheme is case-insensitive** (RFC 6750 §2.1 / RFC 7235 §2.1). `BearerMiddleware()` and `RequireBearer()` no longer reject `bearer xyz` or `BEARER xyz` — the prefix is matched against `authHeader.slice(0, 7).toLowerCase()`.

**E10 — `invalid_client` returns HTTP 401 with `WWW-Authenticate`** (RFC 6749 §5.2). The auth-code grant was the inconsistent outlier — refresh-token and client-credentials already returned 401. All three `invalid_client` throws in `exchangeAuthCode()` now pass `401`, and the `/oauth/token` route appends `WWW-Authenticate: Basic realm="oauth"` whenever it surfaces a 401 OAuthError.

**E11 — device-flow `slow_down` returns HTTP 400, not 429** (RFC 8628 §3.5). `slow_down` is a §5.2-shaped error and the spec doesn't authorise 429; the previous special case is removed.

No schema, no API surface change. Closes findings E5, E10, E11 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`.
