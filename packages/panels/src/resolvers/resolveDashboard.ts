import type { Panel } from '../Panel.js'
import type { PanelContext, SchemaElementLike } from '../types.js'
import type { Dashboard, DashboardTab } from '../schema/Dashboard.js'
import type { Widget } from '../schema/Widget.js'
import type { PanelSchemaElementMeta } from '../resolveSchema.js'
import type { AppLike } from './types.js'
import { debugWarn } from '../debug.js'

type WidgetMetaWithData = import('../schema/Widget.js').WidgetMeta & { type: 'widget'; data?: unknown }

async function resolveWidgetData(widgets: Widget[], ctx: PanelContext): Promise<WidgetMetaWithData[]> {
  return Promise.all(
    widgets.map(async (widget): Promise<WidgetMetaWithData> => {
      const meta: WidgetMetaWithData = widget.toMeta()
      // Skip data resolution for lazy widgets
      if (meta.lazy) return { ...meta, data: null }

      const dataFn = widget.getDataFn?.()
      if (dataFn) {
        try {
          meta.data = await dataFn({ user: ctx.user })
        } catch (e) {
          debugWarn('widget.data', e)
          meta.data = null
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
): Promise<PanelSchemaElementMeta> {
  const dashboard = el as Dashboard
  // We extend DashboardMeta with optional SSR-only fields (savedLayout, savedTabLayouts)
  // that are added at runtime and sent to the client as part of the serialized meta.
  const meta = dashboard.toMeta() as import('../schema/Dashboard.js').DashboardMeta & {
    savedLayout?: unknown[]
    savedTabLayouts?: Record<string, unknown[]>
    widgets: WidgetMetaWithData[]
    tabs?: (import('../schema/Dashboard.js').DashboardTabMeta & { widgets: WidgetMetaWithData[] })[]
  }

  // Resolve top-level widget data
  if (meta.widgets) {
    meta.widgets = await resolveWidgetData(dashboard.getWidgets(), ctx)
  }

  // Resolve tab widget data
  if (meta.tabs) {
    const rawTabs = dashboard.getTabs() as DashboardTab[] | undefined
    for (let i = 0; i < meta.tabs.length; i++) {
      const tab = rawTabs?.[i]
      const metaTab = meta.tabs[i]
      if (tab && metaTab) {
        metaTab.widgets = await resolveWidgetData(tab.getWidgets(), ctx)
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
