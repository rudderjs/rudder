import type { AppRequest } from '@rudderjs/core'
import type { Field } from '../schema/Field.js'
import type { Resource, FieldOrGrouping } from '../Resource.js'
import type { Global } from '../Global.js'
import type { PanelContext } from '../types.js'
import { ComputedField } from '../schema/fields/ComputedField.js'

/** Derive the Prisma relation name from a RelationField. */
export function relationName(field: Field): string {
  const explicit = field.getExtra()['relationName'] as string | undefined
  if (explicit) return explicit
  const name = field.getName()
  return name.endsWith('Id') ? name.slice(0, -2) : name
}

/** Flatten Section / Tabs groupings to a plain Field array. */
export function flattenFields(items: FieldOrGrouping[]): Field[] {
  const result: Field[] = []
  for (const item of items) {
    if ('getFields' in item) {
      result.push(...flattenFields(item.getFields()))
    } else {
      result.push(item as Field)
    }
  }
  return result
}

export function buildContext(req: AppRequest): PanelContext {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    user:    (req as any).user,
    headers: req.headers as Record<string, string>,
    path:    req.path,
    params:  {},
  }
}

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

// ─── Shared field validation core ────────────────────────────

interface ValidateOptions {
  /** Mode for visibility checks (resource forms). */
  mode?: 'create' | 'update'
  /** Skip required validation (draft saves). */
  skipRequired?: boolean
  /** Only validate fields present in the payload (partial updates). */
  partialUpdate?: boolean
  /** Skip relation field validation. */
  skipRelations?: boolean
}

/**
 * Validate a payload against a flat Field[] list.
 * Returns { fieldName: ['error'] } or null if valid.
 */
async function validateFieldList(
  fields: Field[],
  body: Record<string, unknown>,
  opts: ValidateOptions = {},
): Promise<Record<string, string[]> | null> {
  const errors: Record<string, string[]> = {}

  for (const field of fields) {
    if (field.isReadonly()) continue
    if (opts.skipRelations && (field.getType() === 'belongsTo' || field.getType() === 'belongsToMany')) continue
    if (opts.mode === 'create' && field.isHiddenFrom('create')) continue
    if (opts.mode === 'update' && field.isHiddenFrom('edit')) continue

    const name  = field.getName()

    // Partial updates: skip fields not in payload
    if (opts.partialUpdate && !(name in body)) continue

    const value = body[name]

    // Required check
    if (!opts.skipRequired && field.isRequired() && (value === undefined || value === null || value === '')) {
      errors[name] = [`${field.getLabel() || name} is required.`]
    }
  }

  // Custom validators — skip entirely when skipRequired (draft mode)
  if (opts.skipRequired) return Object.keys(errors).length > 0 ? errors : null

  for (const field of fields) {
    if (!field.hasValidate()) continue
    if (field.isReadonly()) continue
    const name = field.getName()

    if (opts.partialUpdate && !(name in body)) continue

    const value = body[name]
    const result = await field.runValidate(value, body)
    if (result !== true) {
      if (errors[name]) {
        errors[name]!.push(result)
      } else {
        errors[name] = [result]
      }
    }
  }

  return Object.keys(errors).length > 0 ? errors : null
}

// ─── Public API (delegates to shared core) ───────────────────

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

export async function validatePayload(
  resource: Resource,
  body: Record<string, unknown>,
  mode: 'create' | 'update',
): Promise<Record<string, string[]> | null> {
  const fields = flattenFields(resource._resolveForm().getFields() as FieldOrGrouping[])
  const isDraft = body['draftStatus'] === 'draft'
  return validateFieldList(fields, body, {
    mode,
    skipRequired: isDraft,
    partialUpdate: mode === 'update',
    skipRelations: true,
  })
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

/**
 * Validate form payload using a flat Field[] list (for schema Forms).
 * Returns { fieldName: ['error'] } or null if valid.
 */
export async function validateFormPayload(
  fields: Field[],
  body: Record<string, unknown>,
): Promise<Record<string, string[]> | null> {
  return validateFieldList(fields, body)
}

export function applyTransforms(resource: Resource, records: unknown[]): unknown[] {
  const fields = flattenFields(resource._resolveForm().getFields() as FieldOrGrouping[])
  const displayFields  = fields.filter(f => f.hasDisplay())
  // Duck-type instead of instanceof — Vite SSR may load separate class instances
  const computedFields = fields.filter((f): f is ComputedField => f.getType() === 'computed' && 'apply' in f)

  if (!displayFields.length && !computedFields.length) return records

  return records.map((r) => {
    const rec = { ...(r as Record<string, unknown>) }
    // Apply computed fields first (they produce the value)
    for (const f of computedFields) {
      rec[f.getName()] = f.apply(rec)
    }
    // Then apply display transforms (which may further format computed or DB values)
    for (const f of displayFields) {
      rec[f.getName()] = f.applyDisplay(rec[f.getName()], rec)
    }
    return rec
  })
}

export function liveBroadcast(slug: string, event: string, data: unknown): void {
  void import('@rudderjs/broadcast').then(({ broadcast }) => {
    broadcast(`panel:${slug}`, event, data)
  }).catch(() => { /* @rudderjs/broadcast not registered */ })
}
