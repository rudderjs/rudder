# Auth-surface review sweep findings — 2026-05-05

**Status:** Done 2026-05-06 — all HIGH/MEDIUM findings shipped across 10 PRs (#238, #240, #241, #242, #243, #244, #245, #247, #249, #250). LOW findings deferred per file.

Three of four agents complete (auth, session, socialite). Sanctum still running.
Verification status noted per finding.

---

## @rudderjs/auth (10 findings)

### HIGH

**A1. verification.ts:52 — `emailVerifiedAt` field mismatch with published schemas** ✅ VERIFIED REAL
- All 4 schemas (auth.prisma + 3 drizzle dialects) define `emailVerified: boolean`
- Middleware reads `user['emailVerifiedAt']`, JSDoc example sets `this.emailVerifiedAt = new Date().toISOString()`
- Verified users (`emailVerified: true`) get 403 from `EnsureEmailIsVerified()` because `emailVerifiedAt` is undefined
- Middleware also bypasses the `MustVerifyEmail.hasVerifiedEmail()` interface method it should be calling
- No tests for verification flow — that's why this slipped through

**A4. verification.ts:75-86, 133-136 — `require()` calls in pure ESM package** ✅ VERIFIED REAL
- Compiled `dist/verification.js` is ESM (`export function ...`) AND uses `require('@rudderjs/router')` and `require('node:crypto')` directly
- In Node ESM, `require` is undefined — `_sha256()` will throw `ReferenceError: require is not defined`
- `verificationUrl()` has try/catch but throws a misleading "router missing" error
- `handleEmailVerification()` calls `_sha256()` with no try/catch — crashes
- Email verification is non-functional in any ESM consumer

### MEDIUM

**A2. gate.ts:6-12 — `_gateObs` cache traps early null** ✅ VERIFIED REAL
- `_getGateObservers()` reads `globalThis['__rudderjs_gate_observers__']` once and caches
- If `Gate.allows()` runs before gate-observers.ts is imported, `_gateObs` becomes `null` permanently
- Telescope's GateCollector never receives events even after it subscribes
- Fix: drop cache, read globalThis on each call (negligible cost vs auth decision)

**A3. gate.ts:269 — GateForUser._check returns `resolvedVia: 'default'` for missing-method (static path returns `'policy'`)**
- Inconsistent observability metadata between Gate.allows() and Gate.forUser(u).allows()
- Low impact (telescope categorization), but contradicts static path

**A6. base-auth-controller.ts:60 — `@Controller('/api/auth')` but auth context only on web group**
- Class JSDoc says routes must come from `web` group (auto-installs AuthMiddleware)
- But `/api/auth` prefix violates RudderJS routing convention (api goes to api.ts)
- If wired to api group: `currentAuth()` throws "No auth context" on first request
- No compile/runtime guard

**A4. (other) verification.ts** — same file as A1, group into one fix

### LOW
- **A5** index.ts:78-95 — re-sync after `next()` is dead code (uncertain)
- **A7** password-reset.ts:147 — Map mutation during iteration (works in practice)
- **A8** session-guard.ts:73-77 — logout `forget()` then `regenerate()` retains `_data`
- **A9** password-reset.ts:117-122 — timing side-channel via `users.retrieveByCredentials`
- **A10** base-auth-controller.ts:131-133 — THROTTLED status not exposed (intentional?)

---

## @rudderjs/session (10 findings)

### HIGH (security)

**S1. index.ts:289-298 — Redis driver uses raw cookie value as session ID, no signing** ⚠️ NEEDS VERIFY
- `RedisDriver.load(cookieValue)` calls `this.key(cookieValue)` directly on raw cookie
- No HMAC verification (unlike CookieDriver)
- Cookie value IS the session ID (`persist` returns `payload.id`)
- Anyone who guesses/leaks/enumerates a UUID can hijack — true bearer-token semantics
- Critical: README emphasizes signed cookies, but redis sessions are unsigned

**S2. index.ts:294 — Redis `load` creates empty session under attacker-supplied ID on cache miss** ⚠️ NEEDS VERIFY (saw it)
- `if (!raw) return this.emptyWithId(cookieValue)`
- Classic session fixation: attacker pre-generates ID, plants on victim, victim logs in, attacker uses same ID
- Even calling `Session.regenerate()` doesn't help if attacker waits

**S3. index.ts:371-372 — `next` throwing skips `session.save()` — Set-Cookie lost on error responses** ⚠️ NEEDS VERIFY
- `await _als.run(session, next); await session.save(res)`
- If next throws, save never runs
- Flash messages on error redirects are dropped
- New sessions never persist on error responses
- Fix: try/finally around save

### MEDIUM

**S4. index.ts:273-284 — RedisDriver.getClient() racy lazy init creates orphaned clients**
- Two concurrent first-request callers both pass `if (!this.client)` and both `new Redis(...)`
- Second overwrites first → orphaned ioredis connection (FD + retry-timer leak)
- Fix: cache `Promise<Client>` instead of client itself

**S5. index.ts:386-389 — `SessionMiddleware()` factory builds new driver per route**
- Web group uses one shared instance; api per-route opt-ins each create independent RedisDriver
- Connection count grows with route count
- Fix: resolve from container (`session.middleware` is already bound)

**S6. index.ts:74 — `Object.keys(payload.flash_next)` throws if missing**
- Constructor unconditionally accesses `payload.flash_next`
- Old/corrupt redis entries without that field crash every load
- Fix: default `payload.flash_next ?? {}`

**S7. index.ts:119-123 — `regenerate()` doesn't invalidate cookie driver session**
- Cookie driver `destroy()` is no-op — old signed cookie still valid until Max-Age expires
- Apps using cookie driver expecting fixation defense are exposed
- Fix: document limitation OR add server-side blocklist

### LOW
- **S8** Max-Age=NaN if lifetime undefined (config defaults not enforced in code)
- **S9** Hono c.header semantics version-coupled (uncertain)
- **S10** Session.current() private but in constraints docs (not a bug)

---

## @rudderjs/socialite (10 findings)

### HIGH (security)

**O1. driver.ts:65-78 — Token endpoint POSTs JSON instead of form-urlencoded**
- `getAccessToken` uses `Content-Type: application/json` with JSON body
- RFC 6749 mandates `application/x-www-form-urlencoded`
- GitHub/Google/Facebook all expect form-encoded
- Apple has its own override (correct), suggesting author knew but missed base class
- Token exchange will fail/be flaky against spec-compliant providers
- **Every login flow against these providers may be broken**

**O2. apple.ts:73-78 — Apple `client_secret` is raw config string, not ES256 JWT**
- Apple requires `client_secret` to be a freshly-signed JWT (ES256 with iss/sub/aud/iat/exp/kid)
- Driver passes `this.config.clientSecret` raw
- Token exchange always fails with `invalid_client`
- Sign-in-with-Apple is fundamentally broken
- Contradicts CLAUDE.md "Apple uses JWT for client secret"

**O3. apple.ts:50-65 — Apple ID token decoded without signature/claim verification**
- `Buffer.from(payload, 'base64url')` decodes but doesn't verify signature
- No iss/aud/exp/nonce checks
- `sub` from unverified JWT becomes `SocialUser.id` (app's primary user ID)
- Account takeover risk if any path can supply crafted id_token
- Violates Apple's own integration guidance

**O4. apple.ts:41-65 — POST callback body trusted without state validation**
- Apple's form_post body (`body.user`) merged into raw user without state echo verification
- State not checked anywhere in framework
- Combined with O3, attacker can POST crafted form with their code + victim's name

**O5. driver.ts (entire) — No CSRF state generation/validation helpers**
- `getRedirectUrl(state?)` accepts optional state but framework neither generates nor validates
- `user(codeOrRequest)` ignores `query.state` entirely
- README/tests pass `'test-state'` literal
- Login CSRF / OAuth state-fixation is the most common OAuth flaw
- Laravel Socialite (the inspiration) auto-generates and validates — this port dropped that

### MEDIUM

**O6. driver.ts:80-94 — Provider response bodies leaked in error messages**
- `Token exchange failed: 401 {full body}` interpolates entire response
- Some providers echo client_id back; PII risk
- Fix: sanitize message, put body on `cause`/non-enumerable detail

**O7. driver.ts:65,113 etc. — All fetch calls have no timeout / AbortSignal**
- Slow/hung provider endpoint keeps handler + state alive indefinitely
- DoS amplifier and resource exhaustion under provider outage

**O8. driver.ts:88-90 — Type coercion on token response trusts arbitrary JSON**
- `(data['access_token'] ?? data['accessToken']) as string | undefined`
- Provider could return non-string; ends up in `Bearer ${token}` header
- Fix: typeof check, reject non-string

**O9. index.ts:38-51 — `extend()` after `driver()` cache stale**
- `_instances` not cleared on extend (only on configure)
- Hot-reload scenarios get old driver
- Fix: add `_instances.delete(name)` to extend()

### LOW
- **O10** google driver no nonce for OIDC `openid` scope (defense-in-depth gap)

---

## @rudderjs/sanctum (10 findings)

### HIGH

**T1. index.ts:264-308 — `req.token` documented but never wired up**
- Middleware writes `(req.raw)['__rjs_token'] = result.token`, but server-hono only defines a getter for `req.user`. No getter for `req.token`, no `token` field on `AppRequest`.
- Guidelines/README tell users to read `req.token` after `SanctumMiddleware` — always undefined
- Fix: add `token?: PersonalAccessToken` field via module augmentation + getter mirroring `user`

**T2. index.ts:341-358 — `boot()` resolves UserProvider via `guard().provider`, hardwiring to session driver, swallows real errors**
- Reads provider off `manager.guard()` which builds `SessionGuard` requiring `@rudderjs/session`
- If `defaults.guard` is anything other than session-driver, `manager.guard()` throws
- Pure-API apps (no session) can't use Sanctum without registering session
- Broad `catch {}` rewrites all errors to "No auth manager found", misdiagnosing
- Fix: resolve provider directly via `manager.createProvider(name)`; don't catch unrelated errors

### MEDIUM

**T3. index.ts:167 — Token expiry uses `<` instead of `<=`** (off-by-one at ms boundary, flaky tests)

**T4. index.ts:174 — `updateLastUsed` runs twice when `[SanctumMiddleware(), RequireToken('write')]` stacked**
- Both middlewares independently call `validateToken`, each issues `updateLastUsed`
- 2x DB writes per authenticated API call
- Fix: RequireToken should reuse already-validated token from request

**T5. index.ts:260-263, 301-305 — `Object.entries(user)` exposes all enumerable own props except `password`/functions**
- Filters only password; `remember_token`, `two_factor_secret`, etc. leak to `req.user`
- Same issue likely in `@rudderjs/auth`'s `userToPlain`
- Fix: allowlist or configurable hidden-fields list

**T6. index.ts:148 — Bearer prefix match case-sensitive (RFC 6750 violation)**
- `bearerToken.startsWith('Bearer ')` rejects `bearer`/`BEARER`
- Some HTTP libs lowercase header values → false negatives
- Fix: `/^bearer\s+/i`

**T7. index.ts:344-353 — Catch-all swallows actual error, reports misleading message** (combines with T2)

### LOW
- **T8** index.ts:186 — `userTokens()` returns full records including hashed `token` column
- **T9** index.ts:152 — `tokenPrefix` is non-enforcing on validate (uncertain — Laravel does same)
- **T10** index.ts:68-73 — MemoryTokenRepository uses `===` linear scan (timing leak; in-memory only)

---

## Severity summary

| Package | HIGH | MEDIUM | LOW |
|---|---|---|---|
| auth | 2 | 4 | 4 |
| session | 3 | 4 | 3 |
| socialite | 5 | 4 | 1 |
| sanctum | 2 | 5 | 3 |
| **total** | **12** | **17** | **11** |

**Top priority (security):** S1, S2, S3 (session) + O1-O5 (socialite) — these are exploitable.

**Top priority (functional break):** A1, A4 (auth verification.ts) — email verification flow is non-functional in ESM.

## Recommended PR strategy

1. **Auth verification.ts fix** (A1 + A4) — single PR, both bugs in same file
2. **Auth gate observability** (A2 + A3) — single PR, gate.ts cleanup
3. **Auth BaseAuthController** (A6) — separate PR, may need API design discussion (rename prefix? error guard?)
4. **Session security** (S1, S2, S3) — single PR, security-focused
5. **Session driver hygiene** (S4, S5, S6, S7) — separate PR, infrastructure
6. **Socialite OAuth correctness** (O1) — separate PR, base driver
7. **Socialite Apple** (O2, O3, O4) — single PR, Apple is broken end-to-end
8. **Socialite state defense** (O5) — separate PR, framework-level addition
9. **Socialite hardening** (O6, O7, O8, O9) — single PR

Don't bundle the security fixes with the cleanup fixes — security fixes should be reviewable in isolation.
