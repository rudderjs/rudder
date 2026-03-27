import type { Panel } from '../Panel.js'
import type { PanelContext, SchemaElementLike } from '../types.js'
import type { PanelSchemaElementMeta } from '../resolveSchema.js'
import type { ConfigurableElement, ResourceLike } from './types.js'
import { TableRegistry } from '../registries/TableRegistry.js'
import { resolveColumns, buildTableMeta, resolveSearchColumns } from './helpers.js'
import { resolveListQuery } from './resolveListQuery.js'

/**
 * Resolve a Table2 element to its SSR meta.
 * Uses resolveListQuery() for shared data pipeline, then adds table-specific
 * column resolution and transforms.
 *
 * Table2 uses .scopes() (from List) instead of .tabs() for filtered views.
 */
export async function resolveTable2(
  el: SchemaElementLike,
  panel: Panel,
  ctx: PanelContext,
): Promise<PanelSchemaElementMeta | null> {
  const config = (el as ConfigurableElement).getConfig() as unknown as import('../schema/Table2.js').Table2Config
  const table = el as unknown as import('../schema/Table2.js').Table2

  // Register for lazy/poll/paginated API endpoint
  const tableId = table.getId()
  TableRegistry.register(panel.getName(), tableId, el as unknown as import('../schema/Table.js').Table)

  // ── Resolve search columns from Column definitions ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const searchColumns = resolveSearchColumns(config as any)

  // ── Shared query pipeline ──
  const model = config.resourceClass
    ? (config.resourceClass as ResourceLike).model
    : config.model
  const result = await resolveListQuery(config, ctx, { elementId: tableId, searchColumns, model })

  // ── Table-specific: resolve columns ──
  const columns = resolveColumns(config.columns, config.resourceClass)

  // ── Table-specific: build meta with column transforms ──
  const slug = config.resourceClass?.getSlug?.() as string | undefined

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return buildTableMeta(config as any, columns, result.records, tableId, {
    resource:        slug ?? '',
    href:            slug ? `${panel.getPath()}/${slug}` : config.href ?? '',
    reorderEndpoint: config.reorderable ? `${panel.getApiBase()}/_tables/reorder` : undefined,
    pagination:      result.pagination,
    activeSearch:    result.activeSearch,
    activeSort:      result.activeSort,
    activeFilters:   result.activeFilters,
  })
}
