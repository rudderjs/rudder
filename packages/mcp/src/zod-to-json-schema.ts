import type { z } from 'zod'

/**
 * Minimal Zod-to-JSON-Schema converter for MCP tool input schemas.
 * Handles the primitive types commonly used in tool parameters, with
 * support for both Zod v3 and Zod v4 internal representations.
 */
export function zodToJsonSchema(schema: z.ZodObject<z.ZodRawShape>): Record<string, unknown> {
  const shape = schema.shape
  const properties: Record<string, unknown> = {}
  const required: string[] = []

  for (const [key, value] of Object.entries(shape)) {
    const field = value as z.ZodTypeAny
    properties[key] = zodTypeToJson(field)

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
  const def = (field as unknown as { _def: Record<string, unknown> })._def ?? {}

  // Zod v3 uses `def.typeName` (e.g. "ZodString").
  // Zod v4 uses `def.type` (e.g. "string").
  const typeName = def['typeName'] as string | undefined
  const typeTag  = def['type']     as string | undefined
  const kind     = normalizeKind(typeName, typeTag)

  const description = getDescription(field, def)
  const withDesc = (body: Record<string, unknown>): Record<string, unknown> =>
    description ? { ...body, description } : body

  switch (kind) {
    case 'string':
      return withDesc({ type: 'string' })
    case 'number':
      return withDesc({ type: 'number' })
    case 'boolean':
      return withDesc({ type: 'boolean' })
    case 'array': {
      // v3: def.type is the element; v4: def.element
      const elem = (def['element'] ?? def['type']) as z.ZodTypeAny
      return withDesc({ type: 'array', items: elem ? zodTypeToJson(elem) : {} })
    }
    case 'optional':
    case 'default':
      return zodTypeToJson(def['innerType'] as z.ZodTypeAny)
    case 'enum': {
      // v3: def.values is an array; v4: def.entries is a record { key: key }
      const values = Array.isArray(def['values'])
        ? (def['values'] as string[])
        : Object.values((def['entries'] ?? {}) as Record<string, string>)
      return withDesc({ type: 'string', enum: values })
    }
    default:
      return withDesc({ type: 'string' })
  }
}

function normalizeKind(typeName: string | undefined, typeTag: string | undefined): string | undefined {
  if (typeName) {
    // Strip "Zod" prefix and lowercase first letter — ZodString → "string"
    const stripped = typeName.replace(/^Zod/, '')
    return stripped.charAt(0).toLowerCase() + stripped.slice(1)
  }
  return typeTag
}

/** Zod v3 stores `.describe()` in `_def.description`; v4 stores it on the instance. */
function getDescription(field: z.ZodTypeAny, def: Record<string, unknown>): string | undefined {
  const fromDef = def['description']
  if (typeof fromDef === 'string') return fromDef
  const fromInstance = (field as unknown as { description?: unknown }).description
  if (typeof fromInstance === 'string') return fromInstance
  return undefined
}

function isOptional(field: z.ZodTypeAny): boolean {
  const def = (field as unknown as { _def: Record<string, unknown> })._def ?? {}
  const typeName = def['typeName'] as string | undefined
  const typeTag  = def['type']     as string | undefined
  const kind = normalizeKind(typeName, typeTag)
  return kind === 'optional' || kind === 'default'
}
