# Phase 4 Findings — Public API surface review

**Plan:** `docs/plans/2026-05-28-quality-dx-sweep.md` (Phase 4 task list)
**Date:** 2026-05-28
**Scope:** every package in `packages/*` (49 packages)
**Goal:** identify symbols that look internal but leak into the published `.d.ts` contract, so `@internal` JSDoc markers and `stripInternal: true` can shrink the public TypeScript surface without removing anything from runtime.

---

## Headline

The framework has **already invested in `@internal` JSDoc markers** — ~110 blocks across source — but **`stripInternal` is currently OFF** in `tsconfig.base.json`, so every one of those `@internal` symbols still ships in the `.d.ts` public types. This is the cheapest "API surface cleanup" available: a one-line TypeScript config change tightens the `.d.ts` contract with **zero runtime impact** on consumers.

The only real coordination point is **`_runWithSession` from `@rudderjs/session`** — an `@internal`-tagged escape hatch that `@rudderjs/socialite` actually imports in its tests across the package boundary. Stripping it breaks `socialite`'s typecheck. The fix is one of: un-mark it (keep it in the public types under the underscore-name convention), expose it via an `/internal` subpath, or migrate `socialite`'s tests to a different pattern.

---

## Tooling status

| Setting | Status | Source |
|---|---|---|
| `stripInternal` in `tsconfig.base.json` | **off** (TypeScript default) | confirmed via `grep` |
| `stripInternal` in any per-package `tsconfig.json` | **off** everywhere | confirmed via `grep packages/*/tsconfig*.json` |
| Rushstack API-Extractor | **not in use** | no `api-extractor.json` anywhere |
| tsdoc / JSDoc lint enforcement | none | framework uses plain `@internal` comments |

Adding `"stripInternal": true` to `tsconfig.base.json` is the single config change that makes the existing `@internal` annotations load-bearing.

---

## Inventory at a glance

| Count | What |
|---|---|
| **110** | `@internal` JSDoc blocks across `packages/*/src/*.ts` (excluding tests + `.d.ts`) |
| **~22** | `export … _Foo` lines across all `packages/*/src/index.ts` |
| **5** | of those 22 are actually intentional underscore-prefixed "internal escape hatch" exports — the rest are uppercase constants matched by my over-broad regex (`DEFAULT_*`, `ROUTE_PATTERN_*`, `FILE_SEARCH_*`, etc.) |
| **1** | confirmed anti-candidate (cross-package leak: see below) |

**The 5 intentional underscore escape-hatch exports:**

| Symbol | Location | Already `@internal`? | Why exported |
|---|---|---|---|
| `_executeTask` | `packages/schedule/src/index.ts:211` | yes | schedule's own test invokes a queued task synchronously |
| `_handleConnection` | `packages/sync/src/index.ts:867` | yes | sync's own test simulates a WS upgrade without a real socket |
| `_resetFirstConnectFired` | `packages/sync/src/index.ts:870` | yes | sync's own test reset between cases |
| `_resetVikeServerCacheForTests` | `packages/view/src/index.ts:52` | yes | view's own test clears the cached vike/server module |
| **`_runWithSession`** | `packages/session/src/index.ts:277` | yes | session ALS-context wrapper — **imported across the package boundary by `@rudderjs/socialite/src/index.test.ts`** |

All five are JSDoc-marked `@internal`. Four are only consumed by the OWNING package's own tests; the fifth (`_runWithSession`) is the anti-candidate.

---

## Heavy concentrations of `@internal` (per-package breakdown)

These are the packages that benefit most from `stripInternal` — but most of their `@internal` annotations live on **private class members** that wouldn't even be visible in the `.d.ts` without TypeScript visibility quirks. Stripping them is purely public-types hygiene; no caller breaks.

| Package | `@internal` JSDoc count | Shape |
|---|---|---|
| `@rudderjs/orm` | 19 | Query-builder helpers, aggregate accessors, observer-symbol helpers. Most are non-exported. |
| `@rudderjs/orm-drizzle` | 11 | Driver-internal SQL fragment builders. None imported by `@rudderjs/orm-prisma` or anywhere else. |
| `@rudderjs/orm-prisma` | 11 | Same shape — driver-internal helpers. |
| `@rudderjs/router` | 5 + `router` const | Marked helpers for route compilation. The exported `router` const reads a global slot — intentional public. |
| `@rudderjs/http` | 4 | Test-wired hooks (`_attachFake`, `_match`). Internal to the fake-manager design. |
| `@rudderjs/server-hono` | 4 | Internal request/response normalization helpers. |
| (others) | 1–2 each | Mostly test-reset hooks (`MailFake.restoreFakes()` etc.) on facades. |

**28 packages have zero `@internal` candidates** — their public surface is already what's intended.

---

## Spot-checks of "is this used outside the owning package?"

Sample of marker-stripping safety, via `grep -rn`:

| Symbol | Cross-package use? |
|---|---|
| `_attachFake`, `_match` (http) | no — internal to http |
| `_buildUrl`, `_buildInit`, `_send` (http) | no |
| `normalizeWithCount`, `normalizeWithExists`, `loadCountOrExists` (orm) | no — adapters don't reach into orm internals |
| `attachWhereHas`, `attachWhereBelongsTo` (orm) | no |
| `_handleConnection`, `_resetFirstConnectFired` (sync) | only sync's own tests |
| `_resetVikeServerCacheForTests` (view) | only view's own tests |
| `_executeTask` (schedule) | only schedule's own tests |
| **`_runWithSession` (session)** | **yes — `@rudderjs/socialite/src/index.test.ts` imports it across the package boundary** |

So 8/9 internals are safe to strip. One is not.

---

## The one anti-candidate: `_runWithSession`

`@rudderjs/socialite` is a published package and ships its own test suite. Those tests construct a `SessionInstance` and run provider code under that session's ALS context — done by importing the private wrapper:

```ts
// packages/socialite/src/index.test.ts:15
import { SessionInstance, _runWithSession } from '@rudderjs/session'
```

This works today because `@rudderjs/session`'s `.d.ts` still emits `_runWithSession` (no `stripInternal`). Flipping `stripInternal: true` strips the type — `socialite`'s test suite breaks on `pnpm typecheck`.

**Three resolution options:**

| Option | Effect | Verdict |
|---|---|---|
| **A. Un-mark `_runWithSession`** (drop the `@internal` JSDoc) | Keeps it in the public types. The underscore-prefix is the actual "don't use this normally" signal; `@internal` was misapplied. | **Recommended.** Smallest churn; matches how the symbol is already used. |
| B. Expose via `@rudderjs/session/internal` subpath | Cleaner separation, but requires a new entry in `package.json` `exports` + migrating socialite's import | More work; no clear win |
| C. Migrate socialite's tests to a different pattern | Avoids the leak entirely, but the existing tests are sensible | Heaviest lift; defer |

Option A is the only one that doesn't require touching socialite's tests, and it preserves the convention that's already in use across the framework (underscore = "internal escape hatch, but it IS public if you really need it").

---

## Recommended fix path

**Scope: one PR, declaration-emit-only changes, `patch` changesets on every package whose `.d.ts` shrinks.**

1. **Drop `@internal` from `_runWithSession`** in `packages/session/src/index.ts:275`. Keep the underscore-prefix. (Same treatment for any other identified cross-package leaks if they surface during the typecheck pass.)
2. **Add `"stripInternal": true`** to `tsconfig.base.json`.
3. **`pnpm build` from root** and spot-check 4–5 `dist/index.d.ts` files (the heavy hitters: orm, orm-drizzle, http, server-hono, router) to confirm `@internal` symbols no longer appear in the declaration emit.
4. **Per-package `patch` changesets** for every package whose declaration emit changed. Note in the changeset that the public types contract is shrinking; consumers using a leaked `@internal` symbol will see a TypeScript error.
5. **PR title**: `refactor: flip stripInternal — internal-marked symbols no longer leak into .d.ts`. Use `refactor:` (not `chore:`) so the changeset bot picks it up correctly.

**Expected breaking surface for consumers:** essentially zero. The only way a consumer breaks is if they explicitly import an `@internal`-tagged symbol from a `@rudderjs/*` package — i.e. an underscore-prefixed or obviously-helper-named import. That's a self-inflicted wound on their side.

---

## Out of scope / deferred

- **Aggressive removal** of any `@internal` symbol from runtime in this round. Default for 1.x is keep-and-hide; removal is a 2.0 decision.
- **Subpath-based internal exports** (`@rudderjs/session/internal`). Useful if more cross-package test helpers appear; not needed for the current count of 1.
- **API-Extractor / tsdoc enforcement tooling.** TypeScript's native `stripInternal` is sufficient at this scale.
- **Re-running this audit on the playground / scaffolder templates.** Apps, not framework — out of scope.

---

## Per-package summary table (all 49)

| Package | `@internal` count | Escape-hatch exports | Notes |
|---|---|---|---|
| ai | 0 (in main) | — | `DEFAULT_*` constants, not internal |
| auth | 2 | — | facade + middleware |
| boost | 0 | — | scaffolder, mostly external bins |
| broadcast | 0 | — | facade only |
| broadcast-redis | 1 | — | driver |
| cache | 1 | — | `restoreFakes()` cleanup hook is internal |
| cashier-paddle | 1 | — | `cashier(cfg?)` factory |
| cli | 0 | — | bin |
| concurrency | 0 | — | clean |
| console | 2 | `rudder`, `commandObservers` (global-slot reads) | escape-hatches are designated |
| containers (n/a) | — | — | — |
| context | 0 | — | clean |
| contracts | 0 | — | pure type facade — clean |
| core | 1 | `BUILTIN_REGISTRY` (intentional public) | clean |
| create-rudder / -app | n/a | — | scaffolder bin |
| crypt | 0 | — | clean |
| hash | 0 | — | clean |
| horizon | 1 | — | dashboard internals |
| http | 4 | — | `_attachFake` / `_match` family, all internal-to-fake |
| image | 0 | — | clean |
| localization | 0 | — | clean |
| log | 1 | — | facade |
| mail | 1 | — | `restoreFakes()` internal |
| mcp | 0 | — | clean |
| middleware | 0 | — | clean |
| notification | 0 | — | clean |
| orm | 19 | — | adapters DON'T import these — safe |
| orm-drizzle | 11 | — | driver internals; nothing cross-package |
| orm-prisma | 11 | — | driver internals; nothing cross-package |
| passport | 0 | — | clean |
| pennant | 0 | — | clean |
| process | 0 | — | clean |
| pulse | 0 | — | clean |
| queue | 0 | — | clean |
| queue-bullmq | 0 | — | driver |
| queue-inngest | 0 | — | driver |
| router | 5 | `router` const (global-slot read) | clean except global |
| sanctum | 0 | — | clean |
| schedule | 2 | `_executeTask` (own-tests only) | schedule global read |
| server-hono | 4 | — | internal normalizers |
| session | 2 | **`_runWithSession`** (cross-pkg leak — see anti-candidate) | needs option A |
| socialite | 0 | — | clean; consumes session's `_runWithSession` |
| storage | 0 | — | facade |
| support | 0 | — | clean |
| sync | 4 | `_handleConnection`, `_resetFirstConnectFired` (own-tests only) | clean |
| telescope | 0 | — | dashboard |
| terminal | 0 | — | clean |
| testing | 0 | — | clean (just shipped) |
| view | 2 | `_resetVikeServerCacheForTests` (own-tests only) | clean except own escape hatch |
| vite | 0 | — | plugin |

---

## Overall assessment

The framework's public API surface is **structurally clean** — the maintainers have invested in `@internal` JSDoc annotations consistently, and ~28 of the 49 packages have zero candidates at all. **What's missing is the `stripInternal: true` switch in `tsconfig.base.json`** so the annotations actually load-bear on the `.d.ts` output.

This is a Phase 4-worth-doing audit in the sense that the fix is real (the public types are wider than intended today) but **the risk and labor are both very low.** No new APIs, no removals, just a documentation-grade tightening. One real coordination point (`_runWithSession` / `socialite`), with a clear three-line resolution.

**Recommendation: ship one `refactor:` PR flipping `stripInternal: true` after dropping the `@internal` marker on `_runWithSession`. `patch` changesets across the ~20 packages whose `.d.ts` actually shrinks.**
