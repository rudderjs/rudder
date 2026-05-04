# `@rudderjs/router` — Laravel Parity Pass (constraints, subdomain, missing(), resource)

**Status:** PROPOSED — design + implementation contract.
**Scope:** four additive surfaces. `packages/router` minor; `@rudderjs/contracts` adds two optional `RouteDefinition` fields; `@rudderjs/server-hono` patch (host gate + param merge); `@rudderjs/cli` patch (`make:controller --resource`).

---

## Path-syntax convention (read first)

Existing router uses Express-style `:param` / `:param?` (see `_buildBindingMiddleware`'s `/:([a-zA-Z_][a-zA-Z0-9_]*)\??/g`). The task description used Laravel's `{param}` — **plan stays on `:param`** to avoid splitting the parser. `where*` calls take the bare param name (`'id'`).

---

## A. Constraint shortcuts

### A.1 Public API

```ts
class RouteBuilder {
  where           (param: string, regex: string | RegExp): this
  whereNumber     (param: string): this   // [0-9]+
  whereAlpha      (param: string): this   // [A-Za-z]+
  whereAlphaNumeric(param: string): this  // [A-Za-z0-9]+
  whereUuid       (param: string): this   // any version (matches Laravel)
  whereUlid       (param: string): this   // Crockford base32, 26 chars
  whereIn         (param: string, values: readonly (string | number)[]): this
}
```

Patterns exported as consts so apps can reuse:

```ts
export const ROUTE_PATTERN_NUMBER   = '[0-9]+'
export const ROUTE_PATTERN_ALPHA    = '[A-Za-z]+'
export const ROUTE_PATTERN_ALPHANUM = '[A-Za-z0-9]+'
export const ROUTE_PATTERN_UUID     = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
export const ROUTE_PATTERN_ULID     = '[0-7][0-9A-HJKMNP-TV-Z]{25}'
```

### A.2 Implementation

Mutate `definition.path` eagerly: `:id` → `:id{<pattern>}` (Hono regex-segment syntax). The `RouteDefinition` reference is shared between the array and the `RouteBuilder`, so mutation propagates. No adapter contract change — Hono already understands `:id{[0-9]+}`.

```ts
where(param: string, regex: string | RegExp): this {
  const pattern = regex instanceof RegExp ? regex.source : regex
  const re      = new RegExp(`(:${param})(\\{[^}]*\\})?`, 'g')
  if (!re.test(this.definition.path)) {
    throw new Error(`[RudderJS Router] where("${param}", …) — route path "${this.definition.path}" has no :${param} segment.`)
  }
  this.definition.path = this.definition.path.replace(re, `$1{${pattern}}`)
  return this
}

whereNumber      (p: string)                            { return this.where(p, ROUTE_PATTERN_NUMBER) }
whereAlpha       (p: string)                            { return this.where(p, ROUTE_PATTERN_ALPHA) }
whereAlphaNumeric(p: string)                            { return this.where(p, ROUTE_PATTERN_ALPHANUM) }
whereUuid        (p: string)                            { return this.where(p, ROUTE_PATTERN_UUID) }
whereUlid        (p: string)                            { return this.where(p, ROUTE_PATTERN_ULID) }
whereIn          (p: string, values: readonly (string|number)[]) {
  if (values.length === 0) throw new Error(`[RudderJS Router] whereIn("${p}", []) — values must be non-empty.`)
  const escaped = values.map(v => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return this.where(p, `(?:${escaped.join('|')})`)
}
```

Caveat: `where*` is fluent-only. `registerController()` doesn't return a `RouteBuilder`, so decorator routes can't add constraints in v1 — document as out-of-scope.

Verify `route()` URL generator's regex `/:([a-zA-Z_][a-zA-Z0-9_]*)(\?)?/g` ignores trailing `{...}` cleanly (it does — `{` is not in the param-name char class). Add a test.

### A.3 Tests

- `whereNumber('id')` rewrites `'/users/:id'` → `'/users/:id{[0-9]+}'`.
- `whereIn('status', ['draft','published'])` → `:status{(?:draft|published)}`.
- Repeated `where*()` on same param — last wins.
- `where('foo', /\d+/)` accepts `RegExp`.
- `where('missing', '...')` throws when path lacks `:missing`.
- `whereIn('s', [])` throws.
- E2E: `whereNumber('id')` on `/users/:id`; assert `GET /users/abc` 404s.
- `route('users.show', { id: 42 })` resolves cleanly when path carries `{[0-9]+}`.

---

## B. Subdomain routing

### B.1 Public API

```ts
router.get('/foo', handler).domain('api.example.com')
router.get('/foo', handler).domain('admin.:tenant.example.com')

router.group({ domain: 'api.example.com' }, () => {
  router.get('/users', listUsers)            // GET api.example.com/users
})

router.group({ domain: ':tenant.example.com', prefix: '/admin' }, () => {
  router.get('/dashboard', dash)             // GET :tenant.example.com/admin/dashboard
})
```

Subdomain params land on `req.params` alongside path params (e.g. `req.params.tenant`).

### B.2 Contract change (`@rudderjs/contracts`)

```ts
// packages/contracts/src/index.ts — RouteDefinition
host?:    string                                                                  // subdomain match template
missing?: (req: AppRequest, err: Error & { httpStatus: number; param: string; value: string; model: string }) => unknown | Promise<unknown>
```

Two additive optional fields. `missing`'s second arg is duck-typed so contracts stays dep-free of `@rudderjs/router`.

### B.3 Router internals

1. **`RouteBuilder.domain(t: string): this`** — sets `this.definition.host = t`.
2. **New `router.group(opts, fn)`** — proper Laravel-style scoping (B.4).
3. **Param lookup** — `_buildBindingMiddleware` already reads `req.params[name]`; if server-hono merges host params into `req.params`, no router change needed.

### B.4 `router.group(opts, fn)` — new method

`runWithGroup(group, fn)` already exists but **only** tags routes with `'web' | 'api'`. It does not prefix paths or scope middleware. Add:

```ts
interface RouteGroupOptions {
  prefix?:     string
  domain?:     string
  middleware?: MiddlewareHandler[]
}

class Router {
  private _groupStack: RouteGroupOptions[] = []

  group(opts: RouteGroupOptions, fn: () => void): this {
    const prev = this._groupStack
    this._groupStack = [...prev, opts]
    try { fn() } finally { this._groupStack = prev }
    return this
  }
}
```

`_rb()` consults `this._groupStack`:
- `path = stack.map(g => g.prefix ?? '').join('') + path`, then collapse `/+` to `/`.
- `host = innermost defined .domain` (hosts can't concatenate).
- `middleware = stack.flatMap(g => g.middleware ?? []).concat(middleware)`.

Coexists with `runWithGroup` — both can be active. Document the distinction: `router.group()` = prefix/domain/middleware scope; `runWithGroup()` (called by `Application.withRouting`) = web/api tag. Don't conflate.

### B.5 Adapter (`@rudderjs/server-hono`)

Hono routes by path only. Pre-handler host check, ~40 LOC. No host-keyed sub-app for v1.

```ts
// registerRoute()
this.app[method](route.path, async (c: Context) => {
  if (route.host) {
    const m = matchHost(route.host, c.req.header('host') ?? '')
    if (!m) return c.notFound()
    ;(c as Record<string, unknown>)['__rjs_host_params'] = m.params
  }
  // ... existing normalizeRequest / chain / handler ...
})

function matchHost(template: string, host: string): { params: Record<string, string> } | null {
  const hostname = host.split(':')[0]!.toLowerCase()
  const names: string[] = []
  const re = new RegExp('^' +
    template.toLowerCase()
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/:([a-z_][a-z0-9_]*)/gi, (_, n) => { names.push(n); return '([^.]+)' })
    + '$', 'i')
  const m = re.exec(hostname); if (!m) return null
  const params: Record<string, string> = {}
  names.forEach((n, i) => { params[n] = m[i + 1]! })
  return { params }
}
```

`normalizeRequest()` merges:

```ts
const hostParams = (c as Record<string, unknown>)['__rjs_host_params'] as Record<string, string> | undefined
const params = { ...(c.req.param() ?? {}), ...(hostParams ?? {}) }   // path wins on collision
```

### B.6 Tests

Router:
- `RouteBuilder.domain()` sets `definition.host`.
- `router.group({ domain, prefix }, …)` — paths get prefix, all routes get host.
- Nested `group()` — innermost host wins, prefixes concat, middleware stacks.

server-hono:
- `host: 'api.example.com'` — match on `Host: api.example.com`; 404 on `Host: web.example.com`.
- `host: ':tenant.example.com'` — captured tenant on `req.params.tenant`.
- `Host: api.example.com:3000` matches `host: 'api.example.com'`.

---

## C. `missing()` 404 customization

### C.1 Implicit-binding caveat

Laravel's `missing()` fires when *implicit* binding fails. Rudder has **explicit** binding only (`router.bind('user', User)` — no convention scanning). **Decision:** scope `missing()` to explicit bindings. It fires whenever `_buildBindingMiddleware` would throw `RouteModelNotFoundError`. Future implicit-binding plan will inherit this transparently.

### C.2 Public API

```ts
class RouteBuilder {
  /** Custom response when a bound route param fails to resolve.
   *  Receives the request and the not-found error; return any value a handler may return. */
  missing(fn: (req: AppRequest, err: RouteModelNotFoundError) => unknown | Promise<unknown>): this
}
```

### C.3 Implementation

Store `missing` on `RouteDefinition` (already widened in B.2). `_buildBindingMiddleware` currently takes `path: string` — change to take the full `RouteDefinition` so the closure captures `def.missing`. `mount()` already has the route in hand; trivial to pass.

```ts
// inside _buildBindingMiddleware, in the not-found branch:
if (resolved === null || resolved === undefined) {
  if (binding.optional) { bound[name] = null; continue }
  const err = new RouteModelNotFoundError(binding.resolver.name, name, raw)
  if (def.missing) {
    const result = await def.missing(req, err)
    if (result instanceof Response)               return res.send ? res.send(result) : (res as any).respond(result)
    if (result && typeof result === 'object')     return res.json(result)
    if (typeof result === 'string')               return res.send(result)
    return  // missing() handled it via res directly
  }
  throw err
}
```

`builder.missing(fn)` writes `this.definition.missing = fn`.

### C.4 Tests

- Binding + `.missing(fn)` — resolver returns null → `fn` called with the error.
- `missing()` → plain object → JSON response.
- `missing()` → `Response` → forwarded as-is.
- `missing()` → `undefined` (handler used `res.json` directly) → no double-write.
- Route without `.missing()` — original `RouteModelNotFoundError` throw still fires.
- Optional binding — `.missing()` does NOT fire (optional → null, no throw).

---

## D. `Route::resource` / `apiResource` / `singleton`

### D.1 Public API

```ts
class Router {
  resource   (name: string, Ctrl: new () => object, opts?: ResourceOptions): ResourceRegistration
  apiResource(name: string, Ctrl: new () => object, opts?: ResourceOptions): ResourceRegistration
  singleton  (name: string, Ctrl: new () => object, opts?: ResourceOptions): SingletonRegistration
}

interface ResourceOptions {
  only?:       readonly ResourceVerb[]
  except?:     readonly ResourceVerb[]
  parameters?: Record<string, string>          // override `:post` segment name
  names?:      Record<string, string>          // override generated route names
  middleware?: MiddlewareHandler[]
}

type ResourceVerb = 'index' | 'create' | 'store' | 'show' | 'edit' | 'update' | 'destroy'

class ResourceRegistration { builders: RouteBuilder[] }
class SingletonRegistration extends ResourceRegistration {
  creatable():   this   // adds GET /profile/create + POST /profile
  destroyable(): this   // adds DELETE /profile
}
```

`resource()` registers seven routes (`index/create/store/show/edit/update/destroy`); `apiResource` excludes `create`+`edit` (HTML form pages, not JSON); `singleton` registers `show/edit/update` only. `update` always also registers a PATCH alias.

### D.2 Controller convention

Plain class with method names matching verbs. **Missing methods are silently skipped** — matches Laravel and lets users register a partial controller without `only`/`except` boilerplate.

```ts
export class PostController {
  index   (req, res) { /* ... */ }
  create  (req, res) { /* ... */ }
  store   (req, res) { /* ... */ }
  show    (req, res) { /* ... */ }
  edit    (req, res) { /* ... */ }
  update  (req, res) { /* ... */ }
  destroy (req, res) { /* ... */ }
}
```

Non-decorated. `resource()` introspects the prototype, binds methods to a controller instance, and registers each via `_rb()` — so bindings, group tags, `where*`, group middleware all work.

### D.3 Implementation sketch

```ts
const RESOURCE_VERBS: Array<{
  verb: ResourceVerb; method: HttpMethod; path: (n: string, p: string) => string; nameSuffix: string
}> = [
  { verb: 'index',   method: 'GET',    path: (n)   => `/${n}`,            nameSuffix: 'index'   },
  { verb: 'create',  method: 'GET',    path: (n)   => `/${n}/create`,     nameSuffix: 'create'  },
  { verb: 'store',   method: 'POST',   path: (n)   => `/${n}`,            nameSuffix: 'store'   },
  { verb: 'show',    method: 'GET',    path: (n,p) => `/${n}/:${p}`,      nameSuffix: 'show'    },
  { verb: 'edit',    method: 'GET',    path: (n,p) => `/${n}/:${p}/edit`, nameSuffix: 'edit'    },
  { verb: 'update',  method: 'PUT',    path: (n,p) => `/${n}/:${p}`,      nameSuffix: 'update'  },
  { verb: 'destroy', method: 'DELETE', path: (n,p) => `/${n}/:${p}`,      nameSuffix: 'destroy' },
]

resource(name: string, Ctrl: new () => object, opts: ResourceOptions = {}): ResourceRegistration {
  const instance  = new Ctrl() as Record<string, unknown>
  const verbs     = filterVerbs(RESOURCE_VERBS, opts)         // honors only/except
  const paramName = opts.parameters?.[name] ?? singularize(name)
  const builders: RouteBuilder[] = []

  for (const spec of verbs) {
    const fn = instance[spec.verb]
    if (typeof fn !== 'function') continue                    // controller doesn't implement → skip
    const path    = spec.path(name, paramName)
    const handler = (fn as RouteHandler).bind(instance)
    Object.defineProperty(handler, 'name', { value: `${Ctrl.name}@${spec.verb}`, configurable: true })

    const builder = this._rb(spec.method, path, handler, opts.middleware ?? [])
    builder.name(opts.names?.[spec.verb] ?? `${name}.${spec.nameSuffix}`)
    builders.push(builder)

    if (spec.verb === 'update') {
      builders.push(this._rb('PATCH', path, handler, opts.middleware ?? []))
    }
  }
  return new ResourceRegistration(builders)
}

apiResource(name, Ctrl, opts = {}): ResourceRegistration {
  return this.resource(name, Ctrl, { ...opts, except: [...(opts.except ?? []), 'create', 'edit'] })
}
```

`singleton()` mirrors `resource()` with a different verb table; `creatable()`/`destroyable()` push more builders.

`singularize()` is a tiny helper — `posts → post`, `categories → category`. **No real inflector** — irregular nouns use `parameters: { posts: 'article' }`.

### D.4 Scaffolder support — `make:controller --resource`

Existing `packages/cli/src/commands/make/controller.ts` already exists with a single stub. Add three mutually-exclusive flags: `--resource`, `--api`, `--singleton`. Each emits a different stub:

```ts
function resourceStub(className: string, prefix: string): string {
  return `import { Controller } from '@rudderjs/router'
import type { Context } from '@rudderjs/core'

// Wire via: router.resource('${prefix.replace(/^\\//, '')}', ${className})
// (not registerController — resource controllers use plain method names, no decorators.)
@Controller('${prefix}')
export class ${className} {
  async index   (_ctx: Context) { return [] }
  async create  (_ctx: Context) { /* render form */ }
  async store   (_ctx: Context) { /* persist */ }
  async show    (_ctx: Context) { /* render one */ }
  async edit    (_ctx: Context) { /* render edit form */ }
  async update  (_ctx: Context) { /* persist update */ }
  async destroy (_ctx: Context) { /* delete */ }
}
`
}
```

`--api` strips `create` + `edit`. `--singleton` keeps `show / edit / update`. CLI plumbing follows `_shared.ts`. Orthogonal — file separately if convenient.

### D.5 Tests (`packages/router/src/resource.test.ts` — new)

| Scenario | Assert |
|---|---|
| `router.resource('posts', PC)` full controller | 7 routes, names `posts.index/create/store/show/edit/update/destroy`, update also PATCH. |
| `router.apiResource('posts', PC)` | 5 routes; no `posts.create` / `posts.edit`. |
| `router.singleton('profile', PC)` | 3 routes (show/edit/update). |
| `.creatable()` | adds 2 (create, store). |
| `.destroyable()` | adds destroy. |
| `only: ['index','show']` | 2 routes. |
| `except: ['destroy']` | 6 routes. |
| Controller missing `edit()` | `posts.edit` silently skipped. |
| `parameters: { posts: 'article' }` | path is `/posts/:article`. |
| `middleware: [authMw]` | every route's chain contains `authMw`. |
| `names: { show: 'posts.detail' }` | named `posts.detail`. |
| Combine with `where*`: `builders[3].whereNumber('post')` | only `show` route gets `:post{[0-9]+}`. |
| Combine with `runWithGroup('web', …)` | all builders carry `group: 'web'`. |

CLI: `--resource`/`--api`/`--singleton` flags emit correct stub bodies.

---

## File touch list

- `packages/contracts/src/index.ts` — add `host?` + `missing?` to `RouteDefinition` (~6 lines).
- `packages/router/src/index.ts` — `where*` (~80) + `RouteBuilder.domain` (~5) + `Router.group()` + stack (~40) + `RouteBuilder.missing` + binding integration (~25) + `resource/apiResource/singleton` + helpers (~120). Total ~270.
- `packages/router/src/index.test.ts` — extend.
- `packages/router/src/resource.test.ts` — new.
- `packages/router/README.md` + CHANGELOG + changeset — minor.
- `packages/server-hono/src/index.ts` — `matchHost` (~25) + host gate (~10) + param merge (~3). Total ~40.
- `packages/server-hono/src/index.test.ts` — extend.
- `packages/server-hono/CHANGELOG + changeset` — patch.
- `packages/cli/src/commands/make/controller.ts` + CHANGELOG + changeset — patch.

Estimated: 1–1.5 days. Subdomain is the largest piece (~half).

---

## Out of scope (note for future plans)

- **Implicit model binding** (no `router.bind()` needed) — separate plan; `.missing()` will work transparently when it lands.
- **Route caching** (`Route::cache`) — pointless until startup shows up in profiling.
- **Nested resources** — `router.resource('users.posts', UserPostController)` → `/users/:user/posts/:post`. Trivial extension; defer until asked.
- **Stacking constraints across `group()`** — `group({ where: { id: '\\d+' } }, …)` applying to every route inside. Composition rule non-obvious; defer.
- **Constraint shortcuts on decorator controllers** — `where*` is fluent-only. `@Where('id', '\\d+')` decorator could come later.
- **Subdomain on decorator controllers** — `@Domain('admin.example.com')` deferred.
- **Route-name prefix in groups** (`as: 'admin.'`) — easy add, deferred.
- **Real inflector** for `singularize()` — keep router lean.

---

## Open questions

1. **`whereUuid` strictness** — any version (matches Laravel) vs v4-only. Plan ships any-version.
2. **`missing()` return-value branching** — Response/object/string handling duplicates the main-handler dispatch in server-hono. Consider lifting into a shared util.
3. **`update` PATCH alias** — both PUT and PATCH register; share name (last-write-wins on `namedRoutes`). Doesn't matter operationally — paths identical — but document.
4. **Group host nesting** — outer `':tenant.example.com'` + inner `'admin.:tenant.example.com'`: use inner verbatim, tenant resolves from inner template. Verify in test.
5. **`router.group()` vs `runWithGroup()`** — naming overlap. Keep `group()` for Laravel parity; rename internal `runWithGroup`/`currentGroup` → `runInWebApiTag`/`currentWebApiTag` only if user confusion appears in practice. Defer the rename.
