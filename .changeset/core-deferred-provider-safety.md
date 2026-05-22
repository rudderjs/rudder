---
'@rudderjs/core': minor
---

feat(core): async-boot guard + cycle detection on deferred providers

Pipeline-hardening Phase 3 from the 2026-05-21 code-review sweep (`docs/plans/2026-05-21-framework-pipeline-hardening.md`).

Three silent-failure modes are closed in `@rudderjs/core`'s deferred-provider lifecycle (the `provides()` opt-in for lazy-init):

**1. Async `boot()` + `provides()` now throws at registration**

Deferred-provider boot runs inside the container's missing handler, which is itself a synchronous step inside `container.make()`. The old path detected an async boot, logged `[RudderJS] Deferred provider "X" returned a Promise from boot() ... will be dropped`, and silently moved on — the consumer of the deferred token got a half-booted service with no obvious cause. Now `_registerAll()` checks `_isAsyncFunction(provider.boot)` when classifying a deferred provider and throws with a clear error:

```
[RudderJS] Deferred provider "MyProvider" has an async boot() — provides() requires
synchronous boot because lazy resolution can't await across container.make(). Move
async work into the bound services themselves (lazy-init pattern), or drop provides()
if eager boot is acceptable.
```

The async-function detector checks `fn.constructor.name === 'AsyncFunction'` first and falls back to `Object.prototype.toString.call(fn) === '[object AsyncFunction]'` to catch bound arrow forms.

**2. Circular deferred resolution throws a real error instead of "Cannot resolve"**

The previous "delete all my tokens at the top of the missing handler" mitigation only covered same-provider re-entry. Cross-provider chains where every token was still mid-registration bottomed out at the generic `Cannot resolve <token>` error from `container.make()`, masking the real cause. The missing-handler closure now tracks tokens currently in flight via a private `Set<string>` and throws on re-entry:

```
[RudderJS] Circular deferred resolution: "a" requires itself during register/boot.
Break the cycle by lazy-resolving via app().make("a") inside a method body instead
of at register/boot time.
```

`try/finally` cleanup so a throw during one resolve doesn't poison the next — verified by a regression test.

**3. Deferred providers no longer eager-boot during `_bootAll()`**

A latent bug surfaced while writing the happy-path test: `_bootAll()` iterated `this.providers` and awaited every provider's `boot()`, including the ones marked as deferred via `provides()`. The lazy missing handler then created a *fresh* provider instance and ran its boot() *again* — duplicate work, plus the eager `await` would silently land an async boot before the new validator above could catch it on a future re-bootstrap. Fixed by adding the original instance to `_bootedProviders` at the deferred branch in `_registerAll()`, so `_bootAll()` skips it. The "deferred" claim documented in `service-provider.ts` (`register()` and `boot()` are not called during bootstrap but lazily when one of the returned tokens is first resolved) now holds end-to-end.

**Tests**

9 new specs in `packages/core/src/index.test.ts` under a new `Application — deferred provider lifecycle (provides())` describe block:

- Happy path: sync boot + provides() registers lazily on first make(); idempotent on second resolve
- Async boot + provides() throws at registration
- Error message names the lazy-init pattern as the migration path
- Sync arrow-function boot is accepted (AsyncFunction detection edge case)
- Non-deferred providers with async boot are unaffected (scope check)
- Self-cycle (`provider.register() → make('self')`) throws "Circular deferred resolution"
- Cross-provider cycle (`A.register → make(b)`, `B.register → make(a)`) throws cycle error
- Legitimate cross-provider chain (`A.boot → make(b)` where B is independent) still works
- Throw during one resolve doesn't poison the next — `try/finally` cleanup

233 → 242 specs in the core test suite. Downstream test suites (`router`, `auth`, `passport`, `mcp`, `server-hono`, `middleware`, `ai` 839, `orm`, `queue`) pass unchanged. Full-repo typecheck across 93 packages clean.

**Migration**

No production providers in the framework or playground use `provides()` today — this is a hardening of a documented capability that nobody currently relies on. Apps that defined a deferred provider with an async `boot()` will now get a clear error at registration instead of a silent half-booted service; the fix is to move async work into the bound service (lazy-init) or drop `provides()` if eager boot is acceptable.
