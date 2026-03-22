import type { MiddlewareHandler } from '@boostkit/core'
import type { RouterLike } from './types.js'
import type { Panel } from '../Panel.js'
import type { ModelClass, QueryBuilderLike, RecordRow } from '../types.js'
import { flattenFields, buildContext } from './utils.js'
import { mountTableRoutes } from './meta/tableRoutes.js'
import { mountStatsRoutes } from './meta/statsRoutes.js'
import { mountTabsRoutes } from './meta/tabsRoutes.js'
import { mountFormRoutes } from './meta/formRoutes.js'
import { mountUploadRoutes } from './meta/uploadRoutes.js'

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

      const resource   = new ResourceClass()
      const tableConfig = resource._resolveTable().getConfig()
      const formFields = flattenFields(resource._resolveForm().getFields() as import('../Resource.js').FieldOrGrouping[])
      const searchableCols = tableConfig.searchColumns
        ?? formFields.filter(f => f.isSearchable()).map(f => f.getName())

      if (searchableCols.length === 0) continue

      let qb: QueryBuilderLike<RecordRow> = Model.query()
      qb = qb.where(searchableCols[0] ?? '', 'LIKE', `%${q}%`)
      for (let i = 1; i < searchableCols.length; i++) {
        qb = qb.orWhere(searchableCols[i] ?? '', 'LIKE', `%${q}%`)
      }

      const rows: RecordRow[] = await qb.limit(limit).all()
      if (rows.length === 0) continue

      const titleField: string = tableConfig.titleField ?? 'id'
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

  // Delegate to sub-handlers
  mountTableRoutes(router, panel, mw)
  mountStatsRoutes(router, panel, mw)
  mountTabsRoutes(router, panel, mw)
  mountFormRoutes(router, panel, mw)
  mountUploadRoutes(router, panel, mw)
}
