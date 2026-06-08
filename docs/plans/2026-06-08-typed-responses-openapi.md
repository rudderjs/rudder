# Typed responses + auto-OpenAPI arc

**Filed:** 2026-06-08
**Status:** plan — not started
**Packages:** `@rudderjs/router` + `@rudderjs/contracts` (Phase 1), new `@rudderjs/openapi` (Phase 2)

## Context

Rudder already makes you declare the input side of every route in a typed, zod-validated way: typed path params (`route()`/`whereNumber`), `.query(schema)`, and `.body(schema)` — all surfaced as `TypedRequest<P,Q,B>`. The one missing half of the type story is the **response**: there's no way to declare what an endpoint returns, so the typed surface is one-sided and there's nothing to generate API docs *from* on the output side.

This arc closes that gap and turns the **same declarations you already write** into living API documentation:

1. **`.responds(status, schema)`** — a typed-response declaration that mirrors `.body()`. Standalone DX win: completes Rudder's typed-everything story (routes ✓ query ✓ body ✓ **response ✓**).
2. **Auto-OpenAPI** — a new opt-in `@rudderjs/openapi` package that walks the route table and emits an OpenAPI 3.1 spec (+ optional Swagger UI at `/docs`) from the declared params/body/responses. Code-first REST docs, FastAPI/Scribe-style — no hand-written spec.

GraphQL is explicitly **out of scope** (decided 2026-06-08): Rudder is an SSR-first framework where `view()` already hands pages exactly their data, so REST is the right core. A GraphQL layer, if ever, is a separate opt-in package — not this arc.

## Validation foundation: Standard Schema, not Zod-the-library (decided 2026-06-08)

We keep **Zod** as the default/recommended validator — its static inference (`z.infer`) is what the whole typed surface is built on, and an owned runtime-only rule layer would *regress* that. We do NOT build our own validator.

But the framework's **type signatures should accept [Standard Schema](https://standardschema.dev) (the `~standard` interface that Zod 4, Valibot, and ArkType all implement), not `ZodType` specifically.** This decouples Rudder from Zod-the-library (no repeat of the zod 3→4 migration pain), lets apps bring Valibot/ArkType, and costs ~a 20-line interface instead of a reinvented validator. tRPC/Hono made the same move.

Implications threaded into the phases below:
- **New surface (`.responds()`) types against Standard Schema from day one** — no migration cost since it's new.
- **Migrating existing `.body()`/`.query()` from `ZodType` → Standard Schema** is an adjacent, mostly-mechanical change (audit `import { ... } from 'zod'` type-position uses in `packages/router` + `packages/core`). It can ride Phase 1 or be a small separate PR — call it **Phase 0** if done first. It does NOT change runtime behavior; Zod stays the default engine.
- **Wrinkle for Phase 2 (important):** Standard Schema standardizes *validate + infer* but **NOT JSON-Schema export.** So OpenAPI emission still needs a **per-validator JSON-Schema converter** — zod 4's native `z.toJSONSchema()` for the default, with a small pluggable registry so a Valibot/ArkType user can register `@valibot/to-json-schema` etc. The emitter accepts any Standard Schema for typing, but only produces spec output for validators it has a converter for (warn clearly otherwise).

## Key mechanics discovered (grounding)

- **Schemas are currently NOT introspectable.** `RouteBuilder.body(schema)` / `.query(schema)` (`packages/router/src/index.ts`) bury the schema inside a validator middleware: `this.definition.middleware.unshift(buildBodyValidator(schema))`. The raw zod schema is lost to a closure. `RouteDefinition` (`packages/contracts/src/index.ts:1017`) has only `method/path/handler/middleware/group/host/missing` — **no `name`, no schemas**. (`name` lives in a separate name registry via `_registerName`.)
- **So Phase 1's load-bearing change is: retain the raw schemas on `RouteDefinition`** so the emitter can read them — additive fields, validators keep working unchanged.
- **zod→JSON-Schema is already solved in-repo.** `@rudderjs/mcp` ships `zodToJsonSchema()` (`packages/mcp/src/zod-to-json-schema.ts`), and zod 4 (the repo's zod, `^4.0.0`) has a native `z.toJSONSchema()`. **No new external dependency.** Phase 2 should prefer zod 4 native `z.toJSONSchema()`; fall back to / extract the mcp converter only if native output needs massaging for OpenAPI 3.1.
- `router.list(): RouteDefinition[]` (the `route:list` source) is the walkable table for the emitter.

---

## Phase 1 — Typed responses (`@rudderjs/router` + `@rudderjs/contracts`)

**Goal:** declare response shapes and retain all route schemas on the definition. Standalone, useful without Phase 2.

### Changes
1. **`RouteDefinition` (contracts):** add additive, optional, introspection-only fields:
   - `name?: string` (mirror what the name registry already stores — populate it on `.name()` too, so the emitter has one source).
   - `bodySchema?: unknown` / `querySchema?: unknown` (the raw zod schema; `unknown` keeps contracts zod-free — the emitter narrows).
   - `responses?: Record<number, { schema: unknown; description?: string }>`.
2. **`RouteBuilder` (router):**
   - `.body(schema)` / `.query(schema)` — additionally stash the raw schema on the definition (`this.definition.bodySchema = schema`) alongside the existing validator middleware. No behavior change.
   - **New `.responds(status, schema, opts?)`** — store into `this.definition.responses[status]`. Overload for the common single-success case: `.responds(schema)` ⇒ status `200`. Multiple calls accumulate (different status codes). A `z.union(...)` schema covers the same-status/variant-shape case (→ OpenAPI `oneOf`). **No runtime validation in v1** — it's a contract declaration (mirrors how `.body()` is the enforcing one; response enforcement is an optional later bonus, see Deferred).
   - **Type `schema` params against Standard Schema, not `ZodType`** (see "Validation foundation"). Use the `StandardSchemaV1` interface so `.responds()` accepts Zod/Valibot/ArkType; infer the response type via the standard's output-type helper. New surface, so no migration cost.
   - Type-thread the response type onto `TypedHandler` so a handler returning the wrong shape is a `tsc` error (parity with how `.body()` types `req.body`). Keep it optional/back-compat — unannotated routes stay loose.
3. **`route:list --verbose`** (optional nicety): show declared response codes.

### Tests
- `.responds()` stores per-status schemas; `.responds(schema)` defaults to 200; unions accepted.
- `.body()`/`.query()` now expose `bodySchema`/`querySchema` on the definition AND still validate (regression).
- Type-level: a handler returning a mismatching shape fails `tsc` (type test in the router suite).

### Changeset
`@rudderjs/router` minor, `@rudderjs/contracts` minor (additive fields).

---

## Phase 2 — Auto-OpenAPI (`@rudderjs/openapi`, new opt-in package)

**Goal:** emit an OpenAPI 3.1 spec from the route table; optionally serve Swagger UI. Opt-in package (Lighthouse model — never in the kernel).

### Why a new package
Spec generation + a Swagger UI asset shouldn't bloat router/core. A discrete `@rudderjs/openapi` keeps it optional and gives it its own release cadence. Depends on `@rudderjs/contracts` (RouteDefinition) + `@rudderjs/router` (to read `router.list()`); zod is already transitive.

### Components
1. **Emitter** — `generateOpenApiDocument(router, info)`:
   - Walk `router.list()`. For each `RouteDefinition`:
     - Path: `:id` → `{id}` (OpenAPI templating); group by path → methods.
     - `operationId` ← `def.name` (skip or auto-name unnamed routes).
     - Path params ← the `:param` segments (+ `whereNumber` → integer type when available).
     - Query params ← `querySchema` (each top-level key → a query parameter).
     - `requestBody` ← `bodySchema`.
     - `responses` ← `def.responses` (status → content schema); default a generic `200` when none declared.
   - schema → JSON Schema through a **small converter registry** (Standard Schema doesn't export JSON Schema — see "Validation foundation" wrinkle): zod 4's `z.toJSONSchema()` registered as the default converter; the emitter detects the validator (via the `~standard` vendor tag) and dispatches. A Valibot/ArkType user registers their own (`@valibot/to-json-schema`, etc.); warn clearly when no converter is registered for a route's validator rather than emitting invalid spec. Verify OpenAPI 3.1 dialect compatibility; massage `$ref`/`nullable` if needed. Hoist repeated schemas into `components.schemas` (nice-to-have; inline is acceptable for v1).
   - Config: title/version/servers from `config('openapi')` (or args).
2. **CLI command** `openapi:generate [--out=openapi.json] [--yaml]` — boot the app, build the router, write the spec. Register via the package-command subpath pattern (see CLAUDE.md "Package commands don't register in CLI").
3. **Swagger UI route (opt-in)** — `registerOpenApiRoutes(router, { path: '/docs', specPath: '/openapi.json' })`: serves the spec JSON + a Swagger UI HTML page (pin the swagger-ui-dist assets or CDN-load in v1). Provider auto-discovery off by default — apps opt in explicitly.
4. **`OpenApiProvider`** — wires config; does NOT auto-serve `/docs` (security: don't expose docs unless asked).

### Tests
- Emitter: a small router with `.query()`/`.body()`/`.responds()` → assert the emitted paths/operations/params/requestBody/responses. Pin the JSON shape.
- `:id` → `{id}` templating; multi-method same path merges; unnamed-route handling.
- Command writes a valid spec (optionally validate against an OpenAPI schema validator).

### Changeset
`@rudderjs/openapi` — new package (initial `0.x`? repo is all-1.0, so `1.0.0` minor-style per convention).

---

## Sequencing & risks

- **Two PRs, in order** (optionally three if the Zod→Standard-Schema decouple is split out as **Phase 0**). Phase 1 lands a clean typed-response feature on its own; Phase 2 consumes it. Don't merge Phase 2 first — it has nothing to read without Phase 1's schema retention. The Standard Schema decouple can ride Phase 1 (new `.responds()` types against it natively) with the existing-`.body()`/`.query()` migration as a small follow-up, or lead as Phase 0.
- **Risk — zod 4 JSON-Schema fidelity.** `z.toJSONSchema()` output may need massaging for OpenAPI 3.1 (nullable, `$ref` placement, unsupported types like `z.date()`/`z.bigint()`). Mitigate: start with the common scalar/object/array/union/enum cases, emit a clear warning for unsupported nodes rather than producing invalid spec. The mcp converter is a reference for what already works in-repo.
- **Risk — response declaration drift.** `.responds()` documents the contract; it doesn't force the controller to match. Acceptable for v1 (same as OpenAPI everywhere). Deferred: optional dev-mode response validation that warns on drift.
- **Security.** Swagger UI is opt-in and not auto-served; document gating it behind auth in production.

## Deferred (not v1)
- Dev-mode response validation (warn when a controller returns outside the declared shape).
- Inferring responses from `JsonResource` (runtime `toArray()` logic isn't a static schema — hard).
- Auth scheme documentation (bearer/session) in the spec — add once the response side is proven.
- `components.schemas` de-duplication / `$ref` reuse (v1 may inline).
- Generating typed client SDKs from the spec.

## Verification (end-to-end)
1. In the playground, annotate a couple of `api.ts` routes with `.body()`/`.query()`/`.responds()`.
2. `pnpm rudder openapi:generate --out=openapi.json` → open in editor.swagger.io or validate; confirm paths/params/body/responses match.
3. Mount `registerOpenApiRoutes(router)`, `pnpm dev`, visit `/docs` — interactive Swagger UI renders and "Try it out" hits the real endpoint.
4. `tsc` proves a handler returning the wrong response shape errors.
