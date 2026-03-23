import type { Panel } from '../Panel.js'
import type { PanelContext, SchemaElementLike } from '../types.js'
import type { Dashboard, DashboardTab } from '../schema/Dashboard.js'
import type { Widget, WidgetMeta } from '../schema/Widget.js'
import type { PanelSchemaElementMeta } from '../resolveSchema.js'
import type { AppLike, ResolveSchemaFn } from './types.js'
import { debugWarn } from '../debug.js'

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
      // Skip schema resolution for lazy widgets
      if (meta.lazy) return meta

      const schemaFn = widget.getSchemaFn?.()
      if (schemaFn) {
        try {
          const elements = await schemaFn(ctx)
          const innerPanel = Object.create(panel, {
            getSchema: { value: () => elements },
          }) as Panel
          meta.schema = await resolveSchemaFn(innerPanel, ctx)
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
    savedTabLayouts?: Record<string, unknown[]>
    widgets: WidgetMetaResolved[]
    tabs?: (import('../schema/Dashboard.js').DashboardTabMeta & { widgets: WidgetMetaResolved[] })[]
  }

  // Resolve top-level widget schemas
  if (meta.widgets) {
    meta.widgets = await resolveWidgetSchemas(dashboard.getWidgets(), panel, ctx, resolveSchemaFn)
  }

  // Resolve tab widget schemas
  if (meta.tabs) {
    const rawTabs = dashboard.getTabs() as DashboardTab[] | undefined
    for (let i = 0; i < meta.tabs.length; i++) {
      const tab = rawTabs?.[i]
      const metaTab = meta.tabs[i]
      if (tab && metaTab) {
        metaTab.widgets = await resolveWidgetSchemas(tab.getWidgets(), panel, ctx, resolveSchemaFn)
      }
    }
  }

  // Resolve user's saved layout from DB for SSR
  const userId = ctx.user?.id as string | undefined
  if (userId) {
    try {
      const coreModule = await import(/* @vite-ignore */ '@boostkit/core') as unknown as { app(): AppLike }
      const prisma = coreModule.app().make('prisma') as Record<string, unknown> | null
      if (prisma?.['panelDashboardLayout']) {
        const panelDashboardLayout = prisma['panelDashboardLayout'] as {
          findFirst(opts: Record<string, unknown>): Promise<{ layout: unknown } | null>
        }
        const panelName = panel.getName()

        // Top-level layout
        const topRecord = await panelDashboardLayout.findFirst({
          where: { userId, panel: panelName, dashboardId: meta.id },
        })
        if (topRecord) {
          meta.savedLayout = JSON.parse(String(topRecord.layout))
        }

        // Tab layouts
        if (meta.tabs) {
          meta.savedTabLayouts = {} as Record<string, unknown[]>
          for (const tab of meta.tabs) {
            const tabRecord = await panelDashboardLayout.findFirst({
              where: { userId, panel: panelName, dashboardId: `${meta.id}:${tab.id}` },
            })
            if (tabRecord) {
              meta.savedTabLayouts[tab.id] = JSON.parse(String(tabRecord.layout))
            }
          }
        }
      }
    } catch (e) { debugWarn('dashboard.layout', e) }
  }

  return meta as unknown as PanelSchemaElementMeta
}
