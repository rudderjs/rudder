import type { z } from 'zod'

/**
 * Minimal Zod-to-JSON-Schema converter for MCP tool input schemas.
 * Handles the common primitive types used in tool parameters.
 */
export function zodToJsonSchema(schema: z.ZodObject<z.ZodRawShape>): Record<string, unknown> {
  const shape = schema.shape
  const properties: Record<string, unknown> = {}
  const required: string[] = []

  for (const [key, value] of Object.entries(shape)) {
    const field = value as z.ZodTypeAny
    properties[key] = zodTypeToJson(field)

    // If the field is not optional, mark as required
    if (!isOptional(field)) {
      required.push(key)
    }
  }

  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
  }
}

function zodTypeToJson(field: z.ZodTypeAny): Record<string, unknown> {
  const def = field._def as Record<string, unknown>
  const typeName = def['typeName'] as string | undefined

  switch (typeName) {
    case 'ZodString':
      return { type: 'string', ...(def['description'] ? { description: def['description'] as string } : {}) }
    case 'ZodNumber':
      return { type: 'number', ...(def['description'] ? { description: def['description'] as string } : {}) }
    case 'ZodBoolean':
      return { type: 'boolean', ...(def['description'] ? { description: def['description'] as string } : {}) }
    case 'ZodArray':
      return { type: 'array', items: zodTypeToJson(def['type'] as z.ZodTypeAny), ...(def['description'] ? { description: def['description'] as string } : {}) }
    case 'ZodOptional':
      return zodTypeToJson(def['innerType'] as z.ZodTypeAny)
    case 'ZodDefault':
      return zodTypeToJson(def['innerType'] as z.ZodTypeAny)
    case 'ZodEnum':
      return { type: 'string', enum: def['values'] as string[], ...(def['description'] ? { description: def['description'] as string } : {}) }
    default:
      return { type: 'string' }
  }
}

function isOptional(field: z.ZodTypeAny): boolean {
  const typeName = (field._def as Record<string, unknown>)['typeName'] as string | undefined
  if (typeName === 'ZodOptional') return true
  if (typeName === 'ZodDefault') return true
  return false
}
