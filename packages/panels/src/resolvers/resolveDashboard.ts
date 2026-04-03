import type { Panel } from '../Panel.js'
import type { PanelContext, SchemaElementLike } from '../types.js'
import type { Dashboard } from '../schema/Dashboard.js'
import type { Widget, WidgetMeta } from '../schema/Widget.js'
import type { PanelSchemaElementMeta } from '../resolveSchema.js'
import type { AppLike, ResolveSchemaFn } from './types.js'
import { debugWarn } from '../debug.js'
import { resolveChildSchema } from './utils.js'

type WidgetMetaResolved = WidgetMeta & { type: 'widget'; schema?: PanelSchemaElementMeta[] }

async function resolveWidgetSchemas(
  widgets: Widget[],
  panel: Panel,
  ctx: PanelContext,
  resolveSchemaFn: ResolveSchemaFn,
): Promise<WidgetMetaResolved[]> {
  return Promise.all(
    widgets.map(async (widget): Promise<WidgetMetaResolved> => {
      const meta: WidgetMetaResolved = widget.toMeta()
      if (meta.lazy) return meta

      const schemaFn = widget.getSchemaFn?.()
      if (schemaFn) {
        try {
          const elements = await schemaFn(ctx)
          meta.schema = await resolveChildSchema(panel, ctx, elements, resolveSchemaFn)
        } catch (e) {
          debugWarn('widget.schema', e)
          meta.schema = []
        }
      }
      return meta
    })
  )
}

export async function resolveDashboard(
  el: SchemaElementLike,
  panel: Panel,
  ctx: PanelContext,
  resolveSchemaFn: ResolveSchemaFn,
): Promise<PanelSchemaElementMeta> {
  const dashboard = el as Dashboard
  const meta = dashboard.toMeta() as import('../schema/Dashboard.js').DashboardMeta & {
    savedLayout?: unknown[]
    widgets: WidgetMetaResolved[]
  }

  // Resolve widget schemas
  meta.widgets = await resolveWidgetSchemas(dashboard.getWidgets(), panel, ctx, resolveSchemaFn)

  // Resolve user's saved layout from DB for SSR
  const userId = ctx.user?.id as string | undefined
  if (userId) {
    try {
      const coreModule = await import(/* @vite-ignore */ '@rudderjs/core') as unknown as { app(): AppLike }
      const prisma = coreModule.app().make('prisma') as Record<string, unknown> | null
      if (prisma?.['panelDashboardLayout']) {
        const panelDashboardLayout = prisma['panelDashboardLayout'] as {
          findFirst(opts: Record<string, unknown>): Promise<{ layout: unknown } | null>
        }
        const record = await panelDashboardLayout.findFirst({
          where: { userId, panel: panel.getName(), dashboardId: meta.id },
        })
        if (record) {
          meta.savedLayout = JSON.parse(String(record.layout))
        }
      }
    } catch (e) { debugWarn('dashboard.layout', e) }
  }

  return meta as unknown as PanelSchemaElementMeta
}
