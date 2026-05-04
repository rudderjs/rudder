# `@rudderjs/core` — Container Tagging, Extend, Rebinding & `*If`

**Status:** PROPOSED — design + implementation contract.
**Author handoff:** filed for the next rudder agent. Self-contained.
**Scope:** v1 = `tag` / `tagged`, `extend`, `rebinding`, `bindIf` / `singletonIf` / `scopedIf`, and a constructor-only `@Tag()` parameter decorator. Contextual binding integration via `Tag('name')` token sentinel.

---

## Why now

`@rudderjs/core`'s `Container` (`packages/core/src/di.ts`) gives us `bind / singleton / scoped / instance / make / has / forget / when().needs().give() / runScoped() / setMissingHandler()`. That's enough for typical app wiring, but four Laravel container affordances are missing and each unlocks a concrete scenario already showing up in the framework:

| Feature | Concrete unlock |
|---|---|
| `tag` / `tagged` | Plugin-style fan-out — e.g. `reports.exporters` (CSV / XLSX / JSON), `notifications.channels`, `pulse.recorders`, `mcp.tools`. Today providers reach into module-level registries (the observer-registry pattern) which works but isn't introspectable from the container. |
| `extend` | Decorator/wrap support without subclassing — wrap `CacheStore`, `Logger`, `HttpClient` with metrics or telescope hooks at boot time. |
| `rebinding` | Hot-swap during testing (`container.instance(Mailer, fake)`) without leaking stale references into already-resolved consumers. Also Laravel `app->refresh()` parity. |
| `bindIf` / `singletonIf` / `scopedIf` | Lets framework providers register a sane default that an app provider can override by binding the same token *first*. Today providers do `if (!container.has(X)) container.bind(X, ...)` ad hoc. |

None of these break existing API. All four are pure additions on `Container`.

---

## Public API

### 1. Tagging

```ts
container.bind('csv.exporter', () => new CsvExporter())
container.bind('xlsx.exporter', () => new XlsxExporter())
container.bind('json.exporter', () => new JsonExporter())

container.tag(['csv.exporter', 'xlsx.exporter', 'json.exporter'], 'reports.exporters')
// or, additively:
container.tag('json.exporter', ['reports.exporters', 'serializers.json'])

const exporters = container.tagged<Exporter>('reports.exporters')
// → [CsvExporter, XlsxExporter, JsonExporter] (resolved via make())
```

Signatures:

```ts
tag(tokens: Token | Token[], tags: string | string[]): this
tagged<T>(tag: string): T[]
```

Where `Token = string | symbol | Constructor`. Both arguments accept either single values or arrays — symmetric with how `singleton` / `bind` already accept `Constructor` or string tokens.

`tagged()` resolves each tagged token through `make()` so singletons stay singletons, scoped bindings respect the active scope, and contextual bindings still apply. Order is **insertion order** — Laravel-compatible and trivially predictable.

Tagging an unbound token is allowed (mirrors Laravel) — it just means `tagged()` will throw the normal "cannot resolve" error on resolve. This lets providers `tag()` then `bind()` in either order.

### 2. Extend (decorator/wrapper)

```ts
container.singleton(Logger, () => new ConsoleLogger())

container.extend(Logger, (logger, c) => {
  return new TelescopeLoggerProxy(logger, c.make(Telescope))
})
```

Signature:

```ts
extend<T>(token: Token, extender: (resolved: T, container: Container) => T): this
```

Multiple `extend()` calls on the same token chain in registration order — the result of the first becomes the input of the second, etc. Mirrors Laravel.

Extenders run **after** the factory (or after auto-resolve) and **before** singleton caching. So a singleton with three extenders calls all three exactly once and caches the final wrapped value. Scoped bindings re-run extenders per scope.

Pre-bound `instance(token, value)` values are also extended on the next `make()` — but to keep semantics simple, the extender runs **once and is cached back as the new instance**, so `make()` after the first call returns the cached extended value.

### 3. Rebinding

```ts
container.singleton(Mailer, () => new SesMailer())

container.rebinding(Mailer, (newInstance, c) => {
  c.make(MailQueue).rewire(newInstance)
})

// Later (in a test):
container.instance(Mailer, new FakeMailer())
// → rebinding listener fires synchronously with the FakeMailer
```

Signature:

```ts
rebinding<T>(token: Token, listener: (instance: T, container: Container) => void): this
```

**When listeners fire** (Laravel parity):

1. `bind()`, `singleton()`, `scoped()`, `instance()` is called for a token that is **already** bound or has a registered instance, and at least one rebinding listener exists for that token.
2. Listener receives the **newly resolved** instance — the container calls `make(token)` once internally to produce it, then invokes each listener with that value.
3. Listeners do **not** fire on the initial bind (only on *re*-binds). This matches Laravel and keeps the listener wiring noise-free during boot.
4. Listeners do **not** fire on `forget()`. Use a separate hook if we ever need teardown.

Rebinding triggers a `make()` even if no consumer has resolved the token yet — same as Laravel. Cost: one factory call per rebind. Acceptable; rebinds are a test/runtime-config concern, not a hot path.

### 4. Conditional bind helpers

```ts
container.bindIf('cache.store', () => new MemoryStore())
container.singletonIf(Mailer, () => new SesMailer())
container.scopedIf('request.id', () => randomUUID())
```

Signatures:

```ts
bindIf<T>(token: Token, factory: Factory<T>): this
singletonIf<T>(token: Token, factory: Factory<T>): this
scopedIf<T>(token: Token, factory: Factory<T>): this
```

Each is a one-liner: call the corresponding `bind` variant only when `this.has(token)` is `false`. Returns `this` either way.

This lets framework providers write:

```ts
// inside CacheServiceProvider.register()
this.app.singletonIf(CacheManager, c => new CacheManager(c.make(ConfigRepo)))
```

instead of the ad-hoc `if (!app.has(...))` dance.

### 5. `@Tag()` parameter decorator

```ts
@Injectable()
export class ReportRunner {
  constructor(@Tag('reports.exporters') private exporters: Exporter[]) {}
}
```

The parameter receives the live `tagged()` array at construction time. Like `@Inject`, this is **constructor-only** — see "Decorator scope" in the design section for why method-level tag injection is intentionally not supported.

---

## Internal data structures

Add to `Container` (`packages/core/src/di.ts`) alongside the existing private maps:

```ts
private _tags       = new Map<string, Set<string | symbol>>()    // tag → tokens
private _extenders  = new Map<string | symbol, Array<(value: unknown, c: Container) => unknown>>()
private _rebinders  = new Map<string | symbol, Array<(value: unknown, c: Container) => void>>()
```

All three keyed on the **resolved** key (after `toToken()` + `resolveAlias()`) so aliased tokens share state with their canonical form.

`reset()` must clear all three.

---

## Resolution flow changes

Today `make()` does (simplified):

```
1. instances.has(key) → return cached
2. bindings.has(key)  → factory(c) → maybe-cache → return
3. typeof token === 'function' → autoResolve()
4. _missingHandler → retry once
5. throw
```

New flow:

```
1. instances.has(key)
   → value = instances.get(key)
   → if first read after instance() and extenders exist for key:
       value = runExtenders(key, value)
       instances.set(key, value)            // cache the wrapped form
   → return value

2. bindings.has(key)
   → if scoped: ALS-cache check, then resolve, runExtenders, cache, return
   → else: value = factory(c)
           value = runExtenders(key, value)
           if singleton: instances.set(key, value)
           return value

3. autoResolve / missingHandler paths unchanged, except both run extenders
   on the produced value before returning (singletons cache the wrapped form)
```

Helper:

```ts
private runExtenders<T>(key: string | symbol, value: T): T {
  const exts = this._extenders.get(key)
  if (!exts) return value
  let v: unknown = value
  for (const ext of exts) v = ext(v, this)
  return v as T
}
```

### Rebinding hook

Wrap the four binding methods (`bind`, `singleton`, `scoped`, `instance`) so each one:

1. Records `wasBound = this.has(key)` before mutating.
2. Performs the existing `this.bindings.set(...)` / `this.instances.set(...)` logic.
3. **Critical:** clears `this.instances.delete(key)` if a non-instance bind replaces a previously-cached singleton — otherwise the old cached value would survive the rebind.
4. If `wasBound && this._rebinders.has(key)` → calls `this.fireRebinders(key)`.

```ts
private fireRebinders(key: string | symbol): void {
  const listeners = this._rebinders.get(key)
  if (!listeners?.length) return
  const fresh = this.make(key)                  // resolve once with new binding
  for (const fn of listeners) fn(fresh, this)
}
```

`fireRebinders()` must run **after** the new binding is in place so `make()` resolves the new value, not the old one.

---

## Decorator: `@Tag()` shape

Mirror `@Inject`'s metadata-emit pattern:

```ts
const TAG_METADATA = 'rudderjs:tag'

export function Tag(name: string): ParameterDecorator {
  return (target, _, index) => {
    const existing: Array<{ index: number; tag: string }> =
      Reflect.getMetadata(TAG_METADATA, target) ?? []
    Reflect.defineMetadata(TAG_METADATA, [...existing, { index, tag: name }], target)
  }
}
```

In `autoResolve`, after collecting `tokenOverrides` from `@Inject`, also collect:

```ts
const tagOverrides: Array<{ index: number; tag: string }> =
  Reflect.getMetadata(TAG_METADATA, target) ?? []
```

In the `paramTypes.map((type, i) => ...)` body, check tag overrides **before** plain inject overrides:

```ts
const tagOverride = tagOverrides.find(o => o.index === i)
if (tagOverride) return this.tagged(tagOverride.tag)
```

Order of priority for a constructor parameter: contextual binding → `@Tag()` → `@Inject()` → reflected `design:paramtypes`. `@Tag` wins over `@Inject` because the two should never appear on the same parameter in practice; if they do, `@Tag` is the more specific intent.

### Why constructor-only

Per `feedback_vite_no_design_paramtypes` in MEMORY: esbuild (which Vite uses for TS transpile) **drops `design:paramtypes` metadata on method decorators**. Class-level + constructor-parameter decorators emit metadata correctly; method-parameter decorators do not. So `@Tag()` only works in constructors. We document this and don't try to support `@Tag()` on method parameters — silent breakage in dev would be worse than no support.

If a user needs to pull tagged services inside a method, they ask for the `Container` itself or use the `Tag()` token sentinel below.

---

## Contextual binding integration

The user spec calls for `when().needs(Tag('exporters')).give(...)` to work. Approach: introduce a `Tag()` token-sentinel function (separate from the decorator — same name is fine, function-call form vs decorator-call form):

```ts
const TAG_TOKEN_PREFIX = 'rudderjs:tag:'

/**
 * Token sentinel for tag-based dependency markers.
 * Use as a decorator on constructor params (`@Tag('x')`), or as a token
 * passed to `when().needs(Tag('x')).give(...)`.
 */
export function Tag(name: string): symbol & ParameterDecorator {
  // dual usage — call site decides shape
  ...
}
```

Implementation note: instead of overloading the same export, we ship **two named exports**:

- `Tag(name)` — parameter decorator (used at the constructor site).
- `tagToken(name)` — returns `Symbol.for(TAG_TOKEN_PREFIX + name)`. Used as a stable token for `when().needs(...)`.

Two names are clearer than one overloaded one, and avoids the Constructor/Symbol type-casting gymnastics.

```ts
container.when(ReportRunner)
  .needs(tagToken('reports.exporters'))
  .give(c => c.tagged('reports.exporters'))
```

The `give()` factory has full control — it can return the tagged array directly, filter it, or return a single picked instance. We deliberately do **not** auto-resolve `tagToken('x')` to `tagged('x')` in `make()`; the token is opaque to the container and only meaningful to contextual bindings.

---

## Code sketch — full `Container` additions

```ts
// types
type Extender<T = unknown>  = (resolved: T, c: Container) => T
type Rebinder<T = unknown>  = (instance: T, c: Container) => void

// state (append to existing private fields)
private _tags       = new Map<string, Set<string | symbol>>()
private _extenders  = new Map<string | symbol, Array<Extender>>()
private _rebinders  = new Map<string | symbol, Array<Rebinder>>()

// public methods
tag(tokens: Token | Token[], tags: string | string[]): this {
  const tokenList = Array.isArray(tokens) ? tokens : [tokens]
  const tagList   = Array.isArray(tags)   ? tags   : [tags]
  for (const tag of tagList) {
    let set = this._tags.get(tag)
    if (!set) { set = new Set(); this._tags.set(tag, set) }
    for (const t of tokenList) set.add(this.toToken(t))
  }
  return this
}

tagged<T>(tag: string): T[] {
  const set = this._tags.get(tag)
  if (!set) return []
  return [...set].map(token => this.make<T>(token))
}

extend<T>(token: Token, extender: Extender<T>): this {
  const key = this.resolveAlias(this.toToken(token))
  const list = this._extenders.get(key) ?? []
  list.push(extender as Extender)
  this._extenders.set(key, list)
  // re-extend any cached singleton/instance so future make() calls see the wrap
  if (this.instances.has(key)) {
    this.instances.set(key, this.runExtenders(key, this.instances.get(key)))
  }
  return this
}

rebinding<T>(token: Token, listener: Rebinder<T>): this {
  const key = this.resolveAlias(this.toToken(token))
  const list = this._rebinders.get(key) ?? []
  list.push(listener as Rebinder)
  this._rebinders.set(key, list)
  return this
}

bindIf<T>(token: Token, factory: Factory<T>): this {
  return this.has(token) ? this : this.bind(token, factory)
}
singletonIf<T>(token: Token, factory: Factory<T>): this {
  return this.has(token) ? this : this.singleton(token, factory)
}
scopedIf<T>(token: Token, factory: Factory<T>): this {
  return this.has(token) ? this : this.scoped(token, factory)
}
```

Each existing `bind / singleton / scoped / instance` method gets a one-line tail:

```ts
bind<T>(token, factory): this {
  const key = this.toToken(token)
  const wasBound = this.bindings.has(key) || this.instances.has(key)
  this.instances.delete(key)              // discard stale cached value
  this.bindings.set(key, { factory, singleton: false })
  if (wasBound) this.fireRebinders(key)
  return this
}
```

`reset()` adds:

```ts
this._tags.clear()
this._extenders.clear()
this._rebinders.clear()
```

---

## Implementation tasks

Each is independently committable.

### Task 1 — Tagging
- Add `_tags` field + `tag()` + `tagged()` methods.
- Update `reset()`.
- Tests: insertion order, multi-tag-per-token, multi-token-per-tag, tagged-but-unbound throws on resolve, alias-tagged token resolves correctly.

### Task 2 — Extend
- Add `_extenders` field + `extend()` method + private `runExtenders()`.
- Update `make()` to call `runExtenders()` in all three resolution paths (instance / bound factory / autoResolve / missingHandler retry).
- Update `instance()` to drop the cached value if extenders are registered later (handled by `extend()` re-running on existing cache).
- Tests: chain order, runs once per singleton, runs per scope for scoped, applies to `instance()`-bound values, applies to autoResolved classes.

### Task 3 — Rebinding
- Add `_rebinders` field + `rebinding()` method + private `fireRebinders()`.
- Wrap `bind`, `singleton`, `scoped`, `instance` to track `wasBound`, clear stale instance cache on rebind, and fire listeners after the new binding is in place.
- Tests: listener fires on second bind, not first; receives new instance; multiple listeners fire in registration order; listeners on a singleton see the newly-resolved value, not the old cached one.

### Task 4 — Conditional bind helpers
- Add `bindIf` / `singletonIf` / `scopedIf` as one-liners.
- Tests: returns existing binding when token already bound; registers when not.

### Task 5 — `@Tag` decorator + `tagToken()`
- Add `TAG_METADATA` constant + `Tag` parameter decorator.
- Add `tagToken(name)` symbol-returning function.
- Update `autoResolve()` to honor `@Tag` overrides before `@Inject`.
- Tests: autoresolve injects tagged array; works with mixed `@Inject` and `@Tag` params; `tagToken()` works inside `when().needs().give()`.

### Task 6 — Exports + docs
- `packages/core/src/index.ts` line 19: extend the di re-export to include `Tag`, `tagToken`.
- `packages/core/CLAUDE.md`: add a "Container additions" section linking to this plan.
- `packages/core/README.md`: add a "Tags, Extend, Rebinding" subsection under the existing container docs.
- `docs/guide/container.md` (rudderjs.com sync follows separately): expand with the same examples.

### Task 7 — Tests
Add `packages/core/src/di-tags.test.ts` (sibling of `di.test.ts`) covering Tasks 1–5. Use the existing in-process `Container` instance pattern from `di.test.ts`. No mocks required.

Test matrix (sketch):

| # | Scenario | Assert |
|---|---|---|
| 1 | `tag(['a','b'], 'g')` then `tagged('g')` | array of resolved values, in insertion order |
| 2 | `tag('a', ['g1','g2'])` | `tagged('g1')` and `tagged('g2')` both contain `a` |
| 3 | `tagged('missing-tag')` | returns `[]` (no throw) |
| 4 | `tag('unbound', 'g')` then `tagged('g')` | throws standard "cannot resolve" |
| 5 | tag a singleton + resolve via `tagged()` twice | same instance both times |
| 6 | `extend(token, fn)` after `singleton()` | first `make()` returns wrapped value |
| 7 | two `extend()`s | applied in order; second wraps first |
| 8 | `extend()` after singleton already cached | cached instance is replaced with wrapped value |
| 9 | `extend()` on `instance()`-bound value | `make()` returns wrapped, `make()` again returns cached wrapped |
| 10 | `extend()` on scoped binding | extenders run once per scope, not once globally |
| 11 | `rebinding(token, fn)` then `bind(token, ...)` first time | listener does NOT fire |
| 12 | `rebinding()` then `bind()` then `bind()` again | listener fires on the second bind with the new instance |
| 13 | rebind a singleton that was already resolved | listener sees the freshly-resolved value, not the stale cache |
| 14 | `bindIf` on already-bound token | binding unchanged |
| 15 | `bindIf` on unbound token | binds |
| 16 | `@Tag('g')` constructor param + `tagged()` setup | autoResolve injects the array |
| 17 | `when(X).needs(tagToken('g')).give(c => c.tagged('g'))` | contextual override returns tagged array |
| 18 | `reset()` clears tags / extenders / rebinders | post-reset `tagged()` returns `[]`, etc. |

### Task 8 — Changeset
```bash
pnpm changeset
# minor bump for @rudderjs/core. additive only — no consumer migration.
```

Body: list the four new container surfaces + the `Tag` / `tagToken` exports. Note that no existing API changes.

---

## Out of scope

- **Laravel attribute set** — `#[Auth]`, `#[Cache]`, `#[Config]`, `#[CurrentUser]`, etc. Those each require knowledge of the auth/cache/config packages and belong in their own per-package plans. The core container only ships the generic `@Tag()` here.
- **Method-level parameter injection** — Vite/esbuild drops `design:paramtypes` on method decorators (memory note `feedback_vite_no_design_paramtypes`). `@Tag` is constructor-only.
- **`extend()` removal API** — once registered, an extender stays for the container's lifetime. Add `removeExtender` later if a real consumer needs it.
- **`refresh(token)` Laravel helper** — same outcome can be achieved by the consumer calling `make(token)` itself; not worth the extra surface.
- **Tag inheritance / namespacing** — `'reports.exporters.csv'` does not auto-include in `'reports.exporters'`. Tags are flat strings; users compose with multiple tags.
- **Wildcard rebinding** — `rebinding('*', fn)` style. Defer until a real use case appears.
- **Async extenders** — `extend()` is sync. Container resolution stays sync end-to-end. If we ever need async wiring it's a separate `bindAsync` / `makeAsync` design, not a band-aid on `extend`.

---

## Open questions for the implementer

1. **`extend()` on a scoped binding** — current sketch says "run once per scope". Confirm by writing test 10 first; if the scoped path turns out to cache before extenders run, restructure the scoped branch to mirror the singleton branch.
2. **`instance(token, value)` then `extend(token, fn)`** — current `extend()` re-wraps the cached instance immediately. Alternative: defer until next `make()`. The eager approach is more predictable but means an `extend()` call has an observable side effect on already-resolved consumers. Pick the eager path (consistent with Laravel's behavior); document it.
3. **Rebinding firing during boot** — providers may call `bind()` then `bind()` again (rare, but possible) during their own `register()`. Listeners fire as expected. If this causes noise, add an internal `_quietRebinds` flag that providers can set; current take is YAGNI.
4. **`@Tag` + `@Inject` on the same parameter** — TypeScript allows it; runtime picks `@Tag` (per priority list). Worth a test asserting this so we don't regress.
5. **`tagToken()` returning a `Symbol.for()`** — global symbol registry means cross-bundle tag tokens collide intentionally (good for plugin authors). Confirm this matches our expectations vs. a per-container `Symbol()`.

---

## File touch list (final)

- `packages/core/src/di.ts` — new fields, methods, decorator, autoresolve hook, rebind wrapping
- `packages/core/src/di-tags.test.ts` — new
- `packages/core/src/index.ts` — re-export `Tag`, `tagToken`
- `packages/core/README.md` — "Tags, Extend, Rebinding" section
- `packages/core/CLAUDE.md` — link to this plan from the di line
- `.changeset/<random>.md` — generated by `pnpm changeset`

Estimated: one focused day for impl + tests + docs. The mechanical bits are small; the resolution-flow changes need careful test coverage to lock in semantics.
