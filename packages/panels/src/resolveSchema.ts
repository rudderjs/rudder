import type { Panel }         from './Panel.js'
import type { PanelContext }  from './types.js'
import type {
  TextElementMeta,
  HeadingElementMeta,
  StatsElementMeta,
  TableElementMeta,
  ChartElementMeta,
  ListElementMeta,
} from './schema/index.js'

export type PanelSchemaElementMeta =
  | TextElementMeta
  | HeadingElementMeta
  | StatsElementMeta
  | TableElementMeta
  | ChartElementMeta
  | ListElementMeta

// ─── Schema resolver ───────────────────────────────────────

export async function resolveSchema(
  panel: Panel,
  ctx: PanelContext,
): Promise<PanelSchemaElementMeta[]> {
  const schemaDef = panel.getSchema()
  if (!schemaDef) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const elements: any[] = typeof schemaDef === 'function'
    ? await (schemaDef as (ctx: PanelContext) => Promise<unknown[]>)(ctx)
    : schemaDef as unknown[]

  const result: PanelSchemaElementMeta[] = []

  for (const el of elements) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const type = (el as any).getType?.() as string | undefined
    if (!type) continue

    // Table needs special resolution (query model, build columns)
    if (type === 'table') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config = (el as any).getConfig() as import('./schema/Table.js').TableConfig
      if (!config.resource) continue

      const ResourceClass = panel.getResources().find(
        (R) => R.getSlug() === config.resource,
      )
      if (!ResourceClass) continue

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Model = (ResourceClass as any).model as any
      if (!Model) continue

      // Build query
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = Model.query()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sortCol = config.sortBy ?? (ResourceClass as any).defaultSort
      if (sortCol) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dir = config.sortBy ? config.sortDir : ((ResourceClass as any).defaultSortDir ?? 'DESC')
        q = q.orderBy(sortCol, dir)
      }
      q = q.limit(config.limit)

      let records: unknown[] = []
      try { records = await q.get() } catch { /* empty model */ }

      // Determine columns
      const resource   = new ResourceClass()
      const flatFields = flattenFields(resource.fields())

      const columnNames: string[] = config.columns.length > 0
        ? config.columns
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        : flatFields
            .filter((f: any) => !f.isHiddenFrom('table') && f.getType() !== 'hasMany')
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((f: any) => f.getName() as string)
            .slice(0, 5)

      const columns = columnNames.map((name) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const field = flatFields.find((f: any) => f.getName() === name)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { name, label: field ? (field as any).getLabel() as string : titleCase(name) }
      })

      result.push({
        type:     'table',
        title:    config.title,
        resource: config.resource,
        columns,
        records,
        href:     `${panel.getPath()}/${config.resource}`,
      } satisfies TableElementMeta)
      continue
    }

    // Dashboard elements — resolve widget data + user layout for SSR
    if (type === 'dashboard') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dashboard = el as any
      const meta = dashboard.toMeta()

      // Resolve top-level widget data
      if (meta.widgets) {
        meta.widgets = await resolveWidgetData(dashboard.getWidgets(), ctx)
      }

      // Resolve tab widget data
      if (meta.tabs) {
        for (let i = 0; i < meta.tabs.length; i++) {
          const tab = dashboard.getTabs()[i]
          if (tab) {
            meta.tabs[i].widgets = await resolveWidgetData(tab.getWidgets(), ctx)
          }
        }
      }

      // Resolve user's saved layout from DB for SSR
      const userId = (ctx.user as any)?.id as string | undefined
      if (userId) {
        try {
          const { app } = await import('@boostkit/core') as any
          const prisma = app().make('prisma')
          if (prisma?.panelDashboardLayout) {
            const panelName = panel.getName()

            // Top-level layout
            const topRecord = await prisma.panelDashboardLayout.findFirst({
              where: { userId, panel: panelName, dashboardId: meta.id },
            })
            if (topRecord) {
              meta.savedLayout = JSON.parse(String(topRecord.layout))
            }

            // Tab layouts
            if (meta.tabs) {
              meta.savedTabLayouts = {} as Record<string, unknown[]>
              for (const tab of meta.tabs) {
                const tabRecord = await prisma.panelDashboardLayout.findFirst({
                  where: { userId, panel: panelName, dashboardId: `${meta.id}:${tab.id}` },
                })
                if (tabRecord) {
                  meta.savedTabLayouts[tab.id] = JSON.parse(String(tabRecord.layout))
                }
              }
            }
          }
        } catch { /* DB not available */ }
      }

      result.push(meta as PanelSchemaElementMeta)
      continue
    }

    // Standalone widget — always resolve data for SSR (lazy only applies inside Dashboard)
    if (type === 'widget') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const widget = el as any
      const meta = widget.toMeta()

      const dataFn = widget.getDataFn?.()
      if (dataFn) {
        try {
          meta.data = await dataFn({ user: ctx.user })
        } catch {
          meta.data = null
        }
      }

      result.push(meta as PanelSchemaElementMeta)
      continue
    }

    // All other element types (text, heading, stats, chart, list, etc.)
    // — pass through their toMeta() directly
    if (typeof (el as any).toMeta === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      result.push((el as any).toMeta() as PanelSchemaElementMeta)
    }
  }

  return result
}

// ─── Dashboard widget data resolver ────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveWidgetData(widgets: any[], ctx: any): Promise<any[]> {
  return Promise.all(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    widgets.map(async (widget: any) => {
      const meta = widget.toMeta()
      // Skip data resolution for lazy widgets
      if (meta.lazy) return { ...meta, data: null }

      const dataFn = widget.getDataFn?.()
      if (dataFn) {
        try {
          meta.data = await dataFn({ user: ctx.user })
        } catch {
          meta.data = null
        }
      }
      return meta
    })
  )
}

// ─── Helpers ───────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function flattenFields(items: any[]): any[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any[] = []
  for (const item of items) {
    if (typeof item.getFields === 'function') {
      result.push(...flattenFields(item.getFields()))
    } else {
      result.push(item)
    }
  }
  return result
}

function titleCase(str: string): string {
  return str.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()).trim()
}
