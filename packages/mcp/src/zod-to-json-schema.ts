import { z } from 'zod'

/**
 * Structural type matching what the inspector needs from a Zod object schema:
 * a `.shape` record. Both Zod v3's and v4's `ZodObject` satisfy it.
 */
export interface ZodLikeObject {
  shape: Record<string, unknown>
}

/**
 * Zod -> JSON Schema for the inspector's describe view.
 *
 * Mirrors `@gemstack/mcp`'s internal converter (which is not part of its public
 * API): Zod 4's native `z.toJSONSchema` with `unrepresentable: 'any'` so
 * `z.date()`/`z.bigint()` degrade instead of throwing, an `override` that maps
 * `z.date()` -> `string` + `date-time`, the `$schema` dialect marker stripped,
 * and an open-object fallback so a tool always advertises some input shape.
 */
export function zodToJsonSchema(schema: ZodLikeObject): Record<string, unknown> {
  try {
    const json = z.toJSONSchema(schema as unknown as z.ZodType, {
      io: 'input',
      unrepresentable: 'any',
      override: (ctx) => {
        if (ctx.zodSchema?._zod?.def?.type === 'date') {
          ctx.jsonSchema.type = 'string'
          ctx.jsonSchema.format = 'date-time'
        }
      },
    }) as Record<string, unknown>
    delete json['$schema']
    return json
  } catch {
    return { type: 'object' }
  }
}
