import type { Field } from '../../schema/Field.js'
import type { Resource, FieldOrGrouping } from '../../Resource.js'
import type { Global } from '../../Global.js'
import { flattenFields } from './fields.js'

// ─── Shared field coercion core ──────────────────────────────

interface CoerceOptions {
  /** Handle relation fields (belongsTo/belongsToMany). Only for resource payloads. */
  relations?: boolean
  /** Create vs update mode — affects belongsToMany connect vs set. */
  mode?: 'create' | 'update'
  /** Stringify tags arrays (Prisma stores as JSON string). Otherwise keep as array. */
  stringifyTags?: boolean
}

/**
 * Coerce a single field value to the correct JS type.
 */
function coerceFieldValue(
  val: unknown,
  type: string,
  opts: CoerceOptions = {},
): unknown {
  if (type === 'boolean' || type === 'toggle') {
    return val === true || val === 'true' || val === '1' || val === 1
  }
  if (type === 'number') {
    return (val === '' || val === null || val === undefined) ? null : Number(val)
  }
  if (type === 'date' || type === 'datetime') {
    if (val === '' || val === null || val === undefined) return null
    const d = new Date(String(val))
    return isNaN(d.getTime()) ? null : d
  }
  if (type === 'tags') {
    if (opts.stringifyTags) {
      return Array.isArray(val) ? JSON.stringify(val) : (val ?? '[]')
    }
    return Array.isArray(val) ? val : (val ?? [])
  }
  if (type === 'content' || type === 'richcontent') {
    if (val === '' || val === null || val === undefined) return null
    if (typeof val === 'string') {
      try { return JSON.parse(val) } catch { return null }
    }
    return val // already an object — pass through
  }
  if (opts.relations && type === 'belongsTo') {
    return (val === '' || val === null || val === undefined) ? null : String(val)
  }
  if (opts.relations && type === 'belongsToMany') {
    const ids     = Array.isArray(val) ? (val as string[]) : []
    const records = ids.map((id) => ({ id: String(id) }))
    return opts.mode === 'create' ? { connect: records } : { set: records }
  }
  return val
}

/**
 * Coerce all field values in a payload using a flat Field[] list.
 */
function coerceFields(
  fields: Field[],
  body: Record<string, unknown>,
  opts: CoerceOptions = {},
): Record<string, unknown> {
  const result = { ...body }
  for (const field of fields) {
    const name = field.getName()
    if (!(name in result)) continue
    result[name] = coerceFieldValue(result[name], field.getType(), opts)
  }
  return result
}

/**
 * Coerce raw form values to the correct JS types before hitting the ORM.
 */
export function coercePayload(
  resource: Resource,
  body: Record<string, unknown>,
  mode: 'create' | 'update' = 'update',
): Record<string, unknown> {
  const formFields = flattenFields(resource._resolveForm().getFields() as FieldOrGrouping[])
  const result = coerceFields(formFields, body, { relations: true, mode, stringifyTags: true })

  // Strip fields that shouldn't be sent to the ORM
  const writableFieldNames = new Set<string>()
  for (const field of formFields) {
    if (field.isReadonly()) continue
    if (mode === 'create' && field.isHiddenFrom('create')) continue
    if (mode === 'update' && field.isHiddenFrom('edit')) continue
    writableFieldNames.add(field.getName())
  }
  writableFieldNames.add('draftStatus') // always allow draftStatus for draftable resources
  for (const key of Object.keys(result)) {
    if (!writableFieldNames.has(key)) delete result[key]
  }

  return result
}

/**
 * Coerce global payload values — same as resource coercion but without relations.
 */
export function coerceGlobalPayload(
  global: Global,
  body: Record<string, unknown>,
): Record<string, unknown> {
  const globalForm = (global as unknown as { _resolveForm(): { getFields(): FieldOrGrouping[] } })._resolveForm()
  return coerceFields(flattenFields(globalForm.getFields()), body)
}

/**
 * Coerce raw form values using a flat Field[] list (for schema Forms).
 */
export function coerceFormPayload(
  fields: Field[],
  body: Record<string, unknown>,
): Record<string, unknown> {
  return coerceFields(fields, body)
}
