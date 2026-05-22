---
'@rudderjs/router': minor
---

feat(router): freeze RouteBuilder after `mount()` + new `Route.lateRegister(fn)` for runtime registration

Pipeline-hardening Phase 4 from the 2026-05-21 code-review sweep (`docs/plans/2026-05-21-framework-pipeline-hardening.md`).

**The silent-failure class being closed**

Once `router.mount(adapter)` has run, the server adapter has captured every registered route by reference. Until now, calling a RouteBuilder mutator (`.query`/`.body`/`.name`/`.where*`/`.domain`/`.missing`) *after* mount silently no-op'd for some routes and partially propagated for others — `def.middleware.unshift(validator)` reaches the adapter for routes without route-binding middleware (the adapter holds the array reference), but routes WITH a binding land on the adapter through a fresh `[bindingMw, ...route.middleware]` array that the unshift can never reach. Cross-adapter divergence with no diagnostic.

Same shape for post-mount registration (`Route.get`, `.post`, `.add`, `.registerController`, `.resource`, `.bind`, `.use`): the new routes / middleware get pushed to internal arrays but the adapter has already finalised its routing table, so they're invisible to incoming requests.

**What changes**

`Router.mount()` now flips a one-way `_mounted` flag and captures the adapter. After that:

- Every RouteBuilder mutator throws on the captured definition: `.query() called on already-mounted route GET /users — define this before router.mount(), or wrap runtime registration in Route.lateRegister(() => Route.get(...).query(...))`. The message names the verb, path, and the escape hatch in one line.
- Every Router registration entry point (`.get`/`.post`/`.put`/`.patch`/`.delete`/`.all`/`.add`/`.registerController`/`.resource`/`.apiResource`/`.singleton`/`.fallback`/`.bind`/`.use`) throws with the same shape unless wrapped in `lateRegister`.

**The escape hatch**

```ts
import { Route } from '@rudderjs/router'

// Inside a dynamic provider's boot(), a feature-flag callback, etc.
Route.lateRegister(() => {
  Route.get('/admin/foo', adminController.foo).query(adminQuerySchema)
})
```

`lateRegister(fn)`:
- Throws if called before `mount()` — there's no adapter to register against.
- Suspends the freeze for the duration of `fn()` (counter-based, so nested calls work too).
- Mounts every route appended during the callback onto the captured adapter via the same code path `mount()` uses (route-binding middleware still gets composed correctly).
- Seals those new routes against further mutation after `fn` returns — the leaked builder from inside the callback will throw on any subsequent `.query()` / `.name()` / etc. just like a module-load route would.
- Decrements the counter via `try/finally`, so a throw inside `fn` leaves the router in a consistent post-mount state.

**Other improvements**

- `mount()` factored into a public driver + a private `_mountRoute(adapter, route)` so `lateRegister` and the initial mount take the same path — single source of truth for route-binding composition.
- `reset()` now clears the mount state (`_mounted` / `_adapter` / `_mountedDefs` / `_inLateRegister`) so dev-mode HMR (`router.reset()` → loaders → `mount()`) and test fixtures rebuild cleanly between cases.

**Migration**

If you currently rely on post-mount mutation or registration, wrap the work in `Route.lateRegister(...)`. Decorator-based controllers (`@Controller` / `@Get`), `routes/web.ts` / `routes/api.ts` files, provider `boot()` methods that run before `_createHandler()`, and HMR-driven re-bootstrap (`reset()` + reload) are all unaffected — registration happens at module load or pre-mount in those paths.

**Tests**

23 new specs across three describe blocks in `packages/router/src/index.test.ts`:

- RouteBuilder mutators throw post-mount: `.query`, `.body`, `.name`, `.where` (covers whereNumber/Alpha/Uuid/Ulid/In transitively), `.domain`, `.missing`, plus an assertion that the error message points at `Route.lateRegister(() => Route.<verb>(...).query(...))`.
- Router registration entry points throw post-mount: each verb (`get`/`post`/`put`/`patch`/`delete`/`all`), `add`, `use`, `bind`, `registerController`, `resource`, `fallback`.
- `Router.reset()` thaws the mount state; pre-mount `lateRegister()` throws; the captured adapter sees the new route; builders inside `lateRegister` can chain; sealed-after-return; route-binding middleware still attaches to late routes; nested `lateRegister` works; throw inside `fn` decrements the counter via `try/finally`.

156 → 179 specs in the router test suite. Downstream test suites (`@rudderjs/core`, `@rudderjs/auth`, `@rudderjs/passport`, `@rudderjs/mcp`, `@rudderjs/server-hono`, `@rudderjs/middleware`) pass unchanged.
