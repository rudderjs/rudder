import type { TableElementMeta, PanelStatMeta } from '../schema/index.js'
import type { PanelContext, QueryBuilderLike, RecordRow } from '../types.js'
import type { Column } from '../schema/Column.js'
import type { FieldOrGrouping } from '../Resource.js'
import type { Field } from '../schema/Field.js'
import type { PersistMode } from '../persist.js'
import { readPersistedState, slugify as slugifyPersist } from '../persist.js'
import type { ResourceLike, ModelLike } from './types.js'

// ─── Field helpers ──────────────────────────────────────────

/** Type guard: true when item is a Field (has both getType and getName). */
export function isField(item: FieldOrGrouping): item is Field {
  return typeof (item as unknown as Record<string, unknown>)['getName'] === 'function'
}

export function flattenFields(items: FieldOrGrouping[]): FieldOrGrouping[] {
  const result: FieldOrGrouping[] = []
  for (const item of items) {
    if (typeof (item as unknown as Record<string, unknown>)['getFields'] === 'function') {
      result.push(...flattenFields((item as unknown as { getFields(): FieldOrGrouping[] }).getFields()))
    } else {
      result.push(item)
    }
  }
  return result
}

function titleCase(str: string): string {
  return str.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()).trim()
}

// ─── Table helpers ──────────────────────────────────────────

/** Extract searchable column names from table config. */
export function resolveSearchColumns(config: import('../schema/Table.js').TableConfig): string[] {
  if (!config.searchable) return []
  if (config.searchColumns) return config.searchColumns
  return (config.columns as Column[])
    .filter(c => typeof (c as { toMeta?: unknown }).toMeta === 'function' && (c as Column).toMeta().searchable)
    .map(c => (c as Column).toMeta().name)
}

/** Resolve Column[] or string[] into PanelColumnMeta[]. Optionally uses Resource fields for labels. */
export function resolveColumns(
  columns: import('../schema/Table.js').TableConfig['columns'],
  resourceClass?: ResourceLike,
): import('../schema/Table.js').PanelColumnMeta[] {
  const isColumnInstances = columns.length > 0 && typeof (columns[0] as { toMeta?: unknown })?.toMeta === 'function'

  if (isColumnInstances) {
    return (columns as Column[]).map(col => col.toMeta() as import('../schema/Table.js').PanelColumnMeta)
  }

  if (resourceClass) {
    const resource = new resourceClass()
    const flatFields2 = flattenFields(resource.fields())
    const names: string[] = columns.length > 0
      ? columns as string[]
      : flatFields2.filter((f): f is Field => isField(f) && !f.isHiddenFrom('table') && f.getType() !== 'hasMany').map(f => (f as Field).getName()).slice(0, 5)
    return names.map(name => {
      const field = flatFields2.find((f): f is Field => isField(f) && (f as Field).getName() === name)
      return { name, label: field ? field.getLabel() : titleCase(name) }
    })
  }

  return (columns as string[]).map(name => ({ name, label: titleCase(name) }))
}

/** Build pagination meta for a table. */
export async function resolvePagination(
  config: import('../schema/Table.js').TableConfig,
  model: ModelLike | undefined,
  recordCount: number,
  currentPage = 1,
  searchFilter?: { search: string; columns: string[] },
  persistedFilters?: Record<string, string>,
  filterDefs?: import('../schema/Filter.js').Filter[],
): Promise<TableElementMeta['pagination']> {
  if (!config.paginationType || config.lazy) return undefined

  let total = recordCount
  if (model) {
    try {
      let countQ: QueryBuilderLike<RecordRow> = config.scope ? config.scope(model.query()) : model.query()
      // Apply search filter to count query
      if (searchFilter && searchFilter.search && searchFilter.columns.length > 0) {
        countQ = countQ.where(searchFilter.columns[0]!, 'LIKE', `%${searchFilter.search}%`)
        for (let i = 1; i < searchFilter.columns.length; i++) {
          countQ = countQ.orWhere(searchFilter.columns[i]!, 'LIKE', `%${searchFilter.search}%`)
        }
      }
      // Apply persisted filters to count query
      if (persistedFilters && filterDefs) {
        for (const [filterName, filterValue] of Object.entries(persistedFilters)) {
          const filter = filterDefs.find(f => f.getName() === filterName)
          if (filter) countQ = filter.applyToQuery(countQ, filterValue)
          else countQ = countQ.where(filterName, filterValue)
        }
      }
      total = await (countQ as QueryBuilderLike<RecordRow> & { count(): Promise<number> }).count()
    } catch { /* fallback to recordCount */ }
  }

  return {
    total,
    currentPage,
    perPage:     config.perPage,
    lastPage:    Math.ceil(total / config.perPage),
    type:        config.paginationType,
  }
}

/** Apply Column.compute() and Column.display() transforms to records (server-side). */
export function applyColumnTransforms(
  config: import('../schema/Table.js').TableConfig,
  records: RecordRow[],
): RecordRow[] {
  const cols = config.columns
  const isColumnInstances = cols.length > 0 && typeof (cols[0] as { getComputeFn?: unknown })?.getComputeFn === 'function'
  if (!isColumnInstances) return records

  const columnList = cols as Column[]
  const hasTransforms = columnList.some(c => c.getComputeFn() || c.getDisplayFn())
  if (!hasTransforms) return records

  return records.map(record => {
    const row = { ...record }
    for (const col of columnList) {
      const computeFn = col.getComputeFn()
      if (computeFn) row[col.getName()] = computeFn(row as Record<string, unknown>)
      const displayFn = col.getDisplayFn()
      if (displayFn) row[col.getName()] = displayFn(row[col.getName()], row as Record<string, unknown>)
    }
    return row
  })
}

/** Assemble the final TableElementMeta from config + resolved data. */
export function buildTableMeta(
  config: import('../schema/Table.js').TableConfig,
  columns: import('../schema/Table.js').PanelColumnMeta[],
  records: RecordRow[],
  tableId: string,
  opts: {
    resource?: string | undefined
    href?: string | undefined
    reorderEndpoint?: string | undefined
    pagination?: TableElementMeta['pagination']
    activeSearch?: string | undefined
    activeSort?: { col: string; dir: string } | undefined
    activeFilters?: Record<string, string> | undefined
  },
): TableElementMeta {
  const transformedRecords = applyColumnTransforms(config, records)
  const meta: TableElementMeta = {
    type:     'table',
    title:    config.title,
    resource: opts.resource ?? '',
    columns,
    records:  transformedRecords,
    href:     config.href ?? opts.href ?? '',
    id:       tableId,
  }
  if (config.description)  meta.description  = config.description
  if (config.emptyMessage) meta.emptyMessage = config.emptyMessage
  if (config.reorderable && opts.reorderEndpoint) {
    meta.reorderable     = true
    meta.reorderEndpoint = opts.reorderEndpoint
  }
  if (config.searchable)          { meta.searchable = true; meta.searchColumns = config.searchColumns }
  if (config.filters.length > 0) meta.filters = config.filters.map(f => f.toMeta())
  if (config.actions.length > 0) meta.actions = config.actions.map(a => a.toMeta())
  if (config.lazy)                meta.lazy         = true
  if (config.pollInterval)        meta.pollInterval = config.pollInterval
  if (opts.pagination)            meta.pagination   = opts.pagination
  if (config.remember)            meta.remember     = config.remember
  if (opts.activeSearch)          meta.activeSearch  = opts.activeSearch
  if (opts.activeSort)            meta.activeSort   = opts.activeSort
  if (opts.activeFilters)         meta.activeFilters = opts.activeFilters
  if (config.live)                { meta.live = true; meta.liveChannel = `live:table:${tableId}` }
  return meta
}

/**
 * Resolve the SSR active tab index based on persist mode.
 * For 'url' mode reads from ctx.urlSearch, for 'session' mode reads from server session.
 * Returns 0 (first tab) for 'localStorage', false, or when lookup fails.
 */
export async function resolveActiveTabIndex(
  persistMode: PersistMode,
  tabsId: string | undefined,
  tabLabels: string[],
  ctx: PanelContext,
): Promise<number> {
  if (persistMode === 'url' && tabsId) {
    const urlSearch = ctx.urlSearch
    if (urlSearch) {
      const activeSlug = urlSearch[tabsId]
      if (activeSlug) {
        const idx = tabLabels.findIndex(label => slugifyPersist(label) === activeSlug)
        if (idx >= 0) return idx
      }
    }
  } else if (persistMode === 'session' && tabsId) {
    const state = readPersistedState('session', `tabs:${tabsId}`, ctx)
    if (state) {
      const slug = state.value ? String(state.value) : undefined
      if (typeof slug === 'string') {
        const idx = tabLabels.findIndex(label => slugifyPersist(label) === slug)
        if (idx >= 0) return idx
      }
    }
  }
  return 0
}
