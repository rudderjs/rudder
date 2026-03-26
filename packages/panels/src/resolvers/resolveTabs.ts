import type { Panel } from '../Panel.js'
import type { PanelContext, SchemaElementLike } from '../types.js'
import type { Tabs } from '../schema/Tabs.js'
import type { TabMeta, TabsMeta } from '../schema/Tabs.js'
import type { PanelSchemaElementMeta } from '../resolveSchema.js'
import type { ResolveSchemaFn, ModelLike } from './types.js'
import { TabsRegistry } from '../registries/TabsRegistry.js'
import { resolveDataSource } from '../datasource.js'
import { resolveActiveTabIndex } from './helpers.js'

export async function resolveTabs(
  el: SchemaElementLike,
  panel: Panel,
  ctx: PanelContext,
  resolveSchema: ResolveSchemaFn,
): Promise<PanelSchemaElementMeta> {
  const tabs = el as Tabs

  // Register for lazy/poll/on-demand API endpoint
  const tabsId = tabs.getId() ?? 'tabs'
  TabsRegistry.register(panel.getName(), tabsId, tabs)

  // ── Model-backed tabs ──
  if (tabs.isModelBacked()) {
    const Model = tabs.getModel()
    if (!Model) { return null as unknown as PanelSchemaElementMeta }

    let resolvedTabs: TabMeta[] = []
    let modelActiveTabIndex = 0

    if (!tabs.isLazy()) {
      // Query model records
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = (Model as ModelLike).query()
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
          resolvedTabs.push({ label, elements: resolved, id: tabId } as TabMeta)
        } else {
          resolvedTabs.push({ label, id: tabId } as TabMeta)
        }
      }
    }
    // else: lazy — resolvedTabs stays empty, client fetches later

    const modelTabsId = tabs.getId()
    const meta: TabsMeta = {
      type: 'tabs',
      ...(modelTabsId && { id: modelTabsId }),
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

    return meta as unknown as PanelSchemaElementMeta
  }

  // ── Array-backed tabs (fromArray) ──
  if (tabs.isArrayBacked()) {
    const dataSource = tabs.getDataSource()!
    let resolvedTabs: TabMeta[] = []
    let arrayActiveTabIndex = 0

    if (!tabs.isLazy()) {
      let records: Record<string, unknown>[] = []
      try { records = await resolveDataSource(dataSource, ctx) } catch { /* empty */ }

      const titleField = tabs.getTitleField()
      const contentFn = tabs.getContentFn()

      const persistMode = tabs.getPersist()
      arrayActiveTabIndex = await resolveActiveTabIndex(persistMode, tabs.getId(), records.map(r => String(r[titleField] ?? r['id'] ?? 'Untitled')), ctx)

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
          resolvedTabs.push({ label, elements: resolved, id: tabId } as TabMeta)
        } else {
          resolvedTabs.push({ label, id: tabId } as TabMeta)
        }
      }
    }

    const arrayTabsId = tabs.getId()
    const meta: TabsMeta = {
      type: 'tabs',
      ...(arrayTabsId && { id: arrayTabsId }),
      tabs: resolvedTabs,
    }
    if (tabs.isCreatable()) meta.creatable = true
    if (tabs.isEditable()) meta.editable = true
    if (tabs.isLazy()) meta.lazy = true
    if (tabs.getPollInterval() !== undefined) meta.pollInterval = tabs.getPollInterval()!
    const arrayPersist = tabs.getPersist()
    if (arrayPersist !== false) meta.persist = arrayPersist
    if (arrayActiveTabIndex > 0) meta.activeTab = arrayActiveTabIndex

    return meta as unknown as PanelSchemaElementMeta
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
    return meta as unknown as PanelSchemaElementMeta
  } else {
    // All-field tabs — resolve badges and pass through
    const allFieldMeta = tabs.toMeta()
    for (let i = 0; i < rawTabs.length; i++) {
      const tab = rawTabs[i]!
      const badge = await tab.resolveBadge()
      if (badge !== undefined && allFieldMeta.tabs[i]) allFieldMeta.tabs[i]!.badge = badge
    }
    return allFieldMeta as unknown as PanelSchemaElementMeta
  }
}
