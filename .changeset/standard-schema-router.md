---
"@rudderjs/router": patch
"@rudderjs/contracts": minor
---

Converge the router's schema surface onto Standard Schema (validator-agnostic validation).

`.body()` / `.query()` (and `RouteOptions` + the verb overloads) now type against `StandardSchemaV1` instead of `ZodType`, matching `.responds()` — so the whole router schema surface accepts any Standard Schema validator (Zod 4, Valibot, ArkType). Zod stays the default and existing code is unaffected (a Zod schema satisfies `StandardSchemaV1` structurally, and `req.query`/`req.body` inference is now `StandardSchemaOutput<S>`, which resolves identically for Zod).

`@rudderjs/contracts` gains the shared validation funnel both validators route through: `standardValidate(schema, value)` (awaits `~standard.validate()`, which may be async, and normalizes it to a value or the framework's `{ [path]: string[] }` error map) + `standardIssuesToErrors()` + the `StandardSchemaIssue` type (the inlined `StandardSchemaResult` now carries `path`, matching the spec, so per-field errors survive). The error shape and HTTP-422 behavior are byte-for-byte unchanged — the existing body/query validator tests pin parity. The router no longer depends on `zod`.

This is Phase 1 of the Standard Schema convergence (`docs/plans/2026-06-08-standard-schema-convergence.md`); `@rudderjs/ai` tool schemas are the remaining user boundary, and `FormRequest` intentionally stays Zod-coupled (its `messages()` uses Zod's error map).
