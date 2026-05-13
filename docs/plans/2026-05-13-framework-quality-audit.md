# Framework code-quality cleanup — core, router, queue, auth, server-hono

> **Status:** shipped 2026-05-13 — all four PRs merged: #418 (A), #419 (B), #420 (C), #421 (D).
> **Date:** 2026-05-13
> **Scope:** internal cleanup across 5 packages following the ORM #413–#417 pattern. No public API breaks. One behavior change (auth password-broker secret hardening) gated behind production check.
> **Companion:** audit findings synthesized from 5 parallel Explore passes; PR sequencing mirrored the ORM cadence.
>
> **Actual deltas (vs. plan estimates):**
> - `router/src/index.ts`: 1162 → 810 LOC (−30%; plan said ~700)
> - `core/src/application.ts`: 699 → 337 LOC (−52%; plan said ~200)
> - Removed `as unknown as`: 9 across the 5 packages (plan said 3 confirmed; D4's `stash(c)` helper added 6 more wins by consolidating Hono context casts)
> - New test files: 2 (`queue/batch.test.ts`, `queue/chain.test.ts`); +2 tests inline in `server-hono/index.test.ts`. Net +14 tests.
>
> **Deferred follow-ups still parked** — see the bottom section.

---

## TL;DR

Five packages audited after ORM finished its 4-PR cleanup. Findings cluster into the same four categories ORM hit:

| ORM PR | Framework equivalent | Packages touched |
|---|---|---|
| #413 (docs + 1 bug) | **PR A** — docs + latent bug fixes | core, router, queue, auth, server-hono |
| #414 (index.ts split −1120 LOC) | **PR B** — `router/index.ts` split | router |
| #414 (cont.) | **PR C** — `core/application.ts` split | core |
| #415 + #416 (cast tightening + test cleanup) | **PR D** — cast tightening + test gap fill | core, queue, auth, server-hono, router |

**Expected deltas:**
- `router/src/index.ts`: 1140 → ~700 LOC (−39%)
- `core/src/application.ts`: 694 → ~200 LOC (−71%)
- Removable `as unknown as`: 3 confirmed (1 in core, 1 in queue, 1 in auth)
- New test files: 4 (batch, chain, multi-cookie, getter-persistence)

Each PR ships independently. Order matters only for the file splits (B before any other touch on `router/index.ts`; C before any other touch on `core/application.ts`) — otherwise interleaving is fine.

Run after each PR's last commit:
```bash
pnpm typecheck && pnpm test
```

---

## Pre-flight (run once before starting)

```bash
git checkout main && git pull --ff-only
pnpm install
pnpm build
pnpm typecheck    # expect clean
pnpm test         # expect green across all packages
```

Baseline must be green before any PR starts.

---

## PR A — Docs + latent bug fixes (cross-package)

Smallest-diff PR. Most items are JSDoc additions; one (auth password-broker) is a behavior change behind a production guard. Bundle them because each item is tiny and they all read the same way to a reviewer ("hidden contracts now in JSDoc").

**Branch:** `docs/framework-quality-fixes`

### A1 — server-hono: JSDoc on normalizeRequest / normalizeResponse

**File:** `packages/server-hono/src/index.ts`

The getter pattern (req.body/session/user/token live on Hono ctx via getters) and the multi-cookie tracking on normalizeResponse are documented in `CLAUDE.md` but not in the source. Future maintainers will reintroduce the Set-Cookie collapse bug.

**Edits:**
- Add JSDoc block to `normalizeRequest` (~line 84) covering: getter semantics, why plain mutation doesn't cross applyMiddleware ↔ registerRoute, and that two calls per request is intentional.
- Add JSDoc block to `normalizeResponse` (~line 141) covering: separate Set-Cookie array, why `new Response(body, {headers})` collapses multi-Set-Cookie, append-in-place pattern for cooperative cookie writers.
- Add JSDoc block to `extractIp` (~line 74) covering: `trustProxy: false` → `undefined`, vite plugin's x-real-ip injection in dev.

**Verify:**
```bash
pnpm --filter @rudderjs/server-hono typecheck
pnpm --filter @rudderjs/server-hono test
```

### A2 — router: JSDoc on runWithGroup / currentGroup

**File:** `packages/router/src/index.ts:37,53`

Module-level `_currentGroup` state is the load-bearing contract for route group tagging. CLAUDE.md notes "loaders run serially because group tagging uses a module-level variable that concurrent loaders would clobber" — this needs to be on the function itself.

**Edits:**
- Add JSDoc to `runWithGroup` covering: synchronous-only invocation, no AsyncLocalStorage by design, what happens if called from async context (silent clobber).
- Add JSDoc to `currentGroup`: reads the module-level slot, returns undefined outside a `runWithGroup` block.

### A3 — core: JSDoc on appendToGroup

**File:** `packages/core/src/application.ts:320-345`

`appendToGroup` does not deduplicate. Provider boot running twice (HMR, test isolation) appends middleware twice. Trap for provider authors.

**Edits:**
- Add `@warning Middleware is not deduplicated. Calling boot() twice on the same provider double-installs.` to `appendToGroup` JSDoc.
- Document `resetGroupMiddleware()` as the dev/HMR escape hatch.

### A4 — core: FormRequest lifecycle JSDoc

**File:** `packages/core/src/validation.ts:55-65`

- `prepareForValidation`: clarify "runs before `authorize()` — use to normalize input for auth checks."
- `passedValidation`: clarify "return data to override validated value; return nothing (undefined) to use schema result."

### A5 — auth: SessionGuard.user() soft-fail JSDoc

**File:** `packages/auth/src/session-guard.ts:24-33`

Already documented inline but not on the method JSDoc. Public-facing.

**Edits:**
- Add JSDoc: "Returns `null` when called outside an ALS-bound session context (matches Laravel's `Auth::user()` semantics). Never throws."

### A6 — queue: cache-optional silent fallback JSDoc

**Files:** `packages/queue/src/job-middleware.ts:54-57,134-155`, `packages/queue/src/unique.ts:43`

`RateLimited` and `ThrottlesExceptions` silently no-op when `@rudderjs/cache` is missing; only `WithoutOverlapping` errors loudly. Asymmetric and undocumented.

**Edits:**
- Add `@warning Requires @rudderjs/cache. Without it this middleware is a no-op (rate-limit/throttle disabled).` to `RateLimited` and `ThrottlesExceptions` class JSDoc.
- Add `@warning In-memory fallback grows unbounded when `ttl=0` and no cache is registered. Production: register `@rudderjs/cache`.` to `UniqueJob` JSDoc.

### A7 — queue: tighten failed() error semantics

**File:** `packages/queue/src/index.ts:218`

```ts
// Current
await job.failed?.(error)
throw error

// New — distinguish job.failed() throws from the original failure
try {
  await job.failed?.(error)
} catch (failedHandlerError) {
  // Job's own failed() hook threw — log and continue with original error
  console.error('[queue] job.failed() handler threw', failedHandlerError)
}
throw error
```

One test addition: `failed()` that throws still allows original error to propagate, and the thrown handler error is logged.

### A8 — auth: harden PasswordBroker.secret default

**File:** `packages/auth/src/password-reset.ts:53`

Currently defaults to hardcoded `'password-reset'` if config missing. Tokens are HMAC'd with this — predictable in production.

**Edits:**
```ts
// Current
this.secret = config.secret ?? 'password-reset'

// New
if (!config.secret) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[@rudderjs/auth] PasswordBroker requires `secret` in production. ' +
      'Set auth.passwords.secret in config (typically derived from APP_KEY).'
    )
  }
  // Dev/test: emit a one-time warning so it's noticed, but allow it.
  console.warn('[@rudderjs/auth] PasswordBroker using hardcoded dev secret — set auth.passwords.secret for prod.')
  this.secret = 'password-reset'
} else {
  this.secret = config.secret
}
```

**Changeset:** `@rudderjs/auth` patch — "Throw in production when PasswordBroker.secret is unconfigured (previously used a hardcoded fallback)."

### A9 — auth: MemoryTokenRepository production warning

**File:** `packages/auth/src/password-reset.ts:137`

**Edits:**
- Add `@warning Process-local storage. Use a database-backed TokenRepository in production (single-process restart wipes pending tokens).` to JSDoc.

### A-Verify

```bash
pnpm typecheck
pnpm test
pnpm --filter @rudderjs/auth test
pnpm --filter @rudderjs/queue test
```

**PR title:** `docs(framework): document hidden contracts; harden auth password-broker; tighten queue failure path`
**Changeset:** `@rudderjs/auth` patch only (A8). Others are docs/code-quality with no behavior change.

---

## PR B — Split `router/src/index.ts`

**Branch:** `refactor/router-index-split`

Same shape as ORM #414. The file is 1140 LOC. Clean extraction candidates:

| Phase | New file | Symbols | Approx LOC out |
|---|---|---|---|
| B1 | `src/url-signing.ts` | `Url` class, `_urlKey`, `signed()` helpers, the `node:crypto` lazy import block | ~180 |
| B2 | `src/binding-middleware.ts` | route-model-binding middleware + `req.bound` plumbing (lines around 577) | ~120 |
| B3 | `src/resource.ts` | `Resource` class + helpers | ~140 |

Expected: `index.ts` 1140 → ~700 LOC.

### B0 — Pre-flight

```bash
cd packages/router
pnpm typecheck   # expect clean
pnpm test        # expect green
```

### B1 — Extract `src/url-signing.ts`

**Step 1: Read current implementation**

```bash
grep -n "_urlKey\|Url\.\|signed\|node:crypto" packages/router/src/index.ts
```

**Step 2: Create the new file** with the extracted symbols. Keep the `node:crypto` lazy import — it's load-bearing for browser bundles (memory: `feedback_no_top_level_node_imports`).

**Step 3: Re-export from `index.ts`** to preserve public API:
```ts
export { Url, signedRoute, signedRouteFor } from './url-signing.js'
```

**Step 4: Verify**

```bash
pnpm --filter @rudderjs/router typecheck
pnpm --filter @rudderjs/router test
pnpm --filter @rudderjs/router build
```

All green. Also test from a dependent package:
```bash
pnpm --filter @rudderjs/core test
```

**Step 5: Commit**

```bash
git add packages/router/src/
git commit -m "refactor(router): extract URL signing into url-signing.ts"
```

### B2 — Extract `src/binding-middleware.ts`

Same recipe. Watch the two `as unknown as` casts on `req.bound` (lines 577–578) — they're load-bearing because `AppRequest` doesn't declare `bound`. Leave them as-is in the move; address in PR D.

### B3 — Extract `src/resource.ts`

Same recipe. `Resource` composes `Router.get/post/...` — no private state to worry about.

### B-Risk notes

- **`runWithGroup` / `currentGroup` stay in `index.ts`.** They mutate the module-level `_currentGroup` slot which is by-design module-scoped to `index.ts`. Moving them would require exporting the slot or accepting a slot parameter — not worth it.
- **`Url.setKey()` is a module-level singleton setter.** When moving it to `url-signing.ts`, the slot moves with it. No call site changes needed since the public API stays the same.

### B-Verify (end of phase)

```bash
pnpm --filter @rudderjs/router typecheck
pnpm --filter @rudderjs/router test
pnpm --filter @rudderjs/router lint
pnpm typecheck   # full repo
```

Public API check:
```bash
git diff main -- packages/router/src/index.ts | grep "^-export" | head
```
Every `-export` line should reappear as a `+export ... from './<sibling>'.js` line. Net: zero public surface change.

**PR title:** `refactor(router): split index.ts into url-signing, binding-middleware, resource siblings`
**Changeset:** none. Internal refactor.

---

## PR C — Split `core/src/application.ts`

**Branch:** `refactor/core-application-split`

`application.ts` is 694 LOC: 200 LOC for `Application` + ~490 LOC for `MiddlewareConfigurator` / `ExceptionConfigurator` / `AppBuilder` / `RudderJS`. Clean seam — the builders are orchestrators that *use* `Application`.

| Phase | New file | Symbols |
|---|---|---|
| C1 | `src/app-builder.ts` | `MiddlewareConfigurator`, `ExceptionConfigurator`, `AppBuilder`, `RudderJS` |

Expected: `application.ts` 694 → ~200 LOC.

### C1 — Extract `src/app-builder.ts`

**Step 1: Map dependencies**

```bash
grep -n "class MiddlewareConfigurator\|class ExceptionConfigurator\|class AppBuilder\|class RudderJS" packages/core/src/application.ts
```

**Step 2: Move classes** to `app-builder.ts`. Import `Application` and any types it needs from `./application.js`.

**Step 3: Re-export from `application.ts` (or from `index.ts` directly, prefer the latter):**
```ts
// index.ts
export { Application } from './application.js'
export { AppBuilder, MiddlewareConfigurator, ExceptionConfigurator, RudderJS } from './app-builder.js'
```

**Step 4: Verify**

```bash
pnpm --filter @rudderjs/core typecheck
pnpm --filter @rudderjs/core test
pnpm --filter @rudderjs/core build
```

**Step 5: Commit**

```bash
git add packages/core/src/
git commit -m "refactor(core): extract app-builder from application.ts"
```

### C-Risk notes

- **`groupMiddlewareStore` lives on `globalThis`.** Keep it in `application.ts` since `Application.boot()` writes to it. `appendToGroup` reads it — same file is fine.
- **Circular import risk.** `app-builder.ts` imports `Application` from `application.ts`. `Application` does NOT import from `app-builder.ts`. Verify with `madge --circular packages/core/src/` if uncertain.

### C-Verify (end of phase)

```bash
pnpm --filter @rudderjs/core typecheck
pnpm --filter @rudderjs/core test
pnpm typecheck   # full repo — every consumer of Application/AppBuilder
```

**PR title:** `refactor(core): extract app-builder from application.ts`
**Changeset:** none.

---

## PR D — Cast tightening + test gap fill

**Branch:** `chore/framework-cast-and-test-cleanup`

Mirrors ORM #415 + #416 combined. Small commits, each ~10–30 LOC.

### D1 — core: make `Application.instance` nullable

**File:** `packages/core/src/application.ts:266`

Removes the only `as unknown as` in core.

**Edit:**
```ts
// Before
private static instance: Application
// ...
;(Application as unknown as Record<string, unknown>)['instance'] = undefined

// After
private static instance: Application | undefined
// ...
Application.instance = undefined
```

Verify: existing tests that reset state pass.

### D2 — queue: drop bridge cast in job-middleware

**File:** `packages/queue/src/job-middleware.ts:201`

Reuse the adjacent `CacheLike` interface (lines 193–197) instead of `as unknown as { CacheRegistry?: ... }`.

### D3 — auth: expose AuthManager.config getter

**File:** `packages/auth/src/auth-manager.ts` + `packages/auth/src/require-guest.ts:18`

Add `get config(): AuthConfig` to `AuthManager`. Drop the cast in `require-guest.ts:18`.

### D4 — server-hono: consolidate context-stash casts

**File:** `packages/server-hono/src/index.ts`

Define once near the top of the file:
```ts
type HonoContextExt = Hono['env'] & Record<string, unknown>
// or: type HonoContextStash = Record<`__rjs_${string}`, unknown>
```

Replace the 11 inline `as unknown as Record<string, unknown>` reads/writes with the alias. **No type relaxation** — just visual consolidation. If a stronger typed alias works (typed by `__rjs_*` key set), use that.

### D5 — queue: tests for batch.ts and chain.ts

**Files:** create `packages/queue/src/batch.test.ts`, `packages/queue/src/chain.test.ts`.

Minimum coverage:
- **Batch:** dispatch N jobs, record success/failure via observer, verify `_recordSuccess`/`_recordFailure` mutate as expected, verify final batch state on all-done.
- **Chain:** dispatch sequential jobs, WeakMap state carries between handlers, chain abort on first failure.

Also update `packages/queue/package.json` `test` script — it lists files explicitly (memory: `feedback_orm_test_script_explicit_files`):
```json
"test": "tsc -p tsconfig.test.json && node --test dist-test/index.test.js dist-test/job-middleware.test.js dist-test/unique.test.js dist-test/batch.test.js dist-test/chain.test.js"
```

### D6 — server-hono: tests for getter persistence + multi-cookie merge

**File:** `packages/server-hono/test/test.ts` (extend existing).

- Test: middleware sets `req.user`, route reads `req.user` → same value (verifies getter pattern).
- Test: middleware A appends Set-Cookie `csrf=...`, middleware B appends Set-Cookie `session=...`, response contains both as separate `Set-Cookie` headers (not collapsed).
- Test: `ViewResponse` duck-typing path renders correctly.

### D-Verify

```bash
pnpm typecheck
pnpm test
pnpm --filter @rudderjs/queue test
pnpm --filter @rudderjs/server-hono test
pnpm --filter @rudderjs/auth test
pnpm --filter @rudderjs/core test
```

Cast count check:
```bash
grep -rn "as unknown as" packages/{core,queue,auth,server-hono,router}/src/ | wc -l
```
Expect ≥3 fewer than baseline (D1, D2, D3). D4 may be net-flat if the alias counts the same line-wise — confirm visually.

**PR title:** `refactor(framework): tighten casts (3 removed), consolidate hono context typing, add queue + hono tests`
**Changeset:** none. Internal cleanup + tests.

---

## What's NOT in this plan

These came up in the audit but are deliberately out of scope:

| Item | Why deferred |
|---|---|
| Auth: 13 source files behind 1 test file (945 LOC) | Coverage is broad; reorg only when next feature touches auth |
| server-hono: export normalizers (`normalizeRequest`/`normalizeResponse`) for reuse | API expansion, needs its own design pass |
| queue: `Batch._recordSuccess/_recordFailure` are `@internal` but publicly accessible | Cosmetic; revisit when batch API stabilizes |
| router: `_urlKey` cross-test corruption risk | After B1 the slot is module-scoped to `url-signing.ts`; if tests still collide, add `Url._resetKey()` for test isolation in a follow-up |
| core: `ExceptionConfigurator.render/.ignore` use `any` for error constructors | Justifiable (isa checks on arbitrary classes); not worth the churn |
| Telescope (4557 LOC), passport (3665 LOC), mcp (2314 LOC) | Larger packages — separate audit pass if/when these become friction |

---

## Wrap-up

After all four PRs land:

```bash
pnpm typecheck
pnpm test                     # full repo green
pnpm build
git log --oneline main..HEAD | head -20
```

**Expected line counts:**
- `packages/router/src/index.ts`: 1140 → ~700 (−39%)
- `packages/core/src/application.ts`: 694 → ~200 (−71%)
- New siblings: `router/src/url-signing.ts`, `router/src/binding-middleware.ts`, `router/src/resource.ts`, `core/src/app-builder.ts`
- New tests: `queue/src/batch.test.ts`, `queue/src/chain.test.ts`, plus extensions to `server-hono/test/test.ts`

**Public API check** (run on each PR before merge):
```bash
git diff main -- 'packages/*/src/index.ts' | grep '^-export' | head
```
Every `-export` should reappear as `+export ... from './<sibling>'.js`. Net zero public surface change across PRs A–D.

**Risk notes:**
- A8 (PasswordBroker hardening) is the only behavior change. Confirm `playground/config/auth.ts` sets `auth.passwords.secret` before merging — otherwise the playground breaks in production mode.
- B and C are pure file splits — review for accidental visibility changes (e.g., `private` becoming `public` because a sibling now needs the method).
- D4 (HonoContextExt alias) should be net-flat or net-negative on cast count. If it isn't, the alias isn't doing its job — revisit.

---

## Sequencing

Recommended order: **A → B → C → D**.

- A is independent of all others. Ship first for fast wins.
- B and C are independent of each other. Can run in parallel branches.
- D touches files modified by B and C — run last to avoid merge conflicts.

If under merge-freeze pressure, A is the only PR that ships meaningful behavior (auth hardening) and should not wait.
