'use client'

import { useState, useRef, useEffect } from 'react'
import type { PanelI18n } from '@boostkit/panels'
import { ResourceIcon } from './ResourceIcon.js'

// ─── Types ──────────────────────────────────────────────────

interface DataFieldMeta {
  name:       string
  label:      string
  type:       string
  format?:    string
  href?:      string
  editable?:  boolean
  editMode?:  string
  editField?: unknown
  sortable?:  boolean
  searchable?: boolean
}

interface ViewModeMeta {
  type:        string
  name:        string
  label:       string
  icon?:       string
  fields?:     DataFieldMeta[]
}

interface PaginationMeta {
  total:       number
  currentPage: number
  perPage:     number
  lastPage:    number
  type:        'pages' | 'loadMore'
}

interface DataViewElement {
  type:              'dataview'
  title:             string
  id:                string
  records:           Record<string, unknown>[]
  titleField?:       string
  descriptionField?: string
  imageField?:       string
  views?:            ViewModeMeta[]
  activeView?:       string
  description?:      string
  searchable?:       boolean
  searchColumns?:    string[]
  pagination?:       PaginationMeta
  filters?:          unknown[]
  actions?:          unknown[]
  activeSearch?:     string
  activeSort?:       { col: string; dir: string }
  activeFilters?:    Record<string, string>
  lazy?:             boolean
  pollInterval?:     number
  live?:             boolean
  remember?:         string
  emptyMessage?:     string
  emptyState?:       { icon?: string; heading?: string; description?: string }
  href?:             string
  creatableUrl?:     string | boolean
  groupBy?:          string
  recordClick?:      string
  exportable?:       string[]
  defaultView?:      Record<string, string>
  folderField?:      string
  sortableOptions?:  { field: string; label: string }[]
  scopes?:           { label: string; icon?: string }[]
  activeScope?:      number
  renderedRecords?:  unknown[][]
}

interface Props {
  element:   DataViewElement
  panelPath: string
  i18n:      PanelI18n
}

// ─── Component ──────────────────────────────────────────────

export function SchemaDataView({ element, panelPath, i18n }: Props) {
  const {
    title, id: elementId, records: initialRecords, views,
    titleField, descriptionField, imageField,
    searchable, pagination: initialPagination,
    activeSearch: ssrSearch, defaultView,
    emptyState, description, href, creatableUrl, groupBy, recordClick,
  } = element
  const sortableOptions = element.sortableOptions
  const scopePresets = element.scopes

  // ── State ──
  const [records, setRecords] = useState(initialRecords)
  const [search, setSearch]   = useState(ssrSearch ?? '')
  const [pagination, setPagination] = useState(initialPagination)
  const [currentPage, setCurrentPage] = useState(initialPagination?.currentPage ?? 1)
  const [loading, setLoading] = useState(false)
  const [sortField, setSortField] = useState(element.activeSort?.col ?? '')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>((element.activeSort?.dir?.toLowerCase() as 'asc' | 'desc') ?? 'asc')
  const [activeScope, setActiveScope] = useState(element.activeScope ?? 0)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Active view ──
  const viewOptions = views ?? []
  const defaultViewName = viewOptions.length > 0 ? viewOptions[0]!.name : 'list'
  const [activeView, setActiveView] = useState(element.activeView ?? defaultViewName)
  const rememberMode = element.remember
  const pathSegment = panelPath.replace(/^\//, '')

  // Save state to session (same as SchemaTable remember)
  function buildState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const state: Record<string, unknown> = { view: activeView, search, page: currentPage }
    if (sortField) { state.sort = sortField; state.dir = sortDir }
    if (activeScope > 0) state.scope = activeScope
    return { ...state, ...overrides }
  }

  function saveRememberState(state: Record<string, unknown>) {
    if (!rememberMode || rememberMode === 'localStorage') return
    if (rememberMode === 'session') {
      void fetch(`${panelPath}/api/_tables/${elementId}/remember`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      })
    }
  }

  function handleViewChange(viewName: string) {
    setActiveView(viewName)
    saveRememberState(buildState({ view: viewName }))
  }

  // ── Container-based responsive default view (first visit only) ──
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Skip if user already has a persisted view (SSR sent it via activeView)
    if (element.activeView) return
    if (!defaultView || !containerRef.current) return
    const width = containerRef.current.clientWidth
    const bp = width < 480 ? 'sm' : width < 768 ? 'md' : 'lg'
    const target = defaultView[bp] ?? defaultView['lg'] ?? defaultView['md'] ?? defaultView['sm']
    if (target && target !== activeView) {
      setActiveView(target)
      saveRememberState(buildState({ view: target }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Fetch ──
  async function fetchData(opts: { page?: number; search?: string; sort?: string; dir?: string; filters?: Record<string, string> } = {}) {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('page', String(opts.page ?? currentPage))
      const searchVal = opts.search !== undefined ? opts.search : search
      if (searchVal) params.set('search', searchVal)
      const s = opts.sort ?? sortField
      const d = opts.dir ?? sortDir
      if (s) { params.set('sort', s); params.set('dir', d) }
      const filtersToApply = opts.filters ?? {}
      for (const [k, v] of Object.entries(filtersToApply)) {
        if (v) params.set(`filter[${k}]`, v)
      }
      const res = await fetch(`${panelPath}/api/_tables/${elementId}?${params}`)
      if (!res.ok) return
      const body = await res.json() as { records: Record<string, unknown>[]; pagination?: PaginationMeta }
      setRecords(body.records)
      if (body.pagination) setPagination(body.pagination)
    } finally {
      setLoading(false)
    }
  }

  function handleSearchChange(value: string) {
    setSearch(value)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      void fetchData({ page: 1, search: value })
      setCurrentPage(1)
      saveRememberState(buildState({ search: value, page: 1 }))
    }, 300)
  }

  function handlePageChange(page: number) {
    setCurrentPage(page)
    void fetchData({ page, search })
    saveRememberState(buildState({ page }))
  }

  function handleSortChange(field: string) {
    const newDir = field === sortField ? (sortDir === 'asc' ? 'desc' : 'asc') : 'asc'
    setSortField(field)
    setSortDir(newDir)
    void fetchData({ page: 1, sort: field, dir: newDir })
    setCurrentPage(1)
    saveRememberState(buildState({ sort: field, dir: newDir, page: 1 }))
  }

  function handleScopeChange(index: number) {
    setActiveScope(index)
    // Scopes are applied server-side via the scope index query param
    const params = new URLSearchParams()
    params.set('page', '1')
    if (search) params.set('search', search)
    if (sortField) { params.set('sort', sortField); params.set('dir', sortDir) }
    params.set('scope', String(index))
    setLoading(true)
    fetch(`${panelPath}/api/_tables/${elementId}?${params}`)
      .then(r => r.ok ? r.json() : null)
      .then((body: { records: Record<string, unknown>[]; pagination?: PaginationMeta } | null) => {
        if (body) {
          setRecords(body.records)
          if (body.pagination) setPagination(body.pagination)
        }
      })
      .finally(() => setLoading(false))
    setCurrentPage(1)
    saveRememberState(buildState({ scope: index, page: 1 }))
  }

  // ── Record click URL ──
  function getRecordHref(record: Record<string, unknown>): string | undefined {
    if (recordClick === 'edit') return href ? `${href}/${record.id}/edit` : undefined
    if (recordClick === 'custom' && record._href) return String(record._href)
    if (href) return `${href}/${record.id}`
    return undefined
  }

  // ── Group records ──
  function groupRecords(recs: Record<string, unknown>[]): { label: string; records: Record<string, unknown>[] }[] {
    if (!groupBy) return [{ label: '', records: recs }]
    const groups: { label: string; records: Record<string, unknown>[] }[] = []
    let currentGroup: string | null = null
    for (const r of recs) {
      const val = String(r[groupBy] ?? '')
      if (val !== currentGroup) {
        currentGroup = val
        groups.push({ label: val, records: [] })
      }
      groups[groups.length - 1]!.records.push(r)
    }
    return groups
  }

  const grouped = groupRecords(records)
  const isEmpty = records.length === 0 && !loading

  return (
    <div ref={containerRef} style={{ containerType: 'inline-size' }}>
      {/* Title */}
      {title && (
        <div className="mb-1 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">{title}</p>
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
        </div>
      )}

      {/* Scope pills */}
      {scopePresets && scopePresets.length > 0 && (
        <div className="flex items-center gap-1 mb-2">
          {scopePresets.map((scope, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleScopeChange(i)}
              className={[
                'inline-flex items-center px-3 py-1.5 text-sm rounded-md transition-colors',
                activeScope === i
                  ? 'bg-primary text-primary-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              ].join(' ')}
            >
              {scope.icon && <span className="mr-1.5"><ResourceIcon icon={scope.icon} /></span>}
              {scope.label}
            </button>
          ))}
        </div>
      )}

      {/* Toolbar: search + sort + view toggle + export */}
      <div className="py-2.5 flex items-center gap-3 flex-wrap">
        {searchable && (
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder={`${i18n.search?.replace(':label', title) ?? `Search ${title}…`}`}
              className="h-8 rounded-md border bg-background pl-8 pr-8 text-sm w-56 focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/60"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
            {search && (
              <button
                type="button"
                onClick={() => handleSearchChange('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        )}

        {/* Sort dropdown */}
        {sortableOptions && sortableOptions.length > 0 && (
          <div className="flex items-center gap-1">
            <select
              value={sortField}
              onChange={(e) => handleSortChange(e.target.value)}
              className="h-8 rounded-md border bg-background px-2 text-sm text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">Sort by…</option>
              {sortableOptions.map((opt) => (
                <option key={opt.field} value={opt.field}>{opt.label}</option>
              ))}
            </select>
            {sortField && (
              <button
                type="button"
                onClick={() => {
                  const newDir = sortDir === 'asc' ? 'desc' : 'asc'
                  setSortDir(newDir)
                  void fetchData({ page: 1, sort: sortField, dir: newDir })
                  setCurrentPage(1)
                  saveRememberState(buildState({ sort: sortField, dir: newDir, page: 1 }))
                }}
                className="h-8 w-8 inline-flex items-center justify-center rounded-md border bg-background text-muted-foreground hover:text-foreground transition-colors"
                title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
              >
                {sortDir === 'asc' ? '↑' : '↓'}
              </button>
            )}
          </div>
        )}

        {/* View toggle */}
        {viewOptions.length > 1 && (
          <div className="flex items-center gap-0.5 ml-auto border rounded-md p-0.5">
            {viewOptions.map((v) => (
              <button
                key={v.name}
                type="button"
                data-view-toggle={v.name}
                onClick={() => handleViewChange(v.name)}
                className={[
                  'inline-flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors',
                  activeView === v.name
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                ].join(' ')}
                title={v.label}
              >
                {v.icon && <ResourceIcon icon={v.icon} />}
                <span className="hidden sm:inline">{v.label}</span>
              </button>
            ))}
          </div>
        )}

        {/* Export */}
        {element.exportable && element.exportable.length > 0 && (
          <button
            type="button"
            onClick={() => {
              const params = new URLSearchParams()
              params.set('format', element.exportable![0]!)
              if (search) params.set('search', search)
              window.open(`${panelPath}/api/_tables/${elementId}/export?${params}`, '_blank')
            }}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground border rounded-md hover:bg-accent transition-colors"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Export
          </button>
        )}

        {/* View all link */}
        {href && (
          <a href={href} className="text-xs text-muted-foreground hover:text-foreground transition-colors ml-auto">
            {i18n.viewAll ?? 'View all →'}
          </a>
        )}
      </div>

      {/* Empty state */}
      {isEmpty && (
        <div className="rounded-xl border bg-card p-12 text-center">
          {emptyState?.icon && <div className="mx-auto mb-3 text-3xl text-muted-foreground/40"><ResourceIcon icon={emptyState.icon} /></div>}
          <p className="text-sm font-medium text-muted-foreground">{emptyState?.heading ?? i18n.noResultsTitle ?? 'No results'}</p>
          {emptyState?.description && <p className="text-xs text-muted-foreground mt-1">{emptyState.description}</p>}
        </div>
      )}

      {/* Content — active view */}
      {!isEmpty && (() => {
        // Find the active view's field definitions
        const activeViewMeta = viewOptions.find(v => v.name === activeView)
        const viewFields = activeViewMeta?.fields

        // For list/grid: use view fields or fall back to titleField/descriptionField/imageField
        const viewType = activeViewMeta?.type ?? activeView

        if (viewType === 'table' && viewFields) {
          return <TableView records={records} fields={viewFields} getHref={getRecordHref} sortField={sortField} sortDir={sortDir} onSort={handleSortChange} />
        }
        if (viewType === 'grid') {
          return (
            <GridView
              groups={grouped}
              fields={viewFields}
              titleField={titleField ?? 'id'}
              descriptionField={descriptionField}
              imageField={imageField}
              getHref={getRecordHref}
              groupBy={groupBy}
            />
          )
        }
        // Default: list view
        return (
          <ListView
            groups={grouped}
            fields={viewFields}
            titleField={titleField ?? 'id'}
            descriptionField={descriptionField}
            imageField={imageField}
            getHref={getRecordHref}
            groupBy={groupBy}
          />
        )
      })()}

      {/* Pagination */}
      {pagination && pagination.lastPage > 1 && (
        <div className="flex items-center justify-between pt-4 text-xs text-muted-foreground">
          <span>{i18n.showing?.replace(':n', String(records.length)).replace(':total', String(pagination.total)) ?? `Showing ${records.length} of ${pagination.total}`}</span>
          <div className="flex items-center gap-1">
            {Array.from({ length: pagination.lastPage }, (_, i) => i + 1).map((page) => (
              <button
                key={page}
                type="button"
                onClick={() => handlePageChange(page)}
                className={[
                  'h-7 min-w-7 px-2 rounded text-xs transition-colors',
                  page === currentPage
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'hover:bg-accent',
                ].join(' ')}
              >
                {page}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── FieldValue — renders a single DataField value ──────────

function FieldValue({ field, record }: { field: DataFieldMeta; record: Record<string, unknown> }) {
  const value = record[field.name]
  if (value === null || value === undefined) return <span className="text-muted-foreground/40">—</span>

  if (field.type === 'image') {
    return <img src={String(value)} alt="" className="h-10 w-10 rounded-md object-cover shrink-0" />
  }
  if (field.type === 'badge') {
    return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground">{String(value)}</span>
  }
  if (field.type === 'boolean') {
    return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground">{value ? 'Yes' : 'No'}</span>
  }
  if (field.type === 'date') {
    try {
      const d = value instanceof Date ? value : new Date(String(value))
      return <span>{d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
    } catch { return <span>{String(value)}</span> }
  }

  return <span>{String(value)}</span>
}

// ─── ListView ───────────────────────────────────────────────

function ListView({ groups, fields, titleField, descriptionField, imageField, getHref, groupBy }: {
  groups:           { label: string; records: Record<string, unknown>[] }[]
  fields?:          DataFieldMeta[]
  titleField:       string
  descriptionField?: string
  imageField?:      string
  getHref:          (r: Record<string, unknown>) => string | undefined
  groupBy?:         string
}) {
  return (
    <div className="rounded-xl border overflow-hidden divide-y">
      {groups.map((group, gi) => (
        <div key={gi}>
          {groupBy && group.label && (
            <div className="px-4 py-2 bg-muted/40 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {group.label}
            </div>
          )}
          {group.records.map((record) => {
            const href = getHref(record)
            const Tag = href ? 'a' : 'div'

            // With DataField definitions
            if (fields && fields.length > 0) {
              const imgField = fields.find(f => f.type === 'image')
              const textFields = fields.filter(f => f.type !== 'image')
              return (
                <Tag key={String(record.id)} {...(href ? { href } : {})} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/30 transition-colors">
                  {imgField && record[imgField.name] && <FieldValue field={imgField} record={record} />}
                  <div className="flex-1 min-w-0">
                    {textFields.map((f, i) => (
                      <p key={f.name} className={i === 0 ? 'text-sm font-medium truncate' : 'text-xs text-muted-foreground truncate'}>
                        <FieldValue field={f} record={record} />
                      </p>
                    ))}
                  </div>
                  {href && <span className="text-xs text-muted-foreground">→</span>}
                </Tag>
              )
            }

            // Fallback: titleField / descriptionField / imageField
            return (
              <Tag key={String(record.id)} {...(href ? { href } : {})} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/30 transition-colors">
                {imageField && record[imageField] && (
                  <img src={String(record[imageField])} alt="" className="h-10 w-10 rounded-md object-cover shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{String(record[titleField] ?? '')}</p>
                  {descriptionField && record[descriptionField] !== undefined && (
                    <p className="text-xs text-muted-foreground truncate">{String(record[descriptionField] ?? '')}</p>
                  )}
                </div>
                {href && <span className="text-xs text-muted-foreground">→</span>}
              </Tag>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ─── GridView ───────────────────────────────────────────────

function GridView({ groups, fields, titleField, descriptionField, imageField, getHref, groupBy }: {
  groups:           { label: string; records: Record<string, unknown>[] }[]
  fields?:          DataFieldMeta[]
  titleField:       string
  descriptionField?: string
  imageField?:      string
  getHref:          (r: Record<string, unknown>) => string | undefined
  groupBy?:         string
}) {
  return (
    <div>
      {groups.map((group, gi) => (
        <div key={gi}>
          {groupBy && group.label && (
            <div className="px-1 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {group.label}
            </div>
          )}
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {group.records.map((record) => {
              const href = getHref(record)
              const Tag = href ? 'a' : 'div'

              // With DataField definitions
              if (fields && fields.length > 0) {
                const imgField = fields.find(f => f.type === 'image')
                const textFields = fields.filter(f => f.type !== 'image')
                return (
                  <Tag key={String(record.id)} {...(href ? { href } : {})} className="rounded-xl border bg-card p-4 hover:bg-muted/30 transition-colors flex flex-col gap-2">
                    {imgField && record[imgField.name] && (
                      <img src={String(record[imgField.name])} alt="" className="h-32 w-full rounded-lg object-cover" />
                    )}
                    {textFields.map((f, i) => (
                      <p key={f.name} className={i === 0 ? 'text-sm font-medium truncate' : 'text-xs text-muted-foreground truncate'}>
                        <FieldValue field={f} record={record} />
                      </p>
                    ))}
                  </Tag>
                )
              }

              // Fallback
              return (
                <Tag key={String(record.id)} {...(href ? { href } : {})} className="rounded-xl border bg-card p-4 hover:bg-muted/30 transition-colors flex flex-col gap-2">
                  {imageField && record[imageField] && (
                    <img src={String(record[imageField])} alt="" className="h-32 w-full rounded-lg object-cover" />
                  )}
                  <p className="text-sm font-medium truncate">{String(record[titleField] ?? '')}</p>
                  {descriptionField && record[descriptionField] !== undefined && (
                    <p className="text-xs text-muted-foreground truncate">{String(record[descriptionField] ?? '')}</p>
                  )}
                </Tag>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── TableView ──────────────────────────────────────────────

function TableView({ records, fields, getHref, sortField, sortDir, onSort }: {
  records:    Record<string, unknown>[]
  fields:     DataFieldMeta[]
  getHref:    (r: Record<string, unknown>) => string | undefined
  sortField?: string
  sortDir?:   string
  onSort?:    (field: string) => void
}) {
  return (
    <div className="rounded-xl border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              {fields.map((f) => {
                const isSortable = f.sortable
                const isActive = sortField === f.name
                return (
                  <th
                    key={f.name}
                    className={[
                      'text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider',
                      isSortable ? 'cursor-pointer select-none hover:text-foreground' : '',
                    ].join(' ')}
                    onClick={isSortable && onSort ? () => onSort(f.name) : undefined}
                  >
                    {f.label}
                    {isSortable && (
                      <svg width="10" height="12" viewBox="0 0 10 12" fill="none" className="inline ml-1" style={{ opacity: isActive ? 1 : 0.3 }}>
                        <path d="M5 1L2 4h6L5 1Z" fill="currentColor" opacity={isActive && sortDir === 'asc' ? 1 : 0.3} />
                        <path d="M5 11L2 8h6L5 11Z" fill="currentColor" opacity={isActive && sortDir === 'desc' ? 1 : 0.3} />
                      </svg>
                    )}
                  </th>
                )
              })}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={String(record.id)} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                {fields.map((f) => (
                  <td key={f.name} className="px-4 py-2.5 text-muted-foreground">
                    <FieldValue field={f} record={record} />
                  </td>
                ))}
                <td className="px-4 py-2.5 text-right">
                  {getHref(record) && (
                    <a href={getHref(record)!} className="text-xs text-muted-foreground hover:text-foreground transition-colors">→</a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
