import type { Panel } from '../Panel.js'
import type { PanelContext, SchemaElementLike } from '../types.js'
import type { Tabs } from '../schema/Tabs.js'
import type { TabMeta, TabsMeta } from '../schema/Tabs.js'
import type { PanelSchemaElementMeta } from '../resolveSchema.js'
import type { ResolveSchemaFn, ModelLike } from './types.js'
import { TabsRegistry } from '../registries/TabsRegistry.js'
import { resolveDataSource } from '../datasource.js'
import { resolveActiveTabIndex } from './helpers.js'
import { resolveChildSchema, applyLazyMeta } from './utils.js'

/**
 * Build TabMeta[] from records — shared by model-backed and array-backed tabs.
 */
async function buildTabsFromRecords(
  records: Record<string, unknown>[],
  tabs: Tabs,
  panel: Panel,
  ctx: PanelContext,
  resolveSchema: ResolveSchemaFn,
): Promise<TabMeta[]> {
  const titleField = tabs.getTitleField()
  const contentFn = tabs.getContentFn()
  const result: TabMeta[] = []

  for (let i = 0; i < records.length; i++) {
    const record = records[i]!
    const label = String(record[titleField] ?? record['id'] ?? 'Untitled')
    const tabId = String(record['id'] ?? i)

    if (contentFn) {
      const elements = await resolveChildSchema(panel, ctx, contentFn(record), resolveSchema)
      result.push({ label, elements, id: tabId } as TabMeta)
    } else {
      result.push({ label, id: tabId } as TabMeta)
    }
  }
  return result
}

/**
 * Build the shared TabsMeta base object with common flags.
 */
function buildTabsMeta(
  tabs: Tabs,
  resolvedTabs: TabMeta[],
  activeTabIndex: number,
): TabsMeta {
  const tabsId = tabs.getId()
  const meta: TabsMeta = {
    type: 'tabs',
    ...(tabsId && { id: tabsId }),
    tabs: resolvedTabs,
  }
  if (tabs.isCreatable()) meta.creatable = true
  if (tabs.isEditable()) meta.editable = true
  applyLazyMeta(meta as unknown as Record<string, unknown>, tabs)
  const persist = tabs.getPersist()
  if (persist !== false) meta.persist = persist
  if (activeTabIndex > 0) meta.activeTab = activeTabIndex
  return meta
}

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
    let activeTabIndex = 0

    if (!tabs.isLazy()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = (Model as ModelLike).query()
      const scopeFn = tabs.getScope()
      if (scopeFn) q = scopeFn(q)

      let records: Record<string, unknown>[] = []
      try { records = await q.get() } catch { /* empty */ }

      const titleField = tabs.getTitleField()
      const persistMode = tabs.getPersist()
      activeTabIndex = await resolveActiveTabIndex(persistMode, tabs.getId(), records.map(r => String(r[titleField] ?? r['id'] ?? 'Untitled')), ctx)

      resolvedTabs = await buildTabsFromRecords(records, tabs, panel, ctx, resolveSchema)
    }

    const meta = buildTabsMeta(tabs, resolvedTabs, activeTabIndex)
    if (tabs.isModelBacked()) meta.modelBacked = true
    return meta as unknown as PanelSchemaElementMeta
  }

  // ── Array-backed tabs (fromArray) ──
  if (tabs.isArrayBacked()) {
    const dataSource = tabs.getDataSource()!
    let resolvedTabs: TabMeta[] = []
    let activeTabIndex = 0

    if (!tabs.isLazy()) {
      let records: Record<string, unknown>[] = []
      try { records = await resolveDataSource(dataSource, ctx) } catch { /* empty */ }

      const titleField = tabs.getTitleField()
      const persistMode = tabs.getPersist()
      activeTabIndex = await resolveActiveTabIndex(persistMode, tabs.getId(), records.map(r => String(r[titleField] ?? r['id'] ?? 'Untitled')), ctx)

      resolvedTabs = await buildTabsFromRecords(records, tabs, panel, ctx, resolveSchema)
    }

    return buildTabsMeta(tabs, resolvedTabs, activeTabIndex) as unknown as PanelSchemaElementMeta
  }

  // ── Static tabs ──
  const rawTabs = tabs.getTabs()
  const hasSchemaElements = rawTabs.some((t) => !t.hasFields())

  if (hasSchemaElements) {
    const resolvedTabs: TabMeta[] = []

    const persistMode = tabs.getPersist()
    const tabLabels = rawTabs.map(t => t.getLabel())
    const activeTabIndex = await resolveActiveTabIndex(persistMode, tabs.getId(), tabLabels, ctx)

    for (let i = 0; i < rawTabs.length; i++) {
      const tab = rawTabs[i]!
      const tabMeta = tab.toMeta()

      const badge = await tab.resolveBadge()
      if (badge !== undefined) tabMeta.badge = badge

      if (tab.hasFields()) {
        resolvedTabs.push(tabMeta)
      } else if (!tab.isLazy()) {
        tabMeta.elements = await resolveChildSchema(panel, ctx, tab.getItems(), resolveSchema)
        resolvedTabs.push(tabMeta)
      } else {
        resolvedTabs.push(tabMeta)
      }
    }

    return buildTabsMeta(tabs, resolvedTabs, activeTabIndex) as unknown as PanelSchemaElementMeta
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
