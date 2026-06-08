import { z } from 'zod'
import type { JsonSchema } from './types.js'

/**
 * Standard Schema standardizes *validate + infer* but NOT JSON-Schema export,
 * so the OpenAPI emitter needs a per-validator converter dispatched by the
 * `~standard` vendor tag. Zod 4's native `z.toJSONSchema()` is registered as
 * the default for vendor `'zod'`; a Valibot/ArkType user registers their own
 * via {@link registerSchemaConverter} (e.g. `@valibot/to-json-schema`).
 */

/**
 * `io` distinguishes request schemas (`'input'` — pre-coercion, what the client
 * sends) from response schemas (`'output'` — post-transform, what the API
 * returns). Zod's `z.toJSONSchema` honours this; converters that don't care may
 * ignore it.
 */
export type SchemaIo = 'input' | 'output'

/**
 * Convert a validator into a JSON Schema (OpenAPI 3.1 / draft-2020-12 dialect).
 * Return `null` if the validator can't be represented — the emitter then warns
 * and skips it rather than emitting a broken document.
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
 * `null` (and the emitter warns) when the schema has no `~standard` tag or no
 * converter is registered for its vendor.
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
 * level via `jsonSchemaDialect`), so a per-schema `$schema` is noise.
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
    // `unrepresentable: 'any'` keeps `z.date()` / `z.bigint()` from throwing —
    // they degrade to an open `{}` schema instead of crashing the document.
    const json = z.toJSONSchema(schema as z.ZodType, { io, unrepresentable: 'any' }) as JsonSchema
    return stripSchemaDialect(json)
  } catch {
    return null
  }
}

registerSchemaConverter('zod', zodConverter)
