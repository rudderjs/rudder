import type { Field } from '../../schema/Field.js'
import type { FieldOrGrouping } from '../../Resource.js'

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
