import { ServiceProvider, type Application } from '@boostkit/core'
import type { Widget, WidgetSize } from './Widget.js'
import type { Dashboard } from './Dashboard.js'
import { DashboardRegistry } from './DashboardRegistry.js'

/** Build default layout positions from a list of widgets. */
function buildDefaultLayout(widgets: Widget[]): Array<{ widgetId: string; size: WidgetSize; position: number }> {
  return widgets.map((w, i) => ({
    widgetId: w.getId(),
    size:     w.getDefaultSize(),
    position: i,
  }))
}

/**
 * Returns a DashboardServiceProvider class that auto-discovers Dashboard
 * elements from panel schemas (no widget config needed).
 *
 * Usage in bootstrap/providers.ts:
 *   import { dashboard } from '@boostkit/dashboards'
 *   export default [..., dashboard(), ...]
 */
export function dashboard(): new (app: Application) => ServiceProvider {
  class DashboardServiceProvider extends ServiceProvider {
    register(): void {
      DashboardRegistry.reset()
    }

    async boot(): Promise<void> {
      let PanelRegistry: any
      let router: any
      try {
        const panels    = await import('@boostkit/panels') as any
        PanelRegistry   = panels.PanelRegistry
        const routerMod = await import('@boostkit/router') as any
        router          = routerMod.router
      } catch {
        return // panels or router not available
      }

      // Resolve user from auth session (same pattern as PanelServiceProvider)
      async function resolveUserId(req: any): Promise<string | undefined> {
        if (req.user?.id) return req.user.id as string
        try {
          const { app } = await import('@boostkit/core') as any
          const auth = app().make('auth')
          if (auth?.api?.getSession) {
            const session = await auth.api.getSession({
              headers: new Headers(req.headers as Record<string, string>),
            })
            return session?.user?.id as string | undefined
          }
        } catch { /* auth not configured */ }
        return undefined
      }

      for (const panel of PanelRegistry.all()) {
        const panelName = panel.getName()
        const base = `${panel.getApiBase()}/_dashboard`

        // Try to discover Dashboard elements from static schema
        const schemaDef = panel.getSchema()
        if (schemaDef && Array.isArray(schemaDef)) {
          for (const el of schemaDef) {
            if (typeof el?.getType === 'function' && el.getType() === 'dashboard') {
              DashboardRegistry.register(panelName, el)
            }
          }
        }
        // For async schemas, dashboards are discovered at request time (see routes below)

        // GET /_dashboard/:dashId/widgets — list widgets with resolved data
        router.get(`${base}/:dashId/widgets`, async (req: any, res: any) => {
          let dashboard = DashboardRegistry.get(panelName, req.params.dashId)

          if (!dashboard) {
            // Resolve async schema to discover dashboards
            const schema = typeof schemaDef === 'function'
              ? await schemaDef({ user: req.user, headers: req.headers ?? {}, path: req.url })
              : schemaDef ?? []
            for (const el of schema) {
              if (typeof el?.getType === 'function' && el.getType() === 'dashboard') {
                DashboardRegistry.register(panelName, el)
                if (el.getId() === req.params.dashId) dashboard = el
              }
            }
          }

          if (!dashboard) return res.status(404).json({ error: 'Dashboard not found' })

          // Determine which widgets to return (top-level or tab)
          const tabId = req.query?.tab as string | undefined
          let widgets = dashboard.getWidgets()
          if (tabId) {
            const tab = dashboard.getTabs()?.find((t: any) => t.getId() === tabId)
            if (tab) widgets = tab.getWidgets()
          }

          const results = []
          for (const widget of widgets) {
            const meta = widget.toMeta()
            let data: unknown = null
            const dataFn = widget.getDataFn()
            if (dataFn) {
              try {
                const settingsStr = req.query?.settings as string | undefined
                const settings = settingsStr ? JSON.parse(settingsStr) : undefined
                const uid = await resolveUserId(req)
                data = await dataFn({ user: uid ? { id: uid, ...req.user } : req.user }, settings)
              } catch { /* data resolution failed */ }
            }
            results.push({ ...meta, data })
          }
          return res.json({ widgets: results })
        })

        // GET /_dashboard/:dashId/layout — user's saved layout (or default)
        router.get(`${base}/:dashId/layout`, async (req: any, res: any) => {
          const userId = await resolveUserId(req)
          const dashId = req.params.dashId as string
          const tabId = req.query?.tab as string | undefined
          const layoutKey = tabId ? `${dashId}:${tabId}` : dashId

          if (!userId) {
            return res.json({ layout: getDefaultLayout(panelName, dashId, tabId) })
          }

          try {
            const { app } = await import('@boostkit/core') as any
            const prisma = app().make('prisma')
            if (prisma?.panelDashboardLayout) {
              const record = await prisma.panelDashboardLayout.findFirst({
                where: { userId, panel: panelName, dashboardId: layoutKey },
              })
              if (record) {
                return res.json({ layout: JSON.parse(String(record.layout)) })
              }
            }
          } catch { /* DB not available — fall through to default */ }

          return res.json({ layout: getDefaultLayout(panelName, dashId, tabId) })
        })

        // PUT /_dashboard/:dashId/layout — save user's layout
        router.put(`${base}/:dashId/layout`, async (req: any, res: any) => {
          const userId = await resolveUserId(req)
          if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' })
          }

          const dashId = req.params.dashId as string
          const tabId = req.query?.tab as string | undefined
          const layoutKey = tabId ? `${dashId}:${tabId}` : dashId
          const body = req.body as { layout?: unknown }
          if (!body?.layout || !Array.isArray(body.layout)) {
            return res.status(400).json({ error: 'Invalid layout' })
          }

          try {
            const { app } = await import('@boostkit/core') as any
            const prisma = app().make('prisma')
            if (prisma?.panelDashboardLayout) {
              await prisma.panelDashboardLayout.upsert({
                where: { userId_panel_dashboardId: { userId, panel: panelName, dashboardId: layoutKey } },
                create: { userId, panel: panelName, dashboardId: layoutKey, layout: JSON.stringify(body.layout) },
                update: { layout: JSON.stringify(body.layout) },
              })
            }
          } catch {
            return res.status(500).json({ error: 'Failed to save layout' })
          }

          return res.json({ ok: true })
        })

        // GET /_widgets/:widgetId — resolve a standalone widget's data
        // Used by lazy standalone widgets that weren't resolved at SSR time
        router.get(`${panel.getApiBase()}/_widgets/:widgetId`, async (req: any, res: any) => {
          const widgetId = req.params.widgetId as string

          // Find the widget in the schema (resolve async schema if needed)
          const schema = typeof schemaDef === 'function'
            ? await schemaDef({ user: req.user, headers: req.headers ?? {}, path: req.url })
            : schemaDef ?? []

          let widget: any = null
          for (const el of schema) {
            if (typeof el?.getType === 'function' && el.getType() === 'widget' && el.getId() === widgetId) {
              widget = el
              break
            }
          }

          if (!widget) return res.status(404).json({ error: 'Widget not found' })

          const meta = widget.toMeta()
          const dataFn = widget.getDataFn?.()
          if (dataFn) {
            try {
              meta.data = await dataFn({ user: req.user })
            } catch {
              meta.data = null
            }
          }

          return res.json({ widget: meta })
        })
      }
    }
  }

  return DashboardServiceProvider
}

function getDefaultLayout(panelName: string, dashId: string, tabId?: string): unknown[] {
  const dashboard = DashboardRegistry.get(panelName, dashId)
  if (!dashboard) return []

  let widgets: Widget[]
  if (tabId) {
    const tab = dashboard.getTabs()?.find((t: any) => t.getId() === tabId)
    widgets = tab ? tab.getWidgets() : []
  } else {
    widgets = dashboard.getWidgets()
  }

  return buildDefaultLayout(widgets)
}

export { buildDefaultLayout }
