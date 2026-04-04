import type { z } from 'zod'

/**
 * Lightweight Zod → JSON Schema converter.
 * Handles the common types used in tool definitions.
 * Supports both Zod v3 (typeName) and Zod v4 (_def.type).
 */
export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return zodTypeToJson(schema as any)
}

function getType(def: any): string {
  // Zod v3 uses typeName (e.g. 'ZodString'), Zod v4 uses type (e.g. 'string')
  return def.typeName ?? def.type ?? ''
}

function zodTypeToJson(schema: any): Record<string, unknown> {
  const def = schema._def
  const t = getType(def)
  const desc = def.description as string | undefined

  // Object
  if (t === 'ZodObject' || t === 'object') {
    const shape = schema.shape ?? def.shape
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

  if (t === 'ZodString'  || t === 'string')  return { type: 'string',  ...(desc ? { description: desc } : {}) }
  if (t === 'ZodNumber'  || t === 'number')  return { type: 'number',  ...(desc ? { description: desc } : {}) }
  if (t === 'ZodBoolean' || t === 'boolean') return { type: 'boolean', ...(desc ? { description: desc } : {}) }
  if (t === 'ZodNull'    || t === 'null')    return { type: 'null' }

  // Array — Zod v3: def.type (inner schema), Zod v4: def.element
  if (t === 'ZodArray' || t === 'array') {
    const inner = def.element ?? def.type
    return { type: 'array', items: zodTypeToJson(inner) }
  }

  // Enum — Zod v3: def.values (string[]), Zod v4: def.entries (Record)
  if (t === 'ZodEnum' || t === 'enum') {
    const values = def.values ?? Object.keys(def.entries ?? {})
    return { type: 'string', enum: values }
  }

  // Optional
  if (t === 'ZodOptional' || t === 'optional') {
    return zodTypeToJson(def.innerType)
  }

  // Nullable
  if (t === 'ZodNullable' || t === 'nullable') {
    const inner = zodTypeToJson(def.innerType)
    return { ...inner, nullable: true }
  }

  // Default
  if (t === 'ZodDefault' || t === 'default') {
    const inner = zodTypeToJson(def.innerType)
    return { ...inner, default: typeof def.defaultValue === 'function' ? def.defaultValue() : def.defaultValue }
  }

  // Literal — Zod v3: def.value, Zod v4: def.values (array)
  if (t === 'ZodLiteral' || t === 'literal') {
    const val = def.value ?? def.values?.[0]
    return { type: typeof val, enum: [val] }
  }

  // Union
  if (t === 'ZodUnion' || t === 'union') {
    const options = def.options ?? def.members ?? []
    return { oneOf: options.map((o: any) => zodTypeToJson(o)) }
  }

  // Record
  if (t === 'ZodRecord' || t === 'record') {
    return { type: 'object', additionalProperties: zodTypeToJson(def.valueType) }
  }

  // Fallback
  return { type: 'string' }
}

function isOptional(schema: any): boolean {
  const t = getType(schema._def)
  return t === 'ZodOptional' || t === 'optional' || t === 'ZodDefault' || t === 'default'
}
