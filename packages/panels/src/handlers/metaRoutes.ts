import type { MiddlewareHandler } from '@boostkit/core'
import type { RouterLike } from './types.js'
import type { Panel } from '../Panel.js'
import { flattenFields, buildContext } from './utils.js'
import { FormRegistry } from '../FormRegistry.js'

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (R) => (R as any).model?.name === modelName || R.getSlug() === modelName,
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Model = (ResourceClass as any)?.model as any

    if (!Model) {
      return res.status(404).json({ message: `Model "${modelName}" not found on this panel.` })
    }

    try {
      await Promise.all(
        ids.map((id, index) =>
          Model.query().where('id', id).update({ [field]: index }),
        ),
      )
      return res.json({ success: true })
    } catch (err) {
      return res.status(500).json({ message: String(err) })
    }
  }, mw)

  // Form submit endpoint — used by Form.make().onSubmit()
  router.post(`${apiBase}/_forms/:formId/submit`, async (req, res) => {
    const formId = (req.params as Record<string, string> | undefined)?.['formId']
    if (!formId) return res.status(400).json({ message: 'Missing formId.' })

    // Look up registered handler (populated when the page containing the form is SSR'd)
    const handler = FormRegistry.get(panel.getName(), formId)
    if (!handler) {
      // Handler not yet registered — try to warm up by evaluating the schema
      try {
        const { resolveSchema } = await import('../resolveSchema.js') as { resolveSchema: typeof import('../resolveSchema.js').resolveSchema }
        const ctx = buildContext(req)
        await resolveSchema(panel, ctx)
      } catch { /* best-effort */ }
    }

    const handler2 = FormRegistry.get(panel.getName(), formId)
    if (!handler2) return res.status(404).json({ message: `Form "${formId}" not found.` })

    const data = (req.body as Record<string, unknown> | undefined) ?? {}

    const ctx = buildContext(req)
    try {
      const result = await handler2(data, ctx)
      return res.json({ success: true, ...(typeof result === 'object' && result !== null ? result : {}) })
    } catch (err: unknown) {
      return res.status(422).json({ message: String(err) })
    }
  }, mw)

  // Upload endpoint — used by FileField / ImageField
  router.post(`${apiBase}/_upload`, async (req, res) => {
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
}
