import type { ZodLikeObject } from './types.js'
import { convertSchema } from '@rudderjs/json-schema'

/**
 * Zod → JSON Schema for MCP tool/prompt input + output schemas.
 *
 * Delegates to the framework's shared, validator-agnostic converter
 * (`@rudderjs/json-schema`), which dispatches on the Standard Schema vendor tag
 * and uses Zod 4's native `z.toJSONSchema` — the same converter `@rudderjs/ai`
 * and `@rudderjs/openapi` use. MCP tool/prompt parameters are request inputs, so
 * convert with `io: 'input'`. Falls back to an open object schema when the
 * converter can't represent the schema, so a tool always advertises *some*
 * input shape.
 *
 * `schema` is typed as the structural {@link ZodLikeObject} (`{ shape }`); the
 * shared converter reads the `~standard.vendor` tag off the real Zod instance at
 * runtime, so any Zod schema passed in converts correctly.
 */
export function zodToJsonSchema(schema: ZodLikeObject): Record<string, unknown> {
  return convertSchema(schema, 'input') ?? { type: 'object' }
}
