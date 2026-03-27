import type { PanelContext, QueryBuilderLike, RecordRow } from '../types.js'
import type { ListConfig } from '../schema/List.js'
import type { PersistMode } from '../persist.js'
import { readPersistedState } from '../persist.js'
import { resolveDataSource } from '../datasource.js'

// ─── Shared query pipeline for all data-view elements ──────
// Used by resolveTable and resolveListElement.
// Handles: persisted state, search, filters, sort, pagination, data sources.

export interface FolderBreadcrumb {
  id:    string
  label: string
}

export interface ListQueryResult {
  records:          RecordRow[]
  pagination?:      {
    total:       number
    currentPage: number
    perPage:     number
    lastPage:    number
    type:        'pages' | 'loadMore'
  } | undefined
  activeSearch?:    string | undefined
  activeSort?:      { col: string; dir: string } | undefined
  activeFilters?:   Record<string, string> | undefined
  activeFolder?:    string | null | undefined
  breadcrumbs?:     FolderBreadcrumb[] | undefined
}

export interface ListQueryOpts {
  /** Element ID for persist key. */
  elementId:     string
  /** Search column names (extracted from Column.searchable or config.searchColumns). */
  searchColumns: string[]
  /** Model class (from resource or direct). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model?:        any
  /** Scope presets from .scopes() — applied based on persisted scope index. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scopes?:       Array<{ scope?: (q: any) => any }> | undefined
  /** When true, skip folder filter and pagination (tree view). */
  treeView?:     boolean
}

/**
 * Resolve data for a List/Table element.
 * Reads persisted state, builds query (or slices array), returns records + pagination.
 */
export async function resolveListQuery(
  config: ListConfig,
  ctx: PanelContext,
  opts: ListQueryOpts,
): Promise<ListQueryResult> {
  const { elementId, searchColumns, model } = opts

  // ── Read persisted state (url/session) ──
  const persisted = readPersistedState(
    config.remember ?? false,
    `table:${elementId}`,
    ctx,
    elementId,
  )
  const urlPage    = persisted?.page ? Number(persisted.page) || 1 : 1
  const urlSort    = persisted?.sort ? String(persisted.sort) : undefined
  const urlSortDir = persisted?.dir ? String(persisted.dir).toUpperCase() as 'ASC' | 'DESC' : undefined
  const urlSearch  = persisted?.search ? String(persisted.search) : undefined

  // Extract persisted filters (stored as filter_<name> keys)
  const persistedFilters: Record<string, string> = {}
  if (persisted) {
    for (const [k, v] of Object.entries(persisted)) {
      if (k.startsWith('filter_')) persistedFilters[k.slice(7)] = String(v)
    }
  }

  // Read persisted scope index
  const persistedScope = persisted?.scope ? Number(persisted.scope) || 0 : 0

  // Read persisted folder
  const persistedFolder = persisted?.folder ? String(persisted.folder) : null

  const searchFilter = urlSearch && searchColumns.length > 0
    ? { search: urlSearch, columns: searchColumns }
    : undefined

  // ── fromArray / rows — static array or async function ──
  if (config.rows) {
    let allRecords: RecordRow[] = []
    if (!config.lazy) {
      allRecords = await resolveDataSource(config.rows, ctx) as RecordRow[]
    }

    const isLoadMore = config.paginationType === 'loadMore'
    const offset   = config.paginationType && !isLoadMore ? (urlPage - 1) * config.perPage : 0
    const sliceEnd = isLoadMore ? urlPage * config.perPage : offset + config.perPage
    const records  = config.paginationType
      ? allRecords.slice(offset, sliceEnd)
      : allRecords

    const pagination = config.paginationType && !config.lazy
      ? {
          total:       allRecords.length,
          currentPage: urlPage,
          perPage:     config.perPage,
          lastPage:    Math.ceil(allRecords.length / config.perPage),
          type:        config.paginationType,
        }
      : undefined

    return { records, pagination }
  }

  // ── Model query (fromModel or fromResource) ──
  if (!model) return { records: [] }

  let records: RecordRow[] = []

  if (!config.lazy) {
    let q: QueryBuilderLike<RecordRow> = model.query()
    if (config.scope) q = config.scope(q)

    // Apply folder filter (WHERE folderField = :folder or IS NULL for root) — skip for tree view
    if (config.folderField && !opts.treeView) {
      if (persistedFolder) {
        q = q.where(config.folderField, persistedFolder)
      } else {
        q = q.where(config.folderField, null)
      }
    }

    // Apply scope preset
    if (opts.scopes && persistedScope > 0 && persistedScope < opts.scopes.length) {
      const scopeFn = opts.scopes[persistedScope]?.scope
      if (scopeFn) q = scopeFn(q)
    }

    // Apply search
    if (searchFilter) {
      q = q.where(searchFilter.columns[0]!, 'LIKE', `%${searchFilter.search}%`)
      for (let i = 1; i < searchFilter.columns.length; i++) {
        q = q.orWhere(searchFilter.columns[i]!, 'LIKE', `%${searchFilter.search}%`)
      }
    }

    // Apply persisted filters
    for (const [filterName, filterValue] of Object.entries(persistedFilters)) {
      const filter = config.filters.find(f => f.getName() === filterName)
      if (filter) q = filter.applyToQuery(q, filterValue)
      else q = q.where(filterName, filterValue)
    }

    // Sort
    const sortCol = urlSort ?? config.sortBy
    if (sortCol) {
      q = q.orderBy(sortCol, urlSortDir ?? config.sortDir)
    }

    // Limit/offset — tree view fetches all records
    if (opts.treeView) {
      q = q.limit(1000) // safety cap
    } else {
      const isLoadMore = config.paginationType === 'loadMore'
      const queryLimit = config.paginationType
        ? (isLoadMore ? urlPage * config.perPage : config.perPage)
        : config.limit
      const offset = config.paginationType && !isLoadMore ? (urlPage - 1) * config.perPage : 0
      q = q.limit(queryLimit)
      if (offset > 0) q = q.offset(offset)
    }

    try { records = await q.get() } catch { /* empty model */ }
  }

  // Pagination count (skip for tree view)
  let pagination: ListQueryResult['pagination']
  if (config.paginationType && !config.lazy && !opts.treeView) {
    try {
      let countQ: QueryBuilderLike<RecordRow> = config.scope ? config.scope(model.query()) : model.query()
      // Apply folder filter to count query
      if (config.folderField) {
        if (persistedFolder) countQ = countQ.where(config.folderField, persistedFolder)
        else countQ = countQ.where(config.folderField, null)
      }
      // Apply scope preset to count query too
      if (opts.scopes && persistedScope > 0 && persistedScope < opts.scopes.length) {
        const scopeFn = opts.scopes[persistedScope]?.scope
        if (scopeFn) countQ = scopeFn(countQ)
      }
      if (searchFilter) {
        countQ = countQ.where(searchFilter.columns[0]!, 'LIKE', `%${searchFilter.search}%`)
        for (let i = 1; i < searchFilter.columns.length; i++) {
          countQ = countQ.orWhere(searchFilter.columns[i]!, 'LIKE', `%${searchFilter.search}%`)
        }
      }
      for (const [filterName, filterValue] of Object.entries(persistedFilters)) {
        const filter = config.filters.find(f => f.getName() === filterName)
        if (filter) countQ = filter.applyToQuery(countQ, filterValue)
        else countQ = countQ.where(filterName, filterValue)
      }
      const total = await (countQ as QueryBuilderLike<RecordRow> & { count(): Promise<number> }).count()
      pagination = {
        total,
        currentPage: urlPage,
        perPage:     config.perPage,
        lastPage:    Math.ceil(total / config.perPage),
        type:        config.paginationType,
      }
    } catch {
      pagination = {
        total:       records.length,
        currentPage: urlPage,
        perPage:     config.perPage,
        lastPage:    Math.ceil(records.length / config.perPage),
        type:        config.paginationType,
      }
    }
  }

  // Active state
  const effectiveSortCol = urlSort ?? config.sortBy
  const effectiveSortDir = urlSortDir ?? config.sortDir

  // ── Resolve breadcrumb chain for folder navigation ──
  let activeFolder: string | null | undefined
  let breadcrumbs: FolderBreadcrumb[] | undefined
  if (config.folderField && model) {
    activeFolder = persistedFolder
    if (persistedFolder) {
      // Walk up parent chain to build breadcrumbs
      breadcrumbs = []
      let currentId: string | null = persistedFolder
      const titleKey = config.titleField ?? 'name'
      const maxDepth = 20  // safety limit
      let depth = 0
      while (currentId && depth < maxDepth) {
        depth++
        try {
          const row = await model.query().find(currentId) as RecordRow | null
          if (!row) break
          breadcrumbs.unshift({ id: String(row.id), label: String(row[titleKey] ?? row.id) })
          currentId = row[config.folderField!] ? String(row[config.folderField!]) : null
        } catch { break }
      }
    }
  }

  return {
    records,
    pagination,
    activeSearch:  urlSearch,
    activeSort:    effectiveSortCol ? { col: effectiveSortCol, dir: effectiveSortDir } : undefined,
    activeFilters: Object.keys(persistedFilters).length > 0 ? persistedFilters : undefined,
    activeFolder,
    breadcrumbs,
  }
}
