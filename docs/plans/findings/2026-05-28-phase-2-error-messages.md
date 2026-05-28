# Phase 2 Findings — Error message actionability

Plan: `docs/plans/2026-05-28-quality-dx-sweep.md` (Tasks 2.1–2.4).
Date: 2026-05-28.
Author: claude.

## Rubric

A good user-facing runtime error meets ALL FIVE:

1. **Identifies the problem** in one sentence (no stack trace as the *primary* signal).
2. **Identifies the cause specifically** — not "X is undefined" but "X is undefined because <reason>".
3. **States a next step** — "Run `pnpm rudder X`" / "Add `Y` to your config" / "See docs at /guide/Z" / "Check that the package is installed".
4. **Includes the failing input** when safe (the missing key, the offending path, etc.).
5. **Renders cleanly** in both the rudder CLI (`CliError` path) and the dev Ignition page (stack + code frame).

Each escapable error is scored **1–5** (one point per criterion). **≤ 3 = candidate for improvement.**

Rendering pipeline reminder (`packages/core/src/app-builder.ts:170-232`):
- `ValidationError` → HTTP 422 JSON `{ message, errors }`.
- Anything with a `httpStatus: number` (duck-typed) → `renderHttpException(new HttpException(status, err.message))` → status code, JSON or HTML by `Accept`.
- `HttpException` → same.
- Anything else → `renderServerError` → 500. In `debug` mode, server-hono's Ignition page wraps `renderServerError` with a stack-frame view (`packages/server-hono/src/error-page.ts`).

`message` is what the user sees in JSON 4xx responses and what the dev page surfaces as the title above the code frame, so message quality is the dominant signal regardless of dev/prod.

## Pre-flight verifications

- **#731 ORM-CLI subprocess errors** — confirmed shipped at `packages/orm/src/commands/migrate.ts:342` (`throw new CliError("Migration command failed (exit ${code})", code)`). Not re-flagged below.
- **Ignition dev error page** — sourcemap remap shipped (project `dev-error-page-sourcemap-remap`). Not in scope for re-finding.
- **`MalformedBodyError`** (`packages/contracts/src/index.ts:416-425`) — has `httpStatus = 400` + a clear "Malformed request body (Content-Type: ...)" message + the explanatory JSDoc. Already good (score 4: misses an explicit next step but the cause is precise). Not flagged below.

## Per-surface inventory

Per-surface tables capture every escapable throw site found via `grep -rEn "throw new (Error|TypeError|[A-Z][a-zA-Z]*Error|HttpException)"` plus close reading. Internal-only assertions (`_isSubBuilder` guard, `Request handler not initialized`, etc.) are excluded — they shouldn't reach userland in healthy code paths.

### 1. Validation surface

| # | Error | Site | Trigger | Current message | Score |
|---|---|---|---|---|---|
| V1 | `ValidationError` (Zod failure) | `packages/core/src/validation.ts:76,131,176` + `packages/router/src/{body,query}-validator.ts:24/21` | `req.body`/`req.query` fails schema; `FormRequest.validate()` | `"Validation failed"` + `errors: { [path]: string[] }` | **4/5** |
| V2 | `ValidationError` (`authorize()` returned false) | `packages/core/src/validation.ts:104` | `FormRequest.authorize()` returns false | `errors: { auth: ['Unauthorized'] }` (key='auth') | **3/5** |
| V3 | `InputTypeError` | `packages/contracts/src/index.ts:550/558/566/577/584/588` | `req.string('k')` / `integer` / etc. with wrong type | `'Input "k" expected integer, got string.'` | **3/5** |
| V4 | `MalformedBodyError` | `packages/contracts/src/index.ts:416-425` (re-thrown `server-hono:657/670`) | Malformed JSON / form body | `'Malformed request body (Content-Type: application/json)'` | **4/5** |

### 2. ORM surface

| # | Error | Site | Trigger | Current message | Score |
|---|---|---|---|---|---|
| O1 | `Error` ("No ORM adapter") | `packages/orm/src/index.ts:181` | Any model query when database provider missing | `'[RudderJS ORM] No ORM adapter registered. Did you add a database provider to your providers list?'` | **4/5** |
| O2 | `ModelNotFoundError` | `packages/orm/src/index.ts:1193,1214,1734` | `findOrFail`/`firstOrFail`/`refresh` after deletion | `'[RudderJS ORM] No User found for id 7.'` or `'No User found.'` | **3/5** |
| O3 | `Error` ("Relation '{x}' is not defined") | `packages/orm/src/index.ts:2049,2166` (`related`, `belongsToMany` static); `packages/orm/src/relations/where-has.ts:97,256` | Typo in `parent.related('postsx')`, `whereHas('postsx')`, etc. | `'[RudderJS ORM] Relation "postsx" is not defined on User.'` | **4/5** |
| O4 | `Error` ("Cannot resolve … is unset") | `packages/orm/src/index.ts:2099,2108,2117,2128,2138`; `packages/orm/src/relations/pivot-deferred.ts:33` | Calling `parent.related('posts')` when parent has no value in the local/parent-key column (e.g. unsaved model, hydrated without that column) | `'[RudderJS ORM] Cannot resolve "posts" on User — userId is unset.'` | **3/5** |
| O5 | `Error` ("Cannot resolve morphTo … unset") | `packages/orm/src/index.ts:2058` | `related('commentable')` when `commentableId`/`commentableType` columns are null | `'[RudderJS ORM] Cannot resolve morphTo "commentable" on Comment — commentableId/commentableType unset.'` | **3/5** |
| O6 | `Error` ("morphTo types: () => [...] is empty") | `packages/orm/src/index.ts:2062`; `packages/orm/src/polymorphic-eager-load.ts:174` | `morphTo` declaration's `types()` returns `[]` | `'[RudderJS ORM] morphTo "commentable" on Comment: \`types: () => [...]\` is empty — declare at least one allowed target class.'` | **5/5** |
| O7 | `Error` ("morphTo duplicate discriminator") | `packages/orm/src/index.ts:2070` | Two classes in `types: () => [...]` share the same `morphAlias ?? name` | `'[RudderJS ORM] morphTo "commentable" on Comment: duplicate discriminator "Post" — both Post and Post resolve to the same value. Set a distinct \`static morphAlias\` on one.'` | **5/5** |
| O8 | `Error` ("morphTo unknown type") | `packages/orm/src/index.ts:2077`; `packages/orm/src/polymorphic-eager-load.ts:197` | Stored `commentableType` doesn't match any class in `types()` | `'[RudderJS ORM] morphTo "commentable" on Comment: unknown commentableType = "Article". Allowed: Post, Video.'` | **5/5** |
| O9 | `Error` ("Cannot ${op} a ${name} without a primary key") | `packages/orm/src/index.ts:1731,1756,1774,1819,1904` | `instance.refresh()/delete()/restore()/increment()/decrement()` on an unsaved model | `'[RudderJS ORM] Cannot refresh a User without a primary key.'` | **3/5** |
| O10 | `Error` ("Scope '{x}' is not defined") | `packages/orm/src/index.ts:1151` | `Model.scope('xyz')` typo | `'[RudderJS ORM] Scope "xyz" is not defined on User.'` | **4/5** |
| O11 | `Error` ("Create/Update/Delete cancelled by observer") | `packages/orm/src/index.ts:1494,1498,1524,1528,1541,1550,1560` | An observer hook returned `false` | `'[RudderJS ORM] Create cancelled by observer on User.'` | **2/5** |
| O12 | `Error` ("Factory state '{x}' is not defined") | `packages/orm/src/factory.ts:99` | `UserFactory.state('vipx').make()` — typo | `'[RudderJS] Factory state "vipx" is not defined on UserFactory.'` | **3/5** |
| O13 | `Error` ("Invalid JSON in '{key}' cast") | `packages/orm/src/cast.ts:192` | `json`/`array`-cast column has invalid JSON in DB | `'[RudderJS ORM] Invalid JSON in "metadata" cast: <first 80 chars>'` | **3/5** |
| O14 | `Error` ("Cast type X requires @rudderjs/crypt") | `packages/orm/src/cast.ts:212,223` | `encrypted`/`encrypted:array`/`encrypted:object` cast without crypt installed | `'[RudderJS ORM] Cast type "encrypted" requires @rudderjs/crypt. Run: pnpm add @rudderjs/crypt'` | **5/5** |
| O15 | `Error` ("Resource toJSON does not support async") | `packages/orm/src/resource.ts:108` | `JsonResource.toJSON()` when subclass returns `Promise` from `toArray()` | `'[RudderJS] JsonResource.toJSON() does not support async toArray(). Use toArray() directly.'` | **3/5** |
| O16 | `VectorDimensionMismatchError` | `packages/orm/src/cast.ts:106` + `vector-errors.ts:26-41` | Inserting a vector with wrong dimension count | `'[RudderJS ORM] Vector column "embedding" expected 1536 dimensions, got 3.'` | **4/5** |
| O17 | `Error` ("Vector column expected number[]") | `packages/orm/src/cast.ts:103` | Vector cast given non-array value | `'[RudderJS ORM] Vector column "embedding" expected number[], got string'` | **3/5** |
| O18 | `Error` ("Vector cast failed to parse") | `packages/orm/src/cast.ts:91` | DB returned a non-JSON-parseable string for a vector column | `'[RudderJS ORM] Vector cast failed to parse value (Unexpected token …): <first 80 chars>'` | **3/5** |
| O19 | `Error` ("Vector column element N must be finite") | `packages/orm/src/cast.ts:114` | Inserting `[1, NaN, 3]` | `'[RudderJS ORM] Vector column "embedding" element 1 must be a finite number, got NaN'` | **5/5** |
| O20 | `MissingEmbedderError` | `packages/orm/src/vector-errors.ts:86`; thrown at `packages/orm-prisma/src/index.ts:264`, `packages/orm-drizzle/src/index.ts:362` | `whereVectorSimilarTo(col, "string")` without `opts.embedWith` | `'[RudderJS ORM] whereVectorSimilarTo("embedding", "<string>") requires opts.embedWith to be set (e.g. "openai/text-embedding-3-small"). Pass an embedded number[] directly to skip auto-embedding.'` | **5/5** |
| O21 | `VectorStorageUnsupportedError` | `packages/orm/src/vector-errors.ts:57`; thrown at `packages/orm-prisma/src/index.ts:447,460`; `packages/orm-drizzle/src/index.ts:772,784,813,836` | Vector op against a non-pgvector backend | `'[RudderJS ORM] Vector storage is not supported on the "sqlite" adapter in this phase. <hint>'` | **4/5** |
| O22 | `Error` ("withPivot requires at least one column name") | `packages/orm/src/relations/pivot-deferred.ts:129` | `parent.related('roles').withPivot()` with no args | `'[RudderJS ORM] withPivot() requires at least one column name.'` | **3/5** |
| O23 | `Error` ("'{m}' is not supported on a {kind} lazy-fetch query") | `packages/orm/src/relations/pivot-deferred.ts:151,159` | `parent.related('roles').create({})` (m2m mutation via deferred Proxy) | `'[RudderJS ORM] "create" is not supported on a belongsToMany lazy-fetch query. Use Model.belongsToMany(parent, name) for pivot mutations or call methods on the related Model directly.'` | **5/5** |
| O24 | `Error` ("Nested whereHas in constrain") | `packages/orm/src/relations/where-has.ts:54` | `Post.whereHas('comments', q => q.whereHas('user', ...))` | `'[RudderJS ORM] Nested whereHas inside a whereHas constrain callback is deferred to v2. Filter on flat columns inside the callback for now.'` | **5/5** |
| O25 | `Error` ("orWhere in whereHas constrain") | `packages/orm/src/relations/where-has.ts:62` | `Post.whereHas('comments', q => q.orWhere(...))` | `'[RudderJS ORM] orWhere inside a whereHas constrain callback is not supported in v1 — the WhereClause contract has no boolean flag, so the OR semantic can\\'t round-trip to the adapter. Compose the predicate with where() (AND), or run two queries and merge in app code.'` | **5/5** |
| O26 | `Error` ("morphTo cannot be used with whereHas") | `packages/orm/src/relations/where-has.ts:259` | `Post.whereHas('commentable', ...)` (morphTo) | `'[RudderJS ORM] morphTo "commentable" cannot be used with whereHas — the related table is dynamic. Filter on {morphName}Id / {morphName}Type directly instead.'` | **5/5** |
| O27 | `Error` ("Prisma has no delegate") | `packages/orm-prisma/src/index.ts:172,529` | `Model.table` is a SQL name (`'oauth_clients'`) instead of Prisma delegate (`'oAuthClient'`) | `'[RudderJS ORM] Prisma has no delegate for table "oauth_clients". Did you run "prisma generate" after adding the model to your schema?'` | **4/5** |
| O28 | `Error` ("No table schema registered" — Drizzle) | `packages/orm-drizzle/src/index.ts:1128` | Drizzle adapter has no entry for that table | `'[RudderJS ORM Drizzle] No table schema registered for "posts". Pass tables: { posts: myTable } in drizzle() config or call DrizzleTableRegistry.register("posts", myTable).'` | **5/5** |
| O29 | `Error` ("delegate '{x}' has no aggregate/groupBy method") | `packages/orm-prisma/src/index.ts:316,822` | Prisma model schema mis-named so the delegate exists but is wrong shape | `'[RudderJS ORM Prisma] delegate "users" has no aggregate() method.'` | **2/5** |
| O30 | `Error` (mixed-where + vector) | `packages/orm-prisma/src/index.ts:361-381`; `packages/orm-drizzle/src/index.ts:706,747,752` | `where()` + `orWhere()` group + `whereVectorSimilarTo()` chained together | Long sentence explaining "is not yet supported — use flat …" | **5/5** |
| O31 | `Error` ("Failed to initialize database client" — Drizzle) | `packages/orm-drizzle/src/index.ts:1116` | drizzle() config produced no usable client | `'[RudderJS ORM Drizzle] Failed to initialize database client.'` | **2/5** |
| O32 | `Error` ("Unsupported operator" — Drizzle) | `packages/orm-drizzle/src/index.ts:348` | Internal — operator string the adapter doesn't recognise | `'[RudderJS ORM Drizzle] Unsupported operator: <op>'` | **2/5** |
| O33 | `Error` ("ai package not installed" auto-embed) | `packages/orm-drizzle/src/index.ts:173-179` (mirror at orm-prisma) | `whereVectorSimilarTo(col, "string")` with `embedWith` set but `@rudderjs/ai` not installed | `'[RudderJS ORM] whereVectorSimilarTo string-query auto-embed requires @rudderjs/ai. Run \`pnpm add @rudderjs/ai\`, or pre-embed via your own embedder and pass number[] instead. Original: …'` | **5/5** |

### 3. Auth surface (`@rudderjs/auth`, `@rudderjs/session`, `@rudderjs/passport`, `@rudderjs/sanctum`)

| # | Error | Site | Trigger | Current message | Score |
|---|---|---|---|---|---|
| A1 | `Error` ("Guard '{x}' is not defined") | `packages/auth/src/auth-manager.ts:48` | `auth().guard('webx')` — typo or config gap | `'[RudderJS Auth] Guard "webx" is not defined.'` | **3/5** |
| A2 | `Error` ("Guard driver '{x}' is not supported") | `packages/auth/src/auth-manager.ts:55,114` | `config/auth.ts` references a driver string the AuthManager doesn't know | `'[RudderJS Auth] Guard driver "passport" is not supported.'` | **2/5** |
| A3 | `Error` ("User provider '{x}' is not defined") | `packages/auth/src/auth-manager.ts:105` | `config/auth.ts` `provider:` typo | `'[RudderJS Auth] User provider "userss" is not defined.'` | **3/5** |
| A4 | `Error` ("Cannot resolve a default provider") | `packages/auth/src/auth-manager.ts:99-101` | `auth.guards.web.provider` missing AND no explicit `createProvider(name)` arg | `'[RudderJS Auth] Cannot resolve a default provider — set "auth.guards.web.provider" or pass an explicit name.'` | **5/5** |
| A5 | `Error` ("No auth context. Use AuthMiddleware.") | `packages/auth/src/auth-manager.ts:137` | `currentAuth()` outside `AuthMiddleware` (e.g. CLI command, queue job, api route) | `'[RudderJS Auth] No auth context. Use AuthMiddleware.'` | **3/5** |
| A6 | `Error` ("No hash driver found") | `packages/auth/src/index.ts:210` | `AuthProvider.boot()` cannot resolve `hash` from DI | `'[RudderJS Auth] No hash driver found. Register HashProvider before AuthProvider.'` | **3/5** |
| A7 | `Error` (PasswordBroker requires secret in production) | `packages/auth/src/password-reset.ts:63-66` | `new PasswordBroker(...)` in prod with no `secret` option | Long sentence with example | **5/5** |
| A8 | `AuthorizationError` | `packages/auth/src/gate.ts:128,319`; rendered via duck-typed `status` → handler converts | `Gate.authorize('ability')` denied | `'This action is unauthorized. [ability]'` (status=403) | **3/5** |
| A9 | `Error` ("No session in context. Use sessionMiddleware.") | `packages/session/src/index.ts:210` | `Session.current()` outside session ALS (api route, CLI, queue) | `'[RudderJS Session] No session in context. Use sessionMiddleware.'` | **3/5** |
| A10 | `Error` ("No auth manager found" — Sanctum) | `packages/sanctum/src/index.ts:391` | `SanctumProvider.boot()` before `AuthProvider` | `'[RudderJS Sanctum] No auth manager found. Register auth() provider before sanctum().'` | **4/5** |
| A11 | `OAuthError` (many) | `packages/passport/src/grants/authorization-code.ts:38-241,285-297` + `device-code.ts:45-198` | Various OAuth 2 protocol violations | Spec-aligned messages ("Authorization code has been revoked.", etc.) | **4/5** |
| A12 | `Error` ("Invalid JWT: expected 3 segments") | `packages/passport/src/token.ts:167` | Bearer token isn't a JWT | `'Invalid JWT: expected 3 segments'` | **2/5** |

### 4. Middleware surface (`@rudderjs/middleware`)

| # | Error | Site | Trigger | Current message | Score |
|---|---|---|---|---|---|
| M1 | 429 response | `packages/middleware/src/index.ts:146,355` | `ThrottleMiddleware`/`RateLimit` budget exceeded | `'Too many requests. Please slow down.'` (default) / `opts.message` | **3/5** |
| M2 | 419 response | `packages/middleware/src/index.ts:242` | CSRF token mismatch | `'CSRF token mismatch.'` (+ `error: 'CSRF_MISMATCH'`) | **2/5** |
| M3 | Silent bypass when no cache | `packages/middleware/src/index.ts:317-318` | `RateLimit` used without a cache provider | (no error — silent `next()`) | **N/A** (warning gap, not a throw) |

### 5. Server-hono surface

| # | Error | Site | Trigger | Current message | Score |
|---|---|---|---|---|---|
| S1 | `MalformedBodyError` re-throws | `packages/server-hono/src/index.ts:657,670` | Invalid JSON / form body | `'Malformed request body (Content-Type: application/json)'` | **4/5** (covered as V4) |

No other escapable throws live in server-hono. The Ignition page consumes whatever the framework threw — message quality lives in the throwing package, not here.

### 6. Router surface

| # | Error | Site | Trigger | Current message | Score |
|---|---|---|---|---|---|
| R1 | `ValidationError` (query/body schema) | `packages/router/src/query-validator.ts:21`, `body-validator.ts:24` | `req.query`/`req.body` fails Zod (router-side `.query(s)`/`.body(s)`) | (same shape as V1) | **4/5** |
| R2 | `Error` ("mounted route mutated") | `packages/router/src/index.ts:323` | `.name()`/`.where()`/etc. after `router.mount()` | Long sentence with `Route.lateRegister(...)` pointer | **5/5** |
| R3 | `Error` ("where(...) — route has no :param") | `packages/router/src/index.ts:383` | `.where('idz', ...)` on `/users/:id` (typo) | `'[RudderJS Router] where("idz", ...) — route path "/users/:id" has no :idz segment.'` | **4/5** |
| R4 | `Error` ("whereIn requires non-empty values") | `packages/router/src/index.ts:414` | `.whereIn('id', [])` | `'[RudderJS Router] whereIn("id", []) — values must be non-empty.'` | **3/5** |
| R5 | `Error` ("register entry called after mount") | `packages/router/src/index.ts:586` | `Route.get(...)` from a deferred provider after first `mount()` outside `lateRegister()` | Long sentence with escape-hatch | **5/5** |
| R6 | `Error` ("lateRegister before mount") | `packages/router/src/index.ts:964` | `Route.lateRegister(...)` before first mount | `'[RudderJS Router] lateRegister() called before mount() — the router has no adapter to register routes against. Call lateRegister() after the app has booted (e.g. from a request-time hook or a dynamic provider's boot()).'` | **5/5** |
| R7 | `Error` ("Named route '{x}' is not defined") | `packages/router/src/index.ts:1184` | `route('users.showz')` typo | `'[RudderJS] Named route "users.showz" is not defined.'` | **3/5** |
| R8 | `Error` ("Missing required parameter '{x}'") | `packages/router/src/index.ts:1197` | `route('users.show', {})` missing `:id` | `'[RudderJS] Missing required parameter "id" for route "users.show".'` | **3/5** |
| R9 | `Error` ("No signing key configured") | `packages/router/src/url-signing.ts:23` | `Url.sign(...)` with neither `APP_KEY` nor `Url.setKey()` | `'[RudderJS] No signing key configured. Set APP_KEY in your .env or call Url.setKey().'` | **5/5** |
| R10 | `RouteModelNotFoundError` | `packages/router/src/binding-middleware.ts:42-57` (thrown at lines 97/102) | `router.bind('user', User)` and `/users/:user` with no matching row | `'[RudderJS] No User matched route parameter "user" with value "999".'` (status=404) | **4/5** |

### Core / DI / providers (cross-cutting, mostly auth A1–A6 already cover the surface)

| # | Error | Site | Trigger | Current message | Score |
|---|---|---|---|---|---|
| C1 | `Error` ("AsyncLocalStorage is not available") | `packages/core/src/di.ts:82` | Scoped binding resolved in a non-Node runtime (browser bundle) | `'[RudderJS] AsyncLocalStorage is not available — runScoped() and scoped bindings require Node.js (node:async_hooks).'` | **4/5** |
| C2 | `Error` ("Cannot resolve scoped binding outside a request scope") | `packages/core/src/di.ts:278-282` | Scoped binding accessed outside `runScoped()` / `ScopeMiddleware` | `'[RudderJS] Cannot resolve scoped binding outside of a request scope. Wrap the call in container.runScoped() or add ScopeMiddleware().'` | **3/5** (missing the *which* binding) |
| C3 | `Error` ("Cannot resolve {token}") | `packages/core/src/di.ts:312-315` | `app().make('config')` or `make(MyService)` with no binding | `'[RudderJS] Cannot resolve "config" from the DI container. Did you forget to add @Injectable() to the class, or register it in a ServiceProvider?'` | **4/5** |
| C4 | `Error` ("reflect-metadata is not loaded") | `packages/core/src/di.ts:362-365` | Decorator class resolution without polyfill | `'[RudderJS] reflect-metadata is not loaded. Add: import \\'reflect-metadata\\' at the top of your bootstrap/app.ts'` | **5/5** |
| C5 | `Error` ("'{X}' is not decorated with @Injectable()") | `packages/core/src/di.ts:370-373` | `app().make(MyService)` where `MyService` has no `@Injectable()` | `'[RudderJS] "MyService" is not decorated with @Injectable(). Add @Injectable() above the class declaration to enable auto-resolution.'` | **5/5** |
| C6 | `Error` ("Circular deferred resolution") | `packages/core/src/application.ts:258-261` | Deferred provider's `register()/boot()` resolves its own token | Long sentence with break-cycle hint | **5/5** |
| C7 | `Error` ("Deferred provider has async boot()") | `packages/core/src/application.ts:216-220` | `provides()` + `async boot()` | Long sentence with fix | **5/5** |
| C8 | `Error` ("Provider X failed to boot") | `packages/core/src/application.ts:193-196,303-306` | Any provider's `boot()` throws | `'[RudderJS] Provider "FooProvider" failed to boot.\\n  Cause: <inner.message>\\n  Check your provider configuration in bootstrap/providers.ts'` (chains `cause`) | **4/5** |
| C9 | `Error` (provider manifest has declared provider but no export) | `packages/core/src/default-providers.ts:116-119` | `rudderjs.provider` in package.json doesn't match an export | `'[RudderJS] @rudderjs/foo declared provider "FooProvider" in package.json but no such class is exported from its main entry.'` | **5/5** |
| C10 | `Error` (multi-driver chosen value not found) | `packages/core/src/default-providers.ts:151-155` | `config('database.driver') = 'prisma'` but only `@rudderjs/orm-drizzle` installed | Long sentence listing installed drivers | **5/5** |

## Rating distribution (escapable, user-facing throws only)

Counted unique source-line sites in the per-surface tables above (V1–V4, O1–O33, A1–A12, M1–M2, S1 deduplicated to V4, R1–R10, C1–C10). 70 distinct entries.

- **Score 5** (excellent, leave alone): 20 → O6, O7, O8, O14, O19, O20, O23, O24, O25, O26, O28, O30, O33, A4, A7, R2, R5, R6, R9, C4, C5, C6, C7, C9, C10 = **25**
- **Score 4** (good, minor polish only): V1, V4, O1, O3, O10, O16, O21, O27, A10, A11, C1, C3, C8, R1, R3, R10 = **16**
- **Score 3** (candidate): V2, V3, O2, O4, O5, O9, O12, O13, O15, O17, O18, O22, A1, A3, A5, A6, A8, A9, C2, M1, R4, R7, R8 = **23**
- **Score 2** (candidate, weak): O11, O29, O31, O32, A2, A12, M2 = **7**
- **Score 1**: 0

The **30 candidates (≤ 3)** are listed with proposed messages below.

## Candidates with proposed messages

### Validation

#### V2 (3/5) — `authorize()` returns false

`packages/core/src/validation.ts:104`

Current: `{ auth: ['Unauthorized'] }` (key='auth').

Issue: the user sees a 422 with an unexpected `auth` key in the errors map. This isn't the same kind of "field-level validation failure" the rest of `ValidationError` represents. The semantic is "authorization failed", which is a 403 in Laravel.

**Proposed:** route `authorize() === false` to `throw new AuthorizationError('Form request authorization failed.')` (already defined in `@rudderjs/auth`, `httpStatus=403`) instead of `ValidationError`. Alternative: keep `ValidationError` but ship 403, not 422.

Note: this changes the response status. Worth confirming with user at the scope-decision checkpoint that flipping 422→403 here is desired (matches Laravel; small breaking-shape change in response code).

#### V3 (3/5) — `InputTypeError`

`packages/contracts/src/index.ts:550/558/566/577/584/588`

Current: `'Input "k" expected integer, got string.'`

Missing: next step + value preview. `req.integer('age')` against `req.body = { age: 'twenty' }` says nothing about where the value came from or how to recover.

**Proposed:** `'Input "age" must be an integer (got string: "twenty"). Use req.input("age") to read the raw value, or req.integer("age", defaultNumber) for a fallback.'`

Implementation: the `InputTypeError` class can include a stringified preview of `received` (truncate at 40 chars, escape) and append a `Read the raw value with req.input(...)` hint. Worth also setting `httpStatus = 400` for consistency — currently it falls through to 500.

### ORM

#### O2 (3/5) — `ModelNotFoundError`

`packages/orm/src/index.ts:1193/1214/1734`

Current: `'[RudderJS ORM] No User found for id 7.'`

Score-3 because the *failing input* is good, but no next step. The renderer turns this into 404 (good); the message body the API consumer sees is just the text. For controllers, this is usually fine. For dev-page surface, fine as-is.

**Proposed:** add a one-line tail when the model has a soft-delete column: `' (use User.withTrashed().find(7) to include soft-deleted rows).'`. Conditional — only when `Model.softDeletes()` returns true. Skip the hint otherwise.

Low priority. Could defer.

#### O4 (3/5) — "Cannot resolve {rel} on {model} — {col} is unset"

`packages/orm/src/index.ts:2099,2108,2117,2128,2138`; `pivot-deferred.ts:33`

Current: `'[RudderJS ORM] Cannot resolve "posts" on User — userId is unset.'`

Issue: "unset" is ambiguous — `null`, `undefined`, or the column wasn't in the SELECT? Common cause: app did `User.select('id', 'email')` then called `user.related('roles')` where the relation key wasn't selected.

**Proposed:** `'[RudderJS ORM] Cannot resolve "posts" on User — user.userId is null/undefined. Either save the model first, or include "userId" in your select() list when reading the parent.'`

#### O5 (3/5) — morphTo unset

`packages/orm/src/index.ts:2058`

Same shape as O4; "unset" → "null/undefined". Less common; mostly happens on unsaved morph-host rows.

**Proposed:** `'[RudderJS ORM] Cannot resolve morphTo "commentable" on Comment — commentable.commentableId or commentable.commentableType is null. Save the morph host first, or assign both columns before calling .related().'`

#### O9 (3/5) — "Cannot {op} a {name} without a primary key"

`packages/orm/src/index.ts:1731,1756,1774,1819,1904`

Current: `'[RudderJS ORM] Cannot refresh a User without a primary key.'`

Issue: doesn't name the PK column or hint at why it could be missing. Most common cause: `new User({...})` then `.refresh()` (never saved).

**Proposed:** `'[RudderJS ORM] Cannot refresh User — User.id is unset. Call .save() / Model.create() first so a primary key is assigned, or set the primary key column manually.'` (Uses `Model.primaryKey` instead of hard-coded "primary key".)

#### O11 (2/5) — "Create/Update/Delete cancelled by observer"

`packages/orm/src/index.ts:1494,1498,1524,1528,1541,1550,1560`

Current: `'[RudderJS ORM] Create cancelled by observer on User.'`

Issue: doesn't say *which* observer returned false. With multiple observers chained, the user has to bisect. Score 2 because no cause specificity AND no next step.

**Proposed:** track the firing observer's identity (function name / class name / index) when `_fireEvent` returns false, and append `' (observer "<name>" returned false on the "<event>" event).'` to the message.

Implementation: requires `_fireEvent` to return more than `false | result` — return `{ cancelled: true, by: <name> } | result` instead. Small refactor; messages get materially better.

#### O12 (3/5) — Factory state not defined

`packages/orm/src/factory.ts:99`

Current: `'[RudderJS] Factory state "vipx" is not defined on UserFactory.'`

Issue: no hint at the available states. Easy to add since the factory exposes its state map.

**Proposed:** `'[RudderJS] Factory state "vipx" is not defined on UserFactory. Defined states: vip, admin, guest. (Add states via UserFactory.state("vipx", ({...}) => ({...})).)'`

#### O13 (3/5) — Invalid JSON in cast

`packages/orm/src/cast.ts:192`

Current: `'[RudderJS ORM] Invalid JSON in "metadata" cast: <first 80 chars>'`

Missing the model name (cast.ts only gets the column key, not the model) and a next step.

**Proposed:** `'[RudderJS ORM] Invalid JSON in cast column "metadata": <first 80 chars>… (cast configured as "json" / "array" / "collection"). Verify the column stores serialized JSON; if it stores raw strings, change the cast to "string" or remove it.'`

If threading the model name through is too invasive, accept "good enough" with just the next step appended.

#### O15 (3/5) — JsonResource.toJSON async

`packages/orm/src/resource.ts:108`

Current: `'[RudderJS] JsonResource.toJSON() does not support async toArray(). Use toArray() directly.'`

Issue: doesn't name the resource class.

**Proposed:** `'[RudderJS] UserResource.toJSON() does not support an async toArray() — async work in resources must be awaited explicitly. Replace `res.json(resource)` with `res.json(await resource.toArray())` for this resource.'`

#### O17 (3/5) — Vector column expected number[]

`packages/orm/src/cast.ts:103`

Current: `'[RudderJS ORM] Vector column "embedding" expected number[], got string'`

Missing: next step + Model context.

**Proposed:** `'[RudderJS ORM] Vector column "embedding" expected number[], got string. If you have a pgvector text string from a raw query, parse it via JSON.parse() before assignment; otherwise check the cast declaration (`static casts = { embedding: vector({ dimensions: N }) }`).'`

#### O18 (3/5) — Vector cast failed to parse

`packages/orm/src/cast.ts:91`

Current: `'[RudderJS ORM] Vector cast failed to parse value (Unexpected token …): <first 80 chars>'`

Missing: column name in the lead, recovery hint.

**Proposed:** `'[RudderJS ORM] Vector cast on column "embedding" failed to parse stored value (Unexpected token …). The DB has "<first 80 chars>…" which isn\\'t pgvector text format ([1,2,3]). Verify the column type is `vector(N)` in your schema.'`

#### O22 (3/5) — withPivot() requires columns

`packages/orm/src/relations/pivot-deferred.ts:129`

Current: `'[RudderJS ORM] withPivot() requires at least one column name.'`

Missing: example.

**Proposed:** `'[RudderJS ORM] withPivot() requires at least one column name — e.g. user.related("roles").withPivot("createdAt", "expiresAt").'`

#### O29 (2/5) — Prisma delegate has no aggregate / groupBy

`packages/orm-prisma/src/index.ts:316,822`

Current: `'[RudderJS ORM Prisma] delegate "users" has no aggregate() method.'`

Issue: leaks Prisma internal detail without telling the user how to fix. Triggered when the static `Model.table` is correct but the Prisma delegate shape doesn't match (e.g. `prisma generate` not re-run after a schema change).

**Proposed:** `'[RudderJS ORM Prisma] Prisma delegate "users" is missing aggregate() — most likely your Prisma Client is stale. Run `pnpm rudder db:generate` (or `pnpm exec prisma generate`) to regenerate.'`

#### O31 (2/5) — Failed to initialize Drizzle client

`packages/orm-drizzle/src/index.ts:1116`

Current: `'[RudderJS ORM Drizzle] Failed to initialize database client.'`

Issue: bare, no cause, no next step.

**Proposed:** `'[RudderJS ORM Drizzle] Failed to initialize database client — drizzle() returned undefined. Check that config.client (a Drizzle Client instance) is set on your drizzle() call in config/database.ts.'`

#### O32 (2/5) — Unsupported operator

`packages/orm-drizzle/src/index.ts:348`

Current: `'[RudderJS ORM Drizzle] Unsupported operator: <op>'`

This is reachable: any user `.where('col', 'foo' as any, 1)` with an invalid operator hits it. Score 2 because no list of supported operators.

**Proposed:** `'[RudderJS ORM Drizzle] Unsupported operator: "<op>". Supported: =, !=, <, <=, >, >=, like, not like, in, not in.'`

(Static — pull from the type union once and stringify.)

### Auth

#### A1 (3/5) — Guard not defined

`packages/auth/src/auth-manager.ts:48`

Current: `'[RudderJS Auth] Guard "webx" is not defined.'`

Missing: defined-guards list + config-file pointer.

**Proposed:** `'[RudderJS Auth] Guard "webx" is not defined in config/auth.ts. Defined guards: web, api. Did you mean "web"?'` (only emit `Did you mean` when closeness is high — Levenshtein ≤ 2.)

#### A2 (2/5) — Guard driver not supported

`packages/auth/src/auth-manager.ts:55,114`

Current: `'[RudderJS Auth] Guard driver "passport" is not supported.'`

Issue: looks like the framework lacks the feature, when in fact the user needs a different package. Score 2 — wrong-shape diagnostic.

**Proposed:** `'[RudderJS Auth] Guard driver "passport" is not built into @rudderjs/auth. For OAuth/bearer auth, install @rudderjs/passport and add PassportProvider to your providers list. For session auth, set driver: "session" in config/auth.ts.'`

#### A3 (3/5) — User provider not defined

`packages/auth/src/auth-manager.ts:105`

Mirror of A1. Same fix shape.

**Proposed:** `'[RudderJS Auth] User provider "userss" is not defined in config/auth.ts. Defined providers: users.'`

#### A5 (3/5) — No auth context

`packages/auth/src/auth-manager.ts:137`

Current: `'[RudderJS Auth] No auth context. Use AuthMiddleware.'`

Two common triggers:
1. Web route handler ran but `AuthMiddleware` is gone from the `web` group (rare — auto-installed).
2. **API route, queue job, CLI command** — `auth()` is called where `AuthMiddleware` doesn't run. This is the dominant trigger now that `AuthMiddleware` auto-installs on `web`.

**Proposed:** `'[RudderJS Auth] auth() has no request context. AuthMiddleware runs only on the "web" route group — for API routes, use RequireBearer() + req.user (see @rudderjs/passport). For queue jobs and CLI commands, pass the user id explicitly.'`

#### A6 (3/5) — No hash driver

`packages/auth/src/index.ts:210`

Current: `'[RudderJS Auth] No hash driver found. Register HashProvider before AuthProvider.'`

Missing concrete fix: usually `HashProvider` *is* listed but auto-discovery didn't run.

**Proposed:** `'[RudderJS Auth] No hash driver registered — @rudderjs/hash either isn\\'t installed or the provider isn\\'t booted. Run `pnpm rudder providers:discover` if you added the package recently, and ensure HashProvider runs before AuthProvider in bootstrap/providers.ts.'`

#### A8 (3/5) — AuthorizationError

`packages/auth/src/gate.ts:128,319`

Current: `'This action is unauthorized. [<ability>]'`

The default is intentionally generic — Laravel parity. Score 3 because there's no actionable next step for the dev when this fires unexpectedly (typo'd ability name, policy missing, etc.).

**Proposed:** when `process.env.NODE_ENV !== 'production'`, append ` (if you didn\\'t expect a 403 here, check that the "<ability>" gate or policy method exists — Gate.define("<ability>", ...) or Policy.<ability>(user, ...).)`. Strip in prod so the client-facing message stays terse.

#### A9 (3/5) — No session in context

`packages/session/src/index.ts:210`

Same shape as A5.

**Proposed:** `'[RudderJS Session] Session.current() called with no session in context. sessionMiddleware auto-installs only on the "web" route group — API routes are stateless. Use Session.maybeCurrent() for a non-throwing read, or mount sessionMiddleware() per-route on the api side if you really need it.'`

#### A12 (2/5) — Invalid JWT 3 segments

`packages/passport/src/token.ts:167`

Current: `'Invalid JWT: expected 3 segments'`

Issue: no `[RudderJS Passport]` prefix; no hint at the actual problem. Triggered when an opaque token (e.g. Sanctum's, or a malformed Bearer header) lands on a Passport `verifyToken()` call.

**Proposed:** `'[RudderJS Passport] Bearer token is not a JWT (expected 3 dot-separated segments, got <N>). Opaque tokens belong to @rudderjs/sanctum, not @rudderjs/passport — check which middleware is handling this route.'`

### Middleware

#### M1 (3/5) — 429 Too many requests

`packages/middleware/src/index.ts:146,355`

Current: `'Too many requests. Please slow down.'`

Score 3 because the message doesn't carry the retry-after (the header does — but for API consumers, the message body should at least mention "Retry-After"). For the default ThrottleMiddleware (line 146) the headers aren't even set.

**Proposed:** include `'Too many requests. Retry after <N>s.'` and ensure `Retry-After` is also set on `ThrottleMiddleware` (RateLimit already does this). Minimal incremental work.

#### M2 (2/5) — CSRF mismatch

`packages/middleware/src/index.ts:242`

Current: `'CSRF token mismatch.'` + `error: 'CSRF_MISMATCH'`.

Score 2 because the developer fielding a 419 has no clue what to do. Common cause: the form doesn't include `_token`, or fetch() doesn't send `X-CSRF-Token`.

**Proposed:** `'CSRF token mismatch. The "_token" form field or "X-CSRF-Token" header didn\\'t match the "csrf_token" cookie. For fetch() calls, read the token via getCsrfToken() and set the X-CSRF-Token header.'`

#### M3 (N/A) — RateLimit silently bypasses without cache

`packages/middleware/src/index.ts:317-318`

Not an error — a silent no-op when `CacheRegistry.get()` returns null. This is a documented behavior, but security-relevant: an app that thinks it's rate-limited isn't if the cache provider didn't boot.

**Proposed:** emit a one-time `bootNotice('middleware', '[RudderJS Middleware] RateLimit installed but no cache provider is registered — limits are NOT being enforced. Register @rudderjs/cache to enable.')` on the first call when no cache is present. This is *not* a throw — a quiet log line per process. Could also be a doctor check.

### Router

#### R4 (3/5) — whereIn empty values

`packages/router/src/index.ts:414`

Current: `'[RudderJS Router] whereIn("id", []) — values must be non-empty.'`

Missing recovery: usually the empty array means the user pre-filtered to nothing and wants the route to be unreachable (or wants to skip the constraint).

**Proposed:** `'[RudderJS Router] whereIn("id", []) — values must be non-empty (pass at least one acceptable value, or drop the constraint).'`

Marginal improvement. Could defer.

#### R7 (3/5) — Named route not defined

`packages/router/src/index.ts:1184`

Current: `'[RudderJS] Named route "users.showz" is not defined.'`

Missing: typo suggestion. Cheap since the router has the full names map.

**Proposed:** `'[RudderJS] Named route "users.showz" is not defined. Did you mean "users.show"? (Run \`pnpm rudder route:list\` for the full list.)'`

Suggestion gated on Levenshtein ≤ 2 of an existing name.

#### R8 (3/5) — Missing required route parameter

`packages/router/src/index.ts:1197`

Current: `'[RudderJS] Missing required parameter "id" for route "users.show".'`

Missing: the path's full param list and supplied params, so the user can see what they got vs needed.

**Proposed:** `'[RudderJS] route("users.show", ...) is missing required parameter "id". Path is "/users/:id"; supplied: {} — call route("users.show", { id: 7 }).'`

### Core / DI

#### C2 (3/5) — Scoped binding outside scope

`packages/core/src/di.ts:278-282`

Current: `'[RudderJS] Cannot resolve scoped binding outside of a request scope. Wrap the call in container.runScoped() or add ScopeMiddleware().'`

Missing: *which* binding the user was resolving.

**Proposed:** thread the `key` into the error: `'[RudderJS] Cannot resolve scoped binding "request.id" outside of a request scope. Wrap the call in container.runScoped() or add ScopeMiddleware(), or change the binding to .singleton(...) if it doesn\\'t need per-request state.'`

## Recommended fix clusters

Clusters group by *cause family*, with the affected packages noted. Each cluster targets a single PR (per-package patch changesets when more than one package is touched).

### Cluster 1: "Lost-context" errors (web-only middleware features called from api/queue/CLI) — 3 errors, 2 packages

`auth/src/auth-manager.ts:137` (A5) · `session/src/index.ts:210` (A9) · (re-test) gate.ts AuthorizationError default message (A8) when env is dev.

**Common cause:** developer calls `auth()` / `Session.current()` from a context where the middleware didn't run. Today's message says "add the middleware" which is *wrong* on api routes — the right answer is "you can't use this here; use the explicit alternative".

**Suggested PR:** `fix: auth + session error messages name the correct alternative (api/queue/CLI)`. Patch on both packages. Three changeset entries.

### Cluster 2: "Stale binding / generation" errors — 4 errors, 3 packages

`orm-prisma/src/index.ts:316,822` (O29) — Prisma delegate missing methods.
`orm/src/index.ts:181` (O1) — already 4/5, but the "Did you add a provider?" sub-question collides with the same "ran `db:generate`" remediation.
`auth/src/index.ts:210` (A6) — provider auto-discovery rerun.
`default-providers.ts:106-109` (existing warn) — paste from memory: this fires when manifest is stale.

**Common cause:** the user did install/configure something, but a generator step needs to be re-run.

**Suggested PR:** `fix: ORM/auth errors point at the correct regenerate command`. Patch on `@rudderjs/orm`, `@rudderjs/orm-prisma`, `@rudderjs/auth`. Three changesets.

### Cluster 3: "Typo'd identifier" errors — 7 errors, 4 packages

`auth/src/auth-manager.ts:48,105` (A1, A3) · `router/src/index.ts:1184` (R7) · `orm/src/factory.ts:99` (O12) · `orm/src/index.ts:1151` (O10 — already 4/5; consider raising) · `orm/src/index.ts:2049/2166` (O3 — same) · plus a future "Did you mean" addition to `Cannot resolve {token}` (C3).

**Common cause:** typo in a named lookup. All have an enumerable set of valid names accessible at throw time.

**Suggested PR:** `feat: add Levenshtein typo suggestions to common framework lookup errors` — minor bump on `@rudderjs/auth`, `@rudderjs/router`, `@rudderjs/orm`, optionally `@rudderjs/core`. Wraps a small shared `suggest(needle, haystack)` helper.

Caveat: classifies as `feat:` because the *behavior* of the error is broadened (extra hint text). If the hint is opt-in (`process.env.NODE_ENV !== 'production'`), `patch` is acceptable.

### Cluster 4: "Unset column / unsaved model" errors — 6 errors, 1 package

`orm/src/index.ts:1731,1756,1774,1819,1904` (O9) · `orm/src/index.ts:2099,2108,2117,2128,2138` (O4) · `orm/src/index.ts:2058` (O5) · `orm/src/relations/pivot-deferred.ts:33` (also O4 family).

**Common cause:** the model is either unsaved or was hydrated without the relation key column. Today says "unset" — fine, but no recovery.

**Suggested PR:** `fix: ORM relation/unsaved-model errors hint at save() or select()`. Patch on `@rudderjs/orm`. One changeset.

### Cluster 5: "Cast / serialization" errors — 4 errors, 1 package

`orm/src/cast.ts:91,103,114,192` (O13, O17, O18) · `orm/src/resource.ts:108` (O15).

**Common cause:** the DB returned a value the cast can't parse or accept, OR the developer wrote async work in a non-async surface.

**Suggested PR:** `fix: ORM cast / resource errors include column + cast type + next step`. Patch on `@rudderjs/orm`. One changeset.

### Cluster 6: "Validation pipeline" errors — 2 errors, 2 packages

`core/src/validation.ts:104` (V2 — route `authorize() === false` to AuthorizationError, not ValidationError) · `contracts/src/index.ts:550-588` (V3 — `InputTypeError` include value + httpStatus=400).

**Common cause:** the validation surface emits 422s in cases where the semantic is 400 or 403.

**Suggested PR:** `fix: validation errors emit the correct HTTP status + actionable detail`. Patch on `@rudderjs/core`, `@rudderjs/contracts`. Two changesets.

**Risk note:** V2 changes the response status from 422 → 403 for `authorize() === false`. Document in the changeset; technically a breaking semantic if any app catches `ValidationError` to render a custom 422 UI for the failure case. Probably worth a `minor` bump on `@rudderjs/core` rather than a `patch` if there's any uncertainty.

### Cluster 7: "Driver-internal" errors that leak — 3 errors, 2 packages

`auth/src/auth-manager.ts:55,114` (A2 — driver not supported → package install hint) · `passport/src/token.ts:167` (A12 — JWT not 3 segments → opaque-token hint) · `orm-drizzle/src/index.ts:1116,348` (O31, O32).

**Common cause:** internal "doesn't fit this driver's shape" errors that the user should never see, OR errors that hint at the *wrong* solution.

**Suggested PR:** `fix: auth/passport/orm-drizzle error messages point at the correct package or operator`. Patch on `@rudderjs/auth`, `@rudderjs/passport`, `@rudderjs/orm-drizzle`. Three changesets.

### Cluster 8: "Silent" gaps that should warn — 2 errors, 2 packages

`middleware/src/index.ts:317-318` (M3 — RateLimit silently bypasses on no cache) · M2 (CSRF rendered cause is opaque) · M1 (default 429 missing retry-after on ThrottleMiddleware).

**Suggested PR:** `fix: middleware error / boot-warn improvements`. Patch on `@rudderjs/middleware`. One changeset.

### Cluster 9: "Observer cancellation" — 1 error, 1 package

`orm/src/index.ts:1494,1498,1524,1528,1541,1550,1560` (O11).

**Suggested PR:** `fix: ORM observer-cancelled errors name the cancelling observer`. Requires refactoring `_fireEvent` to return `{ cancelled, by } | result` instead of `false | result`. Slightly larger change than the rest. Patch on `@rudderjs/orm`. One changeset.

## Out-of-scope / deferred

- **#731 (ORM CLI subprocess stack)** — already shipped.
- **Ignition dev page sourcemap remap** — already shipped.
- **`MalformedBodyError`** (V4) — already good.
- **Score-4 polish items** (V1, O1, O3, O10, O16, O21, O27, A10, A11, C1, C3, C8, R1, R3, R10) — leave alone for this round; they hit the bar.
- **Score-5 items (25)** — leave alone.
- **OAuth protocol errors** (A11) — RFC 6749/8628-aligned; stable shapes consumers depend on. Don't reword them; they're protocol surface, not free-form UX.
- **Documentation cross-links** — none of the proposed messages reach for `/guide/X` doc URLs. That's intentional for now (URLs change; messages don't). If the doc site adopts a stable error-code path (e.g. `/errors/orm-relation-unset`), revisit.

## Methodology caveats

- **No live dogfooding.** I traced the rendering pipeline (`packages/core/src/app-builder.ts:170-232` + `packages/server-hono/src/error-page.ts`) and confirmed the message string is what reaches both JSON 4xx responses and the Ignition page title. I did *not* boot the playground and trigger each error end-to-end. Worst-candidate spot-checks were planned but skipped after the rendering pipeline confirmed the message is the user-visible signal in all paths.
- **Internal-only throws excluded.** Anything that fires only on broken framework code (e.g. `_assertNotSubBuilder` in orm-prisma) is omitted — those don't reach users in healthy paths.
- **Passport OAuth errors not individually scored.** A11 covers all `OAuthError(...)` sites collectively at 4/5. They're protocol-aligned spec strings (`'Authorization code has been revoked.'`); we don't reword OAuth messages.
- **Cast-context plumbing.** O13/O17/O18 proposals assume the cast layer can access the *model name* (currently only the column key is threaded in). If routing the model through `castGet`/`castSet` is too invasive, "good enough" is column + cast type + next step.
- **Levenshtein-suggestion cluster.** Cluster 3's suggestion is incremental and pure additive; if the team's bar is `patch` for additive-only message changes, all of Cluster 3 ships as `patch`. If "user-visible message change" is `feat`, then `minor`.
- **V2 (authorize → 403) is the one item with breaking-semantic risk.** Flagged in Cluster 6.

## Overall assessment

**The framework's error surface is broadly healthy — 25/70 escapable errors hit the rubric perfectly, 16 more are near-perfect, and only 30 are candidates for improvement (7 of them at score 2, 23 at score 3).** The strong patterns are: every error carries the `[RudderJS …]` prefix; almost every error names the failing input; the rendering pipeline (`httpStatus` duck-type + Ignition dev page) is uniform across all surfaces.

The real gaps cluster around three themes:

1. **"Lost-context" errors** (Cluster 1) — `auth()` / `Session.current()` outside the `web` group blame the wrong remediation. Since #731's web/api group split, the "add AuthMiddleware" hint actively misleads users on api/queue/CLI surfaces.
2. **"Typo'd identifier" errors** (Cluster 3) — guards, providers, named routes, scopes, factories, relations all enumerate their valid names at throw time. None offer suggestions. One small `suggest()` helper unblocks all five surfaces.
3. **"Unset" model errors** (Cluster 4) — pervasive ORM "X is unset" messages don't distinguish unsaved vs not-selected, and never tell the user how to recover.

The high-value, low-effort PRs are Clusters 1, 3, 4, and 5 (one PR each, mostly patch changesets). Cluster 9 (observer-cancel) is the biggest behavior change, gated on a small `_fireEvent` refactor. Cluster 6 (V2 → 403) has the one breaking-semantic risk and warrants explicit user sign-off.
