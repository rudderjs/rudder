import type { Field } from '../../schema/Field.js'
import type { Resource, FieldOrGrouping } from '../../Resource.js'
import { flattenFields } from './fields.js'

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
 * Validate form payload using a flat Field[] list (for schema Forms).
 * Returns { fieldName: ['error'] } or null if valid.
 */
export async function validateFormPayload(
  fields: Field[],
  body: Record<string, unknown>,
): Promise<Record<string, string[]> | null> {
  return validateFieldList(fields, body)
}
