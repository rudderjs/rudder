---
"@rudderjs/json-schema": patch
---

Map `z.date()` to `{ type: 'string', format: 'date-time' }` instead of degrading it to an open `{}`. Dates serialize to ISO strings over the wire, so `string` + `date-time` is the right shape for an OpenAPI spec or an LLM tool parameter — and it restores the hint the hand-rolled `@rudderjs/ai` / `@rudderjs/mcp` converters emitted before they consolidated onto this package. Implemented via Zod 4's `toJSONSchema` `override` hook, so all consumers (`@rudderjs/openapi`, `@rudderjs/ai`, `@rudderjs/mcp`) benefit. `z.bigint()` still degrades to an open `{}` — it has no single safe JSON representation, so we don't guess.
