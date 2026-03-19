import type { MiddlewareHandler } from '@boostkit/core'
import type { RouterLike } from './types.js'
import type { Panel } from '../Panel.js'
import type { ModelClass, QueryBuilderLike, RecordRow } from '../types.js'
import { flattenFields, buildContext } from './utils.js'
import { FormRegistry } from '../FormRegistry.js'
import { TableRegistry } from '../TableRegistry.js'
import { StatsRegistry } from '../StatsRegistry.js'
import { TabsRegistry } from '../TabsRegistry.js'

// Lazy-load @boostkit/image (optional peer — not a dependency of panels)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function importImage(): Promise<{ image: (input: Buffer) => any }> {
  const pkg = '@boostkit/image'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return import(/* @vite-ignore */ pkg) as any
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

  // Table data endpoint — used by lazy, poll, paginated tables
  router.get(`${apiBase}/_tables/:tableId`, async (req, res) => {
    const tableId = (req.params as Record<string, string> | undefined)?.['tableId']
    if (!tableId) return res.status(400).json({ message: 'Missing tableId.' })

    let table = TableRegistry.get(panel.getName(), tableId)
    if (!table) {
      // Table not yet registered — warm up by evaluating schema
      try {
        const { resolveSchema } = await import('../resolveSchema.js') as { resolveSchema: typeof import('../resolveSchema.js').resolveSchema }
        const ctx = buildContext(req)
        await resolveSchema(panel, ctx)
      } catch { /* best-effort */ }
      table = TableRegistry.get(panel.getName(), tableId)
    }

    if (!table) return res.status(404).json({ message: `Table "${tableId}" not found.` })

    const config = table.getConfig()
    const url = new URL(req.url, 'http://localhost')
    const page = parseInt(url.searchParams.get('page') as string) || 1
    const search = url.searchParams.get('search')?.trim() ?? ''

    // --- Static rows ---
    if (config.rows) {
      let filtered = config.rows
      // Client-side search for static rows
      if (search && config.searchable) {
        const cols = config.searchColumns ?? (config.columns as Array<{ getName?: () => string } | string>).map(c => typeof c === 'string' ? c : (c as { getName?: () => string }).getName?.() ?? '')
        filtered = config.rows.filter(row =>
          cols.some(col => String(row[col as string] ?? '').toLowerCase().includes(search.toLowerCase()))
        )
      }

      // Apply filters for static rows
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

    if (config.sortBy) q = q.orderBy(config.sortBy, config.sortDir)

    const perPage = config.paginationType ? config.perPage : config.limit
    const offset = (page - 1) * perPage
    q = q.limit(perPage).offset(offset)

    let records: RecordRow[] = []
    try { records = await q.get() } catch { /* empty */ }

    let pagination
    if (config.paginationType) {
      let total = records.length
      try {
        const countQ = config.scope ? config.scope(Model.query()) : Model.query()
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
        const { resolveSchema } = await import('../resolveSchema.js') as { resolveSchema: typeof import('../resolveSchema.js').resolveSchema }
        const ctx = buildContext(req)
        await resolveSchema(panel, ctx)
      } catch { /* best-effort */ }
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
  router.post(`${apiBase}/_forms/:formId/submit`, async (req, res) => {
    const formId = (req.params as Record<string, string> | undefined)?.['formId']
    if (!formId) return res.status(400).json({ message: 'Missing formId.' })

    // Look up registered entry (populated when the page containing the form is SSR'd)
    let entry = FormRegistry.getEntry(panel.getName(), formId)
    if (!entry) {
      // Entry not yet registered — try to warm up by evaluating the schema
      try {
        const { resolveSchema } = await import('../resolveSchema.js') as { resolveSchema: typeof import('../resolveSchema.js').resolveSchema }
        const ctx = buildContext(req)
        await resolveSchema(panel, ctx)
      } catch { /* best-effort */ }
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
        const { resolveSchema } = await import('../resolveSchema.js') as { resolveSchema: typeof import('../resolveSchema.js').resolveSchema }
        const ctx = buildContext(req)
        await resolveSchema(panel, ctx)
      } catch { /* best-effort */ }
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

  // Tabs data endpoint — used by lazy/poll model-backed tabs
  router.get(`${apiBase}/_tabs/:tabsId`, async (req, res) => {
    const tabsId = (req.params as Record<string, string> | undefined)?.['tabsId']
    if (!tabsId) return res.status(400).json({ message: 'Missing tabsId.' })

    let tabs = TabsRegistry.get(panel.getName(), tabsId)
    if (!tabs) {
      try {
        const { resolveSchema } = await import('../resolveSchema.js') as { resolveSchema: typeof import('../resolveSchema.js').resolveSchema }
        const ctx = buildContext(req)
        await resolveSchema(panel, ctx)
      } catch { /* best-effort */ }
      tabs = TabsRegistry.get(panel.getName(), tabsId)
    }
    if (!tabs) return res.status(404).json({ message: `Tabs "${tabsId}" not found.` })

    if (!tabs.isModelBacked()) {
      return res.json({ tabs: tabs.getTabs().map(t => t.toMeta()) })
    }

    const Model = tabs.getModel()
    if (!Model) return res.status(404).json({ message: 'No model configured.' })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = Model.query()
    const scopeFn = tabs.getScope()
    if (scopeFn) q = scopeFn(q)

    let records: Record<string, unknown>[] = []
    try { records = await q.get() } catch { /* empty */ }

    const titleField = tabs.getTitleField()
    // Return records so the client can build tabs (content is resolved separately per-tab)
    return res.json({
      tabs: records.map(r => ({
        label: String(r[titleField] ?? r['id'] ?? 'Untitled'),
        id: String(r['id'] ?? ''),
        record: r,
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
        const { resolveSchema } = await import('../resolveSchema.js') as { resolveSchema: typeof import('../resolveSchema.js').resolveSchema }
        const ctx = buildContext(req)
        await resolveSchema(panel, ctx)
      } catch { /* best-effort */ }
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
