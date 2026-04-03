import type { MiddlewareHandler } from '@rudderjs/core'
import type { RouterLike } from '../types.js'
import type { Panel } from '../../Panel.js'
import { TabsRegistry } from '../../registries/TabsRegistry.js'
import { warmUpRegistries, debugWarn, buildContext } from './shared.js'

export function mountTabsRoutes(
  router: RouterLike,
  panel: Panel,
  mw: MiddlewareHandler[],
): void {
  const apiBase = panel.getApiBase()

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
          const { resolveSchema: resolve } = await import('../../resolveSchema.js') as { resolveSchema: typeof import('../../resolveSchema.js').resolveSchema }
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

      const { resolveSchema: resolve } = await import('../../resolveSchema.js') as { resolveSchema: typeof import('../../resolveSchema.js').resolveSchema }
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
