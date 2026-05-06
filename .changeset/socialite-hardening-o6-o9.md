---
'@rudderjs/socialite': minor
---

Harden OAuth driver fetches against four review findings (O6–O9):

- **O6 — Sanitize provider error messages.** Token exchange + user-info errors no longer interpolate the full response body into `Error.message`. Body is attached on `Error.cause` (`{ status, body }`) so callers that need it can still inspect, but log/error-tracking destinations stop receiving provider-echoed `client_id`, hints, or PII.
- **O7 — Per-request timeout via `AbortSignal`.** All four built-in drivers (GitHub user-emails, Google/Facebook/GitHub token + user-info, Apple id_token) now fetch through a shared `fetchWithTimeout` helper on the base driver. Default 10s per request; override via `SocialiteDriverConfig.timeout` (milliseconds). Stops a hung provider endpoint from keeping a request handler alive indefinitely.
- **O8 — Type-check the token-exchange response.** `access_token` must be a non-empty string (rejected if number / null / empty). `refresh_token` and `expires_in` fall back to `null` on type mismatch instead of being cast and exposed downstream.
- **O9 — `Socialite.extend(name, factory)` invalidates the cached driver.** Previously, calling `extend()` after the driver had been resolved was silent: `_instances` kept the old instance. Now `extend()` drops the cached entry so the next `driver(name)` call uses the new factory. Helps hot-reload + runtime-override workflows.

No breaking changes — `timeout` is additive, error semantics tighten only at the message-vs-cause split, and type-checking only rejects responses that would have produced runtime crashes downstream anyway.
