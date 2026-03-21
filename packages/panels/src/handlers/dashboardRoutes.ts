import type { MiddlewareHandler, AppRequest, AppResponse } from '@boostkit/core'
import type { Panel } from '../Panel.js'
import type { Widget, WidgetSize } from '../schema/Widget.js'
import type { Dashboard, DashboardTab } from '../schema/Dashboard.js'
import type { PanelUser } from '../types.js'
import type { RouterLike } from './types.js'
import { DashboardRegistry } from '../registries/DashboardRegistry.js'

// ── Minimal structural type for dynamically-resolved app/auth ──

interface AppContainer {
  make(key: string): unknown
}

interface AuthLike {
  api: {
    getSession(opts: { headers: Headers }): Promise<{ user?: { id?: string } } | null>
  }
}

interface PrismaLayoutClient {
  panelDashboardLayout: {
    findFirst(args: {
      where: Record<string, unknown>
    }): Promise<{ layout: string } | null>
    upsert(args: {
      where: Record<string, unknown>
      create: Record<string, unknown>
      update: Record<string, unknown>
    }): Promise<void>
  }
}

export function mountDashboardRoutes(
  router: RouterLike,
  panel:  Panel,
  mw:     MiddlewareHandler[],
): void {
  const panelName = panel.getName()
  const base = `${panel.getApiBase()}/_dashboard`
  const schemaDef = panel.getSchema()

  // Register statically-declared Dashboard elements
  if (schemaDef && Array.isArray(schemaDef)) {
    for (const el of schemaDef) {
      if (typeof el?.getType === 'function' && el.getType() === 'dashboard') {
        DashboardRegistry.register(panelName, el as Dashboard)
      }
    }
  }

  // Resolve user from auth session
  async function resolveUserId(req: AppRequest): Promise<string | undefined> {
    const reqUser = req as AppRequest & { user?: PanelUser }
    if (reqUser.user?.id) return String(reqUser.user.id)
    try {
      const { app } = await import(/* @vite-ignore */ '@boostkit/core') as { app(): AppContainer }
      const auth = app().make('auth') as AuthLike | null
      if (auth?.api?.getSession) {
        const session = await auth.api.getSession({
          headers: new Headers(req.headers as Record<string, string>),
        })
        return session?.user?.id
      }
    } catch { /* auth not configured */ }
    return undefined
  }

  // GET /_dashboard/:dashId/widgets — list widgets with resolved data
  router.get(`${base}/:dashId/widgets`, async (req: AppRequest, res: AppResponse) => {
    const params  = req.params as Record<string, string>
    const query   = req.query as Record<string, string | undefined>
    const reqUser = (req as AppRequest & { user?: PanelUser }).user

    let dashboard: Dashboard | undefined = DashboardRegistry.get(panelName, params['dashId'] ?? '')

    if (!dashboard) {
      // Resolve async schema to discover dashboards
      const schema = typeof schemaDef === 'function'
        ? await schemaDef({ user: reqUser, headers: req.headers as Record<string, string>, path: req.url, params: {} })
        : schemaDef ?? []
      for (const el of schema) {
        if (typeof el?.getType === 'function' && el.getType() === 'dashboard') {
          const dash = el as Dashboard
          DashboardRegistry.register(panelName, dash)
          if (dash.getId() === params['dashId']) dashboard = dash
        }
      }
    }

    if (!dashboard) return res.status(404).json({ error: 'Dashboard not found' })

    // Determine which widgets to return (top-level or tab)
    const tabId = query['tab']
    let widgets: Widget[] = dashboard.getWidgets()
    if (tabId) {
      const tab = dashboard.getTabs()?.find((t: DashboardTab) => t.getId() === tabId)
      if (tab) widgets = tab.getWidgets()
    }

    const results = []
    for (const widget of widgets) {
      const meta = widget.toMeta()
      let data: unknown = null
      const dataFn = widget.getDataFn()
      if (dataFn) {
        try {
          const settingsStr = query['settings']
          const settings = settingsStr ? JSON.parse(settingsStr) as Record<string, unknown> : undefined
          const uid = await resolveUserId(req)
          const ctx: PanelUser | undefined = uid ? { id: uid, ...reqUser } : reqUser
          data = await dataFn(ctx, settings)
        } catch { /* data resolution failed */ }
      }
      results.push({ ...meta, data })
    }
    return res.json({ widgets: results })
  }, mw)

  // GET /_dashboard/:dashId/layout — user's saved layout (or default)
  router.get(`${base}/:dashId/layout`, async (req: AppRequest, res: AppResponse) => {
    const userId = await resolveUserId(req)
    const params = req.params as Record<string, string>
    const query  = req.query as Record<string, string | undefined>
    const dashId = params['dashId'] ?? ''
    const tabId  = query['tab']
    const layoutKey = tabId ? `${dashId}:${tabId}` : dashId

    if (!userId) {
      return res.json({ layout: getDefaultLayout(panelName, dashId, tabId) })
    }

    try {
      const { app } = await import(/* @vite-ignore */ '@boostkit/core') as { app(): AppContainer }
      const prisma = app().make('prisma') as PrismaLayoutClient | null
      if (prisma?.panelDashboardLayout) {
        const record = await prisma.panelDashboardLayout.findFirst({
          where: { userId, panel: panelName, dashboardId: layoutKey },
        })
        if (record) {
          return res.json({ layout: JSON.parse(record.layout) })
        }
      }
    } catch { /* DB not available — fall through to default */ }

    return res.json({ layout: getDefaultLayout(panelName, dashId, tabId) })
  }, mw)

  // PUT /_dashboard/:dashId/layout — save user's layout
  router.put(`${base}/:dashId/layout`, async (req: AppRequest, res: AppResponse) => {
    const userId = await resolveUserId(req)
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const params = req.params as Record<string, string>
    const query  = req.query as Record<string, string | undefined>
    const dashId = params['dashId'] ?? ''
    const tabId  = query['tab']
    const layoutKey = tabId ? `${dashId}:${tabId}` : dashId
    const body = req.body as { layout?: unknown }
    if (!body?.layout || !Array.isArray(body.layout)) {
      return res.status(400).json({ error: 'Invalid layout' })
    }

    try {
      const { app } = await import(/* @vite-ignore */ '@boostkit/core') as { app(): AppContainer }
      const prisma = app().make('prisma') as PrismaLayoutClient | null
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
  }, mw)

  // GET /_widgets/:widgetId — resolve a standalone widget's data
  router.get(`${panel.getApiBase()}/_widgets/:widgetId`, async (req: AppRequest, res: AppResponse) => {
    const params  = req.params as Record<string, string>
    const widgetId = params['widgetId'] ?? ''
    const reqUser  = (req as AppRequest & { user?: PanelUser }).user

    const schema = typeof schemaDef === 'function'
      ? await schemaDef({ user: reqUser, headers: req.headers as Record<string, string>, path: req.url, params: {} })
      : schemaDef ?? []

    let widget: Widget | null = null
    for (const el of schema) {
      if (typeof el?.getType === 'function' && el.getType() === 'widget' && (el as Widget).getId() === widgetId) {
        widget = el as Widget
        break
      }
    }

    if (!widget) return res.status(404).json({ error: 'Widget not found' })

    const meta = widget.toMeta() as ReturnType<Widget['toMeta']> & { data?: unknown }
    const dataFn = widget.getDataFn?.()
    if (dataFn) {
      try {
        meta.data = await dataFn(reqUser)
      } catch {
        meta.data = null
      }
    }

    return res.json({ widget: meta })
  }, mw)
}

// ─── Dashboard helpers ──────────────────────────────────────

/** Build default layout positions from a list of widgets. */
export function buildDefaultLayout(widgets: Widget[]): Array<{ widgetId: string; size: WidgetSize; position: number }> {
  return widgets.map((w, i) => ({
    widgetId: w.getId(),
    size:     w.getDefaultSize(),
    position: i,
  }))
}

function getDefaultLayout(panelName: string, dashId: string, tabId?: string): unknown[] {
  const dashboard = DashboardRegistry.get(panelName, dashId)
  if (!dashboard) return []

  let widgets: Widget[]
  if (tabId) {
    const tab = dashboard.getTabs()?.find((t: DashboardTab) => t.getId() === tabId)
    widgets = tab ? tab.getWidgets() : []
  } else {
    widgets = dashboard.getWidgets()
  }

  return buildDefaultLayout(widgets)
}
