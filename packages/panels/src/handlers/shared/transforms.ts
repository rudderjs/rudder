import type { Resource, FieldOrGrouping } from '../../Resource.js'
import { ComputedField } from '../../schema/fields/ComputedField.js'
import { flattenFields } from './fields.js'

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
