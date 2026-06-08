---
"@rudderjs/router": minor
"@rudderjs/contracts": minor
---

Add `.responds()` and retain route schemas on the definition (typed-responses / OpenAPI groundwork).

`RouteBuilder.responds(status?, schema, opts?)` declares the shape a route returns, per HTTP status — completing the typed-route story (path/query/body, now response). It's a contract declaration consumed by introspection (the planned `@rudderjs/openapi` emitter); it does not validate the response at runtime. Call it once per status; a `z.union([...])` documents same-status variant shapes.

The schema params type against **Standard Schema** (the `~standard` interface Zod 4 / Valibot / ArkType all implement), exported from `@rudderjs/contracts` as `StandardSchemaV1` — so the typed surface isn't locked to Zod (Zod remains the default; a Zod schema satisfies it structurally).

To make routes introspectable, `RouteDefinition` now retains `name`, `bodySchema`, `querySchema`, and `responses`: `.body(schema)` / `.query(schema)` stash the raw schema alongside the validator they install (validation is unchanged), and `.name()` mirrors the name onto the definition. All fields are additive and optional — no behavior change for existing routes.
