'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import type { PanelI18n, PanelColumnMeta } from '@boostkit/panels'
import { ResourceIcon } from './ResourceIcon.js'
import { TableEditCell } from './TableEditCell.js'

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
  actions?:          unknown[]
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

  // Auto-detect resource mode from element.resource or explicit prop
  const resourceSlug = resource?.resourceSlug ?? (element.resource || undefined)

  // Force re-render after dnd-kit loads (client-only)
  const [dndReady, setDndReady] = useState(!!_dnd)
  useEffect(() => {
    if (!dndReady && _dndPromise) {
      _dndPromise.then(() => setDndReady(true))
    }
  }, [dndReady])

  // ── State ──
  const [records, setRecords] = useState(initialRecords)
  const [search, setSearch]   = useState(ssrSearch ?? '')
  const [pagination, setPagination] = useState(initialPagination)
  const [currentPage, setCurrentPage] = useState(initialPagination?.currentPage ?? 1)
  const [loading, setLoading] = useState(false)
  const [sortField, setSortField] = useState(element.activeSort?.col ?? '')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>((element.activeSort?.dir?.toLowerCase() as 'asc' | 'desc') ?? 'asc')
  const [activeScope, setActiveScope] = useState(element.activeScope ?? 0)
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>(element.activeFilters ?? {})
  const [currentFolder, setCurrentFolder] = useState<string | null>(element.activeFolder ?? null)
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string; label: string }[]>(element.breadcrumbs ?? [])
  const filters = element.filters ?? []
  const folderField = element.folderField
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Active view ──
  const viewOptions = views ?? []
  const defaultViewName = viewOptions.length > 0 ? viewOptions[0]!.name : 'list'
  const [activeView, setActiveView] = useState(element.activeView ?? defaultViewName)
  const rememberMode = element.remember
  const pathSegment = panelPath.replace(/^\//, '')

  // Save state to session (persist/remember feature)
  function buildState(overrides: Record<string, unknown> = {}, filterOverride?: Record<string, string>): Record<string, unknown> {
    const state: Record<string, unknown> = { view: activeView, search, page: currentPage }
    if (sortField) { state.sort = sortField; state.dir = sortDir }
    if (currentFolder) state.folder = currentFolder
    if (activeScope > 0) state.scope = activeScope
    const filtersToSave = filterOverride ?? activeFilters
    for (const [k, v] of Object.entries(filtersToSave)) {
      if (v) state[`filter_${k}`] = v
    }
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
    const targetView = viewOptions.find(v => v.name === viewName)
    const prevView = viewOptions.find(v => v.name === activeView)
    const targetType = targetView?.type
    const prevType = prevView?.type

    // Re-fetch when switching between view types that need different data
    const needsAllRecords = targetType === 'tree'
    const needsFolderFilter = targetType === 'folder'
    const hadAllRecords = prevType === 'tree'
    const hadFolderFilter = prevType === 'folder'

    if (needsAllRecords !== hadAllRecords || needsFolderFilter !== hadFolderFilter) {
      if (needsAllRecords) {
        // Tree: fetch all records
        void fetchData({ page: 1, viewType: 'tree', folder: null })
      } else if (needsFolderFilter) {
        // Folder: fetch current folder level
        void fetchData({ page: 1, viewType: 'folder', folder: currentFolder })
      } else {
        // Flat views (list/grid/table): fetch all, no folder filter, reset folder state
        setCurrentFolder(null)
        setBreadcrumbs([])
        void fetchData({ page: 1, folder: null, viewType: targetType })
      }
    }

    saveRememberState(buildState({ view: viewName }))
  }

  // ── Lazy: fetch data on client mount (SSR sends empty records) ──
  useEffect(() => {
    if (element.lazy && records.length === 0) {
      void fetchData({ page: 1 })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
  async function fetchData(opts: { page?: number; search?: string; sort?: string; dir?: string; filters?: Record<string, string>; scope?: number; folder?: string | null; viewType?: string } = {}) {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('page', String(opts.page ?? currentPage))
      const searchVal = opts.search !== undefined ? opts.search : search
      if (searchVal) params.set('search', searchVal)
      const s = opts.sort ?? sortField
      const d = opts.dir ?? sortDir
      if (s) { params.set('sort', s); params.set('dir', d) }
      const filtersToApply = opts.filters ?? activeFilters
      for (const [k, v] of Object.entries(filtersToApply)) {
        if (v) params.set(`filter[${k}]`, v)
      }
      // Include active scope
      const scopeIdx = opts.scope ?? activeScope
      if (scopeIdx > 0) params.set('scope', String(scopeIdx))
      // Include folder param
      const folder = opts.folder !== undefined ? opts.folder : currentFolder
      if (folder) params.set('folder', folder)
      // Pass view type to backend (tree = all records, folder = folder-filtered)
      const effectiveViewType = opts.viewType ?? viewOptions.find(v => v.name === activeView)?.type
      if (effectiveViewType === 'tree') params.set('view', 'tree')
      if (effectiveViewType === 'folder') params.set('view', 'folder')
      // Resource mode: include trashed param and use resource API endpoint
      if (resourceSlug && resource?.isTrashed) params.set('trashed', 'true')
      // Resource mode: include active scope as tab param (resource API uses ?tab=slug)
      if (resourceSlug && scopePresets && scopeIdx > 0 && scopeIdx < scopePresets.length) {
        const scopeLabel = scopePresets[scopeIdx]?.label
        if (scopeLabel) params.set('tab', scopeLabel.toLowerCase().replace(/\s+/g, '-'))
      }
      const fetchBase = resourceSlug
        ? `${panelPath}/api/${resourceSlug}`
        : `${panelPath}/api/_tables/${elementId}`
      const res = await fetch(`${fetchBase}?${params}`)
      if (!res.ok) return
      // Resource API returns { data, meta }, table API returns { records, pagination }
      const body = await res.json() as { records?: Record<string, unknown>[]; data?: Record<string, unknown>[]; pagination?: PaginationMeta; meta?: PaginationMeta; breadcrumbs?: { id: string; label: string }[] }
      setRecords(body.records ?? body.data ?? [])
      setPagination(body.pagination ?? body.meta)
      if (body.breadcrumbs !== undefined) setBreadcrumbs(body.breadcrumbs ?? [])
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

  function handleLoadMore() {
    const nextPage = currentPage + 1
    setCurrentPage(nextPage)
    setLoading(true)
    const params = new URLSearchParams()
    params.set('page', String(nextPage))
    if (search) params.set('search', search)
    if (sortField) { params.set('sort', sortField); params.set('dir', sortDir) }
    for (const [k, v] of Object.entries(activeFilters)) { if (v) params.set(`filter[${k}]`, v) }
    if (activeScope > 0) params.set('scope', String(activeScope))
    if (resourceSlug && resource?.isTrashed) params.set('trashed', 'true')
    if (resourceSlug && scopePresets && activeScope > 0 && activeScope < scopePresets.length) {
      const scopeLabel = scopePresets[activeScope]?.label
      if (scopeLabel) params.set('tab', scopeLabel.toLowerCase().replace(/\s+/g, '-'))
    }
    const fetchBase = resourceSlug
      ? `${panelPath}/api/${resourceSlug}`
      : `${panelPath}/api/_tables/${elementId}`
    void fetch(`${fetchBase}?${params}`).then(async (res) => {
      if (!res.ok) return
      const body = await res.json() as { records?: Record<string, unknown>[]; data?: Record<string, unknown>[]; pagination?: PaginationMeta; meta?: PaginationMeta }
      const newRecords = body.records ?? body.data ?? []
      setRecords(prev => [...prev, ...newRecords])
      setPagination(body.pagination ?? body.meta)
    }).finally(() => setLoading(false))
    saveRememberState(buildState({ page: nextPage }))
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
    setCurrentPage(1)
    void fetchData({ page: 1, scope: index })
    saveRememberState(buildState({ scope: index, page: 1 }))
  }

  // ── Record click URL ──
  function handleFilterChange(filterName: string, value: string) {
    const newFilters = { ...activeFilters }
    if (value) newFilters[filterName] = value
    else delete newFilters[filterName]
    setActiveFilters(newFilters)
    setCurrentPage(1)
    void fetchData({ page: 1, filters: newFilters })
    saveRememberState(buildState({ page: 1 }, newFilters))
  }

  function clearFilters() {
    setActiveFilters({})
    setCurrentPage(1)
    void fetchData({ page: 1, filters: {} })
    saveRememberState(buildState({ page: 1 }, {}))
  }

  function handleFolderNavigate(folderId: string | null) {
    setCurrentFolder(folderId)
    setCurrentPage(1)
    if (!folderId) setBreadcrumbs([])
    void fetchData({ page: 1, folder: folderId })
    saveRememberState(buildState({ page: 1, folder: folderId ?? undefined }))
  }

  function getRecordHref(record: Record<string, unknown>): string | undefined {
    if (recordClick === 'edit') return href ? `${href}/${record.id}/edit` : undefined
    if (recordClick === 'custom' && record._href) return String(record._href)
    if (href) return `${href}/${record.id}`
    return undefined
  }

  // ── Refs for live/poll (avoid stale closures) ──
  const currentPageRef = useRef(currentPage)
  const searchRef = useRef(search)
  const sortFieldRef = useRef(sortField)
  const sortDirRef = useRef(sortDir)
  useEffect(() => { currentPageRef.current = currentPage }, [currentPage])
  useEffect(() => { searchRef.current = search }, [search])
  useEffect(() => { sortFieldRef.current = sortField }, [sortField])
  useEffect(() => { sortDirRef.current = sortDir }, [sortDir])
  const activeScopeRef = useRef(activeScope)
  useEffect(() => { activeScopeRef.current = activeScope }, [activeScope])
  const currentFolderRef = useRef(currentFolder)
  useEffect(() => { currentFolderRef.current = currentFolder }, [currentFolder])

  // ── Polling ──
  useEffect(() => {
    if (!element.pollInterval) return
    const interval = setInterval(() => {
      void fetchData({ page: currentPageRef.current, search: searchRef.current, sort: sortFieldRef.current || undefined, dir: sortDirRef.current, scope: activeScopeRef.current, folder: currentFolderRef.current })
    }, element.pollInterval)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [element.pollInterval, elementId])

  // ── Live updates via WebSocket ──
  useEffect(() => {
    if (!element.live || !element.liveChannel) return
    const liveChannel = element.liveChannel
    let destroyed = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let socket: any = null

    ;(async () => {
      try {
        const wsProto = window.location.protocol === 'https:' ? 'wss' : 'ws'
        const wsUrl = `${wsProto}://${window.location.host}/ws`
        const ws = new WebSocket(wsUrl)
        socket = ws

        ws.onopen = () => {
          if (destroyed) { ws.close(); return }
          ws.send(JSON.stringify({ type: 'subscribe', channel: liveChannel }))
        }

        ws.onmessage = (event: MessageEvent) => {
          if (destroyed) return
          try {
            const msg = JSON.parse(String(event.data)) as { type: string; channel?: string }
            if (msg.type === 'event' && msg.channel === liveChannel) {
              void fetchData({
                page: currentPageRef.current,
                search: searchRef.current || undefined,
                sort: sortFieldRef.current || undefined,
                dir: sortDirRef.current,
                scope: activeScopeRef.current,
                folder: currentFolderRef.current,
              })
            }
          } catch { /* ignore */ }
        }

        ws.onclose = () => { socket = null }
      } catch { /* WebSocket not available */ }
    })()

    return () => {
      destroyed = true
      if (socket) {
        try { socket.send(JSON.stringify({ type: 'unsubscribe', channel: liveChannel })) } catch { /* ignore */ }
        socket.close()
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [element.live, element.liveChannel])

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
          return <TableView records={records} fields={viewFields} getHref={getRecordHref} sortField={sortField} sortDir={sortDir} onSort={handleSortChange} saveEndpoint={saveEndpoint} panelPath={panelPath} i18n={i18n} onSaved={handleEditSaved} reorderable={isReorderable} onReorder={handleReorder} />
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
    </div>
  )
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

function ListView({ groups, fields, titleField, descriptionField, imageField, iconField, getHref, groupBy, saveEndpoint, panelPath, i18n, onSaved, onFolderNavigate, reorderable }: {
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
          })}
        </div>
      ))}
    </div>
  )
}

// ─── GridView ───────────────────────────────────────────────

function GridView({ groups, fields, titleField, descriptionField, imageField, iconField, getHref, groupBy, saveEndpoint, panelPath, i18n, onSaved, onFolderNavigate, reorderable }: {
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

function TableView({ records, fields, getHref, sortField, sortDir, onSort, saveEndpoint, panelPath, i18n, onSaved, reorderable, onReorder }: {
  records:       Record<string, unknown>[]
  fields:        DataFieldMeta[]
  getHref:       (r: Record<string, unknown>) => string | undefined
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
}) {
  const table = (
    <div className="rounded-xl border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
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
          <tbody>
            {records.map((record) => {
              const rid = String(record.id)
              return (
                <SortableTableRow key={rid} id={rid} reorderable={reorderable}>
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
                    {getHref(record) && (
                      <a href={getHref(record)!} className="text-xs text-muted-foreground hover:text-foreground transition-colors">→</a>
                    )}
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
