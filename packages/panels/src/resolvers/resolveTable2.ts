import type { Panel } from '../Panel.js'
import type { PanelContext, SchemaElementLike } from '../types.js'
import type { PanelSchemaElementMeta } from '../resolveSchema.js'
import type { PersistMode } from '../persist.js'
import type { ConfigurableElement, ResourceLike } from './types.js'
import { TableRegistry } from '../registries/TableRegistry.js'
import { resolveColumns, buildTableMeta, resolveSearchColumns, resolveActiveTabIndex } from './helpers.js'
import { resolveListQuery } from './resolveListQuery.js'

/**
 * Resolve a Table2 element to its SSR meta.
 * Uses resolveListQuery() for shared data pipeline, then adds table-specific
 * column resolution and transforms.
 */
export async function resolveTable2(
  el: SchemaElementLike,
  panel: Panel,
  ctx: PanelContext,
): Promise<PanelSchemaElementMeta | null> {
  const config = (el as ConfigurableElement).getConfig() as import('../schema/Table2.js').Table2Config
  const table = el as unknown as import('../schema/Table2.js').Table2

  // ── Table with .tabs() — resolve each tab's scoped table ──
  if (config.tabs?.length > 0) {
    return resolveTable2Tabs(table, config, panel, ctx)
  }

  // Register for lazy/poll/paginated API endpoint
  const tableId = table.getId()
  TableRegistry.register(panel.getName(), tableId, el as unknown as import('../schema/Table.js').Table)

  // ── Resolve search columns from Column definitions ──
  const searchColumns = resolveSearchColumns(config)

  // ── Shared query pipeline ──
  const model = config.resourceClass
    ? (config.resourceClass as ResourceLike).model
    : config.model
  const result = await resolveListQuery(config, ctx, { elementId: tableId, searchColumns, model })

  // ── Table-specific: resolve columns ──
  const columns = resolveColumns(config.columns, config.resourceClass)

  // ── Table-specific: build meta with column transforms ──
  const slug = config.resourceClass?.getSlug?.() as string | undefined

  return buildTableMeta(config, columns, result.records, tableId, {
    resource:        slug ?? '',
    href:            slug ? `${panel.getPath()}/${slug}` : config.href ?? '',
    reorderEndpoint: config.reorderable ? `${panel.getApiBase()}/_tables/reorder` : undefined,
    pagination:      result.pagination,
    activeSearch:    result.activeSearch,
    activeSort:      result.activeSort,
    activeFilters:   result.activeFilters,
  })
}

// ── Table tabs → Tabs meta ──────────────────────────────────

async function resolveTable2Tabs(
  table: import('../schema/Table2.js').Table2,
  config: import('../schema/Table2.js').Table2Config,
  panel: Panel,
  ctx: PanelContext,
): Promise<PanelSchemaElementMeta> {
  const tableId = table.getId()
  const tabsId = `${tableId}-tabs`
  const persistMode = (config.remember || 'session') as PersistMode

  const resolvedTabs: { label: string; icon?: string; elements: PanelSchemaElementMeta[] }[] = []

  for (const tab of config.tabs) {
    const tabName = tab.getLabel().toLowerCase().replace(/\s+/g, '-')
    const tabTableId = `${tableId}-${tabName}`
    const tabTable = table._cloneWithScope(tabTableId, tab.getScope())
    const resolved = await resolveTable2(tabTable as unknown as SchemaElementLike, panel, ctx)

    const tabMeta: { label: string; icon?: string; elements: PanelSchemaElementMeta[] } = {
      label: tab.getLabel(),
      elements: resolved ? [resolved] : [],
    }
    const icon = tab.getIcon()
    if (icon) tabMeta.icon = icon
    resolvedTabs.push(tabMeta)
  }

  const tabLabels = config.tabs.map((t: { getLabel(): string }) => t.getLabel())
  const activeTabIndex = await resolveActiveTabIndex(persistMode, tabsId, tabLabels, ctx)

  return {
    type: 'tabs',
    id: tabsId,
    tabs: resolvedTabs,
    persist: persistMode,
    ...(activeTabIndex > 0 ? { activeTab: activeTabIndex } : {}),
  } as unknown as PanelSchemaElementMeta
}
