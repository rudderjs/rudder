import type { PanelContext, QueryBuilderLike, RecordRow } from '../types.js'
import type { ListConfig } from '../schema/List.js'
import type { PersistMode } from '../persist.js'
import { readPersistedState } from '../persist.js'
import { resolveDataSource } from '../datasource.js'

// ─── Shared query pipeline for all data-view elements ──────
// Used by resolveTable and resolveListElement.
// Handles: persisted state, search, filters, sort, pagination, data sources.

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
}

export interface ListQueryOpts {
  /** Element ID for persist key. */
  elementId:     string
  /** Search column names (extracted from Column.searchable or config.searchColumns). */
  searchColumns: string[]
  /** Model class (from resource or direct). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model?:        any
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

    // Limit/offset
    const isLoadMore = config.paginationType === 'loadMore'
    const queryLimit = config.paginationType
      ? (isLoadMore ? urlPage * config.perPage : config.perPage)
      : config.limit
    const offset = config.paginationType && !isLoadMore ? (urlPage - 1) * config.perPage : 0
    q = q.limit(queryLimit)
    if (offset > 0) q = q.offset(offset)

    try { records = await q.get() } catch { /* empty model */ }
  }

  // Pagination count
  let pagination: ListQueryResult['pagination']
  if (config.paginationType && !config.lazy) {
    try {
      let countQ: QueryBuilderLike<RecordRow> = config.scope ? config.scope(model.query()) : model.query()
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

  return {
    records,
    pagination,
    activeSearch:  urlSearch,
    activeSort:    effectiveSortCol ? { col: effectiveSortCol, dir: effectiveSortDir } : undefined,
    activeFilters: Object.keys(persistedFilters).length > 0 ? persistedFilters : undefined,
  }
}
