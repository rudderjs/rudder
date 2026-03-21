import type { AppRequest } from '@boostkit/core'
import type { Field } from '../schema/Field.js'
import type { Resource, FieldOrGrouping } from '../Resource.js'
import type { Global } from '../Global.js'
import type { PanelContext } from '../types.js'
import { ComputedField } from '../schema/fields/ComputedField.js'

/** Derive the Prisma relation name from a RelationField. */
export function relationName(field: Field): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const explicit = (field as any)._extra?.['relationName'] as string | undefined
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

/**
 * Coerce raw form values to the correct JS types before hitting the ORM.
 * - boolean / toggle  -> true | false
 * - number            -> number | null
 * - date / datetime   -> Date | null  (empty string -> null)
 * Empty strings for optional fields are left as-is (ORM handles them).
 */
export function coercePayload(
  resource: Resource,
  body: Record<string, unknown>,
  mode: 'create' | 'update' = 'update',
): Record<string, unknown> {
  const result = { ...body }
  for (const field of flattenFields(resource.fields())) {
    const name = field.getName()
    if (!(name in result)) continue
    const val  = result[name]
    const type = field.getType()
    if (type === 'boolean' || type === 'toggle') {
      result[name] = val === true || val === 'true' || val === '1' || val === 1
    } else if (type === 'number') {
      result[name] = (val === '' || val === null || val === undefined) ? null : Number(val)
    } else if (type === 'date' || type === 'datetime') {
      if (val === '' || val === null || val === undefined) {
        result[name] = null
      } else {
        const d = new Date(String(val))
        result[name] = isNaN(d.getTime()) ? null : d
      }
    } else if (type === 'tags') {
      // UI submits an array; store as JSON string
      result[name] = Array.isArray(val) ? JSON.stringify(val) : (val ?? '[]')
    } else if (type === 'content' || type === 'richcontent') {
      // Prisma Json? field: pass object as-is, parse JSON strings, empty -> null
      if (val === '' || val === null || val === undefined) {
        result[name] = null
      } else if (typeof val === 'string') {
        try { result[name] = JSON.parse(val) } catch { result[name] = null }
      }
      // else: already an object — pass through
    } else if (type === 'belongsTo') {
      result[name] = (val === '' || val === null || val === undefined) ? null : String(val)
    } else if (type === 'belongsToMany') {
      // Prisma implicit M2M: connect on create, set (replace) on update
      const ids     = Array.isArray(val) ? (val as string[]) : []
      const records = ids.map((id) => ({ id: String(id) }))
      result[name]  = mode === 'create' ? { connect: records } : { set: records }
    }
  }
  return result
}

/**
 * Coerce global payload values — same logic as resource coercion
 * but without relation handling (globals store JSON, no FK relations).
 */
export function coerceGlobalPayload(
  global: Global,
  body: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...body }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const field of flattenFields((global as any).fields())) {
    const name = field.getName()
    if (!(name in result)) continue
    const val  = result[name]
    const type = field.getType()
    if (type === 'boolean' || type === 'toggle') {
      result[name] = val === true || val === 'true' || val === '1' || val === 1
    } else if (type === 'number') {
      result[name] = (val === '' || val === null || val === undefined) ? null : Number(val)
    } else if (type === 'date' || type === 'datetime') {
      if (val === '' || val === null || val === undefined) {
        result[name] = null
      } else {
        const d = new Date(String(val))
        result[name] = isNaN(d.getTime()) ? null : d
      }
    } else if (type === 'tags') {
      result[name] = Array.isArray(val) ? val : (val ?? [])
    } else if (type === 'content' || type === 'richcontent') {
      if (val === '' || val === null || val === undefined) {
        result[name] = null
      } else if (typeof val === 'string') {
        try { result[name] = JSON.parse(val) } catch { result[name] = null }
      }
    }
  }
  return result
}

export async function validatePayload(
  resource: Resource,
  body: Record<string, unknown>,
  mode: 'create' | 'update',
): Promise<Record<string, string[]> | null> {
  const fields = flattenFields(resource.fields())
  const errors: Record<string, string[]> = {}

  // Skip required-field validation for draft saves
  const isDraft = body['draftStatus'] === 'draft'

  for (const field of fields) {
    if (field.isReadonly()) continue
    if (field.getType() === 'belongsTo' || field.getType() === 'belongsToMany') continue
    if (mode === 'create' && field.isHiddenFrom('create')) continue
    if (mode === 'update' && field.isHiddenFrom('edit')) continue

    const name  = field.getName()

    // On update, skip validation for fields not present in the payload
    // (supports partial/inline updates where only one field is sent)
    if (mode === 'update' && !(name in body)) continue

    const value = body[name]

    // Drafts skip required validation — user can save incomplete records
    if (!isDraft && field.isRequired() && (value === undefined || value === null || value === '')) {
      errors[name] = [`${field.getLabel()} is required.`]
    }
  }

  // Per-field custom validators — skip entirely for drafts
  if (isDraft) return Object.keys(errors).length > 0 ? errors : null

  for (const field of flattenFields(resource.fields())) {
    if (!field.hasValidate()) continue
    if (field.isReadonly()) continue
    const name = field.getName()

    // On update, skip validation for fields not in the payload
    if (mode === 'update' && !(name in body)) continue

    const value = body[name]
    const result = await field.runValidate(value, body)
    if (result !== true) {
      if (errors[name]) {
        errors[name] = [...(errors[name] ?? []), result]
      } else {
        errors[name] = [result]
      }
    }
  }

  return Object.keys(errors).length > 0 ? errors : null
}

export function applyTransforms(resource: Resource, records: unknown[]): unknown[] {
  const fields = flattenFields(resource.fields())
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
  void import('@boostkit/broadcast').then(({ broadcast }) => {
    broadcast(`panel:${slug}`, event, data)
  }).catch(() => { /* @boostkit/broadcast not registered */ })
}
