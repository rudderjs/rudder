import type { PanelContext, SchemaElementLike } from '../types.js'
import type { ListElementMeta } from '../schema/index.js'
import type { PanelSchemaElementMeta } from '../resolveSchema.js'
import type { LazyDataElement } from './types.js'
import { resolveDataFn } from './utils.js'

export async function resolveList(
  el: SchemaElementLike,
  ctx: PanelContext,
): Promise<PanelSchemaElementMeta> {
  const list = el as unknown as LazyDataElement<ListElementMeta>
  const meta = list.toMeta() as ListElementMeta & { data?: unknown }

  const resolved = await resolveDataFn(ctx, {
    dataFn: list.getDataFn?.() as ((ctx: PanelContext) => Promise<unknown>) | undefined,
    isLazy: list.isLazy?.() ?? false,
    debugLabel: 'list.data',
  })

  if (resolved) {
    if (Array.isArray(resolved)) meta.items = resolved
    else if (resolved && typeof resolved === 'object' && 'items' in resolved) meta.items = (resolved as { items: unknown[] }).items as ListElementMeta['items']
  } else if (list.isLazy?.()) {
    meta.items = []
  }

  return meta as unknown as PanelSchemaElementMeta
}
