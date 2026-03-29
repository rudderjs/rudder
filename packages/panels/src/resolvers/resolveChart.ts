import type { PanelContext, SchemaElementLike } from '../types.js'
import type { ChartElementMeta } from '../schema/index.js'
import type { PanelSchemaElementMeta } from '../resolveSchema.js'
import type { LazyDataElement } from './types.js'
import { resolveDataFn } from './utils.js'

export async function resolveChart(
  el: SchemaElementLike,
  ctx: PanelContext,
): Promise<PanelSchemaElementMeta> {
  const chart = el as unknown as LazyDataElement<ChartElementMeta>
  const meta = chart.toMeta() as ChartElementMeta & { data?: unknown }

  const resolved = await resolveDataFn(ctx, {
    dataFn: chart.getDataFn?.() as ((ctx: PanelContext) => Promise<{ labels?: string[]; datasets?: unknown[] }>) | undefined,
    isLazy: chart.isLazy?.() ?? false,
    debugLabel: 'chart.data',
  })

  if (resolved) {
    if (Array.isArray(resolved.labels)) meta.labels = resolved.labels
    if (Array.isArray(resolved.datasets)) meta.datasets = resolved.datasets as ChartElementMeta['datasets']
  } else if (chart.isLazy?.()) {
    meta.labels = []
    meta.datasets = []
  }

  return meta as unknown as PanelSchemaElementMeta
}
