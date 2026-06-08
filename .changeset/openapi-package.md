---
"@rudderjs/openapi": minor
"@rudderjs/cli": minor
---

New opt-in package: `@rudderjs/openapi` — auto-generate an OpenAPI 3.1 spec from typed routes.

Walks `router.list()` and turns the introspectable schemas Phase 1 retains on each route (`name` / `bodySchema` / `querySchema` / `responses`) into an OpenAPI 3.1 document — path templating (`:id{[0-9]+}` → `{id}`, integer-typed), query parameters, `requestBody`, per-status `responses`, and unique `operationId`s.

**Converter registry.** Standard Schema standardizes validate+infer but not JSON-Schema export, so emission dispatches a per-validator converter by the `~standard` vendor tag. zod 4's native `z.toJSONSchema()` is registered as the default (`'zod'`); `registerSchemaConverter(vendor, fn)` lets a Valibot/ArkType user plug in their own. A route whose validator has no registered converter is warned about and skipped — never a broken document.

**Surface.**
- `generateOpenApiDocument(router, info)` — the emitter.
- `rudder openapi:generate [--out=openapi.json] [--yaml]` — write the spec from the live route table (CLI loader entry added).
- `registerOpenApiRoutes(router, { path, specPath })` — serve Swagger UI at `/docs` + the spec JSON. **Opt-in only**; gate behind auth in production.
- `OpenApiProvider` — wires `config('openapi')`; auto-discovery is OFF by default so docs are never exposed unless the app asks.

Depends on `@rudderjs/contracts` (types) and zod; `@rudderjs/core`/`@rudderjs/router` are optional peers. v1 inlines schemas (no `$ref` de-dup) and omits auth-scheme docs / response validation (deferred).
