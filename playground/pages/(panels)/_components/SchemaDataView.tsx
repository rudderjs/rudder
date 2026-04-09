'use client'

import { useState, useRef, useEffect, useCallback, type RefCallback } from 'react'
import { useDataViewFetch } from './hooks/useDataViewFetch.js'
import { useLiveUpdates } from './hooks/useLiveUpdates.js'
import { usePersistence } from './hooks/usePersistence.js'
import type { PanelI18n, PanelColumnMeta } from '@pilotiq/panels'
import { ResourceIcon } from './ResourceIcon.js'
import { TableEditCell } from './TableEditCell.js'
import { ConfirmDialog } from './ConfirmDialog.js'
import { Checkbox } from '@/components/ui/checkbox.js'
import { Tabs as ScopeTabs, TabsList as ScopeTabsList, TabsTab as ScopeTabsTab, TabsPanels as ScopeTabsPanels, TabsPanel as ScopeTabsPanel } from '@/components/animate-ui/components/base/tabs.js'
import { Tabs as ScopeTabsPrimitive } from '@/components/animate-ui/primitives/base/tabs.js'

// auto-animate: client-only lazy hook (SSR-safe)
function useAutoAnimate(): [RefCallback<HTMLElement>] {
  const parentRef = useRef<HTMLElement | null>(null)
  const initialized = useRef(false)
  const ref: RefCallback<HTMLElement> = (el) => {
    parentRef.current = el
    if (el && !initialized.current && typeof window !== 'undefined') {
      initialized.current = true
      import('@formkit/auto-animate').then(({ default: autoAnimate }) => {
        if (parentRef.current) autoAnimate(parentRef.current)
      }).catch(() => {})
    }
  }
  return [ref]
}


// ─── Action types ────────────────────────────────────────────
interface ActionMeta {
  name:            string
  label:           string
  icon?:           string
  destructive:     boolean
  requiresConfirm: boolean
  confirmMessage?: string
  bulk:            boolean
  row:             boolean
  url?:            string
}

// ─── Client-only hook ───────────────────────────────────────
function useIsMounted() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  return mounted
}

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
  layout?:     string
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
  filters?:          { name: string; type: string; label: string; extra?: Record<string, unknown> }[]
  actions?:          ActionMeta[]
  activeSearch?:     string
  activeSort?:       { col: string; dir: string }
  activeFilters?:    Record<string, string>
  lazy?:             boolean
  pollInterval?:     number
  live?:             boolean
  liveChannel?:      string
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
  iconField?:        string
  activeFolder?:     string | null
  breadcrumbs?:      { id: string; label: string }[]
  reorderable?:      boolean
  reorderEndpoint?:  string
  reorderField?:     string
  reorderModel?:     string
  sortableOptions?:  { field: string; label: string }[]
  scopes?:           { label: string; icon?: string }[]
  activeScope?:      number
  resource?:         string
  renderedRecords?:  unknown[][]
  softDeletes?:      boolean
  autoAnimate?:      boolean | { duration?: number }
  animateScopes?:    boolean | { highlight?: boolean; content?: boolean }
}

/** Resource-context props — enables resource API mode. */
export interface SchemaDataViewResourceProps {
  resourceSlug: string
  isTrashed?: boolean
}

interface Props {
  element:   DataViewElement
  panelPath: string
  i18n:      PanelI18n
  resource?: SchemaDataViewResourceProps
}

// ─── Component ──────────────────────────────────────────────

export function SchemaDataView({ element, panelPath, i18n, resource }: Props) {
  const {
    title, id: elementId, records: initialRecords, views,
    titleField, descriptionField, imageField, iconField,
    searchable, pagination: initialPagination,
    activeSearch: ssrSearch, defaultView,
    emptyState, description, href, creatableUrl, groupBy, recordClick,
  } = element
  const sortableOptions = element.sortableOptions
  const scopePresets = element.scopes

  // Animation flags
  const animateScopes = element.animateScopes
  const scopeHighlightAnimated = animateScopes === true || (typeof animateScopes === 'object' && animateScopes.highlight !== false)
  const scopeContentAnimated = animateScopes === true || (typeof animateScopes === 'object' && animateScopes.content === true)

  // Auto-detect resource mode from element.resource or explicit prop
  const resourceSlug = resource?.resourceSlug ?? (element.resource || undefined)

  // Force re-render after dnd-kit loads (client-only)
  const [dndReady, setDndReady] = useState(!!_dnd)
  useEffect(() => {
    if (!dndReady && _dndPromise) {
      _dndPromise.then(() => setDndReady(true))
    }
  }, [dndReady])

  // ── Selection (for bulk actions) ──
  const bulkActions = (element.actions ?? []).filter(a => a.bulk)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [actionLoading, setActionLoading] = useState(false)
  const [confirmAction, setConfirmAction] = useState<ActionMeta | null>(null)
  function clearSelection() { setSelectedIds(new Set()) }

  // ── Fetch hook ──
  const {
    records, pagination, currentPage, search, sortField, sortDir,
    activeScope, activeFilters, currentFolder, breadcrumbs, loading,
    fetchData, handleSearchChange, handlePageChange, handleLoadMore,
    handleSortChange, handleScopeChange, handleFilterChange, clearFilters,
    handleFolderNavigate, setRecords, stateRefs,
  } = useDataViewFetch(
    { elementId, panelPath, resourceSlug, isTrashed: resource?.isTrashed, scopePresets: element.scopes },
    {
      records: initialRecords,
      pagination: initialPagination,
      search: ssrSearch,
      sortField: element.activeSort?.col,
      sortDir: element.activeSort?.dir?.toLowerCase() as 'asc' | 'desc' | undefined,
      activeScope: element.activeScope,
      activeFilters: element.activeFilters,
      activeFolder: element.activeFolder,
      breadcrumbs: element.breadcrumbs,
    },
    { onStateChange: (state) => saveRememberState(state), clearSelection },
  )

  const filters = element.filters ?? []
  const folderField = element.folderField

  // Toggle all on the *current page* only
  function toggleSelectAll() {
    const pageIds = new Set(records.map(r => String(r.id)))
    const allOnPageSelected = records.length > 0 && records.every(r => selectedIds.has(String(r.id)))
    if (allOnPageSelected) {
      // Deselect current page records, keep others
      setSelectedIds(prev => {
        const next = new Set(prev)
        for (const id of pageIds) next.delete(id)
        return next
      })
    } else {
      // Add current page records to selection
      setSelectedIds(prev => new Set([...prev, ...pageIds]))
    }
  }

  function toggleSelectRecord(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function executeAction(action: ActionMeta) {
    if (selectedIds.size === 0) return
    if (action.requiresConfirm && !confirmAction) {
      setConfirmAction(action)
      return
    }
    setConfirmAction(null)
    setActionLoading(true)
    try {
      const endpoint = `${panelPath}/api/_tables/${elementId}/action/${action.name}`
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      })
      if (res.ok) {
        setSelectedIds(new Set())
        void fetchData({ page: currentPage })
      }
    } finally {
      setActionLoading(false)
    }
  }

  // ── Persistence hook ──
  const viewOptions = views ?? []
  const defaultViewName = viewOptions.length > 0 ? viewOptions[0]!.name : 'list'
  const containerRef = useRef<HTMLDivElement>(null)
  const pathSegment = panelPath.replace(/^\//, '')

  const { activeView, saveRememberState, handleViewChange: _handleViewChange } = usePersistence(
    { rememberMode: element.remember, elementId, panelPath },
    { viewOptions, defaultView: defaultViewName, ssrActiveView: element.activeView, defaultViewBreakpoints: defaultView },
    containerRef,
  )

  function handleViewChange(viewName: string) {
    _handleViewChange(viewName, fetchData, currentFolder, (overrides) => ({ view: activeView, ...overrides }))
  }

  // ── Lazy: fetch data on client mount (SSR sends empty records) ──
  useEffect(() => {
    if (element.lazy && records.length === 0) {
      void fetchData({ page: 1 })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Live updates + polling ──
  useLiveUpdates(
    { pollInterval: element.pollInterval, live: element.live, liveChannel: element.liveChannel, elementId },
    stateRefs,
    fetchData,
  )

  // Build base href for record links (resource mode auto-generates it)
  const resolvedHref = href ?? (resourceSlug ? `${panelPath}/resources/${resourceSlug}` : undefined)

  function getRecordHref(record: Record<string, unknown>): string | undefined {
    if (recordClick === 'edit') return resolvedHref ? `${resolvedHref}/${record.id}/edit` : undefined
    if (recordClick === 'custom' && record._href) return String(record._href)
    if (resolvedHref) return `${resolvedHref}/${record.id}`
    return undefined
  }

  function getEditHref(record: Record<string, unknown>): string | undefined {
    if (!resourceSlug) return undefined
    return `${panelPath}/resources/${resourceSlug}/${record.id}/edit`
  }

  // ── Reorder handler (dnd-kit — client only) ──
  const reorderEndpoint = element.reorderEndpoint ? `${panelPath}/api${element.reorderEndpoint.replace(/^.*\/api/, '')}` : undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleReorder = useCallback((event: any) => {
    const { active, over } = event as { active: { id: string | number }; over: { id: string | number } | null }
    if (!over || active.id === over.id || !reorderEndpoint || !_dnd) return
    setRecords(prev => {
      const oldIndex = prev.findIndex(r => String(r.id) === String(active.id))
      const newIndex = prev.findIndex(r => String(r.id) === String(over.id))
      if (oldIndex === -1 || newIndex === -1) return prev
      const next = _dnd!.arrayMove(prev, oldIndex, newIndex)
      // Persist
      const ids = next.map(r => String(r.id))
      fetch(reorderEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, field: element.reorderField ?? 'position', model: element.reorderModel }),
      }).catch(() => {})
      return next
    })
  }, [reorderEndpoint, element.reorderField, element.reorderModel])

  // ── Editable save handler ──
  const saveEndpoint = `${panelPath}/api/_tables/${elementId}/save`
  const handleEditSaved = useCallback((record: Record<string, unknown>, field: string, value: unknown) => {
    setRecords(prev => prev.map(r => r.id === record.id ? { ...r, [field]: value } : r))
  }, [])

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
      {/* Title — hidden in resource mode (resource page has its own heading) */}
      {title && !resourceSlug && (
        <div className="mb-1 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">{title}</p>
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
        </div>
      )}

      {/* Scope pills — animated highlight or plain buttons */}
      {scopePresets && scopePresets.length > 0 && (
        scopeHighlightAnimated ? (
          <ScopeTabs value={String(activeScope)} onValueChange={(v) => handleScopeChange(Number(v))}>
            <ScopeTabsList className="mb-2">
              {scopePresets.map((scope, i) => (
                <ScopeTabsTab key={i} value={String(i)}>
                  {scope.icon && <span className="mr-1.5"><ResourceIcon icon={scope.icon} /></span>}
                  {scope.label}
                </ScopeTabsTab>
              ))}
            </ScopeTabsList>
          </ScopeTabs>
        ) : (
          <ScopeTabsPrimitive value={String(activeScope)} onValueChange={(v) => handleScopeChange(Number(v))}>
            <div className="flex items-center gap-1 mb-2">
              {scopePresets.map((scope, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleScopeChange(i)}
                  className={[
                    'inline-flex items-center px-3 py-1.5 text-sm rounded-md transition-colors',
                    activeScope === i
                      ? 'bg-muted text-foreground font-medium'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  ].join(' ')}
                >
                  {scope.icon && <span className="mr-1.5"><ResourceIcon icon={scope.icon} /></span>}
                  {scope.label}
                </button>
              ))}
            </div>
          </ScopeTabsPrimitive>
        )
      )}

      {/* Toolbar (shared across scopes — not animated) */}
      {/* Toolbar: search + sort + view toggle + export */}
      {(searchable || filters.length > 0 || (sortableOptions && sortableOptions.length > 0) || viewOptions.length > 1 || (element.exportable && element.exportable.length > 0)) && (
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

        {/* Filters */}
        {filters.map(filter => {
          if (filter.type === 'select') {
            const options = (filter.extra?.options ?? []) as Array<{ label: string; value: string | number | boolean }>
            return (
              <select
                key={filter.name}
                value={activeFilters[filter.name] ?? ''}
                onChange={(e) => handleFilterChange(filter.name, e.target.value)}
                className="h-8 rounded-md border bg-background px-3 pr-8 text-sm appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring"
                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
              >
                <option value="">{filter.label}</option>
                {options.map(opt => (
                  <option key={String(opt.value)} value={String(opt.value)}>{opt.label}</option>
                ))}
              </select>
            )
          }
          return null
        })}
        {Object.keys(activeFilters).length > 0 && (
          <button
            type="button"
            onClick={clearFilters}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {i18n.clearFilters ?? 'Clear filters'}
          </button>
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
      )}

      {/* Bulk action bar */}
      {bulkActions.length > 0 && selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 rounded-lg bg-primary/5 border border-primary/20 mb-2">
          <span className="text-sm font-medium">
            {selectedIds.size} selected
          </span>
          <div className="flex items-center gap-1.5">
            {bulkActions.map(action => (
              <button
                key={action.name}
                type="button"
                disabled={actionLoading}
                onClick={() => void executeAction(action)}
                className={[
                  'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-50',
                  action.destructive
                    ? 'bg-destructive text-white hover:bg-destructive/90'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90',
                ].join(' ')}
              >
                {action.icon && <ResourceIcon icon={action.icon} />}
                {action.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear
          </button>
        </div>
      )}

      {/* Confirm dialog for destructive actions */}
      {confirmAction && (
        <ConfirmDialog
          open={!!confirmAction}
          onClose={() => setConfirmAction(null)}
          onConfirm={() => void executeAction(confirmAction)}
          title={confirmAction.label}
          message={confirmAction.confirmMessage ?? 'Are you sure you want to perform this action?'}
          danger={confirmAction.destructive}
          confirmLabel={confirmAction.label}
        />
      )}

      {/* Folder breadcrumbs — only in folder view */}
      {folderField && (currentFolder || breadcrumbs.length > 0) && viewOptions.find(v => v.name === activeView)?.type === 'folder' && (
        <div className="flex items-center gap-1 py-2 text-sm">
          <button
            type="button"
            onClick={() => handleFolderNavigate(null)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
          </button>
          {breadcrumbs.map((crumb, i) => (
            <span key={crumb.id} className="flex items-center gap-1">
              <span className="text-muted-foreground/50">/</span>
              {i < breadcrumbs.length - 1 ? (
                <button
                  type="button"
                  onClick={() => handleFolderNavigate(crumb.id)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {crumb.label}
                </button>
              ) : (
                <span className="font-medium">{crumb.label}</span>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Data content — animated when scopes + animateScopes enabled */}
      {scopePresets && scopePresets.length > 0 && scopeContentAnimated ? (
        <ScopeTabs value={String(activeScope)} className="gap-0">
          <ScopeTabsPanels>
            {scopePresets.map((_, i) => (
              <ScopeTabsPanel key={i} value={String(i)}>
                {renderDataContent()}
              </ScopeTabsPanel>
            ))}
          </ScopeTabsPanels>
        </ScopeTabs>
      ) : renderDataContent()}
    </div>
  )

  function renderDataContent() { return (<>
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
        const isReorderable = !!element.reorderable && !groupBy

        if (viewType === 'table' && viewFields) {
          return <TableView records={records} fields={viewFields} getHref={getRecordHref} getEditHref={getEditHref} sortField={sortField} sortDir={sortDir} onSort={handleSortChange} saveEndpoint={saveEndpoint} panelPath={panelPath} i18n={i18n} onSaved={handleEditSaved} reorderable={isReorderable} onReorder={handleReorder} selectable={bulkActions.length > 0} selectedIds={selectedIds} onToggleAll={toggleSelectAll} onToggleRecord={toggleSelectRecord} enableAutoAnimate={!!element.autoAnimate} />
        }
        if (viewType === 'tree' && element.folderField) {
          return (
            <ClientTreeView
              records={records}
              folderField={element.folderField}
              titleField={titleField ?? 'id'}
              iconField={iconField}
              fields={viewFields}
              reorderable={element.reorderable}
              reorderEndpoint={reorderEndpoint}
              reorderField={element.reorderField}
              reorderModel={element.reorderModel}
              onRecordsChange={(flat) => setRecords(flat)}
            />
          )
        }

        // Folder view — drill-down + drag-to-reparent
        if (viewType === 'folder' && folderField) {
          const folderLayout = activeViewMeta?.layout ?? 'list'
          // Reuse fields from matching sibling view if folder has no own fields
          const folderFields = viewFields ?? viewOptions.find(v => v.type === folderLayout)?.fields ?? viewOptions.find(v => v.type === 'list')?.fields
          return (
            <FolderView
              records={records}
              fields={folderFields}
              layout={folderLayout}
              titleField={titleField ?? 'id'}
              descriptionField={descriptionField}
              imageField={imageField}
              iconField={iconField}
              folderField={folderField}
              onNavigate={handleFolderNavigate}
              onReparent={(itemId, newParentId) => {
                // Persist reparent via reorder endpoint
                if (reorderEndpoint) {
                  fetch(reorderEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      ids: [itemId],
                      field: element.reorderField ?? 'position',
                      model: element.reorderModel,
                      parentField: folderField,
                      parents: { [itemId]: newParentId },
                    }),
                  }).then(() => {
                    // Re-fetch to update the view
                    void fetchData({ viewType: 'folder', folder: currentFolder })
                  }).catch(() => {})
                }
              }}
              saveEndpoint={saveEndpoint}
              panelPath={panelPath}
              i18n={i18n}
              onSaved={handleEditSaved}
            />
          )
        }

        const viewContent = viewType === 'grid' ? (
          <GridView
            groups={grouped}
            fields={viewFields}
            titleField={titleField ?? 'id'}
            descriptionField={descriptionField}
            imageField={imageField}
            iconField={iconField}
            getHref={getRecordHref}
            groupBy={groupBy}
            saveEndpoint={saveEndpoint}
            panelPath={panelPath}
            i18n={i18n}
            onSaved={handleEditSaved}
            reorderable={isReorderable}
            enableAutoAnimate={!!element.autoAnimate}
          />
        ) : (
          <ListView
            groups={grouped}
            fields={viewFields}
            titleField={titleField ?? 'id'}
            descriptionField={descriptionField}
            imageField={imageField}
            iconField={iconField}
            getHref={getRecordHref}
            groupBy={groupBy}
            saveEndpoint={saveEndpoint}
            panelPath={panelPath}
            i18n={i18n}
            onSaved={handleEditSaved}
            reorderable={isReorderable}
            enableAutoAnimate={!!element.autoAnimate}
          />
        )

        if (isReorderable) {
          return (
            <DndWrapper items={records.map(r => String(r.id))} onDragEnd={handleReorder} strategy={viewType === 'grid' ? 'grid' : 'vertical'}>
              {viewContent}
            </DndWrapper>
          )
        }
        return viewContent
      })()}

      {/* Pagination */}
      {pagination && pagination.type === 'loadMore' ? (
        pagination.currentPage < pagination.lastPage && (
          <div className="flex flex-col items-center gap-2 pt-4">
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={loading}
              className="px-4 py-2 text-sm rounded-md border hover:bg-accent transition-colors disabled:opacity-50"
            >
              {loading ? (i18n.loading ?? 'Loading…') : (i18n.loadMore ?? 'Load more')}
            </button>
            <span className="text-xs text-muted-foreground">
              {i18n.showing?.replace(':n', String(records.length)).replace(':total', String(pagination.total)) ?? `Showing ${records.length} of ${pagination.total}`}
            </span>
          </div>
        )
      ) : pagination && pagination.lastPage > 1 && (
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
  </>)
  }
}

// ─── ClientTreeView — lazy-loads TreeView on client only ─────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ClientTreeView(props: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [Comp, setComp] = useState<React.ComponentType<any> | null>(null)
  useEffect(() => {
    import('./TreeView.js').then(m => setComp(() => m.TreeView))
  }, [])

  // SSR / before hydration: render a static tree (indented list)
  if (!Comp) {
    return <StaticTreeView {...props} />
  }
  return <Comp {...props} />
}

/** SSR-safe static tree — renders records as indented list matching TreeView layout */
function StaticTreeView({ records, folderField, titleField, iconField, fields }: {
  records: Record<string, unknown>[]; folderField: string; titleField: string; iconField?: string; fields?: DataFieldMeta[]
}) {
  // Build flat list with depth — same as dnd-kit-sortable-tree's flattened output
  const childMap = new Map<string | null, Record<string, unknown>[]>()
  for (const r of records) {
    const pid = r[folderField] ? String(r[folderField]) : null
    if (!childMap.has(pid)) childMap.set(pid, [])
    childMap.get(pid)!.push(r)
  }
  const flatItems: { record: Record<string, unknown>; depth: number; hasChildren: boolean }[] = []
  function flatten(parentId: string | null, depth: number) {
    const children = childMap.get(parentId)
    if (!children) return
    for (const r of children) {
      const id = String(r.id)
      const hasChildren = childMap.has(id)
      flatItems.push({ record: r, depth, hasChildren })
      if (hasChildren) flatten(id, depth + 1)
    }
  }
  flatten(null, 0)

  return (
    <div className="rounded-xl border border-border bg-card p-2">
      {flatItems.map(({ record: r, depth, hasChildren }) => {
        const id = String(r.id)
        const icon = iconField ? r[iconField] as string | undefined : undefined
        const title = String(r[titleField] ?? id)
        return (
          <li key={id} className="list-none m-0" style={{ paddingLeft: `${depth * 24}px`, transition: 'transform linear' }}>
            <div className="flex items-center py-1.5 px-2 rounded-md border border-transparent transition-colors hover:bg-muted hover:border-border">
              <div className="flex items-center gap-2 py-0.5 min-w-0">
                <span className="shrink-0 cursor-grab p-1 text-muted-foreground/40 touch-none"><GripPlaceholder /></span>
                {icon && <span className="text-muted-foreground shrink-0"><ResourceIcon icon={icon} /></span>}
                <span className="text-sm font-medium truncate">{title}</span>
                {fields && fields.map(f => {
                  if (f.name === titleField) return null
                  const val = r[f.name]
                  if (val === null || val === undefined) return null
                  if (f.type === 'badge') {
                    return <span key={f.name} className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs bg-secondary text-secondary-foreground">{String(val)}</span>
                  }
                  return <span key={f.name} className="text-xs text-muted-foreground">{String(val)}</span>
                })}
              </div>
              {hasChildren && (
                <button type="button" className="ml-auto border-none bg-transparent cursor-pointer p-1 text-muted-foreground/40 rounded hover:text-foreground hover:bg-muted transition-colors shrink-0">
                  <svg className="h-3 w-3 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              )}
            </div>
          </li>
        )
      })}
    </div>
  )
}

// ─── Static grip placeholder (SSR-safe) ─────────────────────

function GripPlaceholder() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
      <circle cx="5" cy="3" r="1.5" /><circle cx="11" cy="3" r="1.5" />
      <circle cx="5" cy="8" r="1.5" /><circle cx="11" cy="8" r="1.5" />
      <circle cx="5" cy="13" r="1.5" /><circle cx="11" cy="13" r="1.5" />
    </svg>
  )
}

// ─── SSR-safe sortable wrappers ─────────────────────────────
// dnd-kit references `document` at module level — cannot import during SSR.
// These wrappers render plain elements + grip placeholder during SSR,
// then upgrade to interactive dnd-kit components on the client.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _dnd: typeof import('./SortableList.js') | null = null
const _dndPromise = typeof window !== 'undefined' ? import('./SortableList.js').then(m => { _dnd = m }) : null

function SortableItem({ id, children, reorderable, showHandle }: { id: string; children: React.ReactNode; reorderable?: boolean; showHandle?: boolean }) {
  if (!reorderable) return <>{children}</>
  if (!_dnd) return <div style={{ position: 'relative' }}>{showHandle && <span className="absolute left-1 top-1/2 -translate-y-1/2 z-10 p-1 text-muted-foreground/40"><GripPlaceholder /></span>}{children}</div>
  return <_dnd.SortableItem id={id} showHandle={showHandle}>{children}</_dnd.SortableItem>
}

function SortableTableRow({ id, children, reorderable }: { id: string; children: React.ReactNode; reorderable?: boolean }) {
  if (!reorderable || !_dnd) return <tr className="border-b last:border-0 hover:bg-muted/30 transition-colors">{children}</tr>
  return <_dnd.SortableTableRow id={id}>{children}</_dnd.SortableTableRow>
}

function TableDragHandle({ id }: { id: string }) {
  if (!_dnd) return <td className="px-1 py-2.5 w-6"><span className="text-muted-foreground/40 p-1 inline-flex"><GripPlaceholder /></span></td>
  return <_dnd.TableDragHandle id={id} />
}

function DndWrapper({ items, onDragEnd, strategy, children }: {
  items: string[]; onDragEnd: (e: unknown) => void; strategy: 'vertical' | 'grid'; children: React.ReactNode
}) {
  if (!_dnd) return <>{children}</>
  return <_dnd.SortableWrapper items={items} onDragEnd={onDragEnd} strategy={strategy}>{children}</_dnd.SortableWrapper>
}

// ─── FieldValue — renders a single DataField value ──────────

function FieldValue({ field, record, saveEndpoint, panelPath, i18n, onSaved }: {
  field:         DataFieldMeta
  record:        Record<string, unknown>
  saveEndpoint?: string
  panelPath?:    string
  i18n?:         PanelI18n
  onSaved?:      (record: Record<string, unknown>, field: string, value: unknown) => void
}) {
  // Editable field — delegate to TableEditCell
  if (field.editable && saveEndpoint && panelPath && i18n) {
    return (
      <TableEditCell
        record={record}
        column={field as unknown as PanelColumnMeta}
        saveEndpoint={saveEndpoint}
        panelPath={panelPath}
        i18n={i18n}
        onSaved={onSaved}
      />
    )
  }

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

function ListView({ groups, fields, titleField, descriptionField, imageField, iconField, getHref, groupBy, saveEndpoint, panelPath, i18n, onSaved, onFolderNavigate, reorderable, enableAutoAnimate }: {
  groups:           { label: string; records: Record<string, unknown>[] }[]
  fields?:          DataFieldMeta[]
  titleField:       string
  descriptionField?: string
  imageField?:      string
  iconField?:       string
  getHref:          (r: Record<string, unknown>) => string | undefined
  groupBy?:         string
  saveEndpoint?:    string
  panelPath?:       string
  i18n?:            PanelI18n
  onSaved?:         (record: Record<string, unknown>, field: string, value: unknown) => void
  onFolderNavigate?: (folderId: string | null) => void
  reorderable?:     boolean
  enableAutoAnimate?: boolean
}) {
  const [animateRef] = useAutoAnimate()
  const singleGroup = groups.length === 1 && !groupBy
  return (
    <div ref={enableAutoAnimate && singleGroup ? animateRef : undefined} className="rounded-xl border overflow-hidden divide-y">
      {groups.map((group, gi) => {
        const records = group.records
        const wrapRecords = (children: React.ReactNode) =>
          singleGroup ? <>{children}</> : (
            <GroupContainer key={gi} enableAutoAnimate={!!enableAutoAnimate} groupBy={groupBy} label={group.label}>
              {children}
            </GroupContainer>
          )
        return wrapRecords(records.map((record) => {
            const href = onFolderNavigate ? undefined : getHref(record)
            const isFolder = !!onFolderNavigate
            const Tag = href ? 'a' : 'div'
            const folderClick = isFolder ? () => onFolderNavigate(String(record.id)) : undefined
            const icon = iconField ? record[iconField] as string | undefined : undefined
            const rid = String(record.id)

            // With DataField definitions
            if (fields && fields.length > 0) {
              const imgField = fields.find(f => f.type === 'image')
              const textFields = fields.filter(f => f.type !== 'image')
              return (
                <SortableItem key={rid} id={rid} reorderable={reorderable} showHandle>
                  <Tag {...(href ? { href } : {})} onClick={folderClick} className={`flex items-center gap-4 py-3 hover:bg-muted/30 transition-colors${reorderable ? ' pl-8' : ' px-4'}${isFolder ? ' cursor-pointer' : ''}`} style={reorderable ? { paddingLeft: '2rem', paddingRight: '1rem' } : undefined}>
                    {icon && <span className="text-muted-foreground shrink-0"><ResourceIcon icon={icon} /></span>}
                    {imgField && record[imgField.name] && <FieldValue field={imgField} record={record} saveEndpoint={saveEndpoint} panelPath={panelPath} i18n={i18n} onSaved={onSaved} />}
                    <div className="flex-1 min-w-0">
                      {textFields.map((f, i) => (
                        <p key={f.name} className={i === 0 ? 'text-sm font-medium truncate' : 'text-xs text-muted-foreground truncate'}>
                          <FieldValue field={f} record={record} saveEndpoint={saveEndpoint} panelPath={panelPath} i18n={i18n} onSaved={onSaved} />
                        </p>
                      ))}
                    </div>
                    {(href || isFolder) && <span className="text-xs text-muted-foreground">→</span>}
                  </Tag>
                </SortableItem>
              )
            }

            // Fallback: titleField / descriptionField / imageField
            return (
              <SortableItem key={rid} id={rid} reorderable={reorderable} showHandle>
                <Tag {...(href ? { href } : {})} onClick={folderClick} className={`flex items-center gap-4 py-3 hover:bg-muted/30 transition-colors${isFolder ? ' cursor-pointer' : ''}`} style={reorderable ? { paddingLeft: '2rem', paddingRight: '1rem' } : undefined}>
                  {icon && <span className="text-muted-foreground shrink-0"><ResourceIcon icon={icon} /></span>}
                  {imageField && record[imageField] && (
                    <img src={String(record[imageField])} alt="" className="h-10 w-10 rounded-md object-cover shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{String(record[titleField] ?? '')}</p>
                    {descriptionField && record[descriptionField] !== undefined && (
                      <p className="text-xs text-muted-foreground truncate">{String(record[descriptionField] ?? '')}</p>
                    )}
                  </div>
                  {(href || isFolder) && <span className="text-xs text-muted-foreground">→</span>}
                </Tag>
              </SortableItem>
            )
          }))
      })}
    </div>
  )
}

/** Wrapper for grouped list/grid records — applies auto-animate ref to the record container. */
function GroupContainer({ children, enableAutoAnimate, groupBy, label }: {
  children:          React.ReactNode
  enableAutoAnimate?: boolean
  groupBy?:          string
  label?:            string
}) {
  const [animateRef] = useAutoAnimate()
  return (
    <div ref={enableAutoAnimate ? animateRef : undefined}>
      {groupBy && label && (
        <div className="px-4 py-2 bg-muted/40 text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </div>
      )}
      {children}
    </div>
  )
}

// ─── GridView ───────────────────────────────────────────────

function GridView({ groups, fields, titleField, descriptionField, imageField, iconField, getHref, groupBy, saveEndpoint, panelPath, i18n, onSaved, onFolderNavigate, reorderable, enableAutoAnimate }: {
  groups:           { label: string; records: Record<string, unknown>[] }[]
  fields?:          DataFieldMeta[]
  titleField:       string
  descriptionField?: string
  imageField?:      string
  iconField?:       string
  getHref:          (r: Record<string, unknown>) => string | undefined
  groupBy?:         string
  saveEndpoint?:    string
  panelPath?:       string
  i18n?:            PanelI18n
  onSaved?:         (record: Record<string, unknown>, field: string, value: unknown) => void
  onFolderNavigate?: (folderId: string | null) => void
  reorderable?:     boolean
  enableAutoAnimate?: boolean
}) {
  const [animateRef] = useAutoAnimate()
  return (
    <div>
      {groups.map((group, gi) => (
        <div key={gi}>
          {groupBy && group.label && (
            <div className="px-1 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {group.label}
            </div>
          )}
          <div ref={enableAutoAnimate ? animateRef : undefined} className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {group.records.map((record) => {
              const href = onFolderNavigate ? undefined : getHref(record)
              const isFolder = !!onFolderNavigate
              const Tag = href ? 'a' : 'div'
              const folderClick = isFolder ? () => onFolderNavigate(String(record.id)) : undefined
              const icon = iconField ? record[iconField] as string | undefined : undefined
              const rid = String(record.id)

              // With DataField definitions
              if (fields && fields.length > 0) {
                const imgField = fields.find(f => f.type === 'image')
                const textFields = fields.filter(f => f.type !== 'image')
                return (
                  <SortableItem key={rid} id={rid} reorderable={reorderable} showHandle>
                    <Tag {...(href ? { href } : {})} onClick={folderClick} className={`rounded-xl border bg-card p-4 hover:bg-muted/30 transition-colors flex flex-col gap-2${isFolder ? ' cursor-pointer' : ''}`}>
                      {imgField && record[imgField.name] && (
                        <img src={String(record[imgField.name])} alt="" className="h-32 w-full rounded-lg object-cover" />
                      )}
                      {icon && !imgField && (
                        <div className="text-muted-foreground"><ResourceIcon icon={icon} /></div>
                      )}
                      {textFields.map((f, i) => (
                        <p key={f.name} className={i === 0 ? 'text-sm font-medium truncate' : 'text-xs text-muted-foreground truncate'}>
                          <FieldValue field={f} record={record} saveEndpoint={saveEndpoint} panelPath={panelPath} i18n={i18n} onSaved={onSaved} />
                        </p>
                      ))}
                    </Tag>
                  </SortableItem>
                )
              }

              // Fallback
              return (
                <SortableItem key={rid} id={rid} reorderable={reorderable} showHandle>
                  <Tag {...(href ? { href } : {})} onClick={folderClick} className={`rounded-xl border bg-card p-4 hover:bg-muted/30 transition-colors flex flex-col gap-2${isFolder ? ' cursor-pointer' : ''}`}>
                    {imageField && record[imageField] && (
                      <img src={String(record[imageField])} alt="" className="h-32 w-full rounded-lg object-cover" />
                    )}
                    {icon && !imageField && (
                      <div className="text-muted-foreground"><ResourceIcon icon={icon} /></div>
                    )}
                    <p className="text-sm font-medium truncate">{String(record[titleField] ?? '')}</p>
                    {descriptionField && record[descriptionField] !== undefined && (
                      <p className="text-xs text-muted-foreground truncate">{String(record[descriptionField] ?? '')}</p>
                    )}
                  </Tag>
                </SortableItem>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── TableView ──────────────────────────────────────────────

function TableView({ records, fields, getHref, getEditHref, sortField, sortDir, onSort, saveEndpoint, panelPath, i18n, onSaved, reorderable, onReorder, selectable, selectedIds, onToggleAll, onToggleRecord, enableAutoAnimate }: {
  records:       Record<string, unknown>[]
  fields:        DataFieldMeta[]
  getHref:       (r: Record<string, unknown>) => string | undefined
  getEditHref?:  (r: Record<string, unknown>) => string | undefined
  sortField?:    string
  sortDir?:      string
  onSort?:       (field: string) => void
  saveEndpoint?: string
  panelPath?:    string
  i18n?:         PanelI18n
  onSaved?:      (record: Record<string, unknown>, field: string, value: unknown) => void
  reorderable?:  boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onReorder?:    (event: any) => void
  selectable?:   boolean
  selectedIds?:  Set<string>
  onToggleAll?:  () => void
  onToggleRecord?: (id: string) => void
  enableAutoAnimate?: boolean
}) {
  // Check selection state for current page records
  const pageSelectedCount = selectable && selectedIds ? records.filter(r => selectedIds.has(String(r.id))).length : 0
  const allSelected = selectable && records.length > 0 && pageSelectedCount === records.length
  const someSelected = selectable && pageSelectedCount > 0 && pageSelectedCount < records.length
  const [animateRef] = useAutoAnimate()
  const table = (
    <div className="rounded-xl border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              {selectable && (
                <th className="w-10 px-3 py-2.5">
                  <Checkbox
                    checked={someSelected ? 'indeterminate' : !!allSelected}
                    onCheckedChange={onToggleAll}
                    aria-label="Select all"
                  />
                </th>
              )}
              {reorderable && <th className="w-6" />}
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
          <tbody ref={enableAutoAnimate ? animateRef : undefined}>
            {records.map((record) => {
              const rid = String(record.id)
              const isSelected = selectable && selectedIds?.has(rid)
              return (
                <SortableTableRow key={rid} id={rid} reorderable={reorderable}>
                  {selectable && (
                    <td className="w-10 px-3 py-2.5">
                      <Checkbox
                        checked={!!isSelected}
                        onCheckedChange={() => onToggleRecord?.(rid)}
                        aria-label={`Select row ${rid}`}
                      />
                    </td>
                  )}
                  {reorderable && <TableDragHandle id={rid} />}
                  {fields.map((f) => (
                    <td key={f.name} className="px-4 py-2.5 text-muted-foreground">
                      {f.editable && saveEndpoint && panelPath && i18n ? (
                        <TableEditCell
                          record={record}
                          column={f as unknown as PanelColumnMeta}
                          saveEndpoint={saveEndpoint}
                          panelPath={panelPath}
                          i18n={i18n}
                          onSaved={onSaved}
                        />
                      ) : (
                        <FieldValue field={f} record={record} saveEndpoint={saveEndpoint} panelPath={panelPath} i18n={i18n} onSaved={onSaved} />
                      )}
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {getEditHref?.(record) && (
                        <a
                          href={getEditHref(record)!}
                          className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                          title="Edit"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                          </svg>
                        </a>
                      )}
                      {getHref(record) && (
                        <a
                          href={getHref(record)!}
                          className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                          title="View"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                        </a>
                      )}
                    </div>
                  </td>
                </SortableTableRow>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )

  if (reorderable && onReorder) {
    return (
      <DndWrapper items={records.map(r => String(r.id))} onDragEnd={onReorder} strategy="vertical">
        {table}
      </DndWrapper>
    )
  }
  return table
}

// ─── FolderView — drill-down + drag-to-reparent ─────────────

function FolderView({ records, fields, layout, titleField, descriptionField, imageField, iconField, folderField, onNavigate, onReparent, saveEndpoint, panelPath, i18n, onSaved }: {
  records:          Record<string, unknown>[]
  fields?:          DataFieldMeta[]
  layout?:          string
  titleField:       string
  descriptionField?: string
  imageField?:      string
  iconField?:       string
  folderField:      string
  onNavigate:       (folderId: string | null) => void
  onReparent:       (itemId: string, newParentId: string | null) => void
  saveEndpoint?:    string
  panelPath?:       string
  i18n?:            PanelI18n
  onSaved?:         (record: Record<string, unknown>, field: string, value: unknown) => void
}) {
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  const dragHandlers = (rid: string) => ({
    draggable: true,
    onDragStart: () => setDraggingId(rid),
    onDragEnd: () => { setDraggingId(null); setDragOverId(null) },
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); if (draggingId !== rid) setDragOverId(rid) },
    onDragLeave: () => { if (dragOverId === rid) setDragOverId(null) },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      if (draggingId && draggingId !== rid) onReparent(draggingId, rid)
      setDraggingId(null)
      setDragOverId(null)
    },
  })

  const dropClasses = (rid: string) => [
    dragOverId === rid && draggingId !== rid ? 'ring-2 ring-primary/40 ring-inset bg-primary/5' : '',
    draggingId === rid ? 'opacity-40' : '',
  ].filter(Boolean).join(' ')

  // ── Grid layout ──
  if (layout === 'grid') {
    return (
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {records.map((record) => {
          const rid = String(record.id)
          const icon = iconField ? record[iconField] as string | undefined : undefined
          return (
            <div
              key={rid}
              {...dragHandlers(rid)}
              onClick={() => onNavigate(rid)}
              className={`rounded-xl border bg-card p-4 hover:bg-muted/30 transition-all cursor-pointer flex flex-col gap-2 ${dropClasses(rid)}`}
            >
              {imageField && record[imageField] && (
                <img src={String(record[imageField])} alt="" className="h-32 w-full rounded-lg object-cover" />
              )}
              {icon && !imageField && (
                <div className="text-muted-foreground"><ResourceIcon icon={icon} /></div>
              )}
              {!icon && !imageField && (
                <div className="text-muted-foreground/40"><ResourceIcon icon="folder" /></div>
              )}
              {fields && fields.length > 0 ? (
                fields.map((f, i) => (
                  <p key={f.name} className={i === 0 ? 'text-sm font-medium truncate' : 'text-xs text-muted-foreground truncate'}>
                    <FieldValue field={f} record={record} saveEndpoint={saveEndpoint} panelPath={panelPath} i18n={i18n} onSaved={onSaved} />
                  </p>
                ))
              ) : (
                <>
                  <p className="text-sm font-medium truncate">{String(record[titleField] ?? '')}</p>
                  {descriptionField && record[descriptionField] !== undefined && (
                    <p className="text-xs text-muted-foreground truncate">{String(record[descriptionField] ?? '')}</p>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  // ── Table layout ──
  if (layout === 'table' && fields && fields.length > 0) {
    return (
      <div className="rounded-xl border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="w-8" />
                {fields.map(f => (
                  <th key={f.name} className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">{f.label}</th>
                ))}
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {records.map((record) => {
                const rid = String(record.id)
                const icon = iconField ? record[iconField] as string | undefined : undefined
                return (
                  <tr
                    key={rid}
                    {...dragHandlers(rid)}
                    onClick={() => onNavigate(rid)}
                    className={`border-b last:border-0 hover:bg-muted/30 transition-all cursor-pointer ${dropClasses(rid)}`}
                  >
                    <td className="px-2 py-2.5 text-muted-foreground/40">
                      {icon ? <ResourceIcon icon={icon} /> : <ResourceIcon icon="folder" />}
                    </td>
                    {fields.map(f => (
                      <td key={f.name} className="px-4 py-2.5 text-muted-foreground">
                        <FieldValue field={f} record={record} saveEndpoint={saveEndpoint} panelPath={panelPath} i18n={i18n} onSaved={onSaved} />
                      </td>
                    ))}
                    <td className="px-2 py-2.5 text-muted-foreground/40">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // ── List layout (default) ──
  return (
    <div className="rounded-xl border overflow-hidden divide-y">
      {records.map((record) => {
        const rid = String(record.id)
        const icon = iconField ? record[iconField] as string | undefined : undefined

        return (
          <div
            key={rid}
            {...dragHandlers(rid)}
            onClick={() => onNavigate(rid)}
            className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-all hover:bg-muted/30 ${dropClasses(rid)}`}
          >
            {/* Icon */}
            {icon ? (
              <span className="text-muted-foreground shrink-0"><ResourceIcon icon={icon} /></span>
            ) : (
              <span className="text-muted-foreground/40 shrink-0"><ResourceIcon icon="folder" /></span>
            )}

            {/* Content */}
            {fields && fields.length > 0 ? (
              <div className="flex-1 min-w-0 flex items-center gap-3">
                {fields.map((f, i) => (
                  <span key={f.name} className={i === 0 ? 'text-sm font-medium truncate' : 'text-xs text-muted-foreground truncate'}>
                    <FieldValue field={f} record={record} saveEndpoint={saveEndpoint} panelPath={panelPath} i18n={i18n} onSaved={onSaved} />
                  </span>
                ))}
              </div>
            ) : (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{String(record[titleField] ?? '')}</p>
                {descriptionField && record[descriptionField] !== undefined && (
                  <p className="text-xs text-muted-foreground truncate">{String(record[descriptionField] ?? '')}</p>
                )}
              </div>
            )}

            {/* Chevron */}
            <span className="text-muted-foreground/40 shrink-0">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </span>
          </div>
        )
      })}
    </div>
  )
}
