/* eslint-disable @typescript-eslint/no-explicit-any */
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
import type { FormElementMeta } from './schema/Form.js'
import type { DialogElementMeta } from './schema/Dialog.js'
import { FormRegistry } from './FormRegistry.js'

export type PanelSchemaElementMeta =
  | TextElementMeta
  | HeadingElementMeta
  | StatsElementMeta
  | TableElementMeta
  | ChartElementMeta
  | ListElementMeta
  | FormElementMeta
  | DialogElementMeta

// ─── Schema resolver ───────────────────────────────────────

export async function resolveSchema(
  panel: Panel,
  ctx: PanelContext,
): Promise<PanelSchemaElementMeta[]> {
  const schemaDef = panel.getSchema()
  if (!schemaDef) return []

   
  const elements: any[] = typeof schemaDef === 'function'
    ? await (schemaDef as (ctx: PanelContext) => Promise<unknown[]>)(ctx)
    : schemaDef as unknown[]

  const result: PanelSchemaElementMeta[] = []

  for (const el of elements) {
     
    const type = (el as any).getType?.() as string | undefined
    if (!type) continue

    // Schema-level Section — resolve elements recursively
    if (type === 'section') {
       
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
       
      const config = (el as any).getConfig() as import('./schema/Table.js').TableConfig

      // ── fromResource(Class) — preferred resource-linked mode ───
      if (config.resourceClass) {
         
        const ResourceClass = config.resourceClass as any
         
        const Model = ResourceClass.model as any
        if (!Model) continue

         
        let q: any = Model.query()
        const sortCol = config.sortBy ?? ResourceClass.defaultSort
        if (sortCol) {
          const dir = config.sortBy ? config.sortDir : (ResourceClass.defaultSortDir ?? 'DESC')
          q = q.orderBy(sortCol, dir)
        }
        q = q.limit(config.limit)

        let records: unknown[] = []
        try { records = await q.get() } catch { /* empty model */ }

        // Determine columns — Column[] or string[] resolved via Resource fields
         
        const isColumnInstances = config.columns.length > 0 && typeof (config.columns[0] as any)?.toMeta === 'function'

        let columns: import('./schema/Table.js').PanelColumnMeta[]
        if (isColumnInstances) {
           
          columns = (config.columns as any[]).map((col: any) => col.toMeta() as import('./schema/Table.js').PanelColumnMeta)
        } else {
          const resource   = new ResourceClass()
          const flatFields = flattenFields(resource.fields())
          const names: string[] = config.columns.length > 0
            ? config.columns as string[]
             
            : flatFields.filter((f: any) => !f.isHiddenFrom('table') && f.getType() !== 'hasMany').map((f: any) => f.getName() as string).slice(0, 5)
          columns = names.map((name) => {
             
            const field = flatFields.find((f: any) => f.getName() === name)
             
            return { name, label: field ? (field as any).getLabel() as string : titleCase(name) }
          })
        }

        const slug = ResourceClass.getSlug?.() as string | undefined
        result.push({
          type:     'table',
          title:    config.title,
          resource: slug ?? '',
          columns,
          records,
          href:     slug ? `${panel.getPath()}/${slug}` : '',
        } satisfies TableElementMeta)
        continue
      }

      // ── fromModel(Class) — model-backed, no resource ────────────
      if (config.model) {
         
        const Model = config.model as any

        // Build query
         
        let q: any = Model.query()
        if (config.sortBy) q = q.orderBy(config.sortBy, config.sortDir)
        q = q.limit(config.limit)

        let records: unknown[] = []
        try { records = await q.get() } catch { /* empty model */ }

        // Determine columns — accept Column[] or string[]
         
        const isColumnInstances = config.columns.length > 0 && typeof (config.columns[0] as any)?.toMeta === 'function'

         
        const columns: import('./schema/Table.js').PanelColumnMeta[] = isColumnInstances
           
          ? (config.columns as any[]).map((col: any) => col.toMeta() as import('./schema/Table.js').PanelColumnMeta)
          : (config.columns as string[]).map((name) => ({ name, label: titleCase(name) }))

        const meta: TableElementMeta = {
          type:     'table',
          title:    config.title,
          resource: '',
          columns,
          records,
          href:     '',
        }
        if (config.reorderable) {
          meta.reorderable      = true
          meta.reorderEndpoint  = `${panel.getApiBase()}/_tables/reorder`
        }
        result.push(meta as PanelSchemaElementMeta)
        continue
      }

      continue
    }

    // Dashboard elements — resolve widget data + user layout for SSR
    if (type === 'dashboard') {
       
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

    // Dialog — resolve inner elements recursively
    if (type === 'dialog') {
       
      const dialog = el as any
      const items  = dialog.getItems() as unknown[]
      const dialogPanel = Object.create(panel, {
        getSchema: { value: () => items },
      })
      const resolved = await resolveSchema(dialogPanel, ctx)
      const meta = dialog.toMeta() as DialogElementMeta
      meta.elements = resolved
      result.push(meta as PanelSchemaElementMeta)
      continue
    }

    // Standalone Form — register submit handler and pass through meta
    if (type === 'form') {
       
      const form = el as any
      const handler = form.getSubmitHandler?.()
      if (handler) {
        FormRegistry.register(panel.getName(), form.getId(), handler)
      }
      result.push(form.toMeta() as PanelSchemaElementMeta)
      continue
    }

    // Standalone widget — resolve data for SSR (skip lazy widgets)
    if (type === 'widget') {
       
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
       
      result.push((el as any).toMeta() as PanelSchemaElementMeta)
    }
  }

  return result
}

// ─── Dashboard widget data resolver ────────────────────────

 
async function resolveWidgetData(widgets: any[], ctx: any): Promise<any[]> {
  return Promise.all(
     
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

 
function flattenFields(items: any[]): any[] {
   
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
