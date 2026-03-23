import type { MiddlewareHandler, AppRequest, AppResponse } from '@boostkit/core'
import type { Panel } from '../Panel.js'
import type { Widget, WidgetSize, WidgetMeta } from '../schema/Widget.js'
import type { Dashboard } from '../schema/Dashboard.js'
import type { PanelUser, PanelContext, SchemaElementLike } from '../types.js'
import type { PanelSchemaElementMeta } from '../resolveSchema.js'
import type { RouterLike } from './types.js'
import { DashboardRegistry } from '../registries/DashboardRegistry.js'
import { debugWarn } from '../debug.js'

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

type WidgetMetaResolved = WidgetMeta & { type: 'widget'; schema?: PanelSchemaElementMeta[] }

/** Resolve a widget's schema elements via its schemaFn. */
async function resolveWidgetSchema(
  widget: Widget,
  panel: Panel,
  ctx: PanelContext,
  settings?: Record<string, unknown>,
): Promise<WidgetMetaResolved> {
  const meta: WidgetMetaResolved = widget.toMeta()
  const schemaFn = widget.getSchemaFn?.()
  if (schemaFn) {
    try {
      const elements = await schemaFn(ctx, settings)
      const { resolveSchema } = await import('../resolveSchema.js')
      const innerPanel = Object.create(panel, {
        getSchema: { value: () => elements },
      }) as Panel
      meta.schema = await resolveSchema(innerPanel, ctx)
    } catch (e) {
      debugWarn('widget.schema', e)
      meta.schema = []
    }
  }
  return meta
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

  /** Build PanelContext from request. */
  function buildCtx(req: AppRequest): PanelContext {
    const reqUser = (req as AppRequest & { user?: PanelUser }).user
    return { user: reqUser, headers: req.headers as Record<string, string>, path: req.url, params: {} }
  }

  // GET /_dashboard/:dashId/widgets — list widgets with resolved schemas
  router.get(`${base}/:dashId/widgets`, async (req: AppRequest, res: AppResponse) => {
    const params  = req.params as Record<string, string>
    const query   = req.query as Record<string, string | undefined>
    const ctx     = buildCtx(req)

    let dashboard: Dashboard | undefined = DashboardRegistry.get(panelName, params['dashId'] ?? '')

    if (!dashboard) {
      const schema = typeof schemaDef === 'function'
        ? await schemaDef(ctx)
        : schemaDef ?? []
      for (const el of schema as SchemaElementLike[]) {
        if (typeof el?.getType === 'function' && el.getType() === 'dashboard') {
          const dash = el as Dashboard
          DashboardRegistry.register(panelName, dash)
          if (dash.getId() === params['dashId']) dashboard = dash
        }
      }
    }

    if (!dashboard) return res.status(404).json({ error: 'Dashboard not found' })

    const settingsStr = query['settings']
    const settings = settingsStr ? JSON.parse(settingsStr) as Record<string, unknown> : undefined

    const results = await Promise.all(
      dashboard.getWidgets().map(widget => resolveWidgetSchema(widget, panel, ctx, settings))
    )

    return res.json({ widgets: results })
  }, mw)

  // GET /_dashboard/:dashId/layout — user's saved layout (or default)
  router.get(`${base}/:dashId/layout`, async (req: AppRequest, res: AppResponse) => {
    const userId = await resolveUserId(req)
    const params = req.params as Record<string, string>
    const dashId = params['dashId'] ?? ''

    if (!userId) {
      return res.json({ layout: getDefaultLayout(panelName, dashId) })
    }

    try {
      const { app } = await import(/* @vite-ignore */ '@boostkit/core') as { app(): AppContainer }
      const prisma = app().make('prisma') as PrismaLayoutClient | null
      if (prisma?.panelDashboardLayout) {
        const record = await prisma.panelDashboardLayout.findFirst({
          where: { userId, panel: panelName, dashboardId: dashId },
        })
        if (record) {
          return res.json({ layout: JSON.parse(record.layout) })
        }
      }
    } catch { /* DB not available — fall through to default */ }

    return res.json({ layout: getDefaultLayout(panelName, dashId) })
  }, mw)

  // PUT /_dashboard/:dashId/layout — save user's layout
  router.put(`${base}/:dashId/layout`, async (req: AppRequest, res: AppResponse) => {
    const userId = await resolveUserId(req)
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const params = req.params as Record<string, string>
    const dashId = params['dashId'] ?? ''
    const body = req.body as { layout?: unknown }
    if (!body?.layout || !Array.isArray(body.layout)) {
      return res.status(400).json({ error: 'Invalid layout' })
    }

    try {
      const { app } = await import(/* @vite-ignore */ '@boostkit/core') as { app(): AppContainer }
      const prisma = app().make('prisma') as PrismaLayoutClient | null
      if (prisma?.panelDashboardLayout) {
        await prisma.panelDashboardLayout.upsert({
          where: { userId_panel_dashboardId: { userId, panel: panelName, dashboardId: dashId } },
          create: { userId, panel: panelName, dashboardId: dashId, layout: JSON.stringify(body.layout) },
          update: { layout: JSON.stringify(body.layout) },
        })
      }
    } catch {
      return res.status(500).json({ error: 'Failed to save layout' })
    }

    return res.json({ ok: true })
  }, mw)

  // GET /_widgets/:widgetId — resolve a standalone widget's schema
  router.get(`${panel.getApiBase()}/_widgets/:widgetId`, async (req: AppRequest, res: AppResponse) => {
    const params  = req.params as Record<string, string>
    const widgetId = params['widgetId'] ?? ''
    const ctx     = buildCtx(req)

    const schema = typeof schemaDef === 'function'
      ? await schemaDef(ctx)
      : schemaDef ?? []

    let widget: Widget | null = null
    for (const el of schema as SchemaElementLike[]) {
      if (typeof el?.getType === 'function' && el.getType() === 'widget' && (el as Widget).getId() === widgetId) {
        widget = el as Widget
        break
      }
    }

    if (!widget) return res.status(404).json({ error: 'Widget not found' })

    const resolved = await resolveWidgetSchema(widget, panel, ctx)
    return res.json({ widget: resolved })
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

function getDefaultLayout(panelName: string, dashId: string): unknown[] {
  const dashboard = DashboardRegistry.get(panelName, dashId)
  if (!dashboard) return []
  return buildDefaultLayout(dashboard.getWidgets())
}
