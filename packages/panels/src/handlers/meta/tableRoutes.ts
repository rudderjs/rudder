import type { MiddlewareHandler, AppRequest } from '@boostkit/core'
import type { RouterLike } from '../types.js'
import type { Panel } from '../../Panel.js'
import type { ModelClass, QueryBuilderLike, RecordRow } from '../../types.js'
import { flattenFields, buildContext } from '../utils.js'
import { TableRegistry } from '../../registries/TableRegistry.js'
import { warmUpRegistries, debugWarn } from './shared.js'
import {
  applySearch, applyFilters, applyScope, applyFolderFilter,
  extractSearchColumns, parseUrlFilters, buildBreadcrumbs,
  applyColumnTransforms, countFiltered,
} from '../../utils/queryHelpers.js'

/** Extended config shape — covers both Table and List properties used by handlers. */
interface DataViewConfig {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model?: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows?: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scope?: (q: any) => any
  columns: unknown[]
  limit: number
  sortBy?: string | undefined
  sortDir: 'ASC' | 'DESC'
  searchable?: boolean | undefined
  searchColumns?: string[] | undefined
  paginationType?: 'pages' | 'loadMore' | undefined
  perPage: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  filters: Array<{ getName(): string; applyToQuery(q: any, value: string): any }>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  actions: Array<{ getName(): string; execute(records: unknown[]): Promise<void> }>
  lazy?: boolean | undefined
  softDeletes: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSave?: ((...args: any[]) => any) | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resourceClass?: { getSlug?(): string }
  folderField?: string | undefined
  titleField?: string | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scopes?: Array<{ scope?: (q: any) => any }> | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  views?: Array<{ getFields?(): any[] }> | undefined
}

export function mountTableRoutes(
  router: RouterLike,
  panel: Panel,
  mw: MiddlewareHandler[],
): void {
  const apiBase = panel.getApiBase()

  // ── Reorder endpoint ──
  router.post(`${apiBase}/_tables/reorder`, async (req, res) => {
    const { ids, field, model: modelName, parentField, parents } = (req.body as {
      ids?: string[]; field?: string; model?: string
      parentField?: string; parents?: Record<string, string | null>
    }) ?? {}
    if (!Array.isArray(ids) || !field) {
      return res.status(400).json({ message: 'ids[] and field are required.' })
    }

    const ResourceClass = panel.getResources().find(
      (R) => (R.model as ModelClass<RecordRow> | undefined)?.name === modelName || R.getSlug() === modelName,
    )
    const Model = ResourceClass?.model as ModelClass<RecordRow> | undefined

    let ListModel: ModelClass<RecordRow> | undefined
    if (!Model) {
      for (const [, tables] of (TableRegistry as unknown as { entries(): Iterable<[string, Map<string, unknown>]> }).entries?.() ?? []) {
        for (const [, table] of (tables as Map<string, { getConfig(): { model?: unknown } }>).entries()) {
          const cfg = table.getConfig()
          if (cfg.model) { ListModel = cfg.model as ModelClass<RecordRow>; break }
        }
        if (ListModel) break
      }
    }

    const EffectiveModel = Model ?? ListModel
    if (!EffectiveModel) {
      return res.status(404).json({ message: `Model "${modelName ?? 'unknown'}" not found on this panel.` })
    }

    try {
      await Promise.all(
        ids.map((id, index) => {
          const update: Record<string, unknown> = { [field]: index }
          if (parentField && parents && id in parents) {
            update[parentField] = parents[id] ?? null
          }
          return EffectiveModel.query().update(id, update)
        }),
      )
      return res.json({ success: true })
    } catch (err) {
      return res.status(500).json({ message: String(err) })
    }
  }, mw)

  // ── Remember state endpoint ──
  router.post(`${apiBase}/_tables/:tableId/remember`, async (req, res) => {
    const tableId = (req.params as Record<string, string> | undefined)?.['tableId']
    if (!tableId) return res.status(400).json({ message: 'Missing tableId.' })

    const state = (req.body as Record<string, unknown> | undefined) ?? {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = (req as any).session as { put(key: string, value: unknown): void } | undefined
    if (session) session.put(`table:${tableId}`, state)

    return res.json({ success: true })
  }, mw)

  // ── Table data endpoint (lazy, poll, paginated) ──
  router.get(`${apiBase}/_tables/:tableId`, async (req, res) => {
    const tableId = (req.params as Record<string, string> | undefined)?.['tableId']
    if (!tableId) return res.status(400).json({ message: 'Missing tableId.' })

    let table = TableRegistry.get(panel.getName(), tableId)
    if (!table) {
      try { await warmUpRegistries(panel, req) } catch (e) { debugWarn('registry.warmup', e) }
      table = TableRegistry.get(panel.getName(), tableId)
    }
    if (!table) return res.status(404).json({ message: `Table "${tableId}" not found.` })

    const config = table.getConfig() as unknown as DataViewConfig
    const url = new URL(req.url, 'http://localhost')
    const page = parseInt(url.searchParams.get('page') as string) || 1
    const search = url.searchParams.get('search')?.trim() ?? ''

    // ── fromArray / rows ──
    if (config.rows) {
      const { resolveDataSource: resolveDS } = await import('../../datasource.js')
      const ctx = buildContext(req)
      let records = await resolveDS(config.rows, ctx) as RecordRow[]

      // Client-side search for array data
      if (search && config.searchable) {
        const cols = extractSearchColumns(config)
        records = records.filter(row =>
          cols.some(col => String(row[col] ?? '').toLowerCase().includes(search.toLowerCase()))
        )
      }

      // Client-side filter for array data
      const urlFilters = parseUrlFilters(url)
      for (const [colName, value] of Object.entries(urlFilters)) {
        records = records.filter(row => String(row[colName] ?? '') === value)
      }

      const perPage = config.paginationType ? config.perPage : config.limit
      const offset = (page - 1) * perPage
      const paged = records.slice(offset, offset + perPage)

      return res.json({
        records: paged,
        pagination: config.paginationType ? {
          total: records.length, currentPage: page, perPage,
          lastPage: Math.ceil(records.length / perPage), type: config.paginationType,
        } : undefined,
      })
    }

    // ── Model-backed ──
    const Model = config.model as ModelClass<RecordRow> | undefined
    if (!Model) return res.status(404).json({ message: 'No data source configured.' })

    const folderField = config.folderField
    const viewParam = url.searchParams.get('view')
    const isTreeView = viewParam === 'tree'
    const isFolderView = viewParam === 'folder'
    const folderParam = url.searchParams.get('folder')
    const scopeIndex = parseInt(url.searchParams.get('scope') ?? '') || 0
    const scopes = config.scopes
    const searchCols = extractSearchColumns(config)
    const urlFilters = parseUrlFilters(url)
    const sortParam = url.searchParams.get('sort')
    const dirParam = url.searchParams.get('dir')?.toUpperCase() as 'ASC' | 'DESC' | undefined

    let q: QueryBuilderLike<RecordRow> = Model.query()
    if (config.scope) q = config.scope(q)
    if (config.softDeletes) q = q.where('deletedAt', null)
    q = applyFolderFilter(q, folderField, folderParam ?? null, { isTreeView, isFolderView: isFolderView || !!folderParam })
    q = applyScope(q, scopes, scopeIndex)
    if (search) q = applySearch(q, searchCols, search)
    q = applyFilters(q, config.filters, urlFilters)

    const sortCol = sortParam ?? config.sortBy
    if (sortCol) {
      try { q = q.orderBy(sortCol, dirParam ?? config.sortDir) } catch { /* invalid sort column */ }
    }

    // Limit/offset
    const perPage = config.paginationType ? config.perPage : config.limit
    if (!isTreeView) {
      q = q.limit(perPage).offset((page - 1) * perPage)
    } else {
      q = q.limit(1000)
    }

    let records: RecordRow[] = []
    try { records = await q.get() } catch { /* empty */ }

    // Pagination count
    let pagination
    if (config.paginationType && !isTreeView) {
      try {
        const total = await countFiltered(Model, {
          scope: config.scope, softDeletes: config.softDeletes,
          folderField, folderId: folderParam, isFolderView: isFolderView || !!folderParam,
          scopes, scopeIndex,
          searchColumns: search ? searchCols : undefined,
          searchTerm: search || undefined,
          filterDefs: config.filters,
          filterValues: Object.keys(urlFilters).length > 0 ? urlFilters : undefined,
        })
        pagination = { total, currentPage: page, perPage, lastPage: Math.ceil(total / perPage), type: config.paginationType }
      } catch {
        pagination = { total: records.length, currentPage: page, perPage, lastPage: Math.ceil(records.length / perPage), type: config.paginationType }
      }
    }

    // Column transforms
    applyColumnTransforms(records, config.columns ?? [])

    // Breadcrumbs
    let breadcrumbs: { id: string; label: string }[] | undefined
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (folderField && folderParam) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      breadcrumbs = await buildBreadcrumbs(Model, folderParam, folderField, config.titleField ?? 'name')
    }

    return res.json({ records, pagination, breadcrumbs })
  }, mw)

  // ── Inline-edit save endpoint ──
  router.post(`${apiBase}/_tables/:tableId/save`, async (req, res) => {
    const tableId = (req.params as Record<string, string> | undefined)?.['tableId']
    if (!tableId) return res.status(400).json({ message: 'Missing tableId.' })

    const { recordId, field, value } = (req.body as { recordId?: string | number; field?: string; value?: unknown }) ?? {}
    if (recordId === undefined || !field) return res.status(400).json({ message: 'recordId and field are required.' })

    let table = TableRegistry.get(panel.getName(), tableId)
    if (!table) {
      try { await warmUpRegistries(panel, req) } catch (e) { debugWarn('registry.warmup', e) }
      table = TableRegistry.get(panel.getName(), tableId)
    }
    if (!table) return res.status(404).json({ message: `Table "${tableId}" not found.` })

    const config = table.getConfig() as unknown as DataViewConfig
    const ctx = buildContext(req)

    // Find editable Column/DataField by name
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type EditableField = { getName(): string; isEditable(): boolean; getOnSaveFn?(): ((record: Record<string, unknown>, value: unknown, ctx: any) => Promise<void> | void) | undefined }
    let column: EditableField | undefined

    const isColumnInstances = config.columns?.length > 0 && typeof (config.columns[0] as { isEditable?: unknown })?.isEditable === 'function'
    if (isColumnInstances) {
      column = (config.columns as unknown as EditableField[]).find(c => c.getName() === field)
    }

    // Fallback: check view fields (List with ViewMode)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!column && config.views) {
      const views = config.views
      for (const v of views) {
        const fields = v.getFields?.()
        if (fields) {
          const found = fields.find((f: EditableField) => f.getName() === field && typeof f.isEditable === 'function' && f.isEditable())
          if (found) { column = found; break }
        }
      }
    }

    if (column && !column.isEditable()) {
      return res.status(403).json({ message: `Column "${field}" is not editable.` })
    }

    const columnSaveFn = column?.getOnSaveFn?.()
    const tableSaveFn = config.onSave ?? table.getOnSave?.()

    try {
      if (columnSaveFn) {
        await columnSaveFn({ id: recordId } as Record<string, unknown>, value, ctx)
      } else if (tableSaveFn) {
        await tableSaveFn({ id: recordId } as Record<string, unknown>, field, value, ctx)
      } else if (config.model) {
        const Model = config.model as ModelClass<RecordRow>
        await Model.query().update(recordId, { [field]: value })
      } else {
        return res.status(400).json({ message: 'No save handler configured.' })
      }

      if (table.isLive()) {
        try {
          const broadcastPkg = '@boostkit/broadcast'
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { broadcast } = await import(/* @vite-ignore */ broadcastPkg) as any
          broadcast(`live:table:${tableId}`, 'refresh', { field, recordId })
          const resourceSlug = config.resourceClass?.getSlug?.() as string | undefined
          if (resourceSlug) {
            broadcast(`panel:${resourceSlug}`, 'record.updated', { id: recordId })
          } else {
            const slugFromId = tableId.replace(/-[^-]+$/, '')
            const matchingResource = panel.getResources().find(R => R.getSlug() === slugFromId)
            if (matchingResource) broadcast(`panel:${slugFromId}`, 'record.updated', { id: recordId })
          }
        } catch { /* @boostkit/broadcast not available */ }
      }

      return res.json({ success: true })
    } catch (err) {
      return res.status(500).json({ success: false, message: String(err) })
    }
  }, mw)

  // ── Action endpoint ──
  router.post(`${apiBase}/_tables/:tableId/action/:actionName`, async (req, res) => {
    const tableId = (req.params as Record<string, string> | undefined)?.['tableId']
    const actionName = (req.params as Record<string, string> | undefined)?.['actionName']
    if (!tableId || !actionName) return res.status(400).json({ message: 'Missing tableId or actionName.' })

    let table = TableRegistry.get(panel.getName(), tableId)
    if (!table) {
      try { await warmUpRegistries(panel, req) } catch (e) { debugWarn('registry.warmup', e) }
    }
    table = TableRegistry.get(panel.getName(), tableId)
    if (!table) return res.status(404).json({ message: `Table "${tableId}" not found.` })

    const action = table.getActions().find(a => a.getName() === actionName)
    if (!action) return res.status(404).json({ message: `Action "${actionName}" not found.` })

    const { ids } = (req.body as { ids?: string[] }) ?? {}
    if (!Array.isArray(ids)) return res.status(400).json({ message: 'ids[] is required.' })

    const actionConfig = table.getConfig()
    const Model = actionConfig.model as ModelClass<RecordRow> | undefined
    let records: unknown[] = ids

    if (Model) {
      try {
        records = await Promise.all(ids.map(id => Model.query().find(id)))
        records = records.filter(Boolean)
      } catch { /* use raw IDs as fallback */ }
    }

    try {
      await action.execute(records)
      if (table.isLive()) {
        try {
          const broadcastPkg = '@boostkit/broadcast'
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { broadcast } = await import(/* @vite-ignore */ broadcastPkg) as any
          broadcast(`live:table:${tableId}`, 'refresh', { action: actionName })
        } catch { /* @boostkit/broadcast not available */ }
      }
      return res.json({ success: true })
    } catch (err) {
      return res.status(422).json({ message: String(err) })
    }
  }, mw)
}
