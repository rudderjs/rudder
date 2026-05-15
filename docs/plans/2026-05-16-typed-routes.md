# Typed Routes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Status:** planning, 2026-05-16.
**Effort:** ~1.5–2 days for Phases 1–3 (single PR per the minimum-push preference). Phase 4 is an optional follow-up.
**Prerequisites:** none. Stacks cleanly on top of current `main` (`@rudderjs/router@1.x`, `@rudderjs/contracts@1.x`).

**Goal:** Make `Route.get('/users/:id', handler)` type-check the handler's `req.params.id`, and let `.query(schema)` bind a Zod schema so `req.query` is the inferred parsed shape — both with zero codegen and zero scanner work, purely via TypeScript's template-literal types and per-route generic inference.

**Architecture:** Two moving parts, both opt-in (today's code keeps compiling unchanged).

1. `@rudderjs/router` makes each shorthand (`get/post/put/patch/delete/all`) generic over the **literal path type** `P extends string`. A new `ExtractParams<P>` template-literal helper derives `{ id: string; postId: string }` from `'/users/:id/posts/:postId'`. The handler argument is typed as `TypedRequest<Params, Query>` — a wrapper interface that overrides only `params` and `query` on top of `AppRequest`.
2. `RouteBuilder.query(zodSchema)` installs a single validation middleware at chain time and threads the Zod-inferred type through the handler's `req.query`. Validation failures throw `ValidationError` (existing behavior path).

**Tech Stack:** TypeScript template-literal types (no AST, no codegen, no scanner). Zod (already a `@rudderjs/core` dep) for query schemas. No new runtime dependencies.

**Why this design**

- **No scanner, no registry.** Unlike typed-views (where the `Props` interface lives in a separate file the controller can't see), the route path *is right there at the call site* as a literal string. TypeScript's template-literal types can extract `:param` names without any out-of-band knowledge. This is strictly simpler than the scanner approach the memory note initially proposed.
- **Per-chain Zod inference for query.** `.query(schema)` is fluent — its return type carries the inferred shape, which the handler closure sees via contextual typing of the prior `get(path, handler)` call. We solve this by re-ordering the API slightly: `.query(schema)` is now placed *before* the handler when typing matters most, OR the handler can be passed as the second positional arg with `.query()` chained — and the chain re-types via a `TypedHandler` declaration. See Phase 2 design for the exact ergonomic decision.
- **Opt-in, non-breaking.** Apps with no `:params` in their path get `params: {}` (no keys). Apps that don't call `.query(schema)` get the existing `Record<string, string>` typing. Existing routes keep compiling verbatim.
- **`whereNumber`/`whereUuid` don't change param types.** Path constraints are runtime regex; the static type stays `string`. Coercion belongs to `.query()` / future `.params(schema)`, not to constraint helpers.

---

## What ships

| Component | Path | Status |
|---|---|---|
| `ExtractParams<P>` template-literal helper + `TypedRequest<P, Q>` wrapper | `packages/router/src/typed-routes.ts` (new) | new |
| `Router.get/post/put/patch/delete/all` made generic over `P extends string` | `packages/router/src/index.ts` (modify) | new |
| `RouteBuilder.query(schema)` chain installs validation middleware + re-types | `packages/router/src/index.ts` (modify) | new |
| Per-route Zod query middleware (parses, replaces `req.query`, throws on fail) | `packages/router/src/query-validator.ts` (new) | new |
| Type-level tests (`@ts-expect-error` positive/negative) | `packages/router/src/typed-routes.test-d.ts` (new) | new |
| Runtime tests for `.query(schema)` middleware | `packages/router/src/query-validator.test.ts` (new) | new |
| Playground demo: a typed-route + typed-query example | `playground/routes/web.ts` (modify) + `playground-web/routes/web.ts` (mirror) | new |
| Docs page on the convention | `docs/guide/typed-routes.md` (new) + sidebar entry | new |
| Changeset (minor on `@rudderjs/router`) | `.changeset/typed-routes.md` | new |

Out of scope (deferred):

- **Typed body via `.body(schema)`** — overlaps with the existing `FormRequest` class; revisit once the path/query story lands.
- **Typed named-route registry** — `route('users.show', {id: 1})` typing the second arg from the registered path. Possible follow-up via module augmentation, but it'd require either codegen of the registry or AST-walking the routes file. Not needed for v1.
- **Decorator-based controllers** (`@Get('/users/:id')`) — decorator metadata loses the literal type. Would need a different API surface; skip for v1.

---

## Phase 1 — `ExtractParams<P>` + typed handler signature

**Files**
- `packages/router/src/typed-routes.ts` (new)
- `packages/router/src/index.ts` (modify the 6 shorthand methods)

**Design**

```ts
// typed-routes.ts
type Trim<S extends string> = S extends `${infer T}/${infer _}` ? T : S

type ParamName<S extends string> =
  S extends `${infer Name}?` ? Name :  // optional :id?
  S

type ExtractParamsTuple<P extends string> =
  P extends `${infer _Head}:${infer Rest}`
    ? [Trim<Rest>, ...ExtractParamsTuple<RestAfterSeg<Rest>>]
    : []

// Final: convert tuple → object. Optional params → optional keys.
export type ExtractParams<P extends string> = {
  [K in ParamName<ExtractParamsTuple<P>[number]> as K extends `${infer N}?` ? N : K]:
    K extends `${string}?` ? string | undefined : string
}

// Handler with overridden params (and optionally query)
export interface TypedRequest<
  P extends Record<string, string | undefined> = Record<string, string>,
  Q = Record<string, string>,
> extends Omit<AppRequest, 'params' | 'query'> {
  params: P
  query:  Q
}

export type TypedHandler<P extends string, Q = Record<string, string>> = (
  req: TypedRequest<ExtractParams<P>, Q>,
  res: AppResponse,
) => unknown | Promise<unknown>
```

Edge cases the type helper must handle:

- `/users/:id` → `{ id: string }`
- `/users/:id/posts/:postId` → `{ id: string; postId: string }`
- `/files/:filename?` → `{ filename?: string }` (optional → optional key)
- `/users/:id{[0-9]+}` → `{ id: string }` (regex constraint stripped from name; param stays `string`)
- `/static` (no params) → `{}` (empty object — `req.params` is still an object, just keyless)
- `*` (catch-all) → `{}` for v1; Hono's catch-all wildcard isn't a named param

**Router method signatures**

```ts
get<P extends string>(
  path: P,
  handler: TypedHandler<P>,
  middleware?: MiddlewareHandler[],
): RouteBuilder<P>
```

`RouteBuilder` becomes generic over `P` so `.query()` and future `.body()` can carry the path-param shape forward.

**Tests**
- `typed-routes.test-d.ts` (compile-only):
  - Positive: `Route.get('/users/:id', (req) => req.params.id)` — type of `req.params.id` is `string`.
  - Negative: `Route.get('/users/:id', (req) => req.params.notReal)` — `@ts-expect-error`.
  - Optional: `Route.get('/files/:name?', (req) => req.params.name)` — type is `string | undefined`.
  - Multi: `Route.get('/users/:id/posts/:postId', (req) => [req.params.id, req.params.postId])` — both `string`.
  - No params: `Route.get('/health', (req) => req.params)` — type is `{}`.
- Runtime: no changes — existing router tests must keep passing.

**Acceptance**
- All existing router tests pass with zero changes.
- Playground typechecks against new generic signatures.

---

## Phase 2 — `.query(schema)` chain on `RouteBuilder`

**Files**
- `packages/router/src/query-validator.ts` (new)
- `packages/router/src/index.ts` (add method to `RouteBuilder`)

**Design**

```ts
class RouteBuilder<P extends string = string, Q = Record<string, string>> {
  query<S extends ZodType>(schema: S): RouteBuilder<P, z.infer<S>> {
    // 1. Build a middleware that parses req.query through the schema.
    //    On success: req.query = parsed (coerced/transformed values).
    //    On failure: throw ValidationError(zodError.flatten()).
    // 2. Prepend to this.definition.middleware so it runs BEFORE the handler.
    // 3. Return `this` cast to the new generic — TS does the re-type for the
    //    handler that was already registered.
    this.definition.middleware.unshift(buildQueryValidator(schema))
    return this as unknown as RouteBuilder<P, z.infer<S>>
  }
}
```

**Critical ergonomic decision:** since the handler is registered *before* `.query()` is chained, the handler is already typed at `get<P>()` call time. Two options:

**A. Re-order: `.query()` before the handler.**
```ts
Route.get('/users').query(schema).handle((req) => req.query.page)
```
Cleaner inference, but breaks Laravel-style `router.get(path, handler)` symmetry. **Rejected.**

**B. Keep handler position; `.query()` types via inference at the call site.**
```ts
Route.get('/users', (req) => req.query.page).query(schema)
```
Handler runs with `req.query: Record<string, string>` typing at write time — `.query()` doesn't *re-type* the closure that was already passed. **TypeScript can't go back and re-type a closure that's already been bound.** Rejected.

**C. (Chosen) Inline `query: schema` option as an alternative to the chain.**
```ts
Route.get('/users', { query: schema }, (req) => req.query.page)
// OR keep the chain for runtime, but require Zod-typed query via overload:
Route.get('/users/:id', { query: schema }, handler)
```
The overload's `handler` parameter is typed using `z.infer<typeof schema>`, so the closure gets the parsed type at write time. The fluent `.query()` chain still exists for runtime convenience (no compile-time benefit on its own), and is documented as such.

**Final API for Phase 2:**

```ts
// Overload 1 — no query schema (existing behavior, just generic over P)
get<P extends string>(
  path: P,
  handler: TypedHandler<P>,
  middleware?: MiddlewareHandler[],
): RouteBuilder<P>

// Overload 2 — opts object with `query` schema; handler typed from schema
get<P extends string, S extends ZodType>(
  path: P,
  opts: { query: S; middleware?: MiddlewareHandler[] },
  handler: TypedHandler<P, z.infer<S>>,
): RouteBuilder<P, z.infer<S>>
```

The `opts` object also accepts `middleware` for symmetry, so the 3-arg form covers every case.

**Validator middleware**

```ts
// query-validator.ts
export function buildQueryValidator(schema: ZodType): MiddlewareHandler {
  return async (req, _res, next) => {
    const result = schema.safeParse(req.query)
    if (!result.success) {
      throw new ValidationError(result.error.flatten().fieldErrors)
    }
    ;(req as { query: unknown }).query = result.data
    await next()
  }
}
```

`ValidationError` already exists in `@rudderjs/contracts` (used by `FormRequest`). Reuse it; the exception handler renders 422 with the field errors.

**Tests**
- `query-validator.test.ts`:
  - Happy path: `?page=2&limit=10` against `z.object({ page: z.coerce.number(), limit: z.coerce.number() })` → handler sees `{ page: 2, limit: 10 }`.
  - Missing required key → throws ValidationError.
  - Coercion: `?page=abc` against `z.coerce.number()` → throws.
  - Defaults: `?` against `z.object({ page: z.coerce.number().default(1) })` → `{ page: 1 }`.
  - No-schema route untouched: `req.query` still `Record<string, string>` at runtime.

**Acceptance**
- Type-level: opts-form handler sees `z.infer<S>` for `req.query`.
- Runtime: validation passes/fails as expected; `req.query` mutates to parsed data.

---

## Phase 3 — Playground demo + docs

**Files**
- `playground/routes/web.ts` — add `Route.get('/demos/typed-route/:id', { query: PaginationSchema }, ...)` (mirror in `playground-web/`)
- `docs/guide/typed-routes.md` (new) — convention page mirroring `docs/guide/typed-views.md` shape
- `docs/.vitepress/config.ts` — sidebar entry under "Guides" near typed-views
- `.changeset/typed-routes.md` — minor bump on `@rudderjs/router`

Docs page covers:
- Path-param extraction (multiple `:`, optional `?`, with `whereNumber` notes that constraints don't coerce)
- `{ query: schema }` opts form + when to reach for `FormRequest` instead (body validation, multi-field, reusable rules)
- Migration: zero — opt-in by adopting the literal-string call (any app already does)

---

## Phase 4 (deferred) — `.body(schema)` and `.params(schema)`

Not in this PR. `.body()` overlaps with `FormRequest`; `.params(schema)` overlaps with `whereNumber`/`whereUuid` (which already constrain at the regex level and would need coercion semantics decided). Revisit once Phase 1–3 is shipped and used.

---

## Risks

1. **Template-literal recursion depth** — TS allows ~50 recursive template-literal expansions. A path with >50 params would hit the limit; not a realistic case. Mitigation: ship as-is; document the limit if asked.
2. **Closure typing for the bare 2-arg form.** If devs write `Route.get('/users', handler).query(schema)` expecting the closure to see typed `req.query`, they'll be surprised — closure was already typed. Mitigation: docs page explicitly shows the `{ query: schema }` opts form for typed query; the chain `.query(schema)` is for runtime-only validation when types aren't needed.
3. **`RouteBuilder` generic-ization is a breaking type change.** Anyone storing a `RouteBuilder` in a typed variable will need to use `RouteBuilder<string>` or let inference work. Mitigation: default generic to `string`, so untyped uses keep working: `class RouteBuilder<P extends string = string, Q = Record<string, string>>`.
4. **`TypedRequest` reaches into `AppRequest` field by field.** If `AppRequest` adds new fields, `TypedRequest` keeps inheriting them via the `Omit + extend` pattern. Module augmentations (`req.user`, `req.session`, `req.token`) come along automatically since they augment `AppRequest`.

---

## Verification before pushing

Per `feedback_verify_before_push.md`:
1. `pnpm build` from root — all packages compile.
2. `pnpm typecheck` from root — including new `*.test-d.ts` files.
3. `pnpm test` from root — router tests pass; new query-validator tests pass.
4. `cd playground && pnpm dev` — boot the demo route, hit it in browser with valid + invalid query, confirm 200 and 422 responses.
5. `pnpm --filter @rudderjs/router lint` — ESLint clean.
