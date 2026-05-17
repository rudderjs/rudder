# Static-state singleton audit — Vite externals bundle-split sweep

**Status:** plan, 2026-05-17. Pickup task for a fresh session.
**Parent / precedent:** PR #498 — `fix(orm): route ModelRegistry state through globalThis`.

---

## Why this exists

PR #498 fixed a real prod bug: `@rudderjs/orm`'s `ModelRegistry` had `private static adapter: OrmAdapter | null = null`. In a Vite-bundled server, `@rudderjs/orm` is inlined into `entry.mjs` but the adapter packages (`@rudderjs/orm-prisma`, `@rudderjs/orm-drizzle`) are externalized and resolved from `node_modules` at runtime — where they import their *own copy* of `@rudderjs/orm`. Two copies of the class with separate static state = "No ORM adapter registered" on every DB route.

**The pattern, generalized:** any class with `private static X = ...` where:
- the package is *imported* by code that gets bundled into a Vite SSR entry, AND
- the package is *also* loaded fresh from `node_modules` by an externalized peer/driver package

…is broken in the same way. The two ends each get a different copy of the class.

We saw this in the bench smoke for at least *one* other package — `[RudderJS Cache] No cache adapter registered` came from inside `RateLimit` (middleware), which imports `CacheRegistry` from `@rudderjs/cache`. Same shape, same bug. Below is the full sweep.

---

## Audit methodology

For each candidate package, confirm:

1. **Static state on a class** — grep `packages/<pkg>/src/` for `private static .* = ` or `static .* = new ` patterns that hold mutable state (adapter, registry, map, etc.). Treat *immutable* statics (frozen tokens, constants) as safe.
2. **Cross-bundle reach** — is the package imported by code that ends up on the *opposite* side of a Vite externals boundary from where the state is *set*? Concretely:
   - Adapter/driver packages (`@rudderjs/X-prisma`, `@rudderjs/X-redis`, `@rudderjs/X-bullmq`) tend to be externalized.
   - Provider classes inside the package itself get loaded from `node_modules`.
   - Framework callers (`@rudderjs/middleware`, `@rudderjs/server-hono`, user route handlers, user `AppServiceProvider`) often get bundled inline.
   - **If the "set" call site is in node_modules and the "read" call site is bundled, the bug is real.**
3. **Reproduce** — boot the playground prod (`node playground/dist/server/index.mjs`) and exercise a route that drives the read path. Look for "No X registered" or similar adapter-missing errors.
4. **Migrate** — apply the PR #498 pattern (below).

---

## Per-package triage

Status legend:
- 🔴 **High-risk** — set/read crosses a Vite externals boundary; bug likely real today
- 🟡 **Medium-risk** — set/read could split if the user's app structure changes; worth fixing defensively
- 🟢 **Low-risk** — set + read are both always-bundled or always-node_modules; bug unlikely but migration is cheap
- ✅ **Already migrated** — uses `globalThis` today

| Package | File:Line | Risk | Notes |
|---|---|---|---|
| `@rudderjs/orm` ModelRegistry | shipped via #498 | ✅ | precedent |
| `@rudderjs/cache` CacheRegistry | `cache/src/index.ts:29-30` (`adapter`, `defaultName`) | 🔴 | Confirmed seen in bench smoke. `@rudderjs/middleware/src/index.ts:270` imports it; RateLimit fails with "No cache adapter registered" |
| `@rudderjs/queue` (adapter) | `queue/src/index.ts:160` | 🔴 | Adapter packages (`@rudderjs/queue-bullmq`) externalize. Same shape as ORM. |
| `@rudderjs/mail` | `mail/src/index.ts:29-30` (`adapter`, `_from`) | 🔴 | Adapters loaded via separate driver packages. |
| `@rudderjs/storage` | `storage/src/registry.ts:4-5` + `index.ts:37-38` | 🔴 | Disk registry — `s3` driver via optional dep `@aws-sdk/client-s3`. |
| `@rudderjs/hash` | `hash/src/index.ts:14` | 🔴 | Driver registry. Less surface than cache/queue but same pattern. |
| `@rudderjs/pennant` PennantRegistry | `pennant/src/index.ts:180` (`manager`) | 🔴 | **Likely cause of the documented [[playground-pennant-boot-bug]]**. `PennantProvider.boot()` (node_modules) calls `PennantRegistry.set()`; `AppServiceProvider.boot()` (bundled) calls `Feature.define()` which reads it. **Verify this first — if migration fixes the pennant bug for free, that's a separate win.** |
| `@rudderjs/log` | `log/src/index.ts:261-264` (channels, defaultName, shared, eventListeners) | 🟡 | Used by every package — likely bundled everywhere it's read, but cross-package emit paths could split. |
| `@rudderjs/auth` Gate | `auth/src/gate.ts:43-45` (abilities, policies, beforeCallbacks) | 🟡 | Abilities defined in `AppServiceProvider` (bundled); Gate.can() called in handlers (bundled). Cross-bundle risk if any framework middleware reads. |
| `@rudderjs/passport` | `passport/src/Passport.ts:27-43` (scopes, lifetimes, keys) | 🟡 | Same-bundle in practice today (Passport setup in `bootstrap/`). Defensive migration. |
| `@rudderjs/ai` registry | `ai/src/registry.ts:39-41` (factories, default, models) | 🟡 | Provider factories registered at boot, Agent reads at request. Likely same bundle today. |
| `@rudderjs/mcp` Mcp class | `mcp/src/Mcp.ts:27-28` (webServers, localServers) | 🟡 | Observer registry already migrated; the server registry is separate. `Mcp.web()` called from `AppServiceProvider`. |
| `@rudderjs/notification` channels | `notification/src/index.ts:145` | 🟡 | Channel map. |
| `@rudderjs/telescope` storage | `telescope/src/index.ts:71` | 🟢 | Storage configured + read inside the package. Less likely to split but cheap to migrate. |
| `@rudderjs/pulse` storage | `pulse/src/index.ts:33` | 🟢 | Same as telescope. |
| `@rudderjs/horizon` storage | `horizon/src/index.ts:25` | 🟢 | Same as telescope. |
| `@rudderjs/cashier-paddle` | `cashier-paddle/src/Cashier.ts:52-59` (apiKey, tokens, webhook config) | 🟢 | Config tokens — set once at boot, read in webhook handler. Same bundle in practice. |

---

## Migration template

Direct clone of #498's shape (`packages/orm/src/index.ts`, lines 70-152). For each package:

1. Add a `<Pkg>RegistryStore` interface above the class:

```ts
interface <Pkg>RegistryStore {
  adapter: <Adapter> | null         // mirror the original fields
  // ... whatever the original statics held
}

const _g = globalThis as Record<string, unknown>
if (!_g['__rudderjs_<pkg>_registry__']) {
  _g['__rudderjs_<pkg>_registry__'] = {
    adapter: null,
    // ...
  } satisfies <Pkg>RegistryStore
}
const _store = _g['__rudderjs_<pkg>_registry__'] as <Pkg>RegistryStore
```

2. Delete the `private static X` field declarations.
3. Replace every `this.X` / `<ClassName>.X` inside the class with `_store.X`.
4. Public API stays identical — `set`, `get`, `register`, `reset`, etc. unchanged.

**Naming convention:** key is `__rudderjs_<pkg>_<role>__` — match the existing precedents:
- `__rudderjs_orm_registry__` (PR #498)
- `__rudderjs_mcp_observers__`
- `__rudderjs_group_middleware__`
- `__rudderjs_telescope_recording__`

---

## Per-package PR shape

One PR per package (not bundled). Reason: each migration is independently verifiable, the changesets stay clean per package, and rollback is per-package if anything regresses.

PR title: `fix(<pkg>): route <Registry/Manager> state through globalThis`

PR body template (copy from #498):

- **Summary** — one paragraph, same shape as #498
- **How it could be triggered** — name the externalization boundary
- **Test plan** — package's own tests + at least one cross-package test that exercises the actual split (e.g., for `@rudderjs/cache`, drive `RateLimit` against a configured cache adapter)

Changeset: `patch` for each. No public API change.

---

## Per-package test plan

For each migrated package, add one regression test in the package's main `index.test.ts`:

```ts
it('state lives on globalThis so it survives a second copy of @rudderjs/<pkg>', () => {
  const value = makeFixture()
  <Class>.set(value)
  const store = (globalThis as Record<string, unknown>)['__rudderjs_<pkg>_registry__'] as { adapter: unknown } | undefined
  assert.ok(store, 'global store should exist after .set()')
  assert.strictEqual(store.adapter, value)
})
```

This documents the contract for future devs ("why does this class look weird?") and pins the global key name.

---

## Recommended order

Ship in priority order (highest user-impact first):

1. **`@rudderjs/pennant`** — also unblocks the playground pennant boot bug if the hypothesis holds. Free secondary win.
2. **`@rudderjs/cache`** — confirmed seen in bench smoke. Real prod bug today.
3. **`@rudderjs/queue`** — adapter packages (`@rudderjs/queue-bullmq`) are externalized; same shape as ORM.
4. **`@rudderjs/mail`** — adapter packages externalized.
5. **`@rudderjs/storage`** — s3 driver via `@aws-sdk/client-s3`.
6. **`@rudderjs/hash`** — driver registry.
7. (Defensive) `auth` Gate, `passport`, `ai` registry, `mcp` Mcp class, `notification`, `log`.
8. (Lowest priority) telescope/pulse/horizon/cashier-paddle.

After (1) is shipped, attempt a clean playground prod boot. If pennant bug is gone, the realistic-workload bench (`playground/bench/realistic.mjs` from #497) becomes runnable end-to-end — and the bench data informs the parked architectural levers (lazy-DI proxy, eager app construction).

---

## What this audit is NOT

- Not a refactor — `globalThis`-backed state is a workaround for module-duplication, not a code-quality improvement. The static-class API stays; only the storage backing changes.
- Not a security review — `globalThis` keys are predictable; this is a multi-instance correctness fix, not a sandboxing one.
- Not a coverage of *all* module-level state — only static class fields. Function-scope state inside packages is per-instance and not affected by module duplication.

---

## Reusable artifacts

- This plan doc — the methodology + triage table
- PR #498 as the canonical reference implementation (`packages/orm/src/index.ts:72-152`)
- The new regression test in `packages/orm/src/index.test.ts` (search for `'state lives on globalThis'`) as the test template
- `playground/bench/realistic.mjs` (from #497) as the end-to-end verification harness once enough of the audit has shipped
