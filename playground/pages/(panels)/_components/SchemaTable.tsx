'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { PanelSchemaElementMeta, PanelColumnMeta, PanelI18n } from '@boostkit/panels'
import { readClientState, saveClientState } from '../_lib/persist.js'
import { Checkbox } from '@/components/ui/checkbox.js'
import type { PersistMode } from '../_lib/persist.js'
import { TableEditCell } from './TableEditCell.js'

// Client-side cache for table state — survives tab switches within the same page
const tableStateCache = new Map<string, Record<string, unknown>>()

export function SchemaTable({ element, panelPath, i18n }: { element: Extract<PanelSchemaElementMeta, { type: 'table' }>; panelPath: string; i18n: PanelI18n }) {
  const el = element as typeof element & { reorderable?: boolean; reorderEndpoint?: string }
  const tableId = element.id as string | undefined
  const pathSegment = panelPath.replace(/^\//, '')
  const isLazy = !!element.lazy
  const rememberMode = element.remember as string | undefined

  // ── Remember: read initial persisted state ──
  const [initialState] = useState(() => {
    if (!rememberMode || !tableId) return {} as Record<string, unknown>
    return readClientState(rememberMode as PersistMode, `table:${tableId}`, tableId)
  })

  const hasPagination = !!element.pagination
  // SSR provides activeSearch/activeSort for url/session persist modes
  const ssrSearch = (element as { activeSearch?: string }).activeSearch
  const ssrSort = (element as { activeSort?: { col: string; dir: string } }).activeSort
  const ssrFilters = (element as { activeFilters?: Record<string, string> }).activeFilters

  const [records, setRecords] = useState<Record<string, unknown>[]>(element.records as Record<string, unknown>[])
  const [sort, setSort]       = useState<{ col: string; dir: 'asc' | 'desc' } | null>(
    ssrSort ? { col: ssrSort.col, dir: ssrSort.dir.toLowerCase() as 'asc' | 'desc' }
    : null,
  )
  const [search, setSearch]   = useState(ssrSearch ?? '')
  const [dragging, setDragging] = useState<string | null>(null)
  const [pagination, setPagination] = useState<typeof element.pagination>(element.pagination)
  const [currentPage, setCurrentPage] = useState(element.pagination?.currentPage ?? 1)
  const [loadingMore, setLoadingMore] = useState(false)
  const [lazyLoaded, setLazyLoaded] = useState(!isLazy)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Detect if we need to restore from cache (stale SSR data)
  // Start as false to avoid hydration mismatch (localStorage/cache not available during SSR)
  const [restoring, setRestoring] = useState(false)

  // ── Remember: save state on change ──
  function saveRememberState(state: Record<string, unknown>) {
    if (!tableId) return
    // Always cache in memory (survives tab switches)
    tableStateCache.set(tableId, state)
    if (!rememberMode) return
    saveClientState(rememberMode as PersistMode, `table:${tableId}`, state, {
      pathSegment,
      apiPath: `/api/_tables/${tableId}/remember`,
      urlPrefix: tableId,
    })
  }

  // ── Filters & Actions ──
  const filters = (element as { filters?: Array<{ name: string; type: string; label: string; extra: Record<string, unknown> }> }).filters ?? []
  const actions = (element as { actions?: Array<{ name: string; label: string; icon?: string; destructive: boolean; requiresConfirm: boolean; confirmMessage?: string; bulk: boolean; row: boolean }> }).actions ?? []
  const hasBulkActions = actions.some(a => a.bulk)
  const hasRowActions = actions.some(a => a.row)
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>(ssrFilters ?? {})
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [actionLoading, setActionLoading] = useState(false)

  // Refs to track current state for live refresh (avoids stale closure in WebSocket handler)
  const currentPageRef = useRef(currentPage)
  const sortRef = useRef(sort)
  const searchRef = useRef(search)
  const activeFiltersRef = useRef(activeFilters)
  currentPageRef.current = currentPage
  sortRef.current = sort
  searchRef.current = search
  activeFiltersRef.current = activeFilters

  // ── Shared fetch function — all table state changes go through API ──
  async function fetchTable(opts: { page?: number; search?: string; sort?: string; dir?: string; append?: boolean; filters?: Record<string, string> } = {}) {
    if (!tableId) return
    setLoadingMore(true)
    try {
      const params = new URLSearchParams()
      const p = opts.page ?? currentPage
      params.set('page', String(p))
      if (opts.search !== undefined ? opts.search : search) params.set('search', opts.search !== undefined ? opts.search : search)
      if (opts.sort) { params.set('sort', opts.sort); params.set('dir', opts.dir ?? 'asc') }
      else if (sort) { params.set('sort', sort.col); params.set('dir', sort.dir) }
      // Add filter params
      const filtersToApply = opts.filters ?? activeFilters
      for (const [k, v] of Object.entries(filtersToApply)) {
        if (v) params.set(`filter[${k}]`, v)
      }
      const res = await fetch(`/${pathSegment}/api/_tables/${tableId}?${params}`)
      if (res.ok) {
        const body = await res.json() as { records: Record<string, unknown>[]; pagination?: typeof pagination }
        if (opts.append) {
          setRecords(prev => [...prev, ...body.records])
        } else {
          setRecords(body.records)
        }
        if (body.pagination) setPagination(body.pagination)
        setCurrentPage(p)
      }
    } catch { /* fetch failed */ }
    finally { setLoadingMore(false); setRestoring(false) }
  }

  function handleFilterChange(filterName: string, value: string) {
    const newFilters = { ...activeFilters }
    if (value) newFilters[filterName] = value
    else delete newFilters[filterName]
    setActiveFilters(newFilters)

    if (hasPagination) {
      // Fetch with filters applied
      void fetchTable({ page: 1, filters: newFilters })
      setCurrentPage(1)
      saveRememberState({ sort: sort?.col, dir: sort?.dir, search, page: 1, ...Object.fromEntries(Object.entries(newFilters).map(([k, v]) => [`filter_${k}`, v])) })
    } else {
      saveRememberState({ sort: sort?.col, dir: sort?.dir, search, page: currentPage, ...Object.fromEntries(Object.entries(newFilters).map(([k, v]) => [`filter_${k}`, v])) })
    }
  }

  async function executeAction(actionName: string, ids: string[]) {
    if (!tableId) return
    setActionLoading(true)
    try {
      const res = await fetch(`/${pathSegment}/api/_tables/${tableId}/action/${actionName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      if (res.ok) {
        setSelectedIds(new Set())
        // Refresh table data
        void fetchTable({ page: currentPage })
      }
    } catch { /* action failed */ }
    finally { setActionLoading(false) }
  }

  // Reset state when the element changes (e.g. navigating between tabs with different tables)
  const elementRef = useRef(element)
  useEffect(() => {
    if (elementRef.current === element) return
    elementRef.current = element

    // Restore from persisted state or in-memory cache instead of resetting
    if (tableId) {
      const restored = rememberMode
        ? readClientState(rememberMode as PersistMode, `table:${tableId}`, tableId)
        : {}
      // Fall back to in-memory cache (works for session mode and non-remember tables during tab switches)
      const cached = tableStateCache.get(tableId)
      const state = Object.keys(restored).length > 0 ? restored : cached ?? {}
      const restoredPage = state.page ? Number(state.page) : 1
      // Restore filters from element change
      const restoredFiltersOnChange: Record<string, string> = {}
      for (const [k, v] of Object.entries(state)) {
        if (k.startsWith('filter_')) restoredFiltersOnChange[k.slice(7)] = String(v)
      }
      const hasRestoredFiltersOnChange = Object.keys(restoredFiltersOnChange).length > 0
      if (restoredPage > 1 || state.search || state.sort || hasRestoredFiltersOnChange) {
        if (hasRestoredFiltersOnChange) setActiveFilters(restoredFiltersOnChange)
        void fetchTable({
          page: restoredPage,
          search: state.search ? String(state.search) : '',
          sort: state.sort as string,
          dir: state.dir as string,
          filters: restoredFiltersOnChange,
        })
        setSort(state.sort ? { col: String(state.sort), dir: (state.dir as 'asc' | 'desc') ?? 'asc' } : null)
        setSearch(state.search ? String(state.search) : '')
        return
      }
    }

    setRecords(element.records as Record<string, unknown>[])
    setSort(null)
    setSearch('')
    setActiveFilters({})
    setSelectedIds(new Set())
    setPagination(element.pagination)
    setCurrentPage(1)
    setLazyLoaded(!isLazy)
  }, [element])

  // ── Restore remembered state — fetch if client state differs from SSR ──
  useEffect(() => {
    if (!tableId) return
    // Check persisted state, then fall back to in-memory cache (tab switch)
    const persisted = rememberMode ? readClientState(rememberMode as PersistMode, `table:${tableId}`, tableId) : {}
    const cached = tableStateCache.get(tableId)
    const source = Object.keys(persisted).length > 0 ? persisted : cached ?? {}
    const restoredPage = source.page ? Number(source.page) : 1
    const restoredSearch = source.search ? String(source.search) : ''
    // Restore filters from persisted state
    const restoredFilters: Record<string, string> = {}
    for (const [k, v] of Object.entries(source)) {
      if (k.startsWith('filter_')) {
        restoredFilters[k.slice(7)] = String(v)
      }
    }
    if (Object.keys(restoredFilters).length > 0) {
      setActiveFilters(restoredFilters)
    }
    const ssrPage = element.pagination?.currentPage ?? 1
    const isLoadMore = element.pagination?.type === 'loadMore'
    const hasRestoredFilters = Object.keys(restoredFilters).length > 0

    // For loadMore mode with localStorage: fetch all pages up to the saved page
    // (url/session modes are SSR'd with all records already)
    if (isLoadMore && restoredPage > 1 && tableId && rememberMode === 'localStorage') {
      setRestoring(true)
      ;(async () => {
        try {
          let allRecords: Record<string, unknown>[] = [...(element.records as Record<string, unknown>[])]
          let lastPagination = element.pagination
          // Page 1 is already SSR'd, fetch pages 2..restoredPage
          for (let p = 2; p <= restoredPage; p++) {
            const params = new URLSearchParams()
            params.set('page', String(p))
            if (restoredSearch) params.set('search', restoredSearch)
            if (source.sort) { params.set('sort', String(source.sort)); params.set('dir', String(source.dir ?? 'asc')) }
            for (const [k, v] of Object.entries(restoredFilters)) params.set(`filter[${k}]`, v)
            const res = await fetch(`/${pathSegment}/api/_tables/${tableId}?${params}`)
            if (res.ok) {
              const body = await res.json() as { records: Record<string, unknown>[]; pagination?: typeof lastPagination }
              allRecords = [...allRecords, ...body.records]
              if (body.pagination) lastPagination = body.pagination
            }
          }
          setRecords(allRecords)
          if (lastPagination) setPagination(lastPagination)
          setCurrentPage(restoredPage)
        } catch { /* restore failed */ }
        finally { setRestoring(false) }
      })()
      return
    }

    // For pages mode: fetch the specific page
    const effectivePage = restoredPage
    // Skip if SSR already has the right data (url/session on initial page load)
    if (effectivePage === ssrPage && !restoredSearch && !source.sort && !hasRestoredFilters) return
    if (effectivePage <= 1 && !restoredSearch && !source.sort && !hasRestoredFilters) return
    setRestoring(true)
    void fetchTable({ page: effectivePage, search: restoredSearch, sort: source.sort as string, dir: source.dir as string, filters: restoredFilters })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Lazy loading ──
  useEffect(() => {
    if (!isLazy || lazyLoaded || !tableId) return
    fetch(`/${pathSegment}/api/_tables/${tableId}`)
      .then(r => r.ok ? r.json() : null)
      .then((body: { records: Record<string, unknown>[]; pagination?: typeof pagination } | null) => {
        if (body) {
          setRecords(body.records)
          if (body.pagination) setPagination(body.pagination)
        }
        setLazyLoaded(true)
      })
      .catch(() => setLazyLoaded(true))
  }, [isLazy, lazyLoaded, tableId, pathSegment])

  // ── Polling ──
  useEffect(() => {
    const interval = element.pollInterval as number | undefined
    if (!interval || !tableId) return
    const timer = setInterval(() => void fetchTable(), interval)
    return () => clearInterval(timer)
  }, [tableId, currentPage, search, sort, pathSegment, element.pollInterval])

  // ── Live updates via WebSocket ──
  useEffect(() => {
    const liveChannel = (element as { liveChannel?: string }).liveChannel
    const isLive = (element as { live?: boolean }).live
    if (!isLive || !liveChannel) return

    let destroyed = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let socket: any = null

    ;(async () => {
      try {
        // Dynamic import — BKSocket is a publishable client file
        const wsProto = window.location.protocol === 'https:' ? 'wss' : 'ws'
        const wsUrl = `${wsProto}://${window.location.host}/ws`

        // Simple WebSocket subscription to the live channel
        const ws = new WebSocket(wsUrl)
        socket = ws

        ws.onopen = () => {
          if (destroyed) { ws.close(); return }
          ws.send(JSON.stringify({ type: 'subscribe', channel: liveChannel }))
        }

        ws.onmessage = (event: MessageEvent) => {
          if (destroyed) return
          try {
            const msg = JSON.parse(String(event.data)) as { type: string; event?: string; channel?: string }
            if (msg.type === 'event' && msg.channel === liveChannel) {
              // Refetch table data with current state (from refs, not stale closure)
              void fetchTable({
                page: currentPageRef.current,
                search: searchRef.current || undefined,
                sort: sortRef.current?.col,
                dir: sortRef.current?.dir,
                filters: activeFiltersRef.current,
              })
            }
          } catch { /* ignore non-JSON */ }
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
  }, [(element as { liveChannel?: string }).liveChannel])

  // For non-paginated tables, sort and search client-side
  const displayRecords = hasPagination ? records : (() => {
    let result = records
    if (sort) {
      result = [...result].sort((a, b) => {
        const av = a[sort.col] ?? ''
        const bv = b[sort.col] ?? ''
        const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true })
        return sort.dir === 'asc' ? cmp : -cmp
      })
    }
    const searchableCols = element.columns.filter((c: PanelColumnMeta) => c.searchable).map((c: PanelColumnMeta) => c.name)
    if (search && searchableCols.length > 0) {
      result = result.filter(r => searchableCols.some(col => String(r[col] ?? '').toLowerCase().includes(search.toLowerCase())))
    }
    // Client-side filters for non-paginated tables
    for (const [filterName, filterValue] of Object.entries(activeFilters)) {
      if (filterValue) {
        result = result.filter(r => String(r[filterName] ?? '') === filterValue)
      }
    }
    return result
  })()

  function toggleSort(colName: string) {
    const next = sort?.col === colName
      ? { col: colName, dir: (sort.dir === 'asc' ? 'desc' : 'asc') as 'asc' | 'desc' }
      : { col: colName, dir: 'asc' as const }
    setSort(next)
    if (hasPagination) {
      // Server-side sort — fetch page 1 with new sort
      void fetchTable({ page: 1, sort: next.col, dir: next.dir })
      setCurrentPage(1)
    }
    const filterState = Object.fromEntries(Object.entries(activeFilters).map(([k, v]) => [`filter_${k}`, v]))
    saveRememberState({ sort: next.col, dir: next.dir, search, page: hasPagination ? 1 : currentPage, ...filterState })
  }

  function handleSearchChange(value: string) {
    setSearch(value)
    const filterState = Object.fromEntries(Object.entries(activeFilters).map(([k, v]) => [`filter_${k}`, v]))
    // Debounce search — wait 300ms before fetching
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    if (hasPagination) {
      searchTimerRef.current = setTimeout(() => {
        // Reset to page 1 on search
        void fetchTable({ page: 1, search: value })
        setCurrentPage(1)
        saveRememberState({ sort: sort?.col, dir: sort?.dir, search: value, page: 1, ...filterState })
      }, 300)
    } else {
      saveRememberState({ sort: sort?.col, dir: sort?.dir, search: value, page: currentPage, ...filterState })
    }
  }

  function handlePageChange(page: number) {
    if (pagination?.type === 'loadMore') {
      void fetchTable({ page, append: true })
    } else {
      void fetchTable({ page })
    }
    const filterState = Object.fromEntries(Object.entries(activeFilters).map(([k, v]) => [`filter_${k}`, v]))
    saveRememberState({ sort: sort?.col, dir: sort?.dir, search, page, ...filterState })
  }

  // Reorder via drag-and-drop (simple pointer-based, no dnd-kit dependency in this renderer)
  const handleDragStart = useCallback((id: string) => { setDragging(id) }, [])
  const handleDragOver  = useCallback((e: React.DragEvent) => { e.preventDefault() }, [])
  const handleDrop      = useCallback((targetId: string, endpoint: string) => {
    if (!dragging || dragging === targetId) { setDragging(null); return }
    setRecords((prev) => {
      const from = prev.findIndex((r) => String(r['id']) === dragging)
      const to   = prev.findIndex((r) => String(r['id']) === targetId)
      if (from === -1 || to === -1) return prev
      const next = [...prev]
      const [item] = next.splice(from, 1)
      if (item) next.splice(to, 0, item)
      // Persist order
      const ids = next.map((r) => String(r['id']))
      fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ids, field: 'position' }),
      }).catch(() => {})
      return next
    })
    setDragging(null)
  }, [dragging])

  const hasSearch = !!element.searchable || element.columns.some((c: PanelColumnMeta) => c.searchable)
  const hasHref   = !!element.href

  // ── Lazy skeleton or restoring state ──
  if (!lazyLoaded || restoring) {
    return (
      <div>
        <p className="text-sm font-semibold mb-3">{element.title}</p>
        <div className="rounded-xl border overflow-hidden">
          <div className="p-4 space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="h-8 bg-muted/20 rounded animate-pulse" />)}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Title + description — outside the table card */}
      <div className="mb-1">
        <p className="text-sm font-semibold">{element.title}</p>
        {element.description && (
          <p className="text-xs text-muted-foreground mt-0.5">{element.description}</p>
        )}
      </div>

      {/* Toolbar: search + filters + view all — outside the table card */}
      {(hasSearch || filters.length > 0 || hasHref) && (
        <div className="py-2.5 flex items-center gap-3 flex-wrap">
          {hasSearch && (
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              <input
                type="text"
                placeholder={i18n.search?.replace(':label', element.title) ?? `Search ${element.title}...`}
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="h-8 rounded-md border bg-background pl-8 pr-8 text-sm w-56 focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/60"
              />
              {search && (
                <button onClick={() => handleSearchChange('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              )}
            </div>
          )}
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
              onClick={() => { setActiveFilters({}); setCurrentPage(1); if (hasPagination) void fetchTable({ page: 1, filters: {} }); saveRememberState({ sort: sort?.col, dir: sort?.dir, search, page: 1 }) }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {i18n.clearFilters ?? 'Clear filters'}
            </button>
          )}
          {hasHref && (
            <a href={element.href} className="text-xs text-muted-foreground hover:text-foreground transition-colors ml-auto">
              {i18n.viewAll}
            </a>
          )}
        </div>
      )}

      {/* Bulk action bar — outside the table card */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 mb-2 bg-primary/5 border border-primary/20 rounded-lg">
          <span className="text-xs font-medium">
            {i18n.selected?.replace(':n', String(selectedIds.size)) ?? `${selectedIds.size} selected`}
          </span>
          <div className="flex items-center gap-1">
            {actions.filter(a => a.bulk).map(action => (
              <button
                key={action.name}
                onClick={() => {
                  if (action.requiresConfirm) {
                    if (confirm(action.confirmMessage ?? 'Are you sure?')) {
                      void executeAction(action.name, [...selectedIds])
                    }
                  } else {
                    void executeAction(action.name, [...selectedIds])
                  }
                }}
                disabled={actionLoading}
                className={`text-xs px-2.5 py-1 rounded font-medium transition-colors ${action.destructive ? 'text-red-600 hover:bg-red-500/10' : 'text-primary hover:bg-primary/10'}`}
              >
                {action.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-xs text-muted-foreground hover:text-foreground ml-auto"
          >
            {i18n.clearSelection ?? 'Clear'}
          </button>
        </div>
      )}

      {/* Table card */}
      <div className="rounded-xl border overflow-hidden">
      {displayRecords.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <svg className="mx-auto h-10 w-10 text-muted-foreground/40 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-2.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
          <p className="text-sm font-medium text-muted-foreground">{element.emptyMessage ?? i18n.noRecordsFound}</p>
          {search && <p className="text-xs text-muted-foreground/60 mt-1">{i18n.noResultsHint ?? 'Try adjusting your search or filters.'}</p>}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                {hasBulkActions && (
                  <th className="w-10 px-4 py-3">
                    <Checkbox
                      checked={selectedIds.size === displayRecords.length && displayRecords.length > 0}
                      onCheckedChange={(checked) => {
                        if (checked) setSelectedIds(new Set(displayRecords.map(r => String(r['id'] ?? ''))))
                        else setSelectedIds(new Set())
                      }}
                    />
                  </th>
                )}
                {el.reorderable && <th className="w-6" />}
                {element.columns.map((col: PanelColumnMeta) => {
                  const sortable = col.sortable
                  const isActive = sort?.col === col.name
                  return (
                    <th
                      key={col.name}
                      className={`text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider ${sortable ? 'cursor-pointer select-none hover:text-foreground' : ''}`}
                      onClick={sortable ? () => toggleSort(col.name) : undefined}
                    >
                      {col.label}
                      {sortable && isActive && (
                        <svg className="inline ml-1 h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          {sort?.dir === 'asc'
                            ? <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                            : <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                          }
                        </svg>
                      )}
                      {sortable && !isActive && (
                        <svg className="inline ml-1 h-3 w-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                        </svg>
                      )}
                    </th>
                  )
                })}
                {hasRowActions && <th className="w-20" />}
                {hasHref && <th className="w-8" />}
              </tr>
            </thead>
            <tbody>
              {displayRecords.map((record, i) => {
                const id = String(record['id'] ?? i)
                return (
                  <tr
                    key={id}
                    className={`border-b last:border-0 hover:bg-muted/30 transition-colors ${selectedIds.has(id) ? 'bg-primary/5' : ''} ${dragging === id ? 'opacity-50' : ''}`}
                    draggable={el.reorderable}
                    onDragStart={el.reorderable ? () => handleDragStart(id) : undefined}
                    onDragOver={el.reorderable ? handleDragOver : undefined}
                    onDrop={el.reorderable && el.reorderEndpoint ? () => handleDrop(id, el.reorderEndpoint ?? '') : undefined}
                  >
                    {hasBulkActions && (
                      <td className="px-4 py-2.5">
                        <Checkbox
                          checked={selectedIds.has(id)}
                          onCheckedChange={(checked) => {
                            const next = new Set(selectedIds)
                            if (checked) next.add(id)
                            else next.delete(id)
                            setSelectedIds(next)
                          }}
                        />
                      </td>
                    )}
                    {el.reorderable && (
                      <td className="px-2 py-2.5 text-muted-foreground cursor-grab">{'\u2807'}</td>
                    )}
                    {element.columns.map((col: PanelColumnMeta) => (
                      <td key={col.name} className="px-4 py-2.5 text-muted-foreground">
                        {col.editable && col.editField
                          ? <TableEditCell
                              record={record}
                              column={col}
                              saveEndpoint={`/${pathSegment}/api/_tables/${tableId}/save`}
                              panelPath={panelPath}
                              i18n={i18n}
                              onSaved={(rec, field, value) => {
                                setRecords(prev => prev.map(r =>
                                  r['id'] === rec['id'] ? { ...r, [field]: value } : r
                                ))
                              }}
                            />
                          : col.href
                            ? <a
                                href={col.href.replace(/:(\w+)/g, (_, key) => encodeURIComponent(String(record[key] ?? '')))}
                                className="text-primary hover:underline"
                              >
                                {formatCellValue(record[col.name], col, i18n, panelPath)}
                              </a>
                            : formatCellValue(record[col.name], col, i18n, panelPath)
                        }
                      </td>
                    ))}
                    {hasRowActions && (
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex items-center gap-1 justify-end">
                          {actions.filter(a => a.row).map(action => {
                            // Navigation action — render as link
                            if ((action as typeof action & { url?: string }).url) {
                              const resolvedUrl = (action as typeof action & { url: string }).url
                                .replace(/:(\w+)/g, (_, key) => encodeURIComponent(String(record[key] ?? '')))
                              return (
                                <a
                                  key={action.name}
                                  href={resolvedUrl}
                                  title={action.label}
                                  className="p-1 rounded transition-colors text-muted-foreground hover:bg-accent hover:text-foreground"
                                >
                                  <span className="text-xs">{action.label}</span>
                                </a>
                              )
                            }
                            // Server action — render as button
                            return (
                              <button
                                key={action.name}
                                onClick={() => {
                                  if (action.requiresConfirm) {
                                    if (confirm(action.confirmMessage ?? 'Are you sure?')) {
                                      void executeAction(action.name, [id])
                                    }
                                  } else {
                                    void executeAction(action.name, [id])
                                  }
                                }}
                                title={action.label}
                                className={`p-1 rounded transition-colors ${action.destructive ? 'text-red-500 hover:bg-red-500/10' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
                              >
                                <span className="text-xs">{action.label}</span>
                              </button>
                            )
                          })}
                        </div>
                      </td>
                    )}
                    {hasHref && (
                      <td className="px-4 py-2.5 text-right">
                        <a
                          href={`${element.href}/${record['id']}`}
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {'\u2192'}
                        </a>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination: pages mode */}
      {pagination && pagination.type === 'pages' && pagination.lastPage > 1 && (
        <div className="flex items-center justify-between px-5 py-3 border-t bg-muted/10">
          <p className="text-xs text-muted-foreground">
            {(i18n.page ?? 'Page :current of :last').replace(':current', String(currentPage)).replace(':last', String(pagination.lastPage))}
            {' '}
            <span className="text-muted-foreground/60">
              ({(i18n.records ?? ':n records').replace(':n', String(pagination.total))})
            </span>
          </p>
          <div className="flex items-center gap-1">
            {/* Previous button */}
            <button
              onClick={() => currentPage > 1 && handlePageChange(currentPage - 1)}
              disabled={currentPage <= 1}
              className="px-2 py-1 text-xs rounded text-muted-foreground hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            </button>
            {Array.from({ length: pagination.lastPage }, (_, i) => i + 1).map(page => (
              <button
                key={page}
                onClick={() => handlePageChange(page)}
                className={`min-w-[28px] px-2 py-1 text-xs rounded transition-colors ${page === currentPage ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:bg-accent'}`}
              >
                {page}
              </button>
            ))}
            {/* Next button */}
            <button
              onClick={() => currentPage < pagination.lastPage && handlePageChange(currentPage + 1)}
              disabled={currentPage >= pagination.lastPage}
              className="px-2 py-1 text-xs rounded text-muted-foreground hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
            </button>
          </div>
        </div>
      )}

      {/* Pagination: loadMore mode */}
      {pagination && pagination.type === 'loadMore' && records.length < pagination.total && (
        <div className="px-5 py-3 border-t bg-muted/10">
          <button
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={loadingMore}
            className="w-full text-center text-sm text-muted-foreground hover:text-foreground py-2 rounded hover:bg-accent/50 transition-colors disabled:opacity-50"
          >
            {loadingMore ? (i18n.loading ?? 'Loading...') : `${i18n.loadMore ?? 'Load more'} (${records.length} / ${pagination.total})`}
          </button>
        </div>
      )}
      </div>{/* end table card */}
    </div>
  )
}

export function formatCellValue(value: unknown, col: PanelColumnMeta | null, i18n: PanelI18n, _panelPath?: string): string {
  if (value === null || value === undefined) return '\u2014'
  if (col?.type === 'boolean' || typeof value === 'boolean') return value ? i18n.yes : i18n.no
  if (col?.type === 'date' || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) || value instanceof Date) {
    try {
      return new Intl.DateTimeFormat('en', { dateStyle: col?.format === 'datetime' ? undefined : 'medium', ...(col?.format === 'datetime' ? { dateStyle: 'medium', timeStyle: 'short' } : {}) }).format(new Date(String(value)))
    } catch { return String(value) }
  }
  return String(value)
}
