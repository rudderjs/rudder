import type { Panel }         from './Panel.js'
import type { PanelContext, SchemaElementLike, QueryBuilderLike, RecordRow }  from './types.js'
import type {
  TextElementMeta,
  HeadingElementMeta,
  StatsElementMeta,
  PanelStatMeta,
  TableElementMeta,
  ChartElementMeta,
  ListElementMeta,
} from './schema/index.js'
import type { FormElementMeta } from './schema/Form.js'
import type { DialogElementMeta } from './schema/Dialog.js'
import type { Section } from './Section.js'
import type { Tabs } from './Tabs.js'
import type { Widget } from './Widget.js'
import type { Dashboard, DashboardTab } from './Dashboard.js'
import type { FieldOrGrouping } from './Resource.js'
import type { Field } from './Field.js'
import type { Column } from './schema/Column.js'
import { debugWarn } from './debug.js'
import { FormRegistry } from './FormRegistry.js'
import { TableRegistry } from './TableRegistry.js'
import { StatsRegistry } from './StatsRegistry.js'
import { TabsRegistry } from './TabsRegistry.js'
import type { TabMeta, TabsMeta, TabsPersistMode } from './Tabs.js'

export type PanelSchemaElementMeta =
  | TextElementMeta
  | HeadingElementMeta
  | StatsElementMeta
  | TableElementMeta
  | ChartElementMeta
  | ListElementMeta
  | FormElementMeta
  | DialogElementMeta

// ─── Local duck-type interfaces ─────────────────────────────

/** Minimal interface for elements that expose getConfig() (e.g. Table). */
interface ConfigurableElement extends SchemaElementLike {
  getConfig(): import('./schema/Table.js').TableConfig
}

/** Minimal interface for a Form schema element. */
interface FormElement extends SchemaElementLike {
  getId(): string
  getSubmitHandler?(): ((data: Record<string, unknown>, ctx: PanelContext) => Promise<void | Record<string, unknown>>) | undefined
}

/** Minimal interface for a Dialog schema element. */
interface DialogElement extends SchemaElementLike {
  getItems(): unknown[]
  toMeta(): DialogElementMeta
}

/** Minimal interface for a Widget schema element. */
interface WidgetElement extends SchemaElementLike {
  getDataFn?(): ((ctx?: unknown, settings?: Record<string, unknown>) => Promise<unknown>) | undefined
  toMeta(): import('./Widget.js').WidgetMeta & { type: 'widget' }
}

/** Minimal interface for a Resource class (static shape). */
interface ResourceLike {
  new(): { fields(): FieldOrGrouping[] }
  model?: ModelLike
  defaultSort?: string
  defaultSortDir?: 'ASC' | 'DESC'
  getSlug?(): string
}

/** Minimal interface for a Model class (static shape). */
interface ModelLike {
  query(): QueryBuilderLike<RecordRow>
}

/** Minimal interface for @boostkit/core `app()` factory. */
interface AppLike {
  make(key: string): unknown
}

// ─── Schema resolver ───────────────────────────────────────

export async function resolveSchema(
  panel: Panel,
  ctx: PanelContext,
): Promise<PanelSchemaElementMeta[]> {
  const schemaDef = panel.getSchema()
  if (!schemaDef) return []

  const elements: SchemaElementLike[] = typeof schemaDef === 'function'
    ? await (schemaDef as (ctx: PanelContext) => Promise<SchemaElementLike[]>)(ctx)
    : schemaDef as SchemaElementLike[]

  const result: PanelSchemaElementMeta[] = []

  for (const el of elements) {
    const type = (el as SchemaElementLike).getType?.() as string | undefined
    if (!type) continue

    // Schema-level Section — resolve elements recursively
    if (type === 'section') {
      const section = el as Section
      if (typeof section.hasFields === 'function' && !section.hasFields() && section.getItems().length > 0) {
        // Schema element section — resolve items recursively
        const items = section.getItems()
        const sectionPanel = Object.create(panel, {
          getSchema: { value: () => items },
        }) as Panel
        const resolved = await resolveSchema(sectionPanel, ctx)
        const meta = section.toMeta()
        meta.elements = resolved
        result.push(meta as unknown as PanelSchemaElementMeta)
        continue
      }
      // Field section — pass through toMeta()
      result.push(section.toMeta() as unknown as PanelSchemaElementMeta)
      continue
    }

    // Schema-level Tabs — resolve each tab's elements recursively
    if (type === 'tabs') {
      const tabs = el as Tabs

      // Register for lazy/poll/on-demand API endpoint
      const tabsId = tabs.getId() ?? 'tabs'
      TabsRegistry.register(panel.getName(), tabsId, tabs)

      // ── Model-backed tabs ──
      if (tabs.isModelBacked()) {
        const Model = tabs.getModel()
        if (!Model) { continue }

        let resolvedTabs: TabMeta[] = []
        let modelActiveTabIndex = 0

        if (!tabs.isLazy()) {
          // Query model records
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let q: any = Model.query()
          const scopeFn = tabs.getScope()
          if (scopeFn) q = scopeFn(q)

          let records: Record<string, unknown>[] = []
          try { records = await q.get() } catch { /* empty */ }

          const titleField = tabs.getTitleField()
          const contentFn = tabs.getContentFn()

          // Determine active tab index based on persist mode
          const persistMode = tabs.getPersist()
          modelActiveTabIndex = await resolveActiveTabIndex(persistMode, tabs.getId(), records.map(r => String(r[titleField] ?? r['id'] ?? 'Untitled')), ctx)

          for (let i = 0; i < records.length; i++) {
            const record = records[i]!
            const label = String(record[titleField] ?? record['id'] ?? 'Untitled')
            const tabId = String(record['id'] ?? i)

            if (contentFn) {
              const items = contentFn(record)
              const tabPanel = Object.create(panel, {
                getSchema: { value: () => items },
              }) as Panel
              const resolved = await resolveSchema(tabPanel, ctx)
              resolvedTabs.push({ label, fields: [], elements: resolved, id: tabId } as TabMeta)
            } else {
              resolvedTabs.push({ label, fields: [], id: tabId } as TabMeta)
            }
          }
        }
        // else: lazy — resolvedTabs stays empty, client fetches later

        const tabsId = tabs.getId()
        const meta: TabsMeta = {
          type: 'tabs',
          ...(tabsId && { id: tabsId }),
          tabs: resolvedTabs,
        }
        if (tabs.isModelBacked()) meta.modelBacked = true
        if (tabs.isCreatable()) meta.creatable = true
        if (tabs.isEditable()) meta.editable = true
        if (tabs.isLazy()) meta.lazy = true
        if (tabs.getPollInterval() !== undefined) meta.pollInterval = tabs.getPollInterval()!
        const modelPersist = tabs.getPersist()
        if (modelPersist !== false) meta.persist = modelPersist
        if (modelActiveTabIndex > 0) meta.activeTab = modelActiveTabIndex

        result.push(meta as unknown as PanelSchemaElementMeta)
        continue
      }

      // ── Static tabs ──
      const rawTabs = tabs.getTabs()
      const hasSchemaElements = rawTabs.some((t) => !t.hasFields())

      if (hasSchemaElements) {
        const resolvedTabs: TabMeta[] = []

        // Determine active tab index based on persist mode
        const persistMode = tabs.getPersist()
        const tabLabels = rawTabs.map(t => t.getLabel())
        const activeTabIndex = await resolveActiveTabIndex(persistMode, tabs.getId(), tabLabels, ctx)

        for (let i = 0; i < rawTabs.length; i++) {
          const tab = rawTabs[i]!
          const tabMeta = tab.toMeta()

          // Resolve badge value
          const badge = await tab.resolveBadge()
          if (badge !== undefined) tabMeta.badge = badge

          if (tab.hasFields()) {
            // Field tab — always include (lightweight)
            resolvedTabs.push(tabMeta)
          } else if (!tab.isLazy()) {
            // Schema tab — resolve content for SSR (lazy tabs get empty elements)
            const items = tab.getItems()
            const tabPanel = Object.create(panel, {
              getSchema: { value: () => items },
            }) as Panel
            const resolved = await resolveSchema(tabPanel, ctx)
            tabMeta.elements = resolved
            resolvedTabs.push(tabMeta)
          } else {
            // Lazy tab — label/icon/badge only, content loaded on demand
            resolvedTabs.push(tabMeta)
          }
        }

        const staticTabsId = tabs.getId()
        const meta: TabsMeta = {
          type: 'tabs',
          ...(staticTabsId && { id: staticTabsId }),
          tabs: resolvedTabs,
        }
        if (tabs.isCreatable()) meta.creatable = true
        if (tabs.isEditable()) meta.editable = true
        const staticPersist = tabs.getPersist()
        if (staticPersist !== false) meta.persist = staticPersist
        if (activeTabIndex > 0) meta.activeTab = activeTabIndex
        result.push(meta as unknown as PanelSchemaElementMeta)
      } else {
        // All-field tabs — resolve badges and pass through
        const allFieldMeta = tabs.toMeta()
        for (let i = 0; i < rawTabs.length; i++) {
          const tab = rawTabs[i]!
          const badge = await tab.resolveBadge()
          if (badge !== undefined && allFieldMeta.tabs[i]) allFieldMeta.tabs[i]!.badge = badge
        }
        result.push(allFieldMeta as unknown as PanelSchemaElementMeta)
      }
      continue
    }

    // Table needs special resolution (query model, build columns)
    if (type === 'table') {
      const config = (el as ConfigurableElement).getConfig()

      // Register table for lazy/poll/paginated API endpoint
      const tableId = (el as unknown as { getId(): string }).getId()
      TableRegistry.register(panel.getName(), tableId, el as unknown as import('./schema/Table.js').Table)

      // ── fromResource(Class) — preferred resource-linked mode ───
      if (config.resourceClass) {
        const ResourceClass = config.resourceClass as ResourceLike
        const Model = ResourceClass.model as ModelLike | undefined
        if (!Model) continue

        let records: RecordRow[] = []

        // Skip query for lazy tables — data will be fetched client-side
        if (!config.lazy) {
          let q: QueryBuilderLike<RecordRow> = Model.query()
          if (config.scope) q = config.scope(q)
          const sortCol = config.sortBy ?? ResourceClass.defaultSort
          if (sortCol) {
            const dir = config.sortBy ? config.sortDir : (ResourceClass.defaultSortDir ?? 'DESC')
            q = q.orderBy(sortCol, dir)
          }
          const queryLimit = config.paginationType ? config.perPage : config.limit
          q = q.limit(queryLimit)

          try { records = await q.get() } catch { /* empty model */ }
        }

        const columns = resolveColumns(config.columns, ResourceClass)
        const pagination = await resolvePagination(config, Model, records.length)
        const slug = ResourceClass.getSlug?.() as string | undefined

        result.push(buildTableMeta(config, columns, records, tableId, {
          resource: slug ?? '',
          href: slug ? `${panel.getPath()}/${slug}` : '',
          pagination,
        }))
        continue
      }

      // ── fromModel(Class) — model-backed, no resource ────────────
      if (config.model) {
        const Model = config.model as ModelLike

        let records: RecordRow[] = []

        // Skip query for lazy tables — data will be fetched client-side
        if (!config.lazy) {
          let q: QueryBuilderLike<RecordRow> = Model.query()
          if (config.scope) q = config.scope(q)
          if (config.sortBy) q = q.orderBy(config.sortBy, config.sortDir)
          const modelLimit = config.paginationType ? config.perPage : config.limit
          q = q.limit(modelLimit)

          try { records = await q.get() } catch { /* empty model */ }
        }

        const columns = resolveColumns(config.columns)
        const pagination = await resolvePagination(config, Model, records.length)

        result.push(buildTableMeta(config, columns, records, tableId, {
          reorderEndpoint: config.reorderable ? `${panel.getApiBase()}/_tables/reorder` : undefined,
          pagination,
        }))
        continue
      }

      // ── .rows([...]) — static data, no model ─────────────────
      if (config.rows) {
        const columns = resolveColumns(config.columns)

        // Lazy tables skip data — empty records array
        const staticRecords = config.lazy ? [] : config.rows

        // Pagination for static rows — slice the array
        const records = config.paginationType
          ? staticRecords.slice(0, config.perPage)
          : staticRecords

        const pagination = config.paginationType && !config.lazy
          ? { total: config.rows.length, currentPage: 1, perPage: config.perPage, lastPage: Math.ceil(config.rows.length / config.perPage), type: config.paginationType } as TableElementMeta['pagination']
          : undefined

        result.push(buildTableMeta(config, columns, records as RecordRow[], tableId, { pagination }))
        continue
      }

      continue
    }

    // Dashboard elements — resolve widget data + user layout for SSR
    if (type === 'dashboard') {
      const dashboard = el as Dashboard
      // We extend DashboardMeta with optional SSR-only fields (savedLayout, savedTabLayouts)
      // that are added at runtime and sent to the client as part of the serialized meta.
      const meta = dashboard.toMeta() as import('./Dashboard.js').DashboardMeta & {
        savedLayout?: unknown[]
        savedTabLayouts?: Record<string, unknown[]>
        widgets: WidgetMetaWithData[]
        tabs?: (import('./Dashboard.js').DashboardTabMeta & { widgets: WidgetMetaWithData[] })[]
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

      result.push(meta as unknown as PanelSchemaElementMeta)
      continue
    }

    // Dialog — resolve inner elements recursively
    if (type === 'dialog') {
      const dialog = el as DialogElement
      const items  = dialog.getItems()
      const dialogPanel = Object.create(panel, {
        getSchema: { value: () => items },
      }) as Panel
      const resolved = await resolveSchema(dialogPanel, ctx)
      const meta = dialog.toMeta()
      meta.elements = resolved
      result.push(meta as unknown as PanelSchemaElementMeta)
      continue
    }

    // Standalone Form — register submit handler, hooks, resolve initial data
    if (type === 'form') {
      const form = el as FormElement
      const handler = form.getSubmitHandler?.()
      if (handler) {
        FormRegistry.register(panel.getName(), form.getId(), handler)
      }

      // Register lifecycle hooks
      const beforeSubmit = (form as unknown as { getBeforeSubmit?(): unknown }).getBeforeSubmit?.() as
        ((data: Record<string, unknown>, ctx: PanelContext) => Promise<Record<string, unknown>>) | undefined
      const afterSubmit = (form as unknown as { getAfterSubmit?(): unknown }).getAfterSubmit?.() as
        ((result: Record<string, unknown>, ctx: PanelContext) => Promise<void>) | undefined
      if (beforeSubmit || afterSubmit) {
        FormRegistry.registerHooks(panel.getName(), form.getId(), {
          beforeSubmit,
          afterSubmit,
        })
      }

      const formMeta = form.toMeta() as FormElementMeta & { initialValues?: Record<string, unknown> }

      // Resolve initial values if data function provided
      const dataFn = (form as unknown as { getDataFn?(): ((ctx: PanelContext) => Promise<Record<string, unknown>>) | undefined }).getDataFn?.()
      if (dataFn) {
        try {
          formMeta.initialValues = await dataFn(ctx)
        } catch (e) { debugWarn('form.data', e) }
      }

      result.push(formMeta as PanelSchemaElementMeta)
      continue
    }

    // Standalone widget — resolve data for SSR (skip lazy widgets)
    if (type === 'widget') {
      const widget = el as WidgetElement
      // Extend WidgetMeta with the runtime-populated `data` field (SSR-only, not in static type)
      const meta = widget.toMeta() as import('./Widget.js').WidgetMeta & { type: 'widget'; data?: unknown }

      if (!meta.lazy) {
        const dataFn = widget.getDataFn?.()
        if (dataFn) {
          try {
            meta.data = await dataFn({ user: ctx.user })
          } catch (e) {
            debugWarn('widget.data', e)
            meta.data = null
          }
        }
      }

      result.push(meta as unknown as PanelSchemaElementMeta)
      continue
    }

    // Stats — resolve async data, handle lazy/poll
    if (type === 'stats') {
      const stats = el as unknown as import('./schema/Stats.js').Stats
      const dataFn = stats.getDataFn?.()
      const meta = stats.toMeta() as StatsElementMeta & { stats: PanelStatMeta[] }

      // Register for lazy/poll API endpoint
      if (dataFn || stats.isLazy?.() || stats.getPollInterval?.()) {
        StatsRegistry.register(panel.getName(), stats.getId(), stats)
      }

      // Resolve async data (skip for lazy — client fetches after mount)
      if (dataFn && !stats.isLazy?.()) {
        try {
          meta.stats = await dataFn(ctx)
        } catch (e) { debugWarn('stats.data', e) }
      } else if (stats.isLazy?.()) {
        meta.stats = []
      }

      result.push(meta as unknown as PanelSchemaElementMeta)
      continue
    }

    // Chart — resolve async data, handle lazy/poll
    if (type === 'chart') {
      const chart = el as unknown as { getDataFn?(): ((ctx: PanelContext) => Promise<unknown>) | undefined; isLazy?(): boolean; getPollInterval?(): number | undefined; getId?(): string; toMeta(): ChartElementMeta }
      const dataFn = chart.getDataFn?.()
      const meta = chart.toMeta() as ChartElementMeta & { data?: unknown }

      if (dataFn && !chart.isLazy?.()) {
        try {
          const resolved = await dataFn(ctx) as { labels?: string[]; datasets?: unknown[] }
          if (resolved) {
            if (Array.isArray(resolved.labels)) meta.labels = resolved.labels
            if (Array.isArray(resolved.datasets)) meta.datasets = resolved.datasets as ChartElementMeta['datasets']
          }
        } catch (e) { debugWarn('chart.data', e) }
      } else if (chart.isLazy?.()) {
        meta.labels = []
        meta.datasets = []
      }

      result.push(meta as unknown as PanelSchemaElementMeta)
      continue
    }

    // List — resolve async data, handle lazy/poll
    if (type === 'list') {
      const list = el as unknown as { getDataFn?(): ((ctx: PanelContext) => Promise<unknown>) | undefined; isLazy?(): boolean; getPollInterval?(): number | undefined; getId?(): string; toMeta(): ListElementMeta }
      const dataFn = list.getDataFn?.()
      const meta = list.toMeta() as ListElementMeta & { data?: unknown }

      if (dataFn && !list.isLazy?.()) {
        try {
          const resolved = await dataFn(ctx)
          if (Array.isArray(resolved)) meta.items = resolved
          else if (resolved && typeof resolved === 'object' && 'items' in resolved) meta.items = (resolved as { items: unknown[] }).items as ListElementMeta['items']
        } catch (e) { debugWarn('list.data', e) }
      } else if (list.isLazy?.()) {
        meta.items = []
      }

      result.push(meta as unknown as PanelSchemaElementMeta)
      continue
    }

    // All other element types (text, heading, etc.)
    // — pass through their toMeta() directly
    if (typeof (el as SchemaElementLike).toMeta === 'function') {
      result.push((el as SchemaElementLike).toMeta() as unknown as PanelSchemaElementMeta)
    }
  }

  return result
}

// ─── Dashboard widget data resolver ────────────────────────

type WidgetMetaWithData = import('./Widget.js').WidgetMeta & { type: 'widget'; data?: unknown }

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

// ─── Helpers ───────────────────────────────────────────────

/** Type guard: true when item is a Field (has both getType and getName). */
function isField(item: FieldOrGrouping): item is Field {
  return typeof (item as unknown as Record<string, unknown>)['getName'] === 'function'
}

function flattenFields(items: FieldOrGrouping[]): FieldOrGrouping[] {
  const result: FieldOrGrouping[] = []
  for (const item of items) {
    if (typeof (item as unknown as Record<string, unknown>)['getFields'] === 'function') {
      result.push(...flattenFields((item as unknown as { getFields(): FieldOrGrouping[] }).getFields()))
    } else {
      result.push(item)
    }
  }
  return result
}

function titleCase(str: string): string {
  return str.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()).trim()
}

/** Slugify a label for use as URL/storage key. */
function slugifyLabel(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/**
 * Resolve the SSR active tab index based on persist mode.
 * For 'url' mode reads from ctx.urlSearch, for 'session' mode reads from server session.
 * Returns 0 (first tab) for 'localStorage', false, or when lookup fails.
 */
async function resolveActiveTabIndex(
  persistMode: TabsPersistMode,
  tabsId: string | undefined,
  tabLabels: string[],
  ctx: PanelContext,
): Promise<number> {
  if (persistMode === 'url' && tabsId) {
    const urlSearch = ctx.urlSearch
    if (urlSearch) {
      const activeSlug = urlSearch[tabsId]
      if (activeSlug) {
        const idx = tabLabels.findIndex(label => slugifyLabel(label) === activeSlug)
        if (idx >= 0) return idx
      }
    }
  } else if (persistMode === 'session' && tabsId) {
    // Use sessionGet from PanelContext (provided by +data.ts during Vike SSR)
    const sessionGet = ctx.sessionGet
    if (sessionGet) {
      try {
        const stored = sessionGet(`tabs:${tabsId}`)
        if (typeof stored === 'number') return stored
        if (typeof stored === 'string') {
          const idx = tabLabels.findIndex(label => slugifyLabel(label) === stored)
          if (idx >= 0) return idx
        }
      } catch { /* session not available */ }
    }
  }
  return 0
}

/** Resolve Column[] or string[] into PanelColumnMeta[]. Optionally uses Resource fields for labels. */
function resolveColumns(
  columns: import('./schema/Table.js').TableConfig['columns'],
  resourceClass?: ResourceLike,
): import('./schema/Table.js').PanelColumnMeta[] {
  const isColumnInstances = columns.length > 0 && typeof (columns[0] as { toMeta?: unknown })?.toMeta === 'function'

  if (isColumnInstances) {
    return (columns as Column[]).map(col => col.toMeta() as import('./schema/Table.js').PanelColumnMeta)
  }

  if (resourceClass) {
    const resource = new resourceClass()
    const flatFields2 = flattenFields(resource.fields())
    const names: string[] = columns.length > 0
      ? columns as string[]
      : flatFields2.filter((f): f is Field => isField(f) && !f.isHiddenFrom('table') && f.getType() !== 'hasMany').map(f => (f as Field).getName()).slice(0, 5)
    return names.map(name => {
      const field = flatFields2.find((f): f is Field => isField(f) && (f as Field).getName() === name)
      return { name, label: field ? field.getLabel() : titleCase(name) }
    })
  }

  return (columns as string[]).map(name => ({ name, label: titleCase(name) }))
}

/** Build pagination meta for a table. */
async function resolvePagination(
  config: import('./schema/Table.js').TableConfig,
  model: ModelLike | undefined,
  recordCount: number,
): Promise<TableElementMeta['pagination']> {
  if (!config.paginationType || config.lazy) return undefined

  let total = recordCount
  if (model) {
    try {
      const countQ = config.scope ? config.scope(model.query()) : model.query()
      total = await (countQ as QueryBuilderLike<RecordRow> & { count(): Promise<number> }).count()
    } catch { /* fallback to recordCount */ }
  }

  return {
    total,
    currentPage: 1,
    perPage:     config.perPage,
    lastPage:    Math.ceil(total / config.perPage),
    type:        config.paginationType,
  }
}

/** Assemble the final TableElementMeta from config + resolved data. */
function buildTableMeta(
  config: import('./schema/Table.js').TableConfig,
  columns: import('./schema/Table.js').PanelColumnMeta[],
  records: RecordRow[],
  tableId: string,
  opts: {
    resource?: string | undefined
    href?: string | undefined
    reorderEndpoint?: string | undefined
    pagination?: TableElementMeta['pagination']
  },
): TableElementMeta {
  const meta: TableElementMeta = {
    type:     'table',
    title:    config.title,
    resource: opts.resource ?? '',
    columns,
    records,
    href:     config.href ?? opts.href ?? '',
    id:       tableId,
  }
  if (config.description)  meta.description  = config.description
  if (config.emptyMessage) meta.emptyMessage = config.emptyMessage
  if (config.reorderable && opts.reorderEndpoint) {
    meta.reorderable     = true
    meta.reorderEndpoint = opts.reorderEndpoint
  }
  if (config.searchable)          { meta.searchable = true; meta.searchColumns = config.searchColumns }
  if (config.filters.length > 0) meta.filters = config.filters.map(f => f.toMeta())
  if (config.actions.length > 0) meta.actions = config.actions.map(a => a.toMeta())
  if (config.lazy)                meta.lazy         = true
  if (config.pollInterval)        meta.pollInterval = config.pollInterval
  if (opts.pagination)            meta.pagination   = opts.pagination
  if (config.remember)            meta.remember     = config.remember
  return meta
}
