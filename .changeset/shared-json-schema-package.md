---
"@rudderjs/json-schema": minor
"@rudderjs/openapi": patch
---

Extract the schema → JSON Schema converter registry into a shared `@rudderjs/json-schema` package.

The registry (`convertSchema` / `registerSchemaConverter`, Zod 4's `z.toJSONSchema()` as the default, vendor-dispatched by the `~standard` tag) previously lived inside `@rudderjs/openapi`. It now lives in a neutral home so `@rudderjs/ai` and `@rudderjs/mcp` can reuse it too (they each carried their own divergent hand-rolled converter). `@rudderjs/openapi` re-exports the same API from `./converters.js`, so its public surface and behavior are unchanged.
