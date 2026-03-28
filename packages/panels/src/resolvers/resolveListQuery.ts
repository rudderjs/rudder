import type { PanelContext, QueryBuilderLike, RecordRow } from '../types.js'
import type { ListConfig } from '../schema/List.js'
import { readPersistedState } from '../persist.js'
import { resolveDataSource } from '../datasource.js'
import {
  applySearch, applyFilters, applyScope, applyFolderFilter,
  buildBreadcrumbs, countFiltered,
} from '../utils/queryHelpers.js'

// ─── Shared query pipeline for all data-view elements ──────
// Used by resolveDataView for SSR resolution of Table and List elements.

/** Check if a sort column name exists in the table columns or view fields. */
function isValidSortColumn(col: string, config: ListConfig): boolean {
  // Check config.sortBy (always valid — defined by the developer)
  if (col === config.sortBy) return true
  // Check columns (Table)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const columns = (config as any).columns as unknown[] | undefined
  if (columns?.length) {
    for (const c of columns) {
      if (typeof c === 'string' && c === col) return true
      if (typeof c === 'object' && c && 'getName' in c && (c as { getName(): string }).getName() === col) return true
    }
  }
  // Check view fields
  if (config.views?.length) {
    for (const v of config.views) {
      const fields = v.getFields?.()
      if (fields) {
        for (const f of fields) if (f.getName() === col) return true
      }
    }
  }
  // Check sortableOptions
  if (config.sortableOptions) {
    for (const opt of config.sortableOptions) if (opt.field === col) return true
  }
  return false
}

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
  elementId:     string
  searchColumns: string[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model?:        any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scopes?:       Array<{ scope?: (q: any) => any }> | undefined
  treeView?:     boolean
  folderView?:   boolean
}

/**
 * Resolve data for a List/Table element (SSR).
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
  const persistedScope  = persisted?.scope ? Number(persisted.scope) || 0 : 0
  const persistedFolder = persisted?.folder ? String(persisted.folder) : null

  // Extract persisted filters (stored as filter_<name> keys)
  const persistedFilters: Record<string, string> = {}
  if (persisted) {
    for (const [k, v] of Object.entries(persisted)) {
      if (k.startsWith('filter_')) persistedFilters[k.slice(7)] = String(v)
    }
  }

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

    q = applyFolderFilter(q, config.folderField, persistedFolder, { isFolderView: opts.folderView })
    q = applyScope(q, opts.scopes, persistedScope)
    if (urlSearch && searchColumns.length > 0) q = applySearch(q, searchColumns, urlSearch)
    q = applyFilters(q, config.filters, persistedFilters)

    // Sort — validate persisted sort column against known columns/fields
    const sortCol = urlSort ?? config.sortBy
    if (sortCol) {
      const validSort = !urlSort || isValidSortColumn(sortCol, config)
      if (validSort) q = q.orderBy(sortCol, urlSortDir ?? config.sortDir)
    }

    // Limit/offset — tree view fetches all records
    if (opts.treeView) {
      q = q.limit(1000)
    } else {
      const isLoadMore = config.paginationType === 'loadMore'
      const queryLimit = config.paginationType
        ? (isLoadMore ? urlPage * config.perPage : config.perPage)
        : config.limit
      const offset = config.paginationType && !isLoadMore ? (urlPage - 1) * config.perPage : 0
      q = q.limit(queryLimit)
      if (offset > 0) q = q.offset(offset)
    }

    try { records = await q.get() } catch { /* query failed — likely invalid persisted state */ }
  }

  // ── Pagination count (skip for tree view) ──
  let pagination: ListQueryResult['pagination']
  if (config.paginationType && !config.lazy && !opts.treeView) {
    try {
      const total = await countFiltered(model, {
        scope:         config.scope,
        folderField:   config.folderField,
        folderId:      persistedFolder,
        isFolderView:  opts.folderView,
        scopes:        opts.scopes,
        scopeIndex:    persistedScope,
        searchColumns: urlSearch ? searchColumns : undefined,
        searchTerm:    urlSearch,
        filterDefs:    config.filters,
        filterValues:  Object.keys(persistedFilters).length > 0 ? persistedFilters : undefined,
      })
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

  // ── Active state ──
  const effectiveSortCol = urlSort ?? config.sortBy
  const effectiveSortDir = urlSortDir ?? config.sortDir

  // ── Breadcrumbs for folder navigation ──
  let activeFolder: string | null | undefined
  let breadcrumbs: FolderBreadcrumb[] | undefined
  if (config.folderField && model && opts.folderView) {
    activeFolder = persistedFolder
    if (persistedFolder) {
      breadcrumbs = await buildBreadcrumbs(model, persistedFolder, config.folderField, config.titleField ?? 'name')
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
