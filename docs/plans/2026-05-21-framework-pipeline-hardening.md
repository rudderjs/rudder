# Framework pipeline hardening

**Status:** OPEN 2026-05-21
**Scope:** `@rudderjs/core`, `@rudderjs/router`, `@rudderjs/server-hono`
**Source:** Senior-engineer code review pass, 2026-05-21
**Severity:** 4 findings — 1 SPA-nav silent fallback, 1 silent error swallow at HTTP boundary, 1 provider re-entry race, 1 route-registration mount race

These are pipeline correctness fixes. None are exploit-shaped; all are "looks like it works, fails silently in ways that confuse users." Pipeline reviews tend to surface this class because the request flow has many seams where partial-failure modes hide.

---

## Phase 1 — `controllerViewPaths` parameterised-route support

**Severity:** medium — `view()` from `Route.get('/users/:id', ...)` falls back to full reload on SPA nav with no warning
**Effort:** ~1h + test

### The bug

`packages/server-hono/src/index.ts:401,427-429,710-722` — the `controllerViewPaths` registry only contains static GET paths. The code comment admits: "only exact-match paths are tracked — parameterized routes (`/users/:id`) are not supported as controller views in v1."

But the outer fetch handler at line 710-722 unconditionally checks `controllerViewPaths.has(stripped)` to decide whether to rewrite `.pageContext.json` → controller call. A `view()` returned from a parameterised route handler isn't in the set, so the rewrite doesn't happen — Vike's middleware sees the `.pageContext.json` URL and either 404s or serves the wrong page.

User-visible symptom: SPA navigation between two parameterised routes does a full reload instead of a partial render. There's no diagnostic.

### Fix

Match against the route table with param substitution. Hono's router exposes a `match(method, path)` that returns the matched route + extracted params. Use it to detect "does any registered controller route match this path?" — and if so, run the rewrite:

```ts
// inside the fetch handler
if (urlPath.endsWith('.pageContext.json')) {
  const stripped = urlPath.replace(/\.pageContext\.json$/, '') || '/'

  // Old: const matched = controllerViewPaths.has(stripped)
  const matched = controllerViewPaths.has(stripped)
    || isParameterisedControllerRoute(stripped)

  if (matched) {
    // rewrite to controller call
  }
}

function isParameterisedControllerRoute(path: string): boolean {
  const match = router.match('GET', path)
  return match?.handler?._isControllerView === true
}
```

`_isControllerView` is a marker the router sets when registering a route that ultimately returns `view()` — could also be inferred from the route metadata if we track it at registration time.

Alternative simpler shape: replace `controllerViewPaths: Set<string>` with `controllerViewPatterns: Array<{ pattern: string; method: string }>`. At lookup time, do pattern matching. Slower per-request but eliminates the marker complexity.

### Regression test

```ts
it('SPA nav to a parameterised controller view rewrites pageContext.json', async () => {
  Route.get('/users/:id', userController.show)  // returns view()

  const response = await app.fetch(
    new Request('http://localhost/users/42.pageContext.json'),
  )

  // Should hit the controller, not 404 from Vike's static-only middleware
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.user.id, '42')
})
```

---

## Phase 2 — Body parse error → 400, not silent `{}`

**Severity:** medium — malformed JSON / form bodies return `{}` to validators; users see "missing fields" instead of "bad request"
**Effort:** ~15 min + test

### The bug

`packages/server-hono/src/index.ts:490-500`:

```ts
try {
  req.body = await c.req.raw.clone().json()
} catch {
  req.body = {}
}
```

A POST with `Content-Type: application/json` and a truncated / corrupt body silently becomes an empty-body request. Validators then emit cryptic "required field missing" errors instead of "bad JSON." Same for form-urlencoded.

### Fix

Throw a typed `MalformedBodyError extends HttpException(400)` so the central exception pipeline renders cleanly:

```ts
// in @rudderjs/core or @rudderjs/server-hono
export class MalformedBodyError extends HttpException {
  constructor(public contentType: string, cause?: Error) {
    super(400, `Malformed request body (Content-Type: ${contentType})`, cause)
    this.name = 'MalformedBodyError'
  }
}
```

Update the body-parse block:

```ts
const ct = c.req.header('content-type') ?? ''
if (ct.includes('application/json')) {
  try {
    req.body = await c.req.raw.clone().json()
  } catch (e) {
    throw new MalformedBodyError('application/json', e instanceof Error ? e : undefined)
  }
} else if (ct.includes('application/x-www-form-urlencoded')) {
  try {
    const form = await c.req.raw.clone().formData()
    req.body = Object.fromEntries(form.entries())
  } catch (e) {
    throw new MalformedBodyError('application/x-www-form-urlencoded', e instanceof Error ? e : undefined)
  }
}
// No body: req.body stays undefined, validators do the right thing
```

The "no body" case (empty POST, GET with no body) should leave `req.body` as `undefined`, not `{}` — validators check for missing-required separately.

### Regression test

```ts
it('malformed JSON body returns 400 with clear message', async () => {
  const response = await app.fetch(new Request('http://localhost/api/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"name": "tru',  // truncated
  }))

  assert.equal(response.status, 400)
  const body = await response.json()
  assert.match(body.message, /malformed.*application\/json/i)
})
```

---

## Phase 3 — Deferred-provider async-boot semantics

**Severity:** medium — async `boot()` on deferred provider drops the promise; cross-provider re-entry races possible
**Effort:** ~1h + test

### The bug

`packages/core/src/application.ts:194-217` + `packages/core/src/di.ts:298-309` — when a deferred provider's `boot()` is async, the current code logs a warning and drops the promise. The binding is considered booted. Any consumer that depends on the async work having completed observes a half-booted state.

Worse, `boot?.()` runs inside `setMissingHandler` *during a `make()` call*. If the boot calls `make()` on another deferred token, the inner `make` re-enters `_missingHandler` with the outer provider still mid-register (no `_bootedProviders.add` yet). The eager `delete` of all tokens for the current provider (line 203-205) mitigates re-entry for the same provider, but not cross-provider chains.

### Fix

Two changes:

1. **Forbid async `boot()` on providers that use `provides()`** at registration time:

```ts
function register(providerClass: typeof ServiceProvider): void {
  const instance = new providerClass(this)
  if (typeof instance.provides === 'function') {
    if (instance.boot && isAsync(instance.boot)) {
      throw new Error(
        `[RudderJS] ${providerClass.name}: async boot() is incompatible with provides() — ` +
        `the deferred-provider lifecycle requires synchronous boot. ` +
        `Move async work into the booted services themselves (lazy-init pattern).`
      )
    }
  }
  // … existing register logic
}

function isAsync(fn: Function): boolean {
  return fn.constructor.name === 'AsyncFunction'
    || /^async\s/.test(fn.toString())
}
```

2. **Cycle detection in `_missingHandler`**:

```ts
const _resolving = new Set<string | symbol>()

function _missingHandler(token: string | symbol): unknown {
  if (_resolving.has(token)) {
    throw new Error(
      `[RudderJS] Circular deferred resolution: ${String(token)} ` +
      `requires itself during boot. Break the cycle by lazy-resolving via app().make(token) ` +
      `inside a method body, not at module load.`
    )
  }
  _resolving.add(token)
  try {
    const provider = _deferredProviders.get(token)
    if (!provider) return undefined
    provider.register()
    provider.boot?.()
    _bootedProviders.add(provider)
    return _bindings.get(token)
  } finally {
    _resolving.delete(token)
  }
}
```

### Regression test

```ts
it('async boot on deferred provider throws at registration', () => {
  class AsyncDeferredProvider extends ServiceProvider {
    provides() { return ['async-token'] }
    async boot() { await fetch('...') }
  }

  assert.throws(
    () => app.register(AsyncDeferredProvider),
    /async boot\(\) is incompatible with provides\(\)/,
  )
})

it('circular deferred resolution throws with clear message', () => {
  class A extends ServiceProvider {
    provides() { return ['a'] }
    boot() { this.app.make('b') }
  }
  class B extends ServiceProvider {
    provides() { return ['b'] }
    boot() { this.app.make('a') }
  }

  app.register(A)
  app.register(B)

  assert.throws(
    () => app.make('a'),
    /Circular deferred resolution: a/,
  )
})
```

---

## Phase 4 — `RouteBuilder.query()` / `.body()` mount-time freeze

**Severity:** medium — runtime route registration after `_createHandler` ran is brittle; no diagnostic when the race happens
**Effort:** ~30 min + test

### The bug

`packages/router/src/index.ts:449-479,796-809` — the 2-arg form registers the route synchronously inside `_rb`, then returns the builder. A user can call `.query(schema)` *later* and it `unshift`s a validator into `def.middleware`. But the route is **already mounted** by the time `router.mount(adapter)` runs in `_createHandler()` — the mutation only takes effect if the validator install happens *before* mount.

Routes registered in `routes/web.ts` then mounted in `_createHandler()` work because all `.query()` calls in module body happen before the mount. But routes registered at runtime via `app().register(SomeProvider)` *after* `_createHandler` ran are brittle: late `.query()` / `.body()` calls might or might not take effect depending on whether `_buildBindingMiddleware`'s closure read `def.middleware` at mount time or per-request.

### Fix

Freeze `def.middleware` once mounted, and throw on post-mount mutation:

```ts
class RouteBuilder {
  private _mounted = false
  private _def:     RouteDefinition

  _markMounted(): void {
    this._mounted = true
    Object.freeze(this._def.middleware)  // shallow freeze
  }

  query(schema: ZodSchema): this {
    if (this._mounted) {
      throw new Error(
        `[RudderJS Router] .query() called on already-mounted route ${this._def.method} ${this._def.path} — ` +
        `define validators before the app boots, or use Route.lateRegister() for runtime registration.`
      )
    }
    this._def.middleware.unshift(buildQueryValidator(schema))
    return this
  }
  // same for .body() and any other mutator
}
```

`router.mount(adapter)` calls `_markMounted()` on every registered builder before adapter handlers are installed.

For the legitimate runtime-registration case (provider boot adding routes after app boot — common in plugin architectures), add an opt-in:

```ts
Route.lateRegister(() => {
  Route.get('/admin/foo', adminController.foo).query(adminQuerySchema)
})
```

`lateRegister` immediately mounts the route after the callback runs.

### Regression test

```ts
it('throws when .query() is called after mount', () => {
  const builder = Route.get('/test', testController.show)
  app.mount()  // triggers _markMounted

  assert.throws(
    () => builder.query(z.object({ id: z.string() })),
    /\.query\(\) called on already-mounted route/,
  )
})

it('Route.lateRegister works for runtime-registered routes with validators', () => {
  app.mount()

  Route.lateRegister(() => {
    Route.get('/late', lateController.show).query(z.object({ x: z.string() }))
  })

  // No throw; validator is installed and the route is reachable
  const response = await app.fetch(new Request('http://localhost/late?x=1'))
  assert.equal(response.status, 200)
})
```

---

## Notable (yellow — track and decide, not in this sweep)

- **`stash(c)` is a `Context & Record<string, unknown>` cast** (`server-hono:78-81`). The entire `__rjs_*` namespace is invisible to type-checking. A typo (`__rjs_bidy`) compiles. Consider a shared `interface RjsStash` with discriminated keys, or move to `c.set('__rjs_body', …)` with typed module augmentation.
- **`HonoConfig.cors.origin` is `string` only** (`server-hono:61-67`) — but `CorsMiddleware` accepts `string[]`. Inconsistent surface; the Hono path can't do allowlists.
- **`process.env['APP_ENV'] === 'production'` evaluated once at module-load** (`server-hono:655`). In tests that mutate `APP_ENV` mid-suite, `isProd` is stale. Move into the request handler closure.
- **`route()` URL generator double-encodes** (`router/src/index.ts:1051-1057`). A param value containing `/` or `?` corrupts the path. Use `encodeURIComponent`.
- **`Url.isValidSignature` only matches if proxy doesn't strip path prefix** (`url-signing.ts:121`). Silent 403 with no diagnostic when behind an API gateway that rewrites the path.
- **`AppBuilder._suppressVikeNoise()` permanently monkey-patches `console.log/warn/info`** (`app-builder.ts:259-272`). Never restored; string-matches `'Server running at '` which could swallow legitimate user logs.
- **`ExceptionConfigurator._renders` iterated linearly per error** (`app-builder.ts:135-137`). With many custom renderers, build a `Map<Constructor, fn>` and walk the proto chain once.
- **`buildBindingMiddleware` casts `req.bound` to plain object** (`binding-middleware.ts:88-89`). Previous middleware setting `req.bound` to a class instance gets shadow-replaced by `{}`. Type the augmentation properly via `AppRequest` module augmentation.
- **CSRF cookie has no `Secure` flag** (`middleware:227`). `SameSite=Strict` mitigates most CSRF, but `Secure` should also be set in production.
- **`extractIp` only reads `x-forwarded-for[0]`** (`server-hono:106`). Doesn't validate it's a real IP — client-supplied junk becomes `req.ip` and a rate-limit key. Validate with a simple IPv4/IPv6 regex.

---

## Coverage gaps to backfill

- **SPA nav rewrite + `controllerViewPaths`** — zero tests for `/foo/index.pageContext.json` → `/foo` rewrite, `x-rudder-original-url` header, or fallthrough behavior. Phase 1's test seeds this.
- **`__rjs_merge_pending` cookie-merge into raw `Response`** — multi-cookie test exists for `res.json()` but not for `result instanceof Response` / `ViewResponse` branches.
- **`matchHost` subdomain capture + `__rjs_host_params` merge** — no test for collision with path params or port stripping.
- **`Url.isValidSignature` when `_crypto` hasn't loaded yet** — falls back to non-constant-time `===` (`url-signing.ts:137`). Not covered.
- **Deferred-provider re-entry** — Phase 3's test seeds the circular case; add coverage for the legitimate async-via-promise case too.
- **`vike/server` prewarm failure** — silently swallowed (`server-hono:621`). No observable surface, no test.

---

## Suggested PR order

All four phases are independent.

1. **Phase 2** first (`fix(server-hono): malformed body → 400 not silent {}`, changeset patch) — quickest win, no surface change
2. **Phase 4** (`feat(router): freeze RouteBuilder after mount + Route.lateRegister`, changeset minor — new API) — useful to land before Phase 1 in case parameterised-route work needs lateRegister
3. **Phase 1** (`fix(server-hono): SPA nav supports parameterised controller views`, changeset patch)
4. **Phase 3** (`feat(core): cycle detection + async-boot guard on deferred providers`, changeset minor — new throws are breaking for buggy providers)

Phase 3 has the longest tail of subtle change. Phase 1 is the highest user-visible value (SPA nav).

---

## Strengths noted (context)

- Boundary discipline between core / router / server-hono is genuinely clean. `resolveOptionalPeer('@rudderjs/router')` for the cycle, peer deps everywhere, no shortcut imports.
- Per-request augmentation via `__rjs_*` on `c` is the right shape. The comment block explaining why getters cross between `applyMiddleware` and `registerRoute` calls is exactly the kind of doc that prevents future regressions.
- No top-level `node:*` imports in validation / exceptions / middleware modules — `node:crypto` and `node:async_hooks` lazy-loaded behind `globalThis.process` checks.
- `perf-boundaries.ts` gated cleanly behind `RUDDER_PERF_BOUNDARIES=1` with `markBoundary` no-ops when disabled — zero prod overhead.
- DI container's contextual binding + tagging are Laravel-faithful without overreach. The `Constructor<T> = new (...args: never) => T` contravariance fix (from memory) is correct.
