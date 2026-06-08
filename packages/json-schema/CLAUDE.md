# @rudderjs/json-schema

The framework's single, validator-agnostic **schema → JSON Schema** converter.

## Why this package exists

Standard Schema (`~standard`, implemented by Zod 4 / Valibot / ArkType) standardizes *validate + infer* but **NOT JSON-Schema export**. Any feature that needs JSON Schema from a user-supplied schema — `@rudderjs/openapi` (spec generation), `@rudderjs/ai` + `@rudderjs/mcp` (tool parameter shapes sent to the model) — dispatches through this registry by the schema's `~standard.vendor` tag.

It's a **neutral home**: the registry mechanism needs no validator, but the bundled Zod default needs `zod`, so it can't live in the no-dependency `@rudderjs/contracts`. Both the OpenAPI package and the AI/MCP packages depend on this one instead of each rolling their own converter (previously three divergent hand-rolled copies — `oneOf` vs `anyOf`, `nullable:true` vs `type:[t,'null']`, partial type coverage — consolidated here onto Zod 4's complete native `z.toJSONSchema()`).

## API

- `convertSchema(schema, io?)` — the main entry. Dispatches on `~standard.vendor`; returns `JsonSchema | null` (null = no `~standard` tag, or no converter registered for that vendor → caller degrades/warns). `io` is `'input'` (request/params, pre-coercion) or `'output'` (response, post-transform) — Zod honours it.
- `registerSchemaConverter(vendor, fn)` — plug in a converter for a vendor (`'valibot'` → `@valibot/to-json-schema`, …). Last writer wins, so apps can override the bundled `'zod'` converter.
- `getSchemaConverter(vendor)` / `schemaVendor(schema)` — introspection.

## Notes

- The Zod default uses `z.toJSONSchema(schema, { io, unrepresentable: 'any' })` and strips the per-schema `$schema` dialect marker. `unrepresentable: 'any'` keeps `z.date()`/`z.bigint()` from throwing (they degrade to an open `{}`).
- Self-registers the Zod converter on import, so a consumer just needs to import the package for Zod to work.

## Commands

```bash
pnpm build      # tsc
pnpm typecheck  # tsc --noEmit
pnpm test       # tsc -p tsconfig.test.json && node --test
```
