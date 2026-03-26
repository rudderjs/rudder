import type { Panel } from '../Panel.js'
import type { PanelContext, SchemaElementLike, QueryBuilderLike, RecordRow } from '../types.js'
import type { TableElementMeta } from '../schema/index.js'
import type { PanelSchemaElementMeta } from '../resolveSchema.js'
import type { PersistMode } from '../persist.js'
import type { ConfigurableElement, ResourceLike, ModelLike } from './types.js'
import { TableRegistry } from '../registries/TableRegistry.js'
import { readPersistedState } from '../persist.js'
import { resolveDataSource } from '../datasource.js'
import { resolveColumns, resolvePagination, resolveSearchColumns, buildTableMeta, resolveActiveTabIndex } from './helpers.js'

export async function resolveTable(
  el: SchemaElementLike,
  panel: Panel,
  ctx: PanelContext,
): Promise<PanelSchemaElementMeta | null> {
  const config = (el as ConfigurableElement).getConfig()
  const table = el as unknown as import('../schema/Table.js').Table

  // ── Table with .tabs() — resolve each tab's scoped table and return a tabs meta ──
  if (config.tabs.length > 0) {
    return resolveTableTabs(table, config, panel, ctx)
  }

  // Register table for lazy/poll/paginated API endpoint
  const tableId = (el as unknown as { getId(): string }).getId()
  TableRegistry.register(panel.getName(), tableId, el as unknown as import('../schema/Table.js').Table)

  // Read persisted state for remember('url') or remember('session') tables
  const persisted = readPersistedState(
    config.remember ?? false,
    `table:${tableId}`,
    ctx,
    tableId,
  )
  const urlPage = persisted?.page ? Number(persisted.page) || 1 : 1
  const urlSort = persisted?.sort ? String(persisted.sort) : undefined
  const urlSortDir = persisted?.dir ? String(persisted.dir).toUpperCase() as 'ASC' | 'DESC' : undefined
  const urlSearch = persisted?.search ? String(persisted.search) : undefined

  // Extract persisted filters (stored as filter_<name> keys)
  const persistedFilters: Record<string, string> = {}
  if (persisted) {
    for (const [k, v] of Object.entries(persisted)) {
      if (k.startsWith('filter_')) persistedFilters[k.slice(7)] = String(v)
    }
  }

  // ── fromResource(Class) — preferred resource-linked mode ───
  if (config.resourceClass) {
    const ResourceClass = config.resourceClass as ResourceLike
    const Model = ResourceClass.model as ModelLike | undefined
    if (!Model) return null

    let records: RecordRow[] = []

    // Skip query for lazy tables — data will be fetched client-side
    // Resolve search columns for query + count
    const searchCols = resolveSearchColumns(config)
    const searchFilter = urlSearch && searchCols.length > 0 ? { search: urlSearch, columns: searchCols } : undefined

    if (!config.lazy) {
      let q: QueryBuilderLike<RecordRow> = Model.query()
      if (config.scope) q = config.scope(q)

      // Apply search
      if (searchFilter) {
        q = q.where(searchFilter.columns[0]!, 'LIKE', `%${searchFilter.search}%`)
        for (let si = 1; si < searchFilter.columns.length; si++) q = q.orWhere(searchFilter.columns[si]!, 'LIKE', `%${searchFilter.search}%`)
      }

      // Apply persisted filters
      for (const [filterName, filterValue] of Object.entries(persistedFilters)) {
        const filter = config.filters.find(f => f.getName() === filterName)
        if (filter) q = filter.applyToQuery(q, filterValue)
        else q = q.where(filterName, filterValue)
      }

      const sortCol = urlSort ?? config.sortBy
      if (sortCol) {
        const dir = urlSortDir ?? config.sortDir
        q = q.orderBy(sortCol, dir)
      }
      // loadMore: fetch all records up to the current page (page * perPage)
      // pages: fetch just one page with offset
      const isLoadMore = config.paginationType === 'loadMore'
      const queryLimit = config.paginationType ? (isLoadMore ? urlPage * config.perPage : config.perPage) : config.limit
      const offset = config.paginationType && !isLoadMore ? (urlPage - 1) * config.perPage : 0
      q = q.limit(queryLimit)
      if (offset > 0) q = q.offset(offset)

      try { records = await q.get() } catch { /* empty model */ }
    }

    const columns = resolveColumns(config.columns, ResourceClass)
    const pagination = await resolvePagination(config, Model, records.length, urlPage, searchFilter, persistedFilters, config.filters)
    const slug = ResourceClass.getSlug?.() as string | undefined

    // Active sort: persisted sort → table default sort → undefined
    const effectiveSortCol = urlSort ?? config.sortBy
    const effectiveSortDir = urlSortDir ?? config.sortDir

    return buildTableMeta(config, columns, records, tableId, {
      resource: slug ?? '',
      href: slug ? `${panel.getPath()}/${slug}` : '',
      pagination,
      activeSearch: urlSearch,
      activeSort: effectiveSortCol ? { col: effectiveSortCol, dir: effectiveSortDir } : undefined,
      activeFilters: Object.keys(persistedFilters).length > 0 ? persistedFilters : undefined,
    })
  }

  // ── fromModel(Class) — model-backed, no resource ────────────
  if (config.model) {
    const Model = config.model as ModelLike

    let records: RecordRow[] = []

    // Resolve search columns for query + count
    const searchCols2 = resolveSearchColumns(config)
    const searchFilter2 = urlSearch && searchCols2.length > 0 ? { search: urlSearch, columns: searchCols2 } : undefined

    // Skip query for lazy tables — data will be fetched client-side
    if (!config.lazy) {
      let q: QueryBuilderLike<RecordRow> = Model.query()
      if (config.scope) q = config.scope(q)

      // Apply search
      if (searchFilter2) {
        q = q.where(searchFilter2.columns[0]!, 'LIKE', `%${searchFilter2.search}%`)
        for (let si = 1; si < searchFilter2.columns.length; si++) q = q.orWhere(searchFilter2.columns[si]!, 'LIKE', `%${searchFilter2.search}%`)
      }

      // Apply persisted filters
      for (const [filterName, filterValue] of Object.entries(persistedFilters)) {
        const filter = config.filters.find(f => f.getName() === filterName)
        if (filter) q = filter.applyToQuery(q, filterValue)
        else q = q.where(filterName, filterValue)
      }

      const sortCol = urlSort ?? config.sortBy
      if (sortCol) q = q.orderBy(sortCol, urlSortDir ?? config.sortDir)
      const isLoadMore2 = config.paginationType === 'loadMore'
      const modelLimit = config.paginationType ? (isLoadMore2 ? urlPage * config.perPage : config.perPage) : config.limit
      const offset = config.paginationType && !isLoadMore2 ? (urlPage - 1) * config.perPage : 0
      q = q.limit(modelLimit)
      if (offset > 0) q = q.offset(offset)

      try { records = await q.get() } catch { /* empty model */ }
    }

    const columns = resolveColumns(config.columns)
    const pagination = await resolvePagination(config, Model, records.length, urlPage, searchFilter2, persistedFilters, config.filters)

    const modelSortCol = urlSort ?? config.sortBy
    const modelSortDir = urlSortDir ?? config.sortDir

    return buildTableMeta(config, columns, records, tableId, {
      reorderEndpoint: config.reorderable ? `${panel.getApiBase()}/_tables/reorder` : undefined,
      pagination,
      activeSearch: urlSearch,
      activeSort: modelSortCol ? { col: modelSortCol, dir: modelSortDir } : undefined,
      activeFilters: Object.keys(persistedFilters).length > 0 ? persistedFilters : undefined,
    })
  }

  // ── .fromArray() / .rows() — static array or async function ──
  if (config.rows) {
    const columns = resolveColumns(config.columns)

    // Resolve data source (static array or async function)
    let allRecords: Record<string, unknown>[] = []
    if (!config.lazy) {
      allRecords = await resolveDataSource(config.rows, ctx)
    }

    // Pagination — slice the resolved array
    const isLoadMore3 = config.paginationType === 'loadMore'
    const offset = config.paginationType && !isLoadMore3 ? (urlPage - 1) * config.perPage : 0
    const sliceEnd = isLoadMore3 ? urlPage * config.perPage : offset + config.perPage
    const records = config.paginationType
      ? allRecords.slice(offset, sliceEnd)
      : allRecords

    const pagination = config.paginationType && !config.lazy
      ? { total: allRecords.length, currentPage: urlPage, perPage: config.perPage, lastPage: Math.ceil(allRecords.length / config.perPage), type: config.paginationType } as TableElementMeta['pagination']
      : undefined

    return buildTableMeta(config, columns, records as RecordRow[], tableId, { pagination })
  }

  return null
}

// ── Table tabs → Tabs meta ──────────────────────────────────

async function resolveTableTabs(
  table: import('../schema/Table.js').Table,
  config: ReturnType<ConfigurableElement['getConfig']>,
  panel: Panel,
  ctx: PanelContext,
): Promise<PanelSchemaElementMeta> {
  const tableId = table.getId()
  const tabsId = `${tableId}-tabs`
  const persistMode = (config.remember || 'session') as PersistMode

  const resolvedTabs: { label: string; icon?: string; elements: PanelSchemaElementMeta[] }[] = []

  for (const tab of config.tabs) {
    const tabName = tab.getLabel().toLowerCase().replace(/\s+/g, '-')
    const tabTableId = `${tableId}-${tabName}`
    const tabTable = table._cloneWithScope(tabTableId, tab.getScope())
    const resolved = await resolveTable(tabTable as unknown as SchemaElementLike, panel, ctx)

    const tabMeta: { label: string; icon?: string; elements: PanelSchemaElementMeta[] } = {
      label: tab.getLabel(),
      elements: resolved ? [resolved] : [],
    }
    const icon = tab.getIcon()
    if (icon) tabMeta.icon = icon
    resolvedTabs.push(tabMeta)
  }

  const tabLabels = config.tabs.map(t => t.getLabel())
  const activeTabIndex = await resolveActiveTabIndex(persistMode, tabsId, tabLabels, ctx)

  return {
    type: 'tabs',
    id: tabsId,
    tabs: resolvedTabs,
    persist: persistMode,
    ...(activeTabIndex > 0 ? { activeTab: activeTabIndex } : {}),
  } as unknown as PanelSchemaElementMeta
}
