'use client'

import { useState, useRef, useCallback } from 'react'

// ─── Types ──────────────────────────────────────────────────

interface PaginationMeta {
  total:       number
  currentPage: number
  perPage:     number
  lastPage:    number
  type:        'pages' | 'loadMore'
}

interface FetchDataOpts {
  page?:     number
  search?:   string
  sort?:     string
  dir?:      string
  filters?:  Record<string, string>
  scope?:    number
  folder?:   string | null
  viewType?: string
}

export interface DataViewFetchConfig {
  elementId:      string
  panelPath:      string
  resourceSlug?:  string
  isTrashed?:     boolean
  scopePresets?:  { label: string; icon?: string }[]
}

export interface DataViewFetchState {
  records:       Record<string, unknown>[]
  pagination:    PaginationMeta | undefined
  currentPage:   number
  search:        string
  sortField:     string
  sortDir:       'asc' | 'desc'
  activeScope:   number
  activeFilters: Record<string, string>
  currentFolder: string | null
  breadcrumbs:   { id: string; label: string }[]
  loading:       boolean
}

export interface DataViewFetchActions {
  fetchData:          (opts?: FetchDataOpts) => Promise<void>
  handleSearchChange: (value: string) => void
  handlePageChange:   (page: number) => void
  handleLoadMore:     () => void
  handleSortChange:   (field: string) => void
  handleScopeChange:  (index: number) => void
  handleFilterChange: (filterName: string, value: string) => void
  clearFilters:       () => void
  handleFolderNavigate: (folderId: string | null) => void
  setRecords:         React.Dispatch<React.SetStateAction<Record<string, unknown>[]>>
  clearSelection:     () => void
}

export interface UseDataViewFetchReturn extends DataViewFetchState, DataViewFetchActions {
  /** Refs for stale-closure avoidance in live/poll effects */
  stateRefs: {
    currentPage:   React.MutableRefObject<number>
    search:        React.MutableRefObject<string>
    sortField:     React.MutableRefObject<string>
    sortDir:       React.MutableRefObject<string>
    activeScope:   React.MutableRefObject<number>
    currentFolder: React.MutableRefObject<string | null>
  }
}

// ─── Hook ───────────────────────────────────────────────────

export function useDataViewFetch(
  config: DataViewFetchConfig,
  initial: {
    records:       Record<string, unknown>[]
    pagination?:   PaginationMeta
    search?:       string
    sortField?:    string
    sortDir?:      'asc' | 'desc'
    activeScope?:  number
    activeFilters?: Record<string, string>
    activeFolder?: string | null
    breadcrumbs?:  { id: string; label: string }[]
  },
  callbacks?: {
    onStateChange?: (state: Record<string, unknown>) => void
    clearSelection?: () => void
  },
): UseDataViewFetchReturn {
  const { elementId, panelPath, resourceSlug, isTrashed, scopePresets } = config

  // ── State ──
  const [records, setRecords]           = useState(initial.records)
  const [pagination, setPagination]     = useState(initial.pagination)
  const [currentPage, setCurrentPage]   = useState(initial.pagination?.currentPage ?? 1)
  const [search, setSearch]             = useState(initial.search ?? '')
  const [sortField, setSortField]       = useState(initial.sortField ?? '')
  const [sortDir, setSortDir]           = useState<'asc' | 'desc'>(initial.sortDir ?? 'asc')
  const [activeScope, setActiveScope]   = useState(initial.activeScope ?? 0)
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>(initial.activeFilters ?? {})
  const [currentFolder, setCurrentFolder] = useState<string | null>(initial.activeFolder ?? null)
  const [breadcrumbs, setBreadcrumbs]   = useState<{ id: string; label: string }[]>(initial.breadcrumbs ?? [])
  const [loading, setLoading]           = useState(false)

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Refs for stale-closure avoidance ──
  const currentPageRef   = useRef(currentPage)
  const searchRef        = useRef(search)
  const sortFieldRef     = useRef(sortField)
  const sortDirRef       = useRef(sortDir)
  const activeScopeRef   = useRef(activeScope)
  const currentFolderRef = useRef(currentFolder)

  // Keep refs in sync
  currentPageRef.current   = currentPage
  searchRef.current        = search
  sortFieldRef.current     = sortField
  sortDirRef.current       = sortDir
  activeScopeRef.current   = activeScope
  currentFolderRef.current = currentFolder

  const clearSelection = callbacks?.clearSelection ?? (() => {})
  const notifyStateChange = callbacks?.onStateChange

  // ── Core fetch ──
  const fetchData = useCallback(async (opts: FetchDataOpts = {}) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('page', String(opts.page ?? currentPageRef.current))
      const searchVal = opts.search !== undefined ? opts.search : searchRef.current
      if (searchVal) params.set('search', searchVal)
      const s = opts.sort ?? sortFieldRef.current
      const d = opts.dir ?? sortDirRef.current
      if (s) { params.set('sort', s); params.set('dir', d) }
      const filtersToApply = opts.filters ?? activeFilters
      for (const [k, v] of Object.entries(filtersToApply)) {
        if (v) params.set(`filter[${k}]`, v)
      }
      const scopeIdx = opts.scope ?? activeScopeRef.current
      if (scopeIdx > 0) params.set('scope', String(scopeIdx))
      const folder = opts.folder !== undefined ? opts.folder : currentFolderRef.current
      if (folder) params.set('folder', folder)
      const effectiveViewType = opts.viewType
      if (effectiveViewType === 'tree') params.set('view', 'tree')
      if (effectiveViewType === 'folder') params.set('view', 'folder')
      if (resourceSlug && isTrashed) params.set('trashed', 'true')
      if (resourceSlug && scopePresets && scopeIdx > 0 && scopeIdx < scopePresets.length) {
        const scopeLabel = scopePresets[scopeIdx]?.label
        if (scopeLabel) params.set('tab', scopeLabel.toLowerCase().replace(/\s+/g, '-'))
      }
      const fetchBase = resourceSlug
        ? `${panelPath}/api/${resourceSlug}`
        : `${panelPath}/api/_tables/${elementId}`
      const res = await fetch(`${fetchBase}?${params}`)
      if (!res.ok) return
      const body = await res.json() as {
        records?: Record<string, unknown>[]
        data?:    Record<string, unknown>[]
        pagination?: PaginationMeta
        meta?:       PaginationMeta
        breadcrumbs?: { id: string; label: string }[]
      }
      setRecords(body.records ?? body.data ?? [])
      setPagination(body.pagination ?? body.meta)
      if (body.breadcrumbs !== undefined) setBreadcrumbs(body.breadcrumbs ?? [])
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elementId, panelPath, resourceSlug, isTrashed])

  // ── Handlers ──

  function saveState(overrides: Record<string, unknown> = {}, filterOverride?: Record<string, string>) {
    if (!notifyStateChange) return
    const state: Record<string, unknown> = { search: searchRef.current, page: currentPageRef.current }
    if (sortFieldRef.current) { state.sort = sortFieldRef.current; state.dir = sortDirRef.current }
    if (currentFolderRef.current) state.folder = currentFolderRef.current
    if (activeScopeRef.current > 0) state.scope = activeScopeRef.current
    const filtersToSave = filterOverride ?? activeFilters
    for (const [k, v] of Object.entries(filtersToSave)) {
      if (v) state[`filter_${k}`] = v
    }
    notifyStateChange({ ...state, ...overrides })
  }

  function handleSearchChange(value: string) {
    setSearch(value)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      clearSelection()
      void fetchData({ page: 1, search: value })
      setCurrentPage(1)
      saveState({ search: value, page: 1 })
    }, 300)
  }

  function handlePageChange(page: number) {
    setCurrentPage(page)
    void fetchData({ page, search: searchRef.current })
    saveState({ page })
  }

  function handleLoadMore() {
    const nextPage = currentPageRef.current + 1
    setCurrentPage(nextPage)
    setLoading(true)
    const params = new URLSearchParams()
    params.set('page', String(nextPage))
    if (searchRef.current) params.set('search', searchRef.current)
    if (sortFieldRef.current) { params.set('sort', sortFieldRef.current); params.set('dir', sortDirRef.current) }
    for (const [k, v] of Object.entries(activeFilters)) { if (v) params.set(`filter[${k}]`, v) }
    if (activeScopeRef.current > 0) params.set('scope', String(activeScopeRef.current))
    if (resourceSlug && isTrashed) params.set('trashed', 'true')
    if (resourceSlug && scopePresets && activeScopeRef.current > 0 && activeScopeRef.current < scopePresets.length) {
      const scopeLabel = scopePresets[activeScopeRef.current]?.label
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
    saveState({ page: nextPage })
  }

  function handleSortChange(field: string) {
    const newDir = field === sortFieldRef.current ? (sortDirRef.current === 'asc' ? 'desc' : 'asc') : 'asc'
    setSortField(field)
    setSortDir(newDir)
    void fetchData({ page: 1, sort: field, dir: newDir })
    setCurrentPage(1)
    saveState({ sort: field, dir: newDir, page: 1 })
  }

  function handleScopeChange(index: number) {
    clearSelection()
    setActiveScope(index)
    setCurrentPage(1)
    void fetchData({ page: 1, scope: index })
    saveState({ scope: index, page: 1 })
  }

  function handleFilterChange(filterName: string, value: string) {
    clearSelection()
    const newFilters = { ...activeFilters }
    if (value) newFilters[filterName] = value
    else delete newFilters[filterName]
    setActiveFilters(newFilters)
    setCurrentPage(1)
    void fetchData({ page: 1, filters: newFilters })
    saveState({ page: 1 }, newFilters)
  }

  function clearFilters() {
    clearSelection()
    setActiveFilters({})
    setCurrentPage(1)
    void fetchData({ page: 1, filters: {} })
    saveState({ page: 1 }, {})
  }

  function handleFolderNavigate(folderId: string | null) {
    setCurrentFolder(folderId)
    setCurrentPage(1)
    if (!folderId) setBreadcrumbs([])
    void fetchData({ page: 1, folder: folderId })
    saveState({ page: 1, folder: folderId ?? undefined })
  }

  return {
    // State
    records, pagination, currentPage, search, sortField, sortDir,
    activeScope, activeFilters, currentFolder, breadcrumbs, loading,
    // Actions
    fetchData, handleSearchChange, handlePageChange, handleLoadMore,
    handleSortChange, handleScopeChange, handleFilterChange, clearFilters,
    handleFolderNavigate, setRecords, clearSelection,
    // Refs
    stateRefs: {
      currentPage: currentPageRef,
      search: searchRef,
      sortField: sortFieldRef,
      sortDir: sortDirRef,
      activeScope: activeScopeRef,
      currentFolder: currentFolderRef,
    },
  }
}
