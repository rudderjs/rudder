import type { QueryBuilderLike, RecordRow } from '../types.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FilterLike = { getName(): string; applyToQuery(q: any, value: string): any }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ScopeLike = { scope?: (q: any) => any }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ModelLike = { query(): QueryBuilderLike<any>; name?: string }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ColumnLike = { getName(): string; getComputeFn?(): ((r: any) => unknown) | undefined; getDisplayFn?(): ((v: unknown, r?: any) => unknown) | undefined }

// ─── Search ────────────────────────────────────────────────

/** Apply LIKE search across multiple columns (OR chain). */
export function applySearch<T extends RecordRow>(
  q: QueryBuilderLike<T>,
  columns: string[],
  term: string,
): QueryBuilderLike<T> {
  if (!term || columns.length === 0) return q
  q = q.where(columns[0]!, 'LIKE', `%${term}%`)
  for (let i = 1; i < columns.length; i++) {
    q = q.orWhere(columns[i]!, 'LIKE', `%${term}%`)
  }
  return q
}

/** Extract search column names from config. */
export function extractSearchColumns(config: {
  searchable?: boolean | undefined
  searchColumns?: string[] | undefined
  columns?: unknown[] | undefined
}): string[] {
  if (!config.searchable) return []
  if (config.searchColumns) return config.searchColumns
  if (!config.columns) return []
  return (config.columns as { toMeta?: () => { searchable?: boolean; name: string } }[])
    .filter(c => typeof c !== 'string' && c.toMeta?.()?.searchable)
    .map(c => c.toMeta!().name)
}

// ─── Filters ───────────────────────────────────────────────

/** Apply named filter values using Filter definitions. Falls back to where() for unknown names. */
export function applyFilters<T extends RecordRow>(
  q: QueryBuilderLike<T>,
  filterDefs: FilterLike[],
  filterValues: Record<string, string>,
): QueryBuilderLike<T> {
  for (const [name, value] of Object.entries(filterValues)) {
    if (!value) continue
    const filter = filterDefs.find(f => f.getName() === name)
    if (filter) q = filter.applyToQuery(q, value)
    else q = q.where(name, value)
  }
  return q
}

/** Parse filter values from URL search params (?filter[name]=value). */
export function parseUrlFilters(url: URL): Record<string, string> {
  const filters: Record<string, string> = {}
  for (const [key, value] of url.searchParams.entries()) {
    const match = key.match(/^filter\[(.+)\]$/)
    if (match && value) filters[match[1]!] = value
  }
  return filters
}

// ─── Scopes ────────────────────────────────────────────────

/** Apply scope preset by index. */
export function applyScope<T extends RecordRow>(
  q: QueryBuilderLike<T>,
  scopes: ScopeLike[] | undefined,
  scopeIndex: number,
): QueryBuilderLike<T> {
  if (!scopes || scopeIndex <= 0 || scopeIndex >= scopes.length) return q
  const scopeFn = scopes[scopeIndex]?.scope
  if (scopeFn) q = scopeFn(q) as QueryBuilderLike<T>
  return q
}

// ─── Folder ────────────────────────────────────────────────

/** Apply folder-level filter. Skips for tree view (fetches all). */
export function applyFolderFilter<T extends RecordRow>(
  q: QueryBuilderLike<T>,
  folderField: string | undefined,
  folderId: string | null,
  opts: { isTreeView?: boolean | undefined; isFolderView?: boolean | undefined },
): QueryBuilderLike<T> {
  if (!folderField) return q
  if (opts.isTreeView) return q
  if (!opts.isFolderView && !folderId) return q
  if (folderId) q = q.where(folderField, folderId)
  else q = q.where(folderField, null)
  return q
}

/** Build breadcrumb chain by walking parent references. */
export async function buildBreadcrumbs(
  model: ModelLike,
  folderId: string | null,
  folderField: string,
  titleField = 'name',
): Promise<{ id: string; label: string }[]> {
  if (!folderId) return []
  const breadcrumbs: { id: string; label: string }[] = []
  let currentId: string | null = folderId
  let depth = 0
  while (currentId && depth < 20) {
    depth++
    try {
      const row = await model.query().find(currentId) as RecordRow | null
      if (!row) break
      breadcrumbs.unshift({ id: String(row.id), label: String(row[titleField] ?? row.id) })
      currentId = row[folderField] ? String(row[folderField]) : null
    } catch { break }
  }
  return breadcrumbs
}

// ─── Column transforms ────────────────────────────────────

/** Apply Column.compute() and Column.display() transforms to records. */
export function applyColumnTransforms(
  records: RecordRow[],
  columns: unknown[],
): RecordRow[] {
  if (!columns?.length) return records
  const isColumnInstances = typeof (columns[0] as { getComputeFn?: unknown })?.getComputeFn === 'function'
  if (!isColumnInstances) return records

  const cols = columns as ColumnLike[]
  const hasTransforms = cols.some(c => c.getComputeFn?.() || c.getDisplayFn?.())
  if (!hasTransforms) return records

  for (const record of records) {
    for (const col of cols) {
      const computeFn = col.getComputeFn?.()
      if (computeFn) (record as Record<string, unknown>)[col.getName()] = computeFn(record)
      const displayFn = col.getDisplayFn?.()
      if (displayFn) (record as Record<string, unknown>)[col.getName()] = displayFn((record as Record<string, unknown>)[col.getName()], record)
    }
  }
  return records
}

// ─── Count ─────────────────────────────────────────────────

/** Build a count query with the same filters applied. */
export async function countFiltered(
  model: ModelLike,
  opts: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    scope?: ((q: any) => any) | undefined
    softDeletes?: boolean | undefined
    folderField?: string | undefined
    folderId?: string | null | undefined
    isFolderView?: boolean | undefined
    scopes?: ScopeLike[] | undefined
    scopeIndex?: number | undefined
    searchColumns?: string[] | undefined
    searchTerm?: string | undefined
    filterDefs?: FilterLike[] | undefined
    filterValues?: Record<string, string> | undefined
  },
): Promise<number> {
  let q: QueryBuilderLike<RecordRow> = opts.scope ? opts.scope(model.query()) : model.query()
  if (opts.softDeletes) q = q.where('deletedAt', null)
  q = applyFolderFilter(q, opts.folderField, opts.folderId ?? null, { isFolderView: opts.isFolderView })
  q = applyScope(q, opts.scopes, opts.scopeIndex ?? 0)
  if (opts.searchTerm && opts.searchColumns?.length) {
    q = applySearch(q, opts.searchColumns, opts.searchTerm)
  }
  if (opts.filterDefs && opts.filterValues) {
    q = applyFilters(q, opts.filterDefs, opts.filterValues)
  }
  return await (q as QueryBuilderLike<RecordRow> & { count(): Promise<number> }).count()
}
