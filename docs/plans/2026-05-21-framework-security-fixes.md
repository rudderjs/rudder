# Framework security fixes

**Status:** OPEN 2026-05-21
**Scope:** `@rudderjs/passport`, `@rudderjs/auth`, `@rudderjs/middleware`
**Source:** Senior-engineer security review pass, 2026-05-21
**Severity:** 6 findings — 2 OAuth grant races (RFC 6819 §5.2.2.3 violation), 1 rate-limit bypass, 3 fail-open / leak gaps

Race-condition bugs dominate this plan — three of six findings are read-modify-write patterns where the atomic-claim primitive was right there but wasn't used. The `authorization-code` grant gets it right; refresh-token / device-code / rate-limit just didn't copy the pattern.

---

## Phase 1 — Refresh-token rotation atomic claim 🔒

**Severity:** high — concurrent refreshes both mint token pairs; family-reuse detector silently never fires
**Effort:** ~30 min + test

`packages/passport/src/grants/refresh-token.ts:91` does:

```ts
const rt = await RefreshToken.where('tokenHash', hash).first()
if (!rt || rt.revoked) throw invalidGrant()
// …
await issueTokens(...)
await RefreshToken.where('id', rt.id).updateAll({ revoked: true })
```

Two concurrent requests with the same token both pass `revoked === false`, both call `issueTokens()`, both then revoke. One refresh token mints two access+refresh pairs. The reuse detector at `refresh-token.ts:52-60` is supposed to fire `revokeFamily()` on a second use of a consumed token — but both requests saw the token as unconsumed, so neither path runs.

### Fix

Mirror the auth-code pattern at `authorization-code.ts:236-242`: conditional update with rowcount check.

```ts
const claimed = await RefreshToken
  .where('id', rt.id)
  .where('revoked', false)
  .updateAll({ revoked: true })

if (claimed === 0) {
  // Lost the race → another request consumed this token → family compromise
  await revokeFamily(rt.familyId)
  throw invalidGrant('refresh_token_reuse')
}
// Only the winner proceeds to issueTokens()
await issueTokens(...)
```

### Regression test

`refresh-token.test.ts`:
1. Issue refresh token T.
2. `Promise.all([refresh(T), refresh(T)])`.
3. Assert exactly one resolves with new tokens, one rejects with `invalid_grant`.
4. Assert `revokeFamily()` was called for the family.

---

## Phase 2 — Device-code polling atomic claim 🔒

**Severity:** high — same shape as Phase 1; concurrent polls after approval both mint tokens
**Effort:** ~30 min + test

`packages/passport/src/grants/device-code.ts:179-198` reads the row, checks `approved === true`, issues tokens, then deletes. Two concurrent polls during the approval window both observe `approved=true && undeleted` and each call `issueTokens(...)` before the delete runs.

### Fix

Add a `consumed` column (or repurpose the delete as the claim by checking affected-rows count):

```ts
const claimed = await DeviceCode
  .where('id', d.id)
  .where('approved', true)
  .where('consumed', false)
  .updateAll({ consumed: true })

if (claimed === 0) throw authorizationPending()
// Only the winner issues tokens
const tokens = await issueTokens(...)
await DeviceCode.where('id', d.id).delete()  // cleanup, now redundant for security
```

If a `consumed` column would require schema migration, the alternative is delete-with-count: `.delete()` returning row count and treating `0` as "lost the race." But Drizzle returns 0 for deleted rowcount on MySQL (see ORM plan Phase 4), so the column approach is more portable.

### Regression test

Mirror Phase 1: concurrent polls after approval, exactly one succeeds.

---

## Phase 3 — RateLimit atomic increment 🔒

**Severity:** high — login throttle bypass via concurrent requests; documented use case is `RateLimit.perMinute(5)` on `/auth/sign-in`
**Effort:** ~1h + cache-adapter contract widening

`packages/middleware/src/index.ts:311-327` does:

```ts
const record = await cache.get(key) ?? { count: 0, ... }
const count = record.count + 1
if (count > opts.max) return new Response('429', { status: 429 })
await cache.set(key, { count, ... }, ttl)
```

Read → modify → write across the network gap. On Redis backend, two requests racing can both read `count=N`, both write `N+1` → up to 2× max allowed in a window. With many parallel attackers, ~M× max.

### Fix

Use the cache adapter's atomic `increment(key, ttl)`. The `@rudderjs/cache` contract should expose:

```ts
interface CacheStore {
  // existing: get/set/forget/has/...
  increment(key: string, by?: number, ttl?: number): Promise<number>  // returns new count
}
```

Redis: `INCR` + `EXPIRE` in a pipeline. Memory cache: atomic `Map` op. The rate-limit middleware becomes:

```ts
const count = await cache.increment(key, 1, opts.windowSec)
if (count > opts.max) return new Response('429', { ... })
```

If `@rudderjs/cache`'s adapter contract doesn't have `increment` today (verify), add it as a required method with a compat shim that falls back to get+set with a `console.warn('non-atomic')` for adapters that haven't migrated. Phase Phase 3a / 3b can split contract widening from middleware adoption if needed.

### Regression test

`middleware/src/rate-limit.test.ts`:
1. Configure `perMinute(5)`.
2. Fire `Promise.all` of 50 concurrent requests against the same key.
3. Assert exactly 5 succeed (200), 45 return 429.

Currently this test would non-deterministically fail (or pass) depending on Redis network timing.

---

## Phase 4 — `AuthMiddleware` finally block

**Severity:** medium — `req.user` snapshot leaks into error renderer if handler throws after sign-in
**Effort:** ~15 min + test

`packages/auth/src/index.ts:87-126` — `syncUser()` writes `req.user` after `next()`. If the wrapped handler throws *after* a successful sign-in (e.g. a controller error after the session was persisted), the post-`next` sync block never runs and `req.user` is stale or inconsistent.

### Fix

Wrap the post-next sync in a `try/finally` so it runs regardless of throw:

```ts
return async function AuthMiddleware(req, res, next) {
  await runWithAuth(authManager, async () => {
    const beforeUid = readSessionUid(req)
    try {
      await next()
    } finally {
      const afterUid = readSessionUid(req)
      if (beforeUid !== afterUid) syncUser(req)
    }
  })
}
```

### Regression test

`auth/src/index.test.ts`:
1. Handler that signs the user in then throws.
2. Assert `req.user` reflects the post-sign-in state in the error path (or is explicitly cleared — pick the safe default).

---

## Phase 5 — `EnsureEmailIsVerified` hardening

**Severity:** medium — accepts truthy non-Date values as verified; reads from `userToPlain` snapshot
**Effort:** ~30 min + test

`packages/auth/src/verification.ts:54` reads `req.user.emailVerifiedAt` from the plain snapshot produced by `userToPlain()`. The middleware checks `!== null && !== undefined` — accepting the string `"false"`, number `0`, etc., as "verified."

If a future Model lets `emailVerifiedAt` slip into a mass-assignable column (recall `fillable` defaults to `[]` — no enforcement unless opted into), attacker-supplied values become a privilege boundary.

### Fix

Two changes:

1. **Re-resolve via the live guard** instead of reading the snapshot:

```ts
const user = await Auth.user()  // live Model instance, not the plain snapshot
if (!user?.hasVerifiedEmail?.()) return new Response('403', { status: 403 })
```

2. **Type-narrow the column** to `Date | string (ISO)`:

```ts
function isVerifiedTimestamp(v: unknown): boolean {
  if (v instanceof Date) return !isNaN(v.getTime())
  if (typeof v === 'string') return !isNaN(Date.parse(v))
  return false
}
```

If `hasVerifiedEmail()` doesn't exist on the model, the package's `MustVerifyEmail` mixin already documents the contract — make it required for `EnsureEmailIsVerified` to be wired (loud error at boot if mixed).

### Regression test

`verification.test.ts`:
1. User with `emailVerifiedAt = "false"` (string) → middleware returns 403, not 200.
2. User with `emailVerifiedAt = 0` → 403.
3. User with `emailVerifiedAt = "2026-05-21T00:00:00Z"` → 200.

---

## Phase 6 — `BaseAuthController` default rate-limits

**Severity:** medium — credential stuffing + password-reset email flood unbounded by default
**Effort:** ~30 min + test

`packages/auth/src/base-auth-controller.ts:73-141` ships `signIn` / `signUp` / `requestPasswordReset` without any rate-limit middleware. The docstring shows `RateLimit.perMinute(10)` as a sample, but it's opt-in. Apps that mount `Route.registerController(AuthController)` get unprotected auth endpoints.

### Fix

Build sensible defaults into the controller's route registration:

```ts
const DEFAULT_AUTH_RATE_LIMITS = {
  signIn:               RateLimit.perMinute(10).by(req => req.ip),
  signUp:               RateLimit.perMinute(5).by(req => req.ip),
  requestPasswordReset: RateLimit.perMinute(3).by(req => req.body?.email ?? req.ip),
}
```

Expose via a `rateLimits?: typeof DEFAULT_AUTH_RATE_LIMITS` constructor option so apps can override per-route (or disable for tests):

```ts
class BaseAuthController {
  protected rateLimits = DEFAULT_AUTH_RATE_LIMITS
}
```

Subclasses that want different limits override the property. Apps that need to disable (e.g. internal admin panels behind VPN auth) override to `{}`.

Phase 3 must ship first (atomic rate-limit) or the default limits inherit the existing race-condition bypass.

### Regression test

`base-auth-controller.test.ts`:
- Fire 11 sign-in attempts in 1s → the 11th returns 429.
- Same for sign-up (limit 5) and password-reset (limit 3).
- Override `rateLimits = {}` → no 429s in same scenario.

---

## Notable (yellow — track and decide, not in this sweep)

- **Password reset doesn't invalidate other sessions** (`base-auth-controller.ts:158-168`). Laravel's `resetPassword` calls `Auth::logoutOtherDevices()`. A stolen-credential reset leaves the attacker's session valid. Add a `forgetOtherSessions(user)` call after successful reset.
- **Cookie session driver has no `regenerate()` invalidation** — documented at `session/src/index.ts:155-170`. Doctor should warn when `driver: 'cookie'` ships in production. Track as `rudder doctor` check addition, not in this sweep.
- **`Gate.callPolicy(ability)` has no allowlist** — `policy[ability]` resolves prototype methods (`constructor`, `__proto__`, `toString`). Not currently exploitable (caller already authorized the definition). Add `Object.hasOwn(policy, ability)` check defensively.
- **`BearerMiddleware` info-leak**: "JWT signature valid but jti not in DB" and "row.revoked = true" return the same error. Minor; bigger fish to fry.
- **`device/approve` always 401s in default playground wiring** (`passport/src/routes.ts:91` + `playground/routes/api.ts:830`) — endpoint is in api group but requires session-resolved user. Either move to web group or document the cross-mount requirement explicitly.
- **`hashClientSecret` is plain SHA-256 when `APP_KEY` is unset** — CLI mints CSPRNG values but seeders could feed weak inputs. Add bcrypt/argon2 fallback for non-key-stretched paths.

---

## Suggested PR order

All Phase 1-6 items are small and independent.

1. **Phase 1** — `fix(passport): atomic claim on refresh-token rotation` (changeset patch)
2. **Phase 2** — `fix(passport): atomic claim on device-code polling` (changeset patch)
3. **Phase 3** — `fix(middleware): atomic increment on RateLimit` (changeset patch on `@rudderjs/middleware` + minor on `@rudderjs/cache` if contract widens)
4. **Phase 4** — `fix(auth): wrap AuthMiddleware sync in try/finally` (changeset patch)
5. **Phase 5** — `fix(auth): re-resolve user via guard in EnsureEmailIsVerified` (changeset patch)
6. **Phase 6** — `feat(auth): default rate-limits on BaseAuthController` (changeset minor — public API addition). Depends on Phase 3 landing.

Phases 1-3 are the load-bearing items. Phases 4-6 are fail-closed hardening.

---

## Strengths noted (context)

- Constant-time compare correct everywhere it matters (token compare, password compare, session ID compare). `safeCompare` length-mismatch fast-path + equal-length `crypto.timingSafeEqual` is textbook.
- PKCE enforcement for public clients is correct (S256 mandated; verifier-vs-challenge compared via `safeCompare`).
- All refresh tokens / auth codes / user codes / device codes are SHA-256 hashed-at-rest with plaintext-once semantics. JWT exception is justified.
- `redirect_uri` re-validated on POST/DELETE of `/oauth/authorize` (not trusted from GET).
- Session-secret HMAC verification before Redis touch — attacker-supplied unsigned IDs never reach the lookup.
- Refresh-token family revocation pattern in place (once Phase 1 race fixed, RFC 6819 §5.2.2.3 reuse defense is complete).
- **Zero `as any` in security-critical src paths** across all three packages — unusually clean for this surface area.
