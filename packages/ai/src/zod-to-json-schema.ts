import type { z } from 'zod'

/**
 * Lightweight Zod → JSON Schema converter.
 * Handles the common types used in tool definitions.
 */
export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return zodTypeToJson(schema as any)
}

function zodTypeToJson(schema: any): Record<string, unknown> {
  const def = schema._def

  if (def.typeName === 'ZodObject') {
    const shape = schema.shape
    const properties: Record<string, unknown> = {}
    const required: string[] = []

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodTypeToJson(value as any)
      if (!isOptional(value as any)) required.push(key)
    }

    return {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
    }
  }

  if (def.typeName === 'ZodString')  return { type: 'string' }
  if (def.typeName === 'ZodNumber')  return { type: 'number' }
  if (def.typeName === 'ZodBoolean') return { type: 'boolean' }
  if (def.typeName === 'ZodNull')    return { type: 'null' }

  if (def.typeName === 'ZodArray') {
    return { type: 'array', items: zodTypeToJson(def.type) }
  }

  if (def.typeName === 'ZodEnum') {
    return { type: 'string', enum: def.values }
  }

  if (def.typeName === 'ZodOptional') {
    return zodTypeToJson(def.innerType)
  }

  if (def.typeName === 'ZodNullable') {
    const inner = zodTypeToJson(def.innerType)
    return { ...inner, nullable: true }
  }

  if (def.typeName === 'ZodDefault') {
    const inner = zodTypeToJson(def.innerType)
    return { ...inner, default: def.defaultValue() }
  }

  if (def.typeName === 'ZodLiteral') {
    return { type: typeof def.value, const: def.value }
  }

  if (def.typeName === 'ZodUnion') {
    return { oneOf: def.options.map((o: any) => zodTypeToJson(o)) }
  }

  if (def.typeName === 'ZodRecord') {
    return { type: 'object', additionalProperties: zodTypeToJson(def.valueType) }
  }

  // Fallback
  return { type: 'string' }
}

function isOptional(schema: any): boolean {
  return schema._def?.typeName === 'ZodOptional' || schema._def?.typeName === 'ZodDefault'
}
