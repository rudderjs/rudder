'use client'

import { useState, useEffect } from 'react'
import { useData }     from 'vike-react/useData'
import { useConfig }   from 'vike-react/useConfig'
import { navigate }    from 'vike/client/router'
import { CellValue, resolveCellValue } from '../../../../_components/CellValue.js'
import type { FieldMeta, SectionMeta, TabsMeta, PanelI18n, RecordRow } from '@boostkit/panels'
import { useI18n } from '../../../../_hooks/useI18n.js'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table.js'
import { Badge } from '@/components/ui/badge.js'
import { SchemaElementRenderer } from '../../../../_components/SchemaElementRenderer.js'
import { t, flattenSchemaFields } from '../../../../_lib/formHelpers.js'
import type { SchemaItem } from '../../../../_lib/formHelpers.js'
import type { Data }   from './+data.js'

export default function ShowPage() {
  const config = useConfig()
  const { panelMeta, resourceMeta, record, pathSegment, slug, id, hasManyData = {}, widgetData } = useData<Data>()
  const panelName = panelMeta.branding?.title ?? panelMeta.name
  const i18n = useI18n()
  const rec = record as Record<string, unknown> | null

  const recordTitle = resourceMeta.titleField && rec
    ? String(rec[resourceMeta.titleField] ?? resourceMeta.labelSingular)
    : resourceMeta.labelSingular

  config({ title: `${recordTitle} — ${panelName}` })

  const allFields  = flattenSchemaFields(resourceMeta.fields as SchemaItem[])
  const viewFields = allFields.filter(f => !f.hidden?.includes('view') && f.type !== 'password' && f.type !== 'hasMany')
  const hasManyFields = allFields.filter(f => f.type === 'hasMany')

  return (
    <div className="max-w-4xl p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold">{recordTitle}</h1>
          <button
            type="button"
            onClick={() => {
              const back = window.location.pathname + window.location.search
              void navigate(`/${pathSegment}/resources/${slug}/${id}/edit?back=${encodeURIComponent(back)}`)
            }}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
          >
            {i18n.edit}
          </button>
        </div>

        {/* Resource widgets */}
        {widgetData && widgetData.length > 0 && (
          <div className="flex flex-col gap-4 mb-6">
            {widgetData.map((el, i: number) => (
              <SchemaElementRenderer key={i} element={el as import('@boostkit/panels').PanelSchemaElementMeta} panelPath={`/${pathSegment}`} i18n={i18n} />
            ))}
          </div>
        )}

        {/* Main record fields */}
        <div className="rounded-lg border bg-card">
          <dl className="divide-y">
            {viewFields.map((field) => {
              const value = rec ? resolveCellValue(rec, field) : undefined
              return (
                <div key={field.name} className="grid grid-cols-3 gap-4 px-6 py-4">
                  <dt className="text-sm font-medium text-muted-foreground">{field.label}</dt>
                  <dd className="col-span-2 text-sm">
                    <CellValue value={value} type={field.type} extra={field.extra} displayTransformed={field.displayTransformed} pathSegment={pathSegment} i18n={i18n} />
                  </dd>
                </div>
              )
            })}
          </dl>
        </div>

        {/* HasMany relation tables */}
        {hasManyFields.map((field) => (
          <HasManyTable
            key={`${field.name}-${id}`}
            field={field}
            parentId={id}
            parentSlug={slug}
            pathSegment={pathSegment}
            {...(hasManyData[field.name] !== undefined ? { initialData: hasManyData[field.name] } : {})}
            i18n={i18n}
          />
        ))}

        <div className="mt-4">
          <a
            href={`/${pathSegment}/resources/${slug}`}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {t(i18n.backTo, { label: resourceMeta.label })}
          </a>
        </div>
    </div>
  )
}

// ── HasMany table component ───────────────────────────────

interface RelatedRecord { id: string; [key: string]: unknown }
interface PaginationMeta { total: number; currentPage: number; lastPage: number; perPage: number }
interface HasManyInitialData { records: RecordRow[]; schema: FieldMeta[]; pagination: PaginationMeta }

interface HasManyTableProps {
  field:        FieldMeta
  parentId:     string
  parentSlug:   string
  pathSegment:  string
  initialData?: HasManyInitialData
  i18n:         PanelI18n
}

function HasManyTable({ field, parentId, parentSlug, pathSegment, initialData, i18n }: HasManyTableProps) {
  const resourceSlug = field.extra?.['resource'] as string | undefined
  const foreignKey   = field.extra?.['foreignKey'] as string | undefined

  const [records, setRecords] = useState<RelatedRecord[]>((initialData?.records ?? []) as RelatedRecord[])
  const [schema,  setSchema]  = useState<FieldMeta[]>(initialData?.schema ?? [])
  const [pagination, setPagination] = useState<PaginationMeta | null>(initialData?.pagination ?? null)
  const [page, setPage]    = useState(1)
  const [loading, setLoading] = useState(!initialData)

  const throughMany = field.extra?.['throughMany'] === true

  // Load schema once — only if not provided via SSR
  useEffect(() => {
    if (initialData || !resourceSlug) return
    fetch(`/${pathSegment}/api/${resourceSlug}/_schema`)
      .then(r => r.json())
      .then((d: { resourceMeta: { fields: SchemaItem[] } }) => {
        setSchema(flattenSchemaFields(d.resourceMeta.fields).filter(f => !f.hidden?.includes('table') && f.type !== 'hasMany'))
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialData is SSR-only, intentionally excluded to prevent re-fetch loop
  }, [resourceSlug, pathSegment])

  // Load records when page changes (skip page 1 if SSR data already available)
  useEffect(() => {
    if (page === 1 && initialData) return
    if (!resourceSlug || !foreignKey) { setLoading(false); return }
    setLoading(true)
    const relatedUrl  = `/${pathSegment}/api/${resourceSlug}/_related?fk=${encodeURIComponent(foreignKey)}&id=${encodeURIComponent(parentId)}&page=${page}${throughMany ? '&through=true' : ''}`
    fetch(relatedUrl)
      .then(r => r.json())
      .then((d: { data: RelatedRecord[]; meta: PaginationMeta }) => {
        setRecords(d.data)
        setPagination(d.meta)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialData is SSR-only, intentionally excluded to prevent re-fetch loop
  }, [resourceSlug, foreignKey, parentId, pathSegment, page, throughMany])

  if (!resourceSlug) return null

  // Create URL: pre-fill the FK and pass back URL so cancel/save return to this record
  const backUrl  = `/${pathSegment}/resources/${parentSlug}/${parentId}`
  const createHref = foreignKey
    ? `/${pathSegment}/resources/${resourceSlug}/create?prefill[${foreignKey}]=${parentId}&back=${encodeURIComponent(backUrl)}`
    : `/${pathSegment}/resources/${resourceSlug}/create?back=${encodeURIComponent(backUrl)}`

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">{field.label}</h2>
          {pagination && (
            <Badge variant="secondary" className="text-xs">{pagination.total}</Badge>
          )}
        </div>
        <a
          href={createHref}
          className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity"
        >
          {i18n.newRecord}
        </a>
      </div>

      <div className="rounded-xl border overflow-hidden">
        {loading ? (
          <p className="px-6 py-8 text-sm text-muted-foreground text-center">{i18n.loading}</p>
        ) : records.length === 0 ? (
          <p className="px-6 py-8 text-sm text-muted-foreground text-center">{i18n.noRecordsFound}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                {schema.map(col => (
                  <TableHead key={col.name} className="px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {col.label}
                  </TableHead>
                ))}
                <TableHead className="px-4 py-3 w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map(row => (
                <TableRow key={row.id} className="transition-colors hover:bg-muted/30">
                  {schema.map((col, ci) => (
                    <TableCell key={col.name} className="px-4 py-3 text-foreground">
                      {ci === 0
                        ? (
                          <a href={`/${pathSegment}/resources/${resourceSlug}/${row.id}`} className="font-medium hover:text-primary transition-colors">
                            <CellValue value={resolveCellValue(row, col)} type={col.type} extra={col.extra} displayTransformed={col.displayTransformed} pathSegment={pathSegment} i18n={i18n} />
                          </a>
                        )
                        : <CellValue value={resolveCellValue(row, col)} type={col.type} extra={col.extra} displayTransformed={col.displayTransformed} pathSegment={pathSegment} i18n={i18n} />
                      }
                    </TableCell>
                  ))}
                  <TableCell className="px-4 py-3 text-end">
                    <a
                      href={`/${pathSegment}/resources/${resourceSlug}/${row.id}`}
                      className="text-xs text-primary hover:underline"
                    >
                      {i18n.view}
                    </a>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Pagination */}
      {pagination && pagination.lastPage > 1 && (
        <div className="flex items-center justify-between mt-3 text-sm text-muted-foreground">
          <span>{t(i18n.records, { n: pagination.total })}</span>
          <div className="flex gap-1">
            {Array.from({ length: pagination.lastPage }, (_, i) => i + 1).map(p => (
              <button
                key={p}
                type="button"
                onClick={() => setPage(p)}
                className={[
                  'w-8 h-8 text-sm rounded-md transition-colors',
                  p === pagination.currentPage
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground',
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
