import type { MiddlewareHandler, AppRequest } from '@boostkit/core'
import type { RouterLike } from './types.js'
import type { Panel } from '../Panel.js'
import type { ModelClass, QueryBuilderLike, RecordRow } from '../types.js'
import { flattenFields, buildContext } from './utils.js'
import { FormRegistry } from '../FormRegistry.js'
import { TableRegistry } from '../TableRegistry.js'
import { StatsRegistry } from '../StatsRegistry.js'
import { TabsRegistry } from '../TabsRegistry.js'
import { debugWarn } from '../debug.js'

// Lazy-load @boostkit/image (optional peer — not a dependency of panels)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function importImage(): Promise<{ image: (input: Buffer) => any }> {
  const pkg = '@boostkit/image'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return import(/* @vite-ignore */ pkg) as any
}

/**
 * Warm up all registries by resolving the panel schema AND all page schemas.
 * Tables/Stats/Tabs/Forms on custom Pages need this to be found by API endpoints.
 */
async function warmUpRegistries(panel: Panel, req: AppRequest): Promise<void> {
  const { resolveSchema } = await import('../resolveSchema.js') as { resolveSchema: typeof import('../resolveSchema.js').resolveSchema }
  const ctx = buildContext(req)

  // Resolve main panel schema
  if (panel.hasSchema()) {
    await resolveSchema(panel, ctx)
  }

  // Resolve all page schemas
  for (const PageClass of panel.getAllPages()) {
    if (!PageClass.hasSchema()) continue
    try {
      const elements = await PageClass.schema(ctx)
      const pagePanel = Object.create(panel, {
        getSchema: { value: () => elements },
      })
      await resolveSchema(pagePanel, ctx)
    } catch { /* page schema failed */ }
  }
}

export function mountMetaRoutes(
  router: RouterLike,
  panel: Panel,
  mw: MiddlewareHandler[],
): void {
  const apiBase = panel.getApiBase()

  // Meta endpoint — returns panel structure for UI consumers
  router.get(`${apiBase}/_meta`, (_req, res) => {
    return res.json(panel.toMeta())
  }, mw)

  // Badge values — resolves async navigationBadge functions for sidebar display
  router.get(`${apiBase}/_badges`, async (_req, res) => {
    const badges: Record<string, string | number | null> = {}
    for (const ResourceClass of panel.getResources()) {
      const badgeFn = ResourceClass.navigationBadge
      if (badgeFn) {
        try {
          const value = await badgeFn()
          badges[ResourceClass.getSlug()] = value ?? null
        } catch {
          badges[ResourceClass.getSlug()] = null
        }
      }
    }
    return res.json(badges)
  }, mw)

  // Global search endpoint — queries all resources with searchable fields
  router.get(`${apiBase}/_search`, async (req, res) => {
    const url   = new URL(req.url, 'http://localhost')
    const q     = url.searchParams.get('q')?.trim() ?? ''
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 5), 20)

    if (!q) return res.json({ results: [] })

    const results: Array<{
      resource: string
      label:    string
      records:  Array<{ id: string; title: string }>
    }> = []

    for (const ResourceClass of panel.getResources()) {
      const Model = ResourceClass.model as ModelClass<RecordRow> | undefined
      if (!Model) continue

      const resource       = new ResourceClass()
      const searchableCols = flattenFields(resource.fields())
        .filter(f => f.isSearchable())
        .map(f => f.getName())

      if (searchableCols.length === 0) continue

      let qb: QueryBuilderLike<RecordRow> = Model.query()
      qb = qb.where(searchableCols[0] ?? '', 'LIKE', `%${q}%`)
      for (let i = 1; i < searchableCols.length; i++) {
        qb = qb.orWhere(searchableCols[i] ?? '', 'LIKE', `%${q}%`)
      }

      const rows: RecordRow[] = await qb.limit(limit).all()
      if (rows.length === 0) continue

      const titleField: string = ResourceClass.titleField ?? 'id'
      results.push({
        resource: ResourceClass.getSlug(),
        label:    ResourceClass.label ?? ResourceClass.getSlug(),
        records:  rows.map((r) => ({
          id:    String(r['id']),
          title: String(r[titleField] ?? r['id']),
        })),
      })
    }

    return res.json({ results })
  }, mw)

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
      const { resolveDataSource: resolveDS } = await import('../datasource.js')
      const ctx = buildContext(req)
      const allRows = await resolveDS(config.rows, ctx)

      let filtered = allRows
      // Search for array rows
      if (search && config.searchable) {
        const cols = config.searchColumns ?? (config.columns as Array<{ getName?: () => string } | string>).map(c => typeof c === 'string' ? c : (c as { getName?: () => string }).getName?.() ?? '')
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

    // Server-side search
    if (search && config.searchable) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const searchCols = config.searchColumns ?? (config.columns as any[])
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
        // Apply search filter to count query
        if (search && config.searchable) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const countSearchCols = config.searchColumns ?? (config.columns as any[])
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

    return res.json({ records, pagination })
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
      return res.json({ success: true })
    } catch (err) {
      return res.status(422).json({ message: String(err) })
    }
  }, mw)

  // Form submit endpoint — used by Form.make().onSubmit()
  // Form field persist endpoint — save field value to session (persist='session' mode)
  router.post(`${apiBase}/_forms/:formId/persist`, async (req, res) => {
    const formId = (req.params as Record<string, string> | undefined)?.['formId']
    if (!formId) return res.status(400).json({ message: 'Missing formId.' })

    const { field, value } = (req.body as { field?: string; value?: unknown }) ?? {}
    if (!field) return res.status(400).json({ message: 'Missing field name.' })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = (req as any).session as { put(key: string, value: unknown): void } | undefined
    if (session) {
      session.put(`form:${formId}:${field}`, value)
    }

    return res.json({ success: true })
  }, mw)

  router.post(`${apiBase}/_forms/:formId/submit`, async (req, res) => {
    const formId = (req.params as Record<string, string> | undefined)?.['formId']
    if (!formId) return res.status(400).json({ message: 'Missing formId.' })

    // Look up registered entry (populated when the page containing the form is SSR'd)
    let entry = FormRegistry.getEntry(panel.getName(), formId)
    if (!entry) {
      // Entry not yet registered — try to warm up by evaluating the schema
      try {
        await warmUpRegistries(panel, req)
      } catch (e) { debugWarn('registry.warmup', e) }
      entry = FormRegistry.getEntry(panel.getName(), formId)
    }

    if (!entry) return res.status(404).json({ message: `Form "${formId}" not found.` })

    let data = (req.body as Record<string, unknown> | undefined) ?? {}
    const ctx = buildContext(req)

    try {
      // Before hook — transform data before submission
      if (entry.beforeSubmit) {
        data = await entry.beforeSubmit(data, ctx)
      }

      // Main handler
      const result = await entry.handler(data, ctx)
      const responseData = typeof result === 'object' && result !== null ? result : {}

      // After hook — run after successful submission
      if (entry.afterSubmit) {
        await entry.afterSubmit(responseData, ctx)
      }

      return res.json({ success: true, ...responseData })
    } catch (err: unknown) {
      return res.status(422).json({ message: String(err) })
    }
  }, mw)

  // Upload endpoint — used by FileField / ImageField
  router.post(`${apiBase}/_upload`, async (req, res) => {
    try {
      const { Storage } = await import(/* @vite-ignore */ '@boostkit/storage')
      // req.raw is the Hono Context (c); c.req.parseBody() parses multipart/form-data
      const body = await ((req.raw as Record<string, unknown>)['req'] as { parseBody(): Promise<Record<string, unknown>> }).parseBody()
      const file      = body['file'] as File
      const disk      = String(body['disk']      ?? 'local')
      const directory = String(body['directory'] ?? 'uploads')
      const optimize  = body['optimize'] === 'true' || body['optimize'] === true
      const rawConversions = body['conversions'] as string | undefined

      let buffer = Buffer.from(await file.arrayBuffer())
      const isImage = file.type.startsWith('image/') && !file.type.includes('svg')

      // Determine output extension
      let ext = (file.name.split('.').pop() ?? 'bin').toLowerCase()

      // Optimize image (strip metadata, convert to webp, good quality)
      if (isImage && optimize) {
        try {
          const { image } = await importImage()
          buffer = await image(buffer).optimize().format('webp').quality(85).toBuffer()
          ext = 'webp'
        } catch { /* @boostkit/image not installed — skip */ }
      }

      const baseName = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const filename = `${baseName}.${ext}`
      const path     = `${directory}/${filename}`

      await Storage.disk(disk).put(path, buffer)
      const url = Storage.disk(disk).url(path)

      // Generate conversions
      const conversions: Array<{ name: string; path: string; url: string }> = []
      if (isImage && rawConversions) {
        try {
          const specs = JSON.parse(rawConversions) as Array<{ name: string; width: number; height?: number; crop?: boolean; format?: string; quality?: number }>
          if (specs.length > 0) {
            const { image } = await importImage()
            for (const spec of specs) {
              const convFormat = spec.format ?? 'webp'
              const convFilename = `${baseName}-${spec.name}.${convFormat}`
              const convPath = `${directory}/${convFilename}`

              let proc = image(buffer).resize(spec.width, spec.height)
              if (spec.crop) proc = proc.fit('cover')
              proc = proc.format(convFormat as 'webp').stripMetadata()
              if (spec.quality) proc = proc.quality(spec.quality)

              const convBuffer = await proc.toBuffer()
              await Storage.disk(disk).put(convPath, convBuffer)

              conversions.push({
                name: spec.name,
                path: convPath,
                url:  Storage.disk(disk).url(convPath),
              })
            }
          }
        } catch { /* conversions failed — return original only */ }
      }

      return res.json({ url, path, conversions })
    } catch (err) {
      return res.status(500).json({ message: 'Upload failed.', error: String(err) })
    }
  }, mw)

  // Stats data endpoint — used by lazy/poll stats
  router.get(`${apiBase}/_stats/:statsId`, async (req, res) => {
    const statsId = (req.params as Record<string, string> | undefined)?.['statsId']
    if (!statsId) return res.status(400).json({ message: 'Missing statsId.' })

    let stats = StatsRegistry.get(panel.getName(), statsId)
    if (!stats) {
      // Warm up by evaluating schema
      try {
        await warmUpRegistries(panel, req)
      } catch (e) { debugWarn('registry.warmup', e) }
      stats = StatsRegistry.get(panel.getName(), statsId)
    }

    if (!stats) return res.status(404).json({ message: `Stats "${statsId}" not found.` })

    const dataFn = stats.getDataFn()
    if (!dataFn) {
      // Return static stats
      return res.json({ stats: stats.getStats().map(s => s.toMeta()) })
    }

    const ctx = buildContext(req)
    try {
      const resolved = await dataFn(ctx)
      return res.json({ stats: resolved })
    } catch (err) {
      return res.status(500).json({ message: String(err) })
    }
  }, mw)

  // Save active tab to server session (persist='session' mode)
  router.post(`${apiBase}/_tabs/:tabsId/active`, async (req, res) => {
    const tabsId = (req.params as Record<string, string> | undefined)?.['tabsId']
    if (!tabsId) return res.status(400).json({ message: 'Missing tabsId.' })

    const { tab } = (req.body as { tab?: string | number }) ?? {}
    if (tab === undefined) return res.status(400).json({ message: 'Missing tab value.' })

    // Use req.session directly (set by SessionMiddleware in the middleware chain)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = (req as any).session as { put(key: string, value: unknown): void } | undefined
    if (session) {
      session.put(`tabs:${tabsId}`, tab)
    }

    return res.json({ success: true })
  }, mw)

  // Tabs data endpoint — used by lazy/poll model-backed tabs
  router.get(`${apiBase}/_tabs/:tabsId`, async (req, res) => {
    const tabsId = (req.params as Record<string, string> | undefined)?.['tabsId']
    if (!tabsId) return res.status(400).json({ message: 'Missing tabsId.' })

    let tabs = TabsRegistry.get(panel.getName(), tabsId)
    if (!tabs) {
      try {
        await warmUpRegistries(panel, req)
      } catch (e) { debugWarn('registry.warmup', e) }
      tabs = TabsRegistry.get(panel.getName(), tabsId)
    }
    if (!tabs) return res.status(404).json({ message: `Tabs "${tabsId}" not found.` })

    if (!tabs.isModelBacked()) {
      const url = new URL(req.url, 'http://localhost')
      const tabSlug = url.searchParams.get('tab')

      if (tabSlug) {
        // Find the tab by slugified label
        const allTabs = tabs.getTabs()
        const tab = allTabs.find(t =>
          t.getLabel().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') === tabSlug
        )

        if (tab && !tab.hasFields()) {
          // Resolve this tab's schema elements on demand
          const { resolveSchema: resolve } = await import('../resolveSchema.js') as { resolveSchema: typeof import('../resolveSchema.js').resolveSchema }
          const items = tab.getItems()
          const tabPanel = Object.create(panel, {
            getSchema: { value: () => items },
          })
          const ctx = buildContext(req)
          const elements = await resolve(tabPanel, ctx)

          const tabMeta = tab.toMeta()
          const badge = await tab.resolveBadge()

          return res.json({
            tab: {
              label: tab.getLabel(),
              elements,
              ...(tabMeta.icon && { icon: tabMeta.icon }),
              ...(badge !== undefined && { badge }),
            },
          })
        }
      }

      // No specific tab requested — return all tab labels
      const allTabs = tabs.getTabs()
      const tabsMeta = await Promise.all(allTabs.map(async t => {
        const meta = t.toMeta()
        const badge = await t.resolveBadge()
        if (badge !== undefined) meta.badge = badge
        return meta
      }))
      return res.json({ tabs: tabsMeta })
    }

    const Model = tabs.getModel()
    if (!Model) return res.status(404).json({ message: 'No model configured.' })

    const url = new URL(req.url, 'http://localhost')
    const tabRecordId = url.searchParams.get('tab')

    // ?tab=<recordId> — resolve a specific tab's content on demand
    if (tabRecordId && tabs.getContentFn()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let record: Record<string, unknown> | null = null
      try { record = await (Model.query() as any).find(tabRecordId) } catch { /* not found */ }
      if (!record) return res.status(404).json({ message: `Record "${tabRecordId}" not found.` })

      const contentFn = tabs.getContentFn()!
      const items = contentFn(record)

      const { resolveSchema: resolve } = await import('../resolveSchema.js') as { resolveSchema: typeof import('../resolveSchema.js').resolveSchema }
      const tabPanel = Object.create(panel, {
        getSchema: { value: () => items },
      })
      const ctx = buildContext(req)
      const elements = await resolve(tabPanel, ctx)

      return res.json({
        tab: {
          id: String(record['id'] ?? ''),
          label: String(record[tabs.getTitleField()] ?? record['id'] ?? 'Untitled'),
          elements,
        },
      })
    }

    // No ?tab param — return all tab labels (no content, client fetches per-tab)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = Model.query()
    const scopeFn = tabs.getScope()
    if (scopeFn) q = scopeFn(q)

    let records: Record<string, unknown>[] = []
    try { records = await q.get() } catch { /* empty */ }

    const titleField = tabs.getTitleField()
    return res.json({
      tabs: records.map(r => ({
        label: String(r[titleField] ?? r['id'] ?? 'Untitled'),
        id: String(r['id'] ?? ''),
      })),
    })
  }, mw)

  // Tabs create endpoint — create new record/tab
  router.post(`${apiBase}/_tabs/:tabsId/create`, async (req, res) => {
    const tabsId = (req.params as Record<string, string> | undefined)?.['tabsId']
    if (!tabsId) return res.status(400).json({ message: 'Missing tabsId.' })

    let tabs = TabsRegistry.get(panel.getName(), tabsId)
    if (!tabs) {
      try {
        await warmUpRegistries(panel, req)
      } catch (e) { debugWarn('registry.warmup', e) }
      tabs = TabsRegistry.get(panel.getName(), tabsId)
    }
    if (!tabs) return res.status(404).json({ message: `Tabs "${tabsId}" not found.` })
    if (!tabs.isCreatable()) return res.status(403).json({ message: 'Tab creation not allowed.' })

    const ctx = buildContext(req)
    const canCreateFn = tabs.getCanCreateFn()
    if (canCreateFn && !canCreateFn(ctx)) {
      return res.status(403).json({ message: 'Not authorized to create tabs.' })
    }

    const data = (req.body as Record<string, unknown> | undefined) ?? {}
    const onCreateFn = tabs.getOnCreateFn()

    try {
      if (onCreateFn) {
        await onCreateFn(data, ctx)
      } else if (tabs.isModelBacked()) {
        // Default: create a new model record
        const Model = tabs.getModel()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (Model) await (Model.query() as any).create(data)
      }
      return res.json({ success: true })
    } catch (err) {
      return res.status(422).json({ message: String(err) })
    }
  }, mw)
}
