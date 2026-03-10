'use client'

import { useData }     from 'vike-react/useData'
import { AdminLayout } from '../../../_components/AdminLayout.js'
import { Breadcrumbs } from '../../../_components/Breadcrumbs.js'
import type { FieldMeta, SectionMeta, TabsMeta } from '@boostkit/panels'
import type { Data }   from './+data.js'

type SchemaItem = FieldMeta | SectionMeta | TabsMeta

function flattenFields(schema: SchemaItem[]): FieldMeta[] {
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

export default function ShowPage() {
  const { panelMeta, resourceMeta, record, pathSegment, slug, id } = useData<Data>()

  const viewFields = flattenFields(resourceMeta.fields as SchemaItem[]).filter(
    (f) => !f.hidden.includes('view') && f.type !== 'password',
  )

  function renderValue(field: FieldMeta, value: unknown): string {
    if (value === null || value === undefined) return '—'
    if (field.type === 'boolean')  return value ? 'Yes' : 'No'
    if (field.type === 'date')     return new Date(String(value)).toLocaleDateString()
    if (field.type === 'datetime') return new Date(String(value)).toLocaleString()
    if (Array.isArray(value))      return value.join(', ')
    if (typeof value === 'object') return JSON.stringify(value, null, 2)
    return String(value)
  }

  return (
    <AdminLayout panelMeta={panelMeta} currentSlug={slug}>
      <div className="max-w-2xl">
        <Breadcrumbs crumbs={[
          { label: panelMeta.branding?.title ?? panelMeta.name, href: `/${pathSegment}/${slug}` },
          { label: resourceMeta.label, href: `/${pathSegment}/${slug}` },
          { label: resourceMeta.labelSingular },
        ]} />

        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold">{resourceMeta.labelSingular}</h1>
          <a
            href={`/${pathSegment}/${slug}/${id}/edit`}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Edit
          </a>
        </div>

        <div className="rounded-lg border bg-card overflow-hidden">
          <dl className="divide-y">
            {viewFields.map((field) => {
              const value = record ? (record as Record<string, unknown>)[field.name] : undefined
              return (
                <div key={field.name} className="grid grid-cols-3 gap-4 px-6 py-4">
                  <dt className="text-sm font-medium text-muted-foreground">{field.label}</dt>
                  <dd className="col-span-2 text-sm">
                    {field.type === 'color' && value
                      ? (
                        <span className="flex items-center gap-2">
                          <span
                            className="inline-block h-4 w-4 rounded-full border"
                            style={{ backgroundColor: String(value) }}
                          />
                          {String(value)}
                        </span>
                      )
                      : renderValue(field, value)
                    }
                  </dd>
                </div>
              )
            })}
          </dl>
        </div>

        <div className="mt-4">
          <a
            href={`/${pathSegment}/${slug}`}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Back to {resourceMeta.label}
          </a>
        </div>
      </div>
    </AdminLayout>
  )
}
