import type { Panel } from '../Panel.js'
import type { PanelContext, SchemaElementLike } from '../types.js'
import type { StatsElementMeta, PanelStatMeta } from '../schema/index.js'
import type { PanelSchemaElementMeta } from '../resolveSchema.js'
import { StatsRegistry } from '../registries/StatsRegistry.js'
import { debugWarn } from '../debug.js'

export async function resolveStats(
  el: SchemaElementLike,
  panel: Panel,
  ctx: PanelContext,
): Promise<PanelSchemaElementMeta> {
  const stats = el as unknown as import('../schema/Stats.js').Stats
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

  return meta as unknown as PanelSchemaElementMeta
}
