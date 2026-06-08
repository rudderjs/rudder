---
"@rudderjs/ai": patch
---

Converge the tool/output zod→JSON-Schema converter onto the shared `@rudderjs/json-schema` package. `zodToJsonSchema(schema, io)` is now a thin shim over the framework-wide converter (Zod 4 native `z.toJSONSchema`, the same one `@rudderjs/openapi` uses) instead of a hand-rolled walker. Tool parameters convert with `io: 'input'`, structured output with `io: 'output'`.

Internal swap — the public `zodToJsonSchema` export keeps its name and works as before. The emitted JSON Schema is now Zod-native and more complete: unions emit `anyOf` (was `oneOf`), literals emit `{ type, const }` (was `{ type, enum }`), nullable emits an `anyOf` with a `null` branch, and previously-unhandled zod types (refinements, intersections, branded types, etc.) now convert instead of falling back to `{ type: 'string' }`.
