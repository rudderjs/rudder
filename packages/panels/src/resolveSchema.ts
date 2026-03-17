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

    // Schema-level Section — resolve elements recursively
    if (type === 'section') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const section = el as any
      if (typeof section.hasFields === 'function' && !section.hasFields() && section.getItems().length > 0) {
        // Schema element section — resolve items recursively
        const items = section.getItems()
        const sectionPanel = Object.create(panel, {
          getSchema: { value: () => items },
        })
        const resolved = await resolveSchema(sectionPanel, ctx)
        const meta = section.toMeta()
        meta.elements = resolved
        result.push(meta as PanelSchemaElementMeta)
        continue
      }
      // Field section — pass through toMeta()
      result.push(section.toMeta() as PanelSchemaElementMeta)
      continue
    }

    // Schema-level Tabs — resolve each tab's elements recursively
    if (type === 'tabs') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tabs = el as any
      const rawTabs = tabs.getTabs() as any[]

      // Check if any tab has schema elements (not fields)
      const hasSchemaElements = rawTabs.some((t: any) => !t.hasFields())

      if (hasSchemaElements) {
        // Resolve schema elements in each tab
        const resolvedTabs = []
        for (const tab of rawTabs) {
          if (tab.hasFields()) {
            // Field tab — pass through
            resolvedTabs.push(tab.toMeta())
          } else {
            // Schema element tab — resolve items recursively
            const items = tab.getItems()
            // Create a proxy that delegates everything to the real panel
            // but overrides getSchema() to return this tab's items
            const tabPanel = Object.create(panel, {
              getSchema: { value: () => items },
            })
            const resolved = await resolveSchema(tabPanel, ctx)
            resolvedTabs.push({
              label: tab.getLabel(),
              fields: [],
              elements: resolved,
            })
          }
        }
        const tabsId = tabs.getId?.()
        result.push({ type: 'tabs', ...(tabsId && { id: tabsId }), tabs: resolvedTabs } as unknown as PanelSchemaElementMeta)
      } else {
        // All field tabs — pass through toMeta()
        result.push(tabs.toMeta() as PanelSchemaElementMeta)
      }
      continue
    }

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

    // Standalone widget — resolve data for SSR (skip lazy widgets)
    if (type === 'widget') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const widget = el as any
      const meta = widget.toMeta()

      if (!meta.lazy) {
        const dataFn = widget.getDataFn?.()
        if (dataFn) {
          try {
            meta.data = await dataFn({ user: ctx.user })
          } catch {
            meta.data = null
          }
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
