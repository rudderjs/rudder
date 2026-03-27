import type { MiddlewareHandler, AppRequest } from '@boostkit/core'
import type { RouterLike } from '../types.js'
import type { Panel } from '../../Panel.js'
import type { ModelClass, QueryBuilderLike, RecordRow } from '../../types.js'
import { flattenFields, buildContext } from '../utils.js'
import { TableRegistry } from '../../registries/TableRegistry.js'
import { warmUpRegistries, debugWarn } from './shared.js'

export function mountTableRoutes(
  router: RouterLike,
  panel: Panel,
  mw: MiddlewareHandler[],
): void {
  const apiBase = panel.getApiBase()

  // Table reorder endpoint — used by Table.make().reorderable()
  // POST body: { model: string, ids: string[], field: string }
  // We cannot reference the model class directly here, so the client sends
  // ordered IDs and the field name; we update each record's position field.
  router.post(`${apiBase}/_tables/reorder`, async (req, res) => {
    const { ids, field, model: modelName } = (req.body as { ids?: string[]; field?: string; model?: string }) ?? {}
    if (!Array.isArray(ids) || !field) {
      return res.status(400).json({ message: 'ids[] and field are required.' })
    }

    // Find the model by name across all resources registered on this panel
    const ResourceClass = panel.getResources().find(
      (R) => (R.model as ModelClass<RecordRow> | undefined)?.name === modelName || R.getSlug() === modelName,
    )
    const Model = ResourceClass?.model as ModelClass<RecordRow> | undefined

    if (!Model) {
      return res.status(404).json({ message: `Model "${modelName}" not found on this panel.` })
    }

    try {
      await Promise.all(
        ids.map((id, index) =>
          Model.query().update(id, { [field]: index }),
        ),
      )
      return res.json({ success: true })
    } catch (err) {
      return res.status(500).json({ message: String(err) })
    }
  }, mw)

  // Save table navigation state to session (remember='session' mode)
  router.post(`${apiBase}/_tables/:tableId/remember`, async (req, res) => {
    const tableId = (req.params as Record<string, string> | undefined)?.['tableId']
    if (!tableId) return res.status(400).json({ message: 'Missing tableId.' })

    const state = (req.body as Record<string, unknown> | undefined) ?? {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = (req as any).session as { put(key: string, value: unknown): void } | undefined
    if (session) {
      session.put(`table:${tableId}`, state)
    }

    return res.json({ success: true })
  }, mw)

  // Table data endpoint — used by lazy, poll, paginated tables
  router.get(`${apiBase}/_tables/:tableId`, async (req, res) => {
    const tableId = (req.params as Record<string, string> | undefined)?.['tableId']
    if (!tableId) return res.status(400).json({ message: 'Missing tableId.' })

    let table = TableRegistry.get(panel.getName(), tableId)
    if (!table) {
      // Table not yet registered — warm up by evaluating schema
      try {
        await warmUpRegistries(panel, req)
      } catch (e) { debugWarn('registry.warmup', e) }
      table = TableRegistry.get(panel.getName(), tableId)
    }

    if (!table) return res.status(404).json({ message: `Table "${tableId}" not found.` })

    const config = table.getConfig()
    const url = new URL(req.url, 'http://localhost')
    const page = parseInt(url.searchParams.get('page') as string) || 1
    const search = url.searchParams.get('search')?.trim() ?? ''

    // --- fromArray() / rows() — static array or async function ---
    if (config.rows) {
      // Resolve data source
      const { resolveDataSource: resolveDS } = await import('../../datasource.js')
      const ctx = buildContext(req)
      const allRows = await resolveDS(config.rows, ctx)

      let filtered = allRows
      // Search for array rows
      if (search && config.searchable) {
        const cols = config.searchColumns ?? (config.columns ?? []).map((c: { getName?: () => string } | string) => typeof c === 'string' ? c : (c as { getName?: () => string }).getName?.() ?? '')
        filtered = allRows.filter(row =>
          cols.some(col => String(row[col as string] ?? '').toLowerCase().includes(search.toLowerCase()))
        )
      }

      // Apply filters
      for (const [key, value] of url.searchParams.entries()) {
        const match = key.match(/^filter\[(.+)\]$/)
        if (match) {
          const colName = match[1]
          filtered = filtered.filter(row => String(row[colName as string] ?? '') === value)
        }
      }

      const perPage = config.paginationType ? config.perPage : config.limit
      const offset = (page - 1) * perPage
      const records = filtered.slice(offset, offset + perPage)
      const total = filtered.length

      return res.json({
        records,
        pagination: config.paginationType ? {
          total,
          currentPage: page,
          perPage,
          lastPage: Math.ceil(total / perPage),
          type: config.paginationType,
        } : undefined,
      })
    }

    // --- Model-backed ---
    const Model = config.model as ModelClass<RecordRow> | undefined
    if (!Model) return res.status(404).json({ message: 'No data source configured.' })

    let q: QueryBuilderLike<RecordRow> = Model.query()
    if (config.scope) q = config.scope(q)

    // Apply scope preset if ?scope=N is set (from List.scopes())
    const scopeIndex = parseInt(url.searchParams.get('scope') ?? '') || 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scopes = (config as any).scopes as Array<{ scope?: (q: any) => any }> | undefined
    if (scopes && scopeIndex > 0 && scopeIndex < scopes.length) {
      const scopeFn = scopes[scopeIndex]?.scope
      if (scopeFn) q = scopeFn(q)
    }

    // Server-side search
    if (search && config.searchable) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const searchCols = config.searchColumns ?? ((config.columns ?? []) as any[])
        .filter((c: { toMeta?: () => { searchable?: boolean } }) => typeof c !== 'string' && c.toMeta?.()?.searchable)
        .map((c: { toMeta: () => { name: string } }) => c.toMeta().name)
      if (searchCols.length > 0) {
        q = q.where(searchCols[0] ?? '', 'LIKE', `%${search}%`)
        for (let i = 1; i < searchCols.length; i++) {
          q = q.orWhere(searchCols[i] ?? '', 'LIKE', `%${search}%`)
        }
      }
    }

    // Apply filters from query params: ?filter[name]=value
    const filterParams = url.searchParams
    for (const [key, value] of filterParams.entries()) {
      const match = key.match(/^filter\[(.+)\]$/)
      if (match) {
        const filterName = match[1]
        const filter = config.filters.find(f => f.getName() === filterName)
        if (filter) {
          q = filter.applyToQuery(q, value)
        }
      }
    }

    // Sort — use query params if provided, fall back to config default
    const sortParam = url.searchParams.get('sort')
    const dirParam = url.searchParams.get('dir')?.toUpperCase() as 'ASC' | 'DESC' | undefined
    const sortCol = sortParam ?? config.sortBy
    if (sortCol) q = q.orderBy(sortCol, dirParam ?? config.sortDir)

    const perPage = config.paginationType ? config.perPage : config.limit
    const offset = (page - 1) * perPage
    q = q.limit(perPage).offset(offset)

    let records: RecordRow[] = []
    try { records = await q.get() } catch { /* empty */ }

    let pagination
    if (config.paginationType) {
      let total = records.length
      try {
        let countQ: QueryBuilderLike<RecordRow> = config.scope ? config.scope(Model.query()) : Model.query()
        // Apply scope preset to count query
        if (scopes && scopeIndex > 0 && scopeIndex < scopes.length) {
          const countScopeFn = scopes[scopeIndex]?.scope
          if (countScopeFn) countQ = countScopeFn(countQ)
        }
        // Apply search filter to count query
        if (search && config.searchable) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const countSearchCols = config.searchColumns ?? ((config.columns ?? []) as any[])
            .filter((c: { toMeta?: () => { searchable?: boolean } }) => typeof c !== 'string' && c.toMeta?.()?.searchable)
            .map((c: { toMeta: () => { name: string } }) => c.toMeta().name)
          if (countSearchCols.length > 0) {
            countQ = countQ.where(countSearchCols[0] ?? '', 'LIKE', `%${search}%`)
            for (let i = 1; i < countSearchCols.length; i++) {
              countQ = countQ.orWhere(countSearchCols[i] ?? '', 'LIKE', `%${search}%`)
            }
          }
        }
        // Apply filters to count query
        for (const [key, value] of url.searchParams.entries()) {
          const match = key.match(/^filter\[(.+)\]$/)
          if (match) {
            const filterName = match[1]
            const filter = config.filters.find(f => f.getName() === filterName)
            if (filter) countQ = filter.applyToQuery(countQ, value)
          }
        }
        total = await (countQ as QueryBuilderLike<RecordRow> & { count(): Promise<number> }).count()
      } catch { /* fallback */ }
      pagination = {
        total,
        currentPage: page,
        perPage,
        lastPage: Math.ceil(total / perPage),
        type: config.paginationType,
      }
    }

    // Apply Column.compute() + .display() transforms
    const isColumnInstances = config.columns?.length > 0 && typeof (config.columns[0] as { getComputeFn?: unknown })?.getComputeFn === 'function'
    if (isColumnInstances) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cols = config.columns as Array<{ getName(): string; getComputeFn?(): ((r: any) => unknown) | undefined; getDisplayFn?(): ((v: unknown, r?: any) => unknown) | undefined }>
      for (const record of records) {
        for (const col of cols) {
          const computeFn = col.getComputeFn?.()
          if (computeFn) (record as Record<string, unknown>)[col.getName()] = computeFn(record)
          const displayFn = col.getDisplayFn?.()
          if (displayFn) (record as Record<string, unknown>)[col.getName()] = displayFn((record as Record<string, unknown>)[col.getName()], record)
        }
      }
    }

    return res.json({ records, pagination })
  }, mw)

  // Table inline-edit save endpoint
  router.post(`${apiBase}/_tables/:tableId/save`, async (req, res) => {
    const tableId = (req.params as Record<string, string> | undefined)?.['tableId']
    if (!tableId) return res.status(400).json({ message: 'Missing tableId.' })

    const { recordId, field, value } = (req.body as { recordId?: string | number; field?: string; value?: unknown }) ?? {}
    if (recordId === undefined || !field) return res.status(400).json({ message: 'recordId and field are required.' })

    let table = TableRegistry.get(panel.getName(), tableId)
    if (!table) {
      try {
        await warmUpRegistries(panel, req)
      } catch (e) { debugWarn('registry.warmup', e) }
      table = TableRegistry.get(panel.getName(), tableId)
    }

    if (!table) return res.status(404).json({ message: `Table "${tableId}" not found.` })

    const config = table.getConfig()
    const ctx = buildContext(req)

    // Find the Column instance by name
    const isColumnInstances = config.columns?.length > 0 && typeof (config.columns[0] as { isEditable?: unknown })?.isEditable === 'function'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type ColumnLike = { getName(): string; isEditable(): boolean; getOnSaveFn?(): ((record: Record<string, unknown>, value: unknown, ctx: any) => Promise<void> | void) | undefined }
    const column = isColumnInstances
      ? (config.columns as unknown as ColumnLike[]).find(c => c.getName() === field)
      : undefined

    if (column && !column.isEditable()) {
      return res.status(403).json({ message: `Column "${field}" is not editable.` })
    }

    // Determine save handler: column-level → table-level → auto (model update)
    const columnSaveFn = column?.getOnSaveFn?.()
    const tableSaveFn = config.onSave ?? table.getOnSave?.()

    try {
      if (columnSaveFn) {
        await columnSaveFn({ id: recordId } as Record<string, unknown>, value, ctx)
      } else if (tableSaveFn) {
        await tableSaveFn({ id: recordId } as Record<string, unknown>, field, value, ctx)
      } else if (config.model) {
        // Auto: update model by ID
        const Model = config.model as ModelClass<RecordRow>
        await Model.query().update(recordId, { [field]: value })
      } else {
        return res.status(400).json({ message: 'No save handler configured.' })
      }
      // Broadcast live update if table has .live()
      if (table.isLive()) {
        try {
          const broadcastPkg = '@boostkit/broadcast'
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { broadcast } = await import(/* @vite-ignore */ broadcastPkg) as any
          broadcast(`live:table:${tableId}`, 'refresh', { field, recordId })
          // Also broadcast on resource channel (resource tables listen on panel:{slug})
          const resourceSlug = config.resourceClass?.getSlug?.() as string | undefined
          if (resourceSlug) {
            broadcast(`panel:${resourceSlug}`, 'record.updated', { id: recordId })
          } else {
            // Per-tab tables: derive slug from tableId (e.g. 'articles-all' → 'articles')
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

  // Table action endpoint — execute bulk/row actions on table records
  router.post(`${apiBase}/_tables/:tableId/action/:actionName`, async (req, res) => {
    const tableId = (req.params as Record<string, string> | undefined)?.['tableId']
    const actionName = (req.params as Record<string, string> | undefined)?.['actionName']
    if (!tableId || !actionName) return res.status(400).json({ message: 'Missing tableId or actionName.' })

    let table = TableRegistry.get(panel.getName(), tableId)
    if (!table) {
      // Warm up
      try {
        await warmUpRegistries(panel, req)
      } catch (e) { debugWarn('registry.warmup', e) }
    }

    table = TableRegistry.get(panel.getName(), tableId)
    if (!table) return res.status(404).json({ message: `Table "${tableId}" not found.` })

    const action = table.getActions().find(a => a.getName() === actionName)
    if (!action) return res.status(404).json({ message: `Action "${actionName}" not found.` })

    const { ids } = (req.body as { ids?: string[] }) ?? {}
    if (!Array.isArray(ids)) return res.status(400).json({ message: 'ids[] is required.' })

    // Fetch records by IDs if model is available
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

      // Broadcast live update if table has .live()
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
