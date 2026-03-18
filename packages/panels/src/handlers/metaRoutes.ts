import type { MiddlewareHandler } from '@boostkit/core'
import type { RouterLike } from './types.js'
import type { Panel } from '../Panel.js'
import type { ModelClass, QueryBuilderLike, RecordRow } from '../types.js'
import { flattenFields, buildContext } from './utils.js'
import { FormRegistry } from '../FormRegistry.js'

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
}
