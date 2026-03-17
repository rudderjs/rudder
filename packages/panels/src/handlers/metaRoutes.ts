import type { MiddlewareHandler } from '@boostkit/core'
import type { RouterLike } from './types.js'
import type { Panel } from '../Panel.js'
import { flattenFields } from './utils.js'

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
