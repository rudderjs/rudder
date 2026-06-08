# @rudderjs/json-schema

## 1.1.0

### Minor Changes

- 4e6c67d: Extract the schema → JSON Schema converter registry into a shared `@rudderjs/json-schema` package.

  The registry (`convertSchema` / `registerSchemaConverter`, Zod 4's `z.toJSONSchema()` as the default, vendor-dispatched by the `~standard` tag) previously lived inside `@rudderjs/openapi`. It now lives in a neutral home so `@rudderjs/ai` and `@rudderjs/mcp` can reuse it too (they each carried their own divergent hand-rolled converter). `@rudderjs/openapi` re-exports the same API from `./converters.js`, so its public surface and behavior are unchanged.

### Patch Changes

- 085869e: Map `z.date()` to `{ type: 'string', format: 'date-time' }` instead of degrading it to an open `{}`. Dates serialize to ISO strings over the wire, so `string` + `date-time` is the right shape for an OpenAPI spec or an LLM tool parameter — and it restores the hint the hand-rolled `@rudderjs/ai` / `@rudderjs/mcp` converters emitted before they consolidated onto this package. Implemented via Zod 4's `toJSONSchema` `override` hook, so all consumers (`@rudderjs/openapi`, `@rudderjs/ai`, `@rudderjs/mcp`) benefit. `z.bigint()` still degrades to an open `{}` — it has no single safe JSON representation, so we don't guess.
- Updated dependencies [7c79edc]
- Updated dependencies [5c80378]
  - @rudderjs/contracts@1.15.0
