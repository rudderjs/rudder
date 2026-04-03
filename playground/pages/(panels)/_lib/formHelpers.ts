import type { FieldMeta, SectionMeta, TabsMeta } from '@rudderjs/panels'

export type SchemaItem = FieldMeta | SectionMeta | TabsMeta

/** Flatten Section/Tabs groupings to a plain FieldMeta array (all fields, no mode filter). */
export function flattenSchemaFields(schema: SchemaItem[]): FieldMeta[] {
  const result: FieldMeta[] = []
  for (const item of schema) {
    if (item.type === 'section') {
      result.push(...(item as SectionMeta).fields)
    } else if (item.type === 'tabs') {
      for (const tab of (item as TabsMeta).tabs) result.push(...tab.fields)
    } else {
      result.push(item as FieldMeta)
    }
  }
  return result
}

/** Flatten Section/Tabs groupings, filtering out fields hidden from the given mode. */
export function flattenFormFields(schema: SchemaItem[], mode: 'create' | 'edit'): FieldMeta[] {
  const result: FieldMeta[] = []
  function collect(fields: FieldMeta[]) {
    for (const f of fields) {
      if (!f.hidden?.includes(mode)) result.push(f)
    }
  }
  for (const item of schema) {
    if (item.type === 'section') {
      collect((item as SectionMeta).fields)
    } else if (item.type === 'tabs') {
      for (const tab of (item as TabsMeta).tabs) if (tab.fields) collect(tab.fields)
    } else {
      const f = item as FieldMeta
      if (!f.hidden?.includes(mode)) result.push(f)
    }
  }
  return result
}

export function t(template: string, vars: Record<string, string | number>): string {
  return template.replace(/:([a-z]+)/g, (_, k: string) => String(vars[k] ?? `:${k}`))
}

export function buildInitialValues(
  formFields: FieldMeta[],
  record: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    formFields.map((f) => {
      const raw = record[f.name]
      if (f.type === 'belongsToMany') {
        const arr = Array.isArray(raw) ? (raw as Array<{ id?: string }>) : []
        return [f.name, arr.map((r) => r.id ?? String(r)).filter(Boolean)]
      }
      return [f.name, raw ?? '']
    }),
  )
}
