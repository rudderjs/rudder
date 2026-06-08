import { z } from 'zod'

/**
 * `@rudderjs/json-schema` — the framework's single, validator-agnostic
 * schema → JSON Schema converter.
 *
 * Standard Schema standardizes *validate + infer* but NOT JSON-Schema export,
 * so any feature that needs JSON Schema from a user-supplied schema (OpenAPI
 * specs, AI/MCP tool parameter shapes) dispatches through this registry by the
 * `~standard` vendor tag. Zod 4's native `z.toJSONSchema()` is registered as the
 * default for vendor `'zod'`; a Valibot/ArkType user registers their own via
 * {@link registerSchemaConverter} (e.g. `@valibot/to-json-schema`).
 *
 * This is the neutral home both `@rudderjs/openapi` and `@rudderjs/ai`/`mcp`
 * depend on — the registry mechanism needs no validator, but the bundled zod
 * default needs `zod`, so it can't live in the no-dependency `@rudderjs/contracts`.
 */

/** A JSON Schema object. Kept loose — callers shape/validate it downstream. */
export type JsonSchema = Record<string, unknown>

/**
 * `io` distinguishes request schemas (`'input'` — pre-coercion, what the caller
 * sends) from response schemas (`'output'` — post-transform, what's returned).
 * Zod's `z.toJSONSchema` honours this; converters that don't care may ignore it.
 */
export type SchemaIo = 'input' | 'output'

/**
 * Convert a validator into JSON Schema (OpenAPI 3.1 / draft-2020-12 dialect).
 * Return `null` if the validator can't be represented — callers then warn/skip
 * rather than emitting a broken document.
 */
export type SchemaConverter = (schema: unknown, io: SchemaIo) => JsonSchema | null

const registry = new Map<string, SchemaConverter>()

/**
 * Register a JSON-Schema converter for a Standard Schema vendor (the value of
 * `schema['~standard'].vendor` — `'zod'`, `'valibot'`, `'arktype'`, …). Last
 * writer wins, so apps can override the bundled zod converter.
 */
export function registerSchemaConverter(vendor: string, fn: SchemaConverter): void {
  registry.set(vendor, fn)
}

/** The registered converter for a vendor, if any. */
export function getSchemaConverter(vendor: string): SchemaConverter | undefined {
  return registry.get(vendor)
}

/** Read the Standard Schema vendor tag off a validator, if it has one. */
export function schemaVendor(schema: unknown): string | undefined {
  const std = (schema as { '~standard'?: { vendor?: unknown } } | null | undefined)?.['~standard']
  return typeof std?.vendor === 'string' ? std.vendor : undefined
}

/**
 * Convert a validator to JSON Schema by dispatching on its vendor tag. Returns
 * `null` when the schema has no `~standard` tag or no converter is registered
 * for its vendor (the caller decides how to degrade).
 */
export function convertSchema(schema: unknown, io: SchemaIo = 'output'): JsonSchema | null {
  const vendor = schemaVendor(schema)
  if (vendor === undefined) return null
  const converter = registry.get(vendor)
  if (converter === undefined) return null
  return converter(schema, io)
}

// ── Default zod 4 converter ────────────────────────────────

/**
 * Strip the top-level `$schema` dialect marker zod emits. OpenAPI 3.1 schema
 * objects use the 2020-12 dialect implicitly (declared once at the document
 * level), and tool parameter schemas don't want it either — a per-schema
 * `$schema` is noise.
 */
function stripSchemaDialect(json: JsonSchema): JsonSchema {
  if ('$schema' in json) {
    const { $schema, ...rest } = json
    void $schema
    return rest
  }
  return json
}

const zodConverter: SchemaConverter = (schema, io) => {
  try {
    // `unrepresentable: 'any'` keeps types with no JSON Schema analogue (`z.date()`,
    // `z.bigint()`) from throwing — they degrade to an open `{}` instead of crashing
    // the document. The `override` then upgrades the ones we *can* hint usefully:
    // `z.date()` serializes to an ISO string over the wire, so `string` + `date-time`
    // is the right shape for an OpenAPI spec or an LLM tool parameter (it's also what
    // the hand-rolled AI/MCP converters used to emit before they were consolidated here).
    // `z.bigint()` stays open — it has no single safe JSON representation (number loses
    // precision, string changes the type), so we don't guess.
    const json = z.toJSONSchema(schema as z.ZodType, {
      io,
      unrepresentable: 'any',
      override: (ctx) => {
        if (ctx.zodSchema?._zod?.def?.type === 'date') {
          ctx.jsonSchema.type = 'string'
          ctx.jsonSchema.format = 'date-time'
        }
      },
    }) as JsonSchema
    return stripSchemaDialect(json)
  } catch {
    return null
  }
}

registerSchemaConverter('zod', zodConverter)
