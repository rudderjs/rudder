---
'@rudderjs/passport': patch
---

Mechanical cleanup bundle — closes findings L7, L8, P12, and E12 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`.

**L7 — drop `(x as any).id` casts.** `OAuthClient`, `AccessToken`, `RefreshToken`, `AuthCode`, and `DeviceCode` now `declare id: string`. Every call site that reached `.id` through an `(x as any).id as string` cast now hits the typed property directly (`token.id`, `client.id`, `authCode.id`, etc.) — same bytecode at runtime, the casts were purely a TypeScript ergonomics artifact. The seeder stub emitted by `make:passport-client` has been updated to match.

**L8 — device-flow verification URI prefers `config('app.url')`.** `requestDeviceCode`'s default verification URI no longer derives from `${req.protocol}://${req.hostname}` first. Resolution order is now: `opts.verificationUri` → `config('app.url') + prefix + '/device'` → host-header fallback (kept for dev convenience). The fallback emits a one-shot warning so production deployments behind a reverse proxy without trust-proxy notice the host-header dependency. Most apps already export `app.url` in `config/app.ts` and won't see the warning.

**P12 — single `Date.now()` snapshot in `issueTokens`.** `iat`, `exp`, `expires_in`, and the refresh token's `expiresAt` are all derived from one `const now = Date.now()` at the top of issuance. `createToken` accepts an optional `iatMs` so the caller's snapshot reaches the JWT payload — a downstream verifier no longer sees `iat + expires_in !== exp` from sub-second drift between independent `Date.now()` reads across the intervening async DB write + key load.

**E12 — `state` echoed on auth-endpoint errors + `report()` for `server_error`.** `GET/POST/DELETE /oauth/authorize` now echo `state` back on every error path (RFC 6749 §4.1.2.1). Non-`OAuthError` throws across the OAuth handlers (`/authorize`, `/token`, `/device/code`, `/device/approve`) call `report()` so the root cause surfaces through the configured exception reporter instead of being silently collapsed under `server_error`.
