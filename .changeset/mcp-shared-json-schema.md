---
"@rudderjs/mcp": patch
---

Converge the tool/prompt zod→JSON-Schema converter onto the shared `@rudderjs/json-schema` package. `zodToJsonSchema()` is now a thin shim over `convertSchema(schema, 'input')` (Zod 4 native `z.toJSONSchema`, the same converter `@rudderjs/ai` and `@rudderjs/openapi` use) instead of a hand-rolled walker. MCP tool/prompt parameters are request inputs, so they convert with `io: 'input'`.

The internal `zod` dependency moves to `^4.0.0` (the MCP SDK accepts `^3.25 || ^4.0`, and MCP only uses zod to *produce* JSON Schema — it never `.parse()`s at runtime, so the bump is runtime-safe). The shared converter is Zod-4-native, so MCP tools should be authored with Zod 4 schemas; a Zod 3 schema degrades to an open `{ type: 'object' }`.

The emitted JSON Schema is now Zod-native and more complete/correct: unions emit `anyOf` (was `oneOf`), literals emit `{ type, const }`, nullable emits an `anyOf` with a `null` branch (was `type: [t, 'null']`), tuples emit `prefixItems`. One honest downgrade: `z.date()` is unrepresentable in JSON Schema and now emits an open `{}` schema (the hand-rolled converter guessed `string` + `date-time`).
