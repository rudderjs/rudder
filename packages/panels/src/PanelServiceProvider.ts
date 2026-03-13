import { ServiceProvider } from '@boostkit/core'
import type { MiddlewareHandler, AppRequest, AppResponse } from '@boostkit/core'
import { PanelRegistry } from './PanelRegistry.js'
import type { Panel } from './Panel.js'
import type { Field } from './Field.js'
import type { Resource, FieldOrGrouping } from './Resource.js'
import type { Action } from './Action.js'
import type { PanelContext } from './types.js'
import { ComputedField } from './fields/ComputedField.js'

// ─── Helpers ───────────────────────────────────────────────

/** Derive the Prisma relation name from a RelationField. */
function relationName(field: Field): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const explicit = (field as any)._extra?.['relationName'] as string | undefined
  if (explicit) return explicit
  const name = field.getName()
  return name.endsWith('Id') ? name.slice(0, -2) : name
}

/** Flatten Section / Tabs groupings to a plain Field array. */
function flattenFields(items: FieldOrGrouping[]): Field[] {
  const result: Field[] = []
  for (const item of items) {
    if ('getFields' in item) {
      result.push(...flattenFields(item.getFields()))
    } else {
      result.push(item as Field)
    }
  }
  return result
}

// ─── Panel Service Provider ────────────────────────────────

export class PanelServiceProvider extends ServiceProvider {
  register(): void {}

  async boot(): Promise<void> {
    this.publishes({
      from: new URL('../pages', import.meta.url).pathname,
      to:   'pages/(panels)',
      tag:  'panels-pages',
    })

    const { router } = await import('@boostkit/router') as {
      router: {
        get(path: string, handler: (req: AppRequest, res: AppResponse) => unknown, mw?: MiddlewareHandler[]): void
        post(path: string, handler: (req: AppRequest, res: AppResponse) => unknown, mw?: MiddlewareHandler[]): void
        put(path: string, handler: (req: AppRequest, res: AppResponse) => unknown, mw?: MiddlewareHandler[]): void
        delete(path: string, handler: (req: AppRequest, res: AppResponse) => unknown, mw?: MiddlewareHandler[]): void
      }
    }

    for (const panel of PanelRegistry.all()) {
      const mw = this.buildPanelMiddleware(panel)

      // Meta endpoint — returns panel structure for UI consumers
      router.get(`${panel.getApiBase()}/_meta`, (_req, res) => {
        return res.json(panel.toMeta())
      }, mw)

      // Global search endpoint — queries all resources with searchable fields
      router.get(`${panel.getApiBase()}/_search`, async (req, res) => {
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const Model = ResourceClass.model as any
          if (!Model) continue

          const resource       = new ResourceClass()
          const searchableCols = flattenFields(resource.fields())
            .filter(f => f.isSearchable())
            .map(f => f.getName())

          if (searchableCols.length === 0) continue

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let qb: any = Model.query()
          qb = qb.where(searchableCols[0]!, 'LIKE', `%${q}%`)
          for (let i = 1; i < searchableCols.length; i++) {
            qb = qb.orWhere(searchableCols[i]!, 'LIKE', `%${q}%`)
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const rows: any[] = await qb.limit(limit).all()
          if (rows.length === 0) continue

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const titleField: string = (ResourceClass as any).titleField ?? 'id'
          results.push({
            resource: ResourceClass.getSlug(),
            label:    ResourceClass.label ?? ResourceClass.getSlug(),
            records:  rows.map((r: any) => ({
              id:    String(r.id),
              title: String(r[titleField] ?? r.id),
            })),
          })
        }

        return res.json({ results })
      }, mw)

      // Upload endpoint — used by FileField / ImageField
      router.post(`${panel.getApiBase()}/_upload`, async (req, res) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { Storage } = await import('@boostkit/storage') as any
          // req.raw is the Hono Context (c); c.req.parseBody() parses multipart/form-data
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const body      = await (req.raw as any).req.parseBody() as Record<string, unknown>
          const file      = body['file'] as File
          const disk      = String(body['disk']      ?? 'local')
          const directory = String(body['directory'] ?? 'uploads')

          const ext      = (file.name.split('.').pop() ?? 'bin').toLowerCase()
          const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
          const path     = `${directory}/${filename}`

          await Storage.disk(disk).put(path, Buffer.from(await file.arrayBuffer()))
          const url = await Storage.disk(disk).url(path)
          return res.json({ url, path })
        } catch (err) {
          return res.status(500).json({ message: 'Upload failed.', error: String(err) })
        }
      }, mw)

      // Mount CRUD routes for each resource
      for (const ResourceClass of panel.getResources()) {
        this.mountResource(router, panel, ResourceClass, mw)
      }
    }
  }

  // ── Guard middleware ───────────────────────────────────

  private buildPanelMiddleware(panel: Panel): MiddlewareHandler[] {
    const guard = panel.getGuard()
    if (!guard) return []

    const mw: MiddlewareHandler = async (req, res, next) => {
      // Resolve the authenticated user from the session (via better-auth),
      // falling back to req.user if AuthMiddleware has already set it.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let user: Record<string, unknown> | undefined = (req as any).user
      if (!user) {
        try {
          const { app } = await import('@boostkit/core') as any
          const auth    = app().make('auth')
          const session = await auth.api.getSession({
            headers: new Headers(req.headers as Record<string, string>),
          })
          user = session?.user ?? undefined
        } catch {
          // auth not configured
        }
      }

      const ctx: PanelContext = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        user:    user as any,
        headers: req.headers as Record<string, string>,
        path:    req.path,
      }
      const allowed = await guard(ctx)
      if (!allowed) {
        return res.status(401).json({ message: 'Unauthorized.' })
      }
      await next()
    }

    return [mw]
  }

  // ── Resource CRUD routes ───────────────────────────────

  private mountResource(
    router: {
      get(path: string, handler: (req: AppRequest, res: AppResponse) => unknown, mw?: MiddlewareHandler[]): void
      post(path: string, handler: (req: AppRequest, res: AppResponse) => unknown, mw?: MiddlewareHandler[]): void
      put(path: string, handler: (req: AppRequest, res: AppResponse) => unknown, mw?: MiddlewareHandler[]): void
      delete(path: string, handler: (req: AppRequest, res: AppResponse) => unknown, mw?: MiddlewareHandler[]): void
    },
    panel: Panel,
    ResourceClass: typeof Resource,
    mw: MiddlewareHandler[],
  ): void {
    const slug    = ResourceClass.getSlug()
    const base    = `${panel.getApiBase()}/${slug}`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Model   = ResourceClass.model as any

    // ── GET /panel/api/resource — list (paginated) ────────
    router.get(base, async (req, res) => {
      const resource = new ResourceClass()
      const ctx      = this.buildContext(req)
      if (!await resource.policy('viewAny', ctx)) return res.status(403).json({ message: 'Forbidden.' })
      if (!Model) return res.status(500).json({ message: `Resource "${slug}" has no model defined.` })

      const page    = Number((req.query as Record<string, string>)['page']    ?? 1)
      const perPage = Math.min(Number((req.query as Record<string, string>)['perPage'] ?? ResourceClass.perPage), 100)

      const url    = new URL(req.url, 'http://localhost')
      const sort   = url.searchParams.get('sort') ?? undefined
      const dir    = (url.searchParams.get('dir') ?? 'ASC').toUpperCase() as 'ASC' | 'DESC'
      const search = url.searchParams.get('search') ?? undefined

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = Model.query()

      // Include belongsTo relations so the table can show display names
      for (const f of flattenFields(resource.fields()).filter(f => f.getType() === 'belongsTo')) {
        q = q.with(relationName(f))
      }

      // Sort — only on fields marked sortable()
      if (sort) {
        const sortableFields = flattenFields(resource.fields()).filter(f => f.isSortable()).map(f => f.getName())
        if (sortableFields.includes(sort)) {
          q = q.orderBy(sort, dir)
        }
      }

      // Search — LIKE across all searchable fields (OR)
      if (search) {
        const searchableCols = flattenFields(resource.fields()).filter(f => f.isSearchable()).map(f => f.getName())
        if (searchableCols.length > 0) {
          q = q.where(searchableCols[0]!, 'LIKE', `%${search}%`)
          for (let i = 1; i < searchableCols.length; i++) {
            q = q.orWhere(searchableCols[i]!, `%${search}%`)
          }
        }
      }

      // Filters — ?filter[field]=value
      for (const filter of resource.filters()) {
        const value = url.searchParams.get(`filter[${filter.getName()}]`)
        if (value !== null && value !== '') {
          q = filter.applyToQuery(q, value)
        }
      }

      const result = await q.paginate(page, perPage)

      // Strip unreadable fields from each record
      const allFields = flattenFields(resource.fields())
      const readableNames = new Set(
        allFields.filter(f => f.canRead(ctx)).map(f => f.getName())
      )
      readableNames.add('id')
      result.data = (result.data as Record<string, unknown>[]).map((r) =>
        Object.fromEntries(Object.entries(r).filter(([k]) => readableNames.has(k)))
      )

      result.data = this.applyTransforms(resource, result.data as unknown[]) as typeof result.data

      return res.json({
        data: result.data,
        meta: {
          total:       result.total,
          currentPage: result.currentPage,
          perPage:     result.perPage,
          lastPage:    result.lastPage,
        },
      })
    }, mw)

    // ── GET /panel/api/resource/_related — hasMany reverse relation records ──
    router.get(`${base}/_related`, async (req, res) => {
      if (!Model) return res.status(500).json({ message: `Resource "${slug}" has no model defined.` })

      const url     = new URL(req.url, 'http://localhost')
      const fk      = url.searchParams.get('fk')
      const id      = url.searchParams.get('id')
      const through = url.searchParams.get('through') === 'true'
      const page    = Number(url.searchParams.get('page') ?? 1)

      if (!fk || !id) return res.status(422).json({ message: 'fk and id query params are required.' })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = through
        // M2M: WHERE relation.some.id = parentId (Prisma nested filter)
        ? Model.query().where(fk, { some: { id } })
        // FK:  WHERE foreignKey = parentId
        : Model.query().where(fk, id)

      // Include belongsTo and belongsToMany relations so display values are available
      for (const f of flattenFields(new ResourceClass().fields())) {
        if (f.getType() === 'belongsTo')    q = q.with(relationName(f))
        if (f.getType() === 'belongsToMany') q = q.with(f.getName())
      }

      const result = await q.paginate(page, 15)
      return res.json({
        data: result.data,
        meta: {
          total:       result.total,
          currentPage: result.currentPage,
          perPage:     result.perPage,
          lastPage:    result.lastPage,
        },
      })
    }, mw)

    // ── GET /panel/api/resource/_schema — field definitions for inline create ──
    router.get(`${base}/_schema`, async (_req, res) => {
      const resource     = new ResourceClass()
      const resourceMeta = resource.toMeta()
      return res.json({ resourceMeta })
    }, mw)

    // ── GET /panel/api/resource/_options — relation select options ──
    router.get(`${base}/_options`, async (req, res) => {
      if (!Model) return res.status(500).json({ message: `Resource "${slug}" has no model defined.` })

      const url   = new URL(req.url, 'http://localhost')
      const label = url.searchParams.get('label') ?? 'name'

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const records: any[] = await Model.query().all()
      const options = records.map((r: any) => ({
        value: String(r.id),
        label: String(r[label] ?? r.id),
      }))
      return res.json(options)
    }, mw)

    // ── GET /panel/api/resource/:id — show ────────────────
    router.get(`${base}/:id`, async (req, res) => {
      const resource = new ResourceClass()
      const ctx      = this.buildContext(req)
      if (!await resource.policy('view', ctx)) return res.status(403).json({ message: 'Forbidden.' })
      if (!Model) return res.status(500).json({ message: `Resource "${slug}" has no model defined.` })

      const id = (req.params as Record<string, string>)['id']

      // Include belongsToMany relations so the edit form can populate multi-selects
      const manyRelations = flattenFields(new ResourceClass().fields())
        .filter(f => f.getType() === 'belongsToMany')
        .map(f => f.getName())

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = Model.query()
      for (const rel of manyRelations) q = q.with(rel)
      const record = await q.find(id)

      if (!record) return res.status(404).json({ message: 'Record not found.' })

      // Strip unreadable fields
      const allFieldsForShow = flattenFields(resource.fields())
      const readableNamesForShow = new Set(
        allFieldsForShow.filter(f => f.canRead(ctx)).map(f => f.getName())
      )
      readableNamesForShow.add('id')
      const filteredRecord = Object.fromEntries(
        Object.entries(record as Record<string, unknown>).filter(([k]) => readableNamesForShow.has(k))
      )
      const [transformedRecord] = this.applyTransforms(resource, [filteredRecord])
      return res.json({ data: transformedRecord })
    }, mw)

    // ── POST /panel/api/resource — create ─────────────────
    router.post(base, async (req, res) => {
      const resource = new ResourceClass()
      const ctx      = this.buildContext(req)
      if (!await resource.policy('create', ctx)) return res.status(403).json({ message: 'Forbidden.' })
      if (!Model) return res.status(500).json({ message: `Resource "${slug}" has no model defined.` })

      const raw    = req.body as Record<string, unknown>
      const body   = this.coercePayload(resource, raw, 'create')
      const errors = await this.validatePayload(resource, body, 'create')
      if (errors) return res.status(422).json({ message: 'Validation failed.', errors })

      const record = await Model.create(body)
      if ((ResourceClass as any).live) this.liveBroadcast(slug, 'record.created', { id: (record as any).id })
      return res.status(201).json({ data: record })
    }, mw)

    // ── PUT /panel/api/resource/:id — update ──────────────
    router.put(`${base}/:id`, async (req, res) => {
      const resource = new ResourceClass()
      const ctx      = this.buildContext(req)
      if (!await resource.policy('update', ctx)) return res.status(403).json({ message: 'Forbidden.' })
      if (!Model) return res.status(500).json({ message: `Resource "${slug}" has no model defined.` })

      const id     = (req.params as Record<string, string>)['id']
      const exists = await Model.find(id)
      if (!exists) return res.status(404).json({ message: 'Record not found.' })

      const raw    = req.body as Record<string, unknown>
      const body   = this.coercePayload(resource, raw, 'update')
      // Inject id so per-field validators can exclude the current record (e.g. unique slug)
      const errors = await this.validatePayload(resource, { ...body, id }, 'update')
      if (errors) return res.status(422).json({ message: 'Validation failed.', errors })

      const record = await Model.query().update(id, body)
      if ((ResourceClass as any).live) this.liveBroadcast(slug, 'record.updated', { id })
      return res.json({ data: record })
    }, mw)

    // ── DELETE /panel/api/resource/:id — delete ───────────
    router.delete(`${base}/:id`, async (req, res) => {
      const resource = new ResourceClass()
      const ctx      = this.buildContext(req)
      if (!await resource.policy('delete', ctx)) return res.status(403).json({ message: 'Forbidden.' })
      if (!Model) return res.status(500).json({ message: `Resource "${slug}" has no model defined.` })

      const id     = (req.params as Record<string, string>)['id']
      const exists = await Model.find(id)
      if (!exists) return res.status(404).json({ message: 'Record not found.' })

      await Model.query().delete(id)
      if ((ResourceClass as any).live) this.liveBroadcast(slug, 'record.deleted', { id })
      return res.json({ message: 'Deleted successfully.' })
    }, mw)

    // ── DELETE /panel/api/resource — bulk delete ──────────
    router.delete(base, async (req, res) => {
      const resource = new ResourceClass()
      const ctx      = this.buildContext(req)
      if (!await resource.policy('delete', ctx)) return res.status(403).json({ message: 'Forbidden.' })
      if (!Model) return res.status(500).json({ message: `Resource "${slug}" has no model defined.` })

      const { ids } = req.body as { ids?: string[] }
      if (!ids?.length) return res.status(422).json({ message: 'No records selected.' })

      let deleted = 0
      for (const id of ids) {
        const exists = await Model.find(id)
        if (exists) {
          await Model.query().delete(id)
          deleted++
        }
      }

      if ((ResourceClass as any).live) this.liveBroadcast(slug, 'records.deleted', { ids, deleted })
      return res.json({ message: `${deleted} records deleted.`, deleted })
    }, mw)

    // ── POST /panel/api/resource/_action/:action — bulk action
    router.post(`${base}/_action/:action`, async (req, res) => {
      const resource = new ResourceClass()
      const ctx      = this.buildContext(req)
      if (!await resource.policy('update', ctx)) return res.status(403).json({ message: 'Forbidden.' })

      const actionName = (req.params as Record<string, string>)['action']
      const action     = resource.actions().find((a: Action) => a.getName() === actionName)
      if (!action) return res.status(404).json({ message: `Action "${actionName}" not found.` })

      const { ids } = req.body as { ids?: string[] }
      if (!ids?.length) return res.status(422).json({ message: 'No records selected.' })

      // Fetch the records and execute the action
      const records: unknown[] = []
      if (Model) {
        for (const id of ids) {
          const record = await Model.find(id)
          if (record) records.push(record)
        }
      }

      await action.execute(records)
      if ((ResourceClass as any).live) this.liveBroadcast(slug, 'action.executed', { action: actionName, ids })
      return res.json({ message: 'Action executed successfully.' })
    }, mw)

    // ── Version routes (only for versioned resources) ───
    if ((ResourceClass as any).versioned) {
      this.mountVersionRoutes(router, panel, ResourceClass, mw)
    }
  }

  // ── Version history routes ──────────────────────────

  private mountVersionRoutes(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    router: any,
    panel: Panel,
    ResourceClass: typeof Resource,
    mw: MiddlewareHandler[],
  ): void {
    const slug = ResourceClass.getSlug()
    const base = `${panel.getApiBase()}/${slug}`

    // GET /{panel}/api/{resource}/{id}/_versions — list
    router.get(`${base}/:id/_versions`, async (req: AppRequest, res: AppResponse) => {
      const id = (req.params as Record<string, string>)['id']
      const docName = `panel:${slug}:${id}`
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prisma = this.app.make<any>('prisma')
        const versions = await prisma.panelVersion.findMany({
          where: { docName },
          orderBy: { createdAt: 'desc' },
          select: { id: true, label: true, userId: true, createdAt: true },
        })
        return res.json({ data: versions })
      } catch {
        return res.json({ data: [] })
      }
    }, mw)

    // POST /{panel}/api/{resource}/{id}/_versions — create (snapshot + publish)
    router.post(`${base}/:id/_versions`, async (req: AppRequest, res: AppResponse) => {
      const resource = new ResourceClass()
      const ctx = this.buildContext(req)
      if (!await resource.policy('update', ctx)) return res.status(403).json({ message: 'Forbidden.' })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Model = ResourceClass.model as any
      if (!Model) return res.status(500).json({ message: 'No model.' })

      const id      = (req.params as Record<string, string>)['id']
      const docName = `panel:${slug}:${id}`
      const body    = req.body as { label?: string }

      try {
        const { Live } = await import('@boostkit/live')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prisma = this.app.make<any>('prisma')

        const snapshot    = Live.snapshot(docName)
        const fieldValues = Live.readMap(docName, 'fields')

        await prisma.panelVersion.create({
          data: {
            docName,
            snapshot: Buffer.from(snapshot),
            label:    body.label ?? null,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            userId:   (ctx.user as any)?.id ?? null,
          },
        })

        const coerced = this.coercePayload(resource, fieldValues, 'update')
        await Model.query().update(id, coerced)

        if ((ResourceClass as any).live) this.liveBroadcast(slug, 'record.updated', { id })

        return res.json({ message: 'Version saved and published.' })
      } catch (err) {
        return res.status(500).json({ message: 'Failed to save version.', error: String(err) })
      }
    }, mw)

    // GET /{panel}/api/{resource}/{id}/_versions/{versionId} — detail
    router.get(`${base}/:id/_versions/:versionId`, async (req: AppRequest, res: AppResponse) => {
      const versionId = (req.params as Record<string, string>)['versionId']
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prisma = this.app.make<any>('prisma')
        const version = await prisma.panelVersion.findUnique({ where: { id: versionId } })
        if (!version) return res.status(404).json({ message: 'Version not found.' })

        const Y   = await import('yjs')
        const doc = new Y.Doc()
        Y.applyUpdate(doc, new Uint8Array(version.snapshot))
        const fields = doc.getMap('fields')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data: Record<string, unknown> = {}
        fields.forEach((val: unknown, key: string) => { data[key] = val })
        doc.destroy()

        return res.json({
          data: {
            id:        version.id,
            label:     version.label,
            userId:    version.userId,
            createdAt: version.createdAt,
            fields:    data,
          },
        })
      } catch (err) {
        return res.status(500).json({ message: 'Failed to read version.', error: String(err) })
      }
    }, mw)
  }

  // ── Live broadcast helper ─────────────────────────────

  private liveBroadcast(slug: string, event: string, data: unknown): void {
    void import('@boostkit/broadcast').then(({ broadcast }) => {
      broadcast(`panel:${slug}`, event, data)
    }).catch(() => { /* @boostkit/broadcast not registered */ })
  }

  // ── Helpers ────────────────────────────────────────────

  private applyTransforms(resource: Resource, records: unknown[]): unknown[] {
    const fields = flattenFields(resource.fields())
    const displayFields  = fields.filter(f => f.hasDisplay())
    // Duck-type instead of instanceof — Vite SSR may load separate class instances
    const computedFields = fields.filter((f): f is ComputedField => f.getType() === 'computed' && 'apply' in f)

    if (!displayFields.length && !computedFields.length) return records

    return records.map((r) => {
      const rec = { ...(r as Record<string, unknown>) }
      // Apply computed fields first (they produce the value)
      for (const f of computedFields) {
        rec[f.getName()] = f.apply(rec)
      }
      // Then apply display transforms (which may further format computed or DB values)
      for (const f of displayFields) {
        rec[f.getName()] = f.applyDisplay(rec[f.getName()], rec)
      }
      return rec
    })
  }

  private buildContext(req: AppRequest): PanelContext {
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      user:    (req as any).user,
      headers: req.headers as Record<string, string>,
      path:    req.path,
    }
  }

  /**
   * Coerce raw form values to the correct JS types before hitting the ORM.
   * - boolean / toggle  → true | false
   * - number            → number | null
   * - date / datetime   → Date | null  (empty string → null)
   * Empty strings for optional fields are left as-is (ORM handles them).
   */
  private coercePayload(
    resource: Resource,
    body: Record<string, unknown>,
    mode: 'create' | 'update' = 'update',
  ): Record<string, unknown> {
    const result = { ...body }
    for (const field of flattenFields(resource.fields())) {
      const name = field.getName()
      if (!(name in result)) continue
      const val  = result[name]
      const type = field.getType()
      if (type === 'boolean' || type === 'toggle') {
        result[name] = val === true || val === 'true' || val === '1' || val === 1
      } else if (type === 'number') {
        result[name] = (val === '' || val === null || val === undefined) ? null : Number(val)
      } else if (type === 'date' || type === 'datetime') {
        if (val === '' || val === null || val === undefined) {
          result[name] = null
        } else {
          const d = new Date(String(val))
          result[name] = isNaN(d.getTime()) ? null : d
        }
      } else if (type === 'tags') {
        // UI submits an array; store as JSON string
        result[name] = Array.isArray(val) ? JSON.stringify(val) : (val ?? '[]')
      } else if (type === 'content') {
        // Prisma Json? field: pass object as-is, parse JSON strings, empty → null
        if (val === '' || val === null || val === undefined) {
          result[name] = null
        } else if (typeof val === 'string') {
          try { result[name] = JSON.parse(val) } catch { result[name] = null }
        }
        // else: already an object — pass through
      } else if (type === 'belongsTo') {
        result[name] = (val === '' || val === null || val === undefined) ? null : String(val)
      } else if (type === 'belongsToMany') {
        // Prisma implicit M2M: connect on create, set (replace) on update
        const ids     = Array.isArray(val) ? (val as string[]) : []
        const records = ids.map((id) => ({ id: String(id) }))
        result[name]  = mode === 'create' ? { connect: records } : { set: records }
      }
    }
    return result
  }

  private async validatePayload(
    resource: Resource,
    body: Record<string, unknown>,
    mode: 'create' | 'update',
  ): Promise<Record<string, string[]> | null> {
    const fields = flattenFields(resource.fields())
    const errors: Record<string, string[]> = {}

    for (const field of fields) {
      if (field.isReadonly()) continue
      if (field.getType() === 'belongsTo' || field.getType() === 'belongsToMany') continue
      if (mode === 'create' && field.isHiddenFrom('create')) continue
      if (mode === 'update' && field.isHiddenFrom('edit')) continue

      const name  = field.getName()
      const value = body[name]

      if (field.isRequired() && (value === undefined || value === null || value === '')) {
        errors[name] = [`${field.getLabel()} is required.`]
      }
    }

    // Per-field custom validators (inspired by PayloadCMS)
    for (const field of flattenFields(resource.fields())) {
      if (!field.hasValidate()) continue
      if (field.isReadonly()) continue
      const name = field.getName()
      const value = body[name]
      const result = await field.runValidate(value, body)
      if (result !== true) {
        if (errors[name]) {
          errors[name] = [...errors[name]!, result]
        } else {
          errors[name] = [result]
        }
      }
    }

    return Object.keys(errors).length > 0 ? errors : null
  }
}

// ─── Factory ───────────────────────────────────────────────

import type { Panel as PanelType } from './Panel.js'
import type { Application } from '@boostkit/core'

/**
 * Register one or more panels and mount their API routes.
 *
 * @example
 * import { panels } from '@boostkit/panels'
 * import { adminPanel, customerPanel } from './panels.js'
 *
 * export default [
 *   panels([adminPanel, customerPanel]),
 *   ...
 * ]
 */
export function panels(panelList: PanelType[]): new (app: Application) => PanelServiceProvider {
  return class extends PanelServiceProvider {
    register(): void {
      PanelRegistry.reset()
      for (const panel of panelList) {
        PanelRegistry.register(panel)
      }
    }
  }
}
