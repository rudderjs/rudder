'use client'

import type React from 'react'
import { useState, useEffect } from 'react'
import { useData }     from 'vike-react/useData'
import { useConfig }   from 'vike-react/useConfig'
import { navigate }    from 'vike/client/router'
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
  const config = useConfig()
  const { panelMeta, resourceMeta, record, pathSegment, slug, id, hasManyData } = useData<Data>()
  const panelName = panelMeta.branding?.title ?? panelMeta.name
  const rec = record as Record<string, unknown> | null

  const recordTitle = resourceMeta.titleField && rec
    ? String(rec[resourceMeta.titleField] ?? resourceMeta.labelSingular)
    : resourceMeta.labelSingular

  config({ title: `${recordTitle} — ${panelName}` })

  const allFields  = flattenFields(resourceMeta.fields as SchemaItem[])
  const viewFields = allFields.filter(f => !f.hidden.includes('view') && f.type !== 'password' && f.type !== 'hasMany')
  const hasManyFields = allFields.filter(f => f.type === 'hasMany')

  function renderValue(field: FieldMeta, value: unknown): React.ReactNode {
    if (field.type === 'belongsTo') {
      const rel     = (field.extra?.['relationName'] as string) ?? (field.name.endsWith('Id') ? field.name.slice(0, -2) : field.name)
      const display = (field.extra?.['displayField'] as string) ?? 'name'
      const target  = field.extra?.['resource'] as string | undefined
      const related = rec ? rec[rel] as Record<string, unknown> | null : null
      if (!related) return <span className="text-muted-foreground">—</span>
      const label = String(related[display] ?? '—')
      return target
        ? <a href={`/${pathSegment}/${target}/${related['id']}`} className="text-primary hover:underline">{label}</a>
        : <span>{label}</span>
    }
    if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>
    if (field.type === 'boolean')  return value ? 'Yes' : 'No'
    if (field.type === 'date')     return new Date(String(value)).toLocaleDateString()
    if (field.type === 'datetime') return new Date(String(value)).toLocaleString()
    if (field.type === 'color') return (
      <span className="flex items-center gap-2">
        <span className="inline-block h-4 w-4 rounded-full border" style={{ backgroundColor: String(value) }} />
        {String(value)}
      </span>
    )
    if (field.type === 'image' && value) return <img src={String(value)} alt="" className="max-h-24 w-auto rounded border" />
    if (field.type === 'belongsToMany') {
      const display = (field.extra?.['displayField'] as string) ?? 'name'
      const target  = field.extra?.['resource'] as string | undefined
      const items   = Array.isArray(value) ? value as Record<string, unknown>[] : []
      if (items.length === 0) return <span className="text-muted-foreground">—</span>
      return (
        <span className="flex flex-wrap gap-1">
          {items.map((item, i) => {
            const label = String(item[display] ?? item['name'] ?? item['id'] ?? '—')
            return target
              ? <a key={i} href={`/${pathSegment}/${target}/${item['id']}`} className="text-primary hover:underline">{label}</a>
              : <span key={i}>{label}</span>
          })}
        </span>
      )
    }
    if (field.type === 'tags') {
      const arr = Array.isArray(value) ? value as string[]
        : typeof value === 'string' ? (() => { try { return JSON.parse(value) as string[] } catch { return [value] } })()
        : []
      if (arr.length === 0) return <span className="text-muted-foreground">—</span>
      return (
        <span className="flex flex-wrap gap-1">
          {arr.map((tag, i) => (
            <span key={i} className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs">{String(tag)}</span>
          ))}
        </span>
      )
    }
    if (Array.isArray(value)) return <span>{value.join(', ')}</span>
    if (typeof value === 'object') return <span className="font-mono text-xs">{JSON.stringify(value, null, 2)}</span>
    return String(value)
  }

  return (
    <AdminLayout panelMeta={panelMeta} currentSlug={slug}>
      <div className="max-w-4xl">
        <Breadcrumbs crumbs={[
          { label: panelMeta.branding?.title ?? panelMeta.name, href: `/${pathSegment}/${slug}` },
          { label: resourceMeta.label, href: `/${pathSegment}/${slug}` },
          { label: recordTitle },
        ]} />

        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold">{recordTitle}</h1>
          <button
            type="button"
            onClick={() => {
              const back = window.location.pathname + window.location.search
              void navigate(`/${pathSegment}/${slug}/${id}/edit?back=${encodeURIComponent(back)}`)
            }}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Edit
          </button>
        </div>

        {/* Main record fields */}
        <div className="rounded-lg border bg-card">
          <dl className="divide-y">
            {viewFields.map((field) => {
              const value = record ? (record as Record<string, unknown>)[field.name] : undefined
              return (
                <div key={field.name} className="grid grid-cols-3 gap-4 px-6 py-4">
                  <dt className="text-sm font-medium text-muted-foreground">{field.label}</dt>
                  <dd className="col-span-2 text-sm">
                    {renderValue(field, value)}
                  </dd>
                </div>
              )
            })}
          </dl>
        </div>

        {/* HasMany relation tables */}
        {hasManyFields.map((field) => (
          <HasManyTable
            key={field.name}
            field={field}
            parentId={id}
            parentSlug={slug}
            pathSegment={pathSegment}
            initialData={hasManyData[field.name]}
          />
        ))}

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

// ── HasMany table component ───────────────────────────────

interface RelatedRecord { id: string; [key: string]: unknown }
interface PaginationMeta { total: number; currentPage: number; lastPage: number; perPage: number }
interface HasManyInitialData { records: RelatedRecord[]; schema: FieldMeta[]; pagination: PaginationMeta }

interface HasManyTableProps {
  field:        FieldMeta
  parentId:     string
  parentSlug:   string
  pathSegment:  string
  initialData?: HasManyInitialData
}

function HasManyTable({ field, parentId, parentSlug, pathSegment, initialData }: HasManyTableProps) {
  const resourceSlug = field.extra?.['resource'] as string | undefined
  const foreignKey   = field.extra?.['foreignKey'] as string | undefined

  const [records, setRecords] = useState<RelatedRecord[]>(initialData?.records ?? [])
  const [schema,  setSchema]  = useState<FieldMeta[]>(initialData?.schema ?? [])
  const [pagination, setPagination] = useState<PaginationMeta | null>(initialData?.pagination ?? null)
  const [page, setPage]    = useState(1)
  const [loading, setLoading] = useState(!initialData)

  // Load schema once — only if not provided via SSR
  useEffect(() => {
    if (initialData || !resourceSlug) return
    fetch(`/${pathSegment}/api/${resourceSlug}/_schema`)
      .then(r => r.json())
      .then((d: { resourceMeta: { fields: SchemaItem[] } }) => {
        setSchema(flattenFields(d.resourceMeta.fields).filter(f => !f.hidden.includes('table') && f.type !== 'hasMany'))
      })
      .catch(() => {})
  }, [resourceSlug, pathSegment])

  // Load records when page changes (skip page 1 if SSR data already available)
  useEffect(() => {
    if (page === 1 && initialData) return
    if (!resourceSlug || !foreignKey) { setLoading(false); return }
    setLoading(true)
    const throughMany = field.extra?.['throughMany'] === true
    const relatedUrl  = `/${pathSegment}/api/${resourceSlug}/_related?fk=${encodeURIComponent(foreignKey)}&id=${encodeURIComponent(parentId)}&page=${page}${throughMany ? '&through=true' : ''}`
    fetch(relatedUrl)
      .then(r => r.json())
      .then((d: { data: RelatedRecord[]; meta: PaginationMeta }) => {
        setRecords(d.data)
        setPagination(d.meta)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [resourceSlug, foreignKey, parentId, pathSegment, page])

  if (!resourceSlug) return null

  // Create URL: pre-fill the FK and pass back URL so cancel/save return to this record
  const backUrl  = `/${pathSegment}/${parentSlug}/${parentId}`
  const createHref = foreignKey
    ? `/${pathSegment}/${resourceSlug}/create?prefill[${foreignKey}]=${parentId}&back=${encodeURIComponent(backUrl)}`
    : `/${pathSegment}/${resourceSlug}/create?back=${encodeURIComponent(backUrl)}`

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold">{field.label}</h2>
        <a
          href={createHref}
          className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity"
        >
          + New
        </a>
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        {loading ? (
          <p className="px-6 py-8 text-sm text-muted-foreground text-center">Loading…</p>
        ) : records.length === 0 ? (
          <p className="px-6 py-8 text-sm text-muted-foreground text-center">No records found.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                {schema.map(col => (
                  <th key={col.name} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {col.label}
                  </th>
                ))}
                <th className="px-4 py-3 w-16" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {records.map(row => (
                <tr key={row.id} className="hover:bg-muted/30 transition-colors">
                  {schema.map(col => (
                    <td key={col.name} className="px-4 py-3 text-sm">
                      <CellValue col={col} row={row} pathSegment={pathSegment} resourceSlug={resourceSlug} />
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right">
                    <a
                      href={`/${pathSegment}/${resourceSlug}/${row.id}`}
                      className="text-xs text-primary hover:underline"
                    >
                      View
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {pagination && pagination.lastPage > 1 && (
        <div className="flex items-center justify-between mt-3 text-sm text-muted-foreground">
          <span>{pagination.total} record{pagination.total !== 1 ? 's' : ''}</span>
          <div className="flex gap-1">
            {Array.from({ length: pagination.lastPage }, (_, i) => i + 1).map(p => (
              <button
                key={p}
                type="button"
                onClick={() => setPage(p)}
                className={[
                  'px-2.5 py-1 rounded text-xs',
                  p === pagination.currentPage
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-accent',
                ].join(' ')}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function CellValue({ col, row, pathSegment, resourceSlug }: { col: FieldMeta; row: RelatedRecord; pathSegment: string; resourceSlug: string }) {
  const raw = row[col.name]

  if (col.type === 'belongsTo') {
    const rel     = (col.extra?.['relationName'] as string) ?? (col.name.endsWith('Id') ? col.name.slice(0, -2) : col.name)
    const display = (col.extra?.['displayField'] as string) ?? 'name'
    const target  = col.extra?.['resource'] as string | undefined
    const related = row[rel] as Record<string, unknown> | null | undefined
    if (!related) return <span className="text-muted-foreground">—</span>
    const label = String(related[display] ?? '—')
    return target
      ? <a href={`/${pathSegment}/${target}/${related['id']}`} className="text-primary hover:underline">{label}</a>
      : <span>{label}</span>
  }

  if (raw === null || raw === undefined || raw === '') return <span className="text-muted-foreground">—</span>
  if (col.type === 'boolean') return raw ? 'Yes' : 'No'
  if (col.type === 'image')   return <img src={String(raw)} alt="" className="h-8 w-8 rounded object-cover" />
  if (col.type === 'color')   return (
    <span className="flex items-center gap-1.5">
      <span className="h-3 w-3 rounded-full border shrink-0" style={{ backgroundColor: String(raw) }} />
      {String(raw)}
    </span>
  )
  if (col.type === 'tags') {
    const arr = Array.isArray(raw) ? raw as string[]
      : typeof raw === 'string' ? (() => { try { return JSON.parse(raw) as string[] } catch { return [raw] } })()
      : []
    if (arr.length === 0) return <span className="text-muted-foreground">—</span>
    return (
      <span className="flex flex-wrap gap-1">
        {arr.map((tag, i) => (
          <span key={i} className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs">{String(tag)}</span>
        ))}
      </span>
    )
  }
  if (col.type === 'belongsToMany') {
    const display = (col.extra?.['displayField'] as string) ?? 'name'
    const target  = col.extra?.['resource'] as string | undefined
    const items   = Array.isArray(raw) ? raw as Record<string, unknown>[] : []
    if (items.length === 0) return <span className="text-muted-foreground">—</span>
    return (
      <span className="flex flex-wrap gap-1">
        {items.map((item, i) => {
          const label = String(item[display] ?? item['name'] ?? item['id'] ?? '—')
          return target
            ? <a key={i} href={`/${pathSegment}/${target}/${item['id']}`} className="text-xs text-primary hover:underline">{label}</a>
            : <span key={i}>{label}</span>
        })}
      </span>
    )
  }
  if (Array.isArray(raw)) return <span>{(raw as unknown[]).map(String).join(', ')}</span>
  return <span>{String(raw)}</span>
}
