# @rudderjs/openapi

Auto-generate an **OpenAPI 3.1** spec (+ optional Swagger UI) from RudderJS typed
routes. Opt-in package (Lighthouse model) — **never pulled into the kernel**;
auto-discovery is OFF by default so docs are never exposed unless the app asks.

Phase 2 of the typed-responses/OpenAPI arc (`docs/plans/2026-06-08-typed-responses-openapi.md`).
Consumes the introspectable fields Phase 1 retains on `RouteDefinition`
(`name` / `bodySchema` / `querySchema` / `responses`).

## Key Files

- `src/emitter.ts` — `generateOpenApiDocument(router, info)`: walks `router.list()`, builds the 3.1 document.
- `src/converters.ts` — the **converter registry**. `registerSchemaConverter(vendor, fn)` / `convertSchema()`. zod 4's `z.toJSONSchema()` registered as the default for vendor `'zod'`.
- `src/path-template.ts` — router path → OpenAPI template (`:id{[0-9]+}` → `{id}`, integer-flagged).
- `src/routes.ts` — `registerOpenApiRoutes(router, opts)`: mounts `/docs` (Swagger UI) + `/openapi.json`. **Opt-in only.**
- `src/swagger-ui.ts` — Swagger UI HTML (CDN-loaded assets, pinned version).
- `src/provider.ts` — `OpenApiProvider`: wires `config('openapi')`; does NOT serve routes.
- `src/commands/openapi-generate.ts` — the `openapi:generate` CLI command.
- `src/yaml.ts` — minimal zero-dep YAML serializer for `--yaml`.

## The converter registry (the important wrinkle)

Standard Schema standardizes *validate + infer* but **NOT JSON-Schema export**.
So emission dispatches a per-validator converter by the `~standard` vendor tag:

- vendor `'zod'` → zod 4 native `z.toJSONSchema(schema, { io, unrepresentable: 'any' })`, top-level `$schema` stripped. `unrepresentable: 'any'` keeps `z.date()`/`z.bigint()` from throwing (they degrade to an open `{}`).
- A Valibot/ArkType user calls `registerSchemaConverter('valibot', fn)` with e.g. `@valibot/to-json-schema`.
- **No converter for a route's validator → warn + skip that schema**, never a broken document. The emitter accepts an `onWarn` sink (defaults to `console.warn`); the CLI command collects warnings and prints them.

`io` distinguishes request schemas (`'input'`, used for body/query) from response schemas (`'output'`).

## Emitter behavior

- **Path templating**: `:id` → `{id}`; `whereNumber` (`:id{[0-9]+}`) → `{ type: 'integer' }`, else `string`. Path params are always `required: true` (OpenAPI rule).
- **operationId** ← `def.name`; unnamed routes synthesize `method_slug`. **operationIds are made unique** across the document (3.1 requirement): an `all()` route expands to get/post/put/patch/delete and gets a method suffix; remaining collisions get `_2`, `_3`. Wildcard `*` segments map to `all` in the slug so `/x/*` ≠ `/x`.
- **Query params** ← top-level properties of `querySchema` (each → an `in: 'query'` parameter; `required` mirrors the schema).
- **requestBody** ← `bodySchema` (`application/json`).
- **responses** ← `def.responses` (status → content + description); a generic `200` when none declared.
- `info` (title/version/servers) ← `config('openapi')` or the `info` arg (arg wins).

> **Phase 1 gap:** only the **chained** `.body(schema)`/`.query(schema)` forms retain the schema on the definition. The opts-form `Route.get(path, { body, query }, handler)` installs validators but does NOT retain the raw schema, so those routes show no body/query in the spec. Use the chained form for documented routes (or extend Phase 1 to retain opts-form schemas — a follow-up).

## v1 scope / deferred

Skipped in v1 (deferred in the plan): dev-mode response validation, `JsonResource` inference, auth-scheme docs (`securitySchemes`), `components.schemas` `$ref` de-dup (schemas inline). Validated against redocly's `spec` rule — zero structural violations (remaining lint items are opinionated completeness recommendations: summaries, security, 4xx).

## Commands

```bash
pnpm build      # tsc -p tsconfig.build.json
pnpm typecheck  # tsc --noEmit
pnpm test       # tsc -p tsconfig.test.json && cd dist-test && node --test  (rm -rf dist-test first)
```

`rudder openapi:generate [--out=openapi.json] [--yaml]` — boots the app, reads the live route table, writes the spec. Registered via the package-command subpath pattern (loader entry in `packages/cli/src/index.ts` → `@rudderjs/openapi/commands/openapi-generate`).

## Security

`registerOpenApiRoutes` is **opt-in** and `OpenApiProvider` never calls it. An open `/docs` exposes the full API surface — gate it behind auth (or dev-only) in production. The playground mounts it dev-only in `routes/web.ts` as the reference.
