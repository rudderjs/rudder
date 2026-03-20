'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { PanelSchemaElementMeta, PanelStatMeta, PanelColumnMeta, PanelI18n, ChartElementMeta, ChartDataset, ListElementMeta } from '@boostkit/panels'
import { readClientState, saveClientState } from '../_lib/persist.js'
import type { PersistMode } from '../_lib/persist.js'

// Extended type to include custom widget types not in PanelSchemaElementMeta
type SchemaElementRendererElement = PanelSchemaElementMeta
  | { type: 'stat-progress'; data: Record<string, unknown> }
  | { type: 'user-card'; data: Record<string, unknown> }

export interface SchemaElementRendererProps {
  element:    SchemaElementRendererElement
  panelPath:  string
  i18n:       PanelI18n
}

export function SchemaElementRenderer({ element, panelPath, i18n }: SchemaElementRendererProps) {
  if (element.type === 'text') {
    return <p className="text-sm text-muted-foreground">{element.content}</p>
  }

  if (element.type === 'heading') {
    const Tag = (`h${element.level}`) as 'h1' | 'h2' | 'h3'
    const cls = element.level === 1
      ? 'text-2xl font-bold'
      : element.level === 2
      ? 'text-xl font-semibold'
      : 'text-lg font-semibold'
    return <Tag className={cls}>{element.content}</Tag>
  }

  if (element.type === 'stats') {
    return <StatsRow stats={element.stats} />
  }

  if (element.type === 'chart') {
    return <ChartWidget element={element as ChartElementMeta} />
  }

  if (element.type === 'table') {
    return <SchemaTable element={element} panelPath={panelPath} i18n={i18n} />
  }

  if (element.type === 'list') {
    return <ListWidget element={element as ListElementMeta} />
  }

  if (element.type === 'stat-progress') {
    return <StatProgressWidget data={element.data ?? {}} />
  }

  if (element.type === 'user-card') {
    return <UserCardWidget data={element.data ?? {}} />
  }

  return null
}

function StatCard({ stat }: { stat: PanelStatMeta }) {
  return (
    <div className="rounded-xl border bg-card p-5 flex flex-col gap-1 h-full">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{stat.label}</p>
      <p className="text-3xl font-bold tabular-nums">{stat.value.toLocaleString()}</p>
      {stat.description && (
        <p className="text-xs text-muted-foreground mt-0.5">{stat.description}</p>
      )}
      {stat.trend !== undefined && (
        <p className={`text-xs font-medium mt-0.5 ${stat.trend >= 0 ? 'text-green-600' : 'text-red-500'}`}>
          {stat.trend >= 0 ? '\u2191' : '\u2193'} {Math.abs(stat.trend)}%
        </p>
      )}
    </div>
  )
}

function StatsRow({ stats }: { stats: PanelStatMeta[] }) {
  // Single stat — render directly, filling the container
  if (stats.length === 1 && stats[0]) return <StatCard stat={stats[0]} />

  return (
    <div className={`grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-${Math.min(stats.length, 4)}`}>
      {stats.map((stat, i) => <StatCard key={i} stat={stat} />)}
    </div>
  )
}

function SchemaTable({ element, panelPath, i18n }: { element: Extract<PanelSchemaElementMeta, { type: 'table' }>; panelPath: string; i18n: PanelI18n }) {
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

  const [records, setRecords] = useState<Record<string, unknown>[]>(element.records as Record<string, unknown>[])
  const [sort, setSort]       = useState<{ col: string; dir: 'asc' | 'desc' } | null>(
    ssrSort ? { col: ssrSort.col, dir: ssrSort.dir.toLowerCase() as 'asc' | 'desc' }
    : initialState.sort ? { col: String(initialState.sort), dir: (initialState.dir as 'asc' | 'desc') ?? 'asc' }
    : null,
  )
  const [search, setSearch]   = useState(ssrSearch ?? (initialState.search ? String(initialState.search) : ''))
  const [dragging, setDragging] = useState<string | null>(null)
  const [pagination, setPagination] = useState<typeof element.pagination>(element.pagination)
  const [currentPage, setCurrentPage] = useState(
    element.pagination?.currentPage && element.pagination.currentPage > 1
      ? element.pagination.currentPage  // SSR'd page (url/session persist)
      : initialState.page ? Number(initialState.page)  // client-restored page (localStorage/url on re-mount)
      : 1,
  )
  const [loadingMore, setLoadingMore] = useState(false)
  const [lazyLoaded, setLazyLoaded] = useState(!isLazy)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Remember: save state on change ──
  function saveRememberState(state: Record<string, unknown>) {
    if (!rememberMode || !tableId) return
    saveClientState(rememberMode as PersistMode, `table:${tableId}`, state, {
      pathSegment,
      apiPath: `/api/_tables/${tableId}/remember`,
      urlPrefix: tableId,
    })
  }

  // ── Shared fetch function — all table state changes go through API ──
  async function fetchTable(opts: { page?: number; search?: string; sort?: string; dir?: string; append?: boolean } = {}) {
    if (!tableId) return
    setLoadingMore(true)
    try {
      const params = new URLSearchParams()
      const p = opts.page ?? currentPage
      params.set('page', String(p))
      if (opts.search !== undefined ? opts.search : search) params.set('search', opts.search !== undefined ? opts.search : search)
      if (opts.sort) { params.set('sort', opts.sort); params.set('dir', opts.dir ?? 'asc') }
      else if (sort) { params.set('sort', sort.col); params.set('dir', sort.dir) }
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
    finally { setLoadingMore(false) }
  }

  // Reset state when the element changes (e.g. navigating between tabs with different tables)
  const elementRef = useRef(element)
  useEffect(() => {
    if (elementRef.current === element) return
    elementRef.current = element
    setRecords(element.records as Record<string, unknown>[])
    setSort(null)
    setSearch('')
    setPagination(element.pagination)
    setCurrentPage(1)
    setLazyLoaded(!isLazy)
  }, [element])

  // ── Restore remembered state — fetch if client state differs from SSR ──
  useEffect(() => {
    if (!rememberMode || !tableId) return
    const restoredPage = initialState.page ? Number(initialState.page) : 1
    const restoredSearch = initialState.search ? String(initialState.search) : ''
    const ssrPage = element.pagination?.currentPage ?? 1
    // Skip if SSR already has the right data (url/session on initial page load)
    if (restoredPage === ssrPage && !restoredSearch && !initialState.sort) return
    if (restoredPage <= 1 && !restoredSearch && !initialState.sort) return
    void fetchTable({ page: restoredPage, search: restoredSearch, sort: initialState.sort as string, dir: initialState.dir as string })
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

  // ── Lazy skeleton ──
  if (!lazyLoaded) {
    return (
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="px-5 py-3 border-b bg-muted/40">
          <div className="h-4 w-32 bg-muted/40 rounded animate-pulse" />
        </div>
        <div className="p-4 space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-8 bg-muted/20 rounded animate-pulse" />)}
        </div>
      </div>
    )
  }

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
    saveRememberState({ sort: next.col, dir: next.dir, search, page: hasPagination ? 1 : currentPage })
  }

  function handleSearchChange(value: string) {
    setSearch(value)
    // Debounce search — wait 300ms before fetching
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    if (hasPagination) {
      searchTimerRef.current = setTimeout(() => {
        // Reset to page 1 on search
        void fetchTable({ page: 1, search: value })
        setCurrentPage(1)
        saveRememberState({ sort: sort?.col, dir: sort?.dir, search: value, page: 1 })
      }, 300)
    } else {
      saveRememberState({ sort: sort?.col, dir: sort?.dir, search: value, page: currentPage })
    }
  }

  function handlePageChange(page: number) {
    if (pagination?.type === 'loadMore') {
      void fetchTable({ page, append: true })
    } else {
      void fetchTable({ page })
    }
    saveRememberState({ sort: sort?.col, dir: sort?.dir, search, page })
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

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b bg-muted/40">
        <div>
          <p className="text-sm font-semibold">{element.title}</p>
          {element.description && (
            <p className="text-xs text-muted-foreground mt-0.5">{element.description}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {hasSearch && (
            <input
              type="search"
              placeholder={i18n.search ?? 'Search…'}
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="h-7 rounded-md border bg-background px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
          )}
          {hasHref && (
            <a href={element.href} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              {i18n.viewAll}
            </a>
          )}
        </div>
      </div>

      {/* Table */}
      {displayRecords.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">{element.emptyMessage ?? i18n.noRecordsFound}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/20">
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
                        <span className="ml-1">{sort?.dir === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </th>
                  )
                })}
                {hasHref && <th className="w-8" />}
              </tr>
            </thead>
            <tbody>
              {displayRecords.map((record, i) => {
                const id = String(record['id'] ?? i)
                return (
                  <tr
                    key={id}
                    className={`border-b last:border-0 hover:bg-muted/30 transition-colors ${dragging === id ? 'opacity-50' : ''}`}
                    draggable={el.reorderable}
                    onDragStart={el.reorderable ? () => handleDragStart(id) : undefined}
                    onDragOver={el.reorderable ? handleDragOver : undefined}
                    onDrop={el.reorderable && el.reorderEndpoint ? () => handleDrop(id, el.reorderEndpoint ?? '') : undefined}
                  >
                    {el.reorderable && (
                      <td className="px-2 py-2.5 text-muted-foreground cursor-grab">⠿</td>
                    )}
                    {element.columns.map((col: PanelColumnMeta) => (
                      <td key={col.name} className="px-4 py-2.5 text-muted-foreground">
                        {formatCellValue(record[col.name], col, i18n, panelPath)}
                      </td>
                    ))}
                    {hasHref && (
                      <td className="px-4 py-2.5 text-right">
                        <a
                          href={`${element.href}/${record['id']}`}
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          →
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
        <div className="flex items-center justify-between px-5 py-3 border-t bg-muted/20">
          <p className="text-xs text-muted-foreground">
            {i18n.showing?.replace(':n', String(records.length)).replace(':total', String(pagination.total)) ?? `Showing ${records.length} of ${pagination.total}`}
          </p>
          <div className="flex items-center gap-1">
            {Array.from({ length: pagination.lastPage }, (_, i) => i + 1).map(page => (
              <button
                key={page}
                onClick={() => handlePageChange(page)}
                className={`px-2.5 py-1 text-xs rounded ${page === currentPage ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
              >
                {page}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Pagination: loadMore mode */}
      {pagination && pagination.type === 'loadMore' && records.length < pagination.total && (
        <div className="px-5 py-3 border-t">
          <button
            onClick={() => handlePageChange(currentPage + 1)}
            className="w-full text-center text-sm text-muted-foreground hover:text-foreground py-1.5"
          >
            {loadingMore ? (i18n.loading ?? 'Loading…') : (i18n.loadMore ?? 'Load more')}
          </button>
        </div>
      )}
    </div>
  )
}

function ChartWidget({ element }: { element: ChartElementMeta }) {
  const [mod, setMod] = useState<typeof import('recharts') | null>(null)

  useEffect(() => {
    import('recharts').then(setMod).catch(() => {})
  }, [])

  if (!mod) {
    return (
      <div className="rounded-xl border bg-card p-5" style={{ height: element.height }}>
        <p className="text-sm font-semibold mb-3">{element.title}</p>
        <div className="h-full animate-pulse bg-muted/30 rounded-lg" />
      </div>
    )
  }

  const { ResponsiveContainer, LineChart, BarChart, PieChart, AreaChart, Line, Bar, Pie, Area, XAxis, YAxis, Tooltip, CartesianGrid, Cell, Legend } = mod
  const colors = ['hsl(var(--primary))', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4']

  // Pie / Doughnut
  if (element.chartType === 'pie' || element.chartType === 'doughnut') {
    const pieData = element.labels.map((label: string, i: number) => ({
      name: label,
      value: element.datasets[0]?.data[i] ?? 0,
    }))
    return (
      <div className="rounded-xl border bg-card p-5">
        <p className="text-sm font-semibold mb-3">{element.title}</p>
        <ResponsiveContainer width="100%" height={element.height}>
          <PieChart>
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              innerRadius={element.chartType === 'doughnut' ? '60%' : 0}
              outerRadius="80%"
              paddingAngle={2}
            >
              {pieData.map((_: unknown, i: number) => (
                <Cell key={i} fill={(element.datasets[0]?.color ?? colors[i % colors.length]) as string} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
    )
  }

  // Line / Bar / Area
  const data = element.labels.map((label: string, i: number) => {
    const point: Record<string, unknown> = { name: label }
    for (const ds of element.datasets) {
      point[ds.label] = ds.data[i] ?? 0
    }
    return point
  })

  const ChartComp = element.chartType === 'bar' ? BarChart
    : element.chartType === 'area' ? AreaChart
    : LineChart

  return (
    <div className="rounded-xl border bg-card p-5">
      <p className="text-sm font-semibold mb-3">{element.title}</p>
      <ResponsiveContainer width="100%" height={element.height}>
        <ChartComp data={data}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="name" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip />
          {element.datasets.length > 1 && <Legend />}
          {element.datasets.map((ds: ChartDataset, i: number) => {
            const color = ds.color ?? colors[i % colors.length]
            if (element.chartType === 'bar') {
              return <Bar key={ds.label} dataKey={ds.label} fill={color} radius={[4, 4, 0, 0]} />
            }
            if (element.chartType === 'area') {
              // @ts-expect-error — recharts types don't handle exactOptionalPropertyTypes
              return <Area key={ds.label} type="monotone" dataKey={ds.label} stroke={color} fill={color} fillOpacity={0.15} strokeWidth={2} />
            }
            // @ts-expect-error — recharts types don't handle exactOptionalPropertyTypes
            return <Line key={ds.label} type="monotone" dataKey={ds.label} stroke={color} strokeWidth={2} dot={{ r: 3 }} />
          })}
        </ChartComp>
      </ResponsiveContainer>
    </div>
  )
}

function ListWidget({ element }: { element: ListElementMeta }) {
  return (
    <div className="rounded-xl border bg-card">
      <div className="px-5 py-3 border-b bg-muted/40">
        <p className="text-sm font-semibold">{element.title}</p>
      </div>
      {element.items.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">No items.</p>
      ) : (
        <ul className="divide-y">
          {element.items.map((item, i) => (
            <li key={i} className="px-5 py-3 flex items-start gap-3">
              {item.icon && <span className="text-base shrink-0 mt-0.5">{item.icon}</span>}
              <div className="flex-1 min-w-0">
                {item.href ? (
                  <a href={item.href} className="text-sm font-medium hover:text-primary transition-colors">
                    {item.label}
                  </a>
                ) : (
                  <p className="text-sm font-medium">{item.label}</p>
                )}
                {item.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function StatProgressWidget({ data }: { data: Record<string, unknown> }) {
  const value = Number(data?.value ?? 0)
  const max = Number(data?.max ?? 100)
  const label = String(data?.label ?? '')
  const pct = max > 0 ? (value / max) * 100 : 0
  const color = String(data?.color ?? 'hsl(var(--primary))')

  // SVG circular progress
  const radius = 15.9155
  const circumference = 2 * Math.PI * radius

  return (
    <div className="rounded-xl border bg-card p-5 h-full flex items-center gap-4">
      <svg viewBox="0 0 36 36" className="w-14 h-14 shrink-0 -rotate-90">
        <circle
          cx="18" cy="18" r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          className="text-muted/20"
        />
        <circle
          cx="18" cy="18" r={radius}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeDasharray={`${(pct / 100) * circumference} ${circumference}`}
          strokeLinecap="round"
        />
      </svg>
      <div>
        <p className="text-2xl font-bold tabular-nums">{value}<span className="text-sm font-normal text-muted-foreground">/{max}</span></p>
        {label && <p className="text-xs text-muted-foreground mt-0.5">{label}</p>}
      </div>
    </div>
  )
}

function UserCardWidget({ data }: { data: Record<string, unknown> }) {
  const name = String(data?.name ?? '')
  const role = String(data?.role ?? '')
  const avatar = data?.avatar as string | undefined
  const href = data?.href as string | undefined
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div className="rounded-xl border bg-card p-5 h-full flex items-center gap-4">
      {avatar ? (
        <img src={avatar} alt={name} className="w-12 h-12 rounded-full object-cover shrink-0" />
      ) : (
        <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-semibold shrink-0">
          {initials}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">{name}</p>
        {role && <p className="text-xs text-muted-foreground">{role}</p>}
      </div>
      {href && (
        <a href={href} className="text-xs text-primary hover:underline shrink-0">View</a>
      )}
    </div>
  )
}

function formatCellValue(value: unknown, col: PanelColumnMeta | null, i18n: PanelI18n, _panelPath?: string): string {
  if (value === null || value === undefined) return '—'
  if (col?.type === 'boolean' || typeof value === 'boolean') return value ? i18n.yes : i18n.no
  if (col?.type === 'date' || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) || value instanceof Date) {
    try {
      return new Intl.DateTimeFormat('en', { dateStyle: col?.format === 'datetime' ? undefined : 'medium', ...(col?.format === 'datetime' ? { dateStyle: 'medium', timeStyle: 'short' } : {}) }).format(new Date(String(value)))
    } catch { return String(value) }
  }
  return String(value)
}
