# @rudderjs/openapi

## 1.1.0

### Minor Changes

- fd2bb54: New opt-in package: `@rudderjs/openapi` — auto-generate an OpenAPI 3.1 spec from typed routes.

  Walks `router.list()` and turns the introspectable schemas Phase 1 retains on each route (`name` / `bodySchema` / `querySchema` / `responses`) into an OpenAPI 3.1 document — path templating (`:id{[0-9]+}` → `{id}`, integer-typed), query parameters, `requestBody`, per-status `responses`, and unique `operationId`s.

  **Converter registry.** Standard Schema standardizes validate+infer but not JSON-Schema export, so emission dispatches a per-validator converter by the `~standard` vendor tag. zod 4's native `z.toJSONSchema()` is registered as the default (`'zod'`); `registerSchemaConverter(vendor, fn)` lets a Valibot/ArkType user plug in their own. A route whose validator has no registered converter is warned about and skipped — never a broken document.

  **Surface.**

  - `generateOpenApiDocument(router, info)` — the emitter.
  - `rudder openapi:generate [--out=openapi.json] [--yaml]` — write the spec from the live route table (CLI loader entry added).
  - `registerOpenApiRoutes(router, { path, specPath })` — serve Swagger UI at `/docs` + the spec JSON. **Opt-in only**; gate behind auth in production.
  - `OpenApiProvider` — wires `config('openapi')`; auto-discovery is OFF by default so docs are never exposed unless the app asks.

  Depends on `@rudderjs/contracts` (types) and zod; `@rudderjs/core`/`@rudderjs/router` are optional peers. v1 inlines schemas (no `$ref` de-dup) and omits auth-scheme docs / response validation (deferred).

### Patch Changes

- 4e6c67d: Extract the schema → JSON Schema converter registry into a shared `@rudderjs/json-schema` package.

  The registry (`convertSchema` / `registerSchemaConverter`, Zod 4's `z.toJSONSchema()` as the default, vendor-dispatched by the `~standard` tag) previously lived inside `@rudderjs/openapi`. It now lives in a neutral home so `@rudderjs/ai` and `@rudderjs/mcp` can reuse it too (they each carried their own divergent hand-rolled converter). `@rudderjs/openapi` re-exports the same API from `./converters.js`, so its public surface and behavior are unchanged.

- Updated dependencies [085869e]
- Updated dependencies [e8bd81f]
- Updated dependencies [4e6c67d]
- Updated dependencies [7c79edc]
- Updated dependencies [5c80378]
  - @rudderjs/json-schema@1.1.0
  - @rudderjs/core@1.11.0
  - @rudderjs/router@1.9.0
  - @rudderjs/contracts@1.15.0
