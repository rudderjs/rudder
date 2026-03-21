import type { PanelContext, SchemaElementLike } from '../types.js'
import type { PanelSchemaElementMeta } from '../resolveSchema.js'
import type { WidgetElement } from './types.js'
import { debugWarn } from '../debug.js'

export async function resolveWidget(
  el: SchemaElementLike,
  ctx: PanelContext,
): Promise<PanelSchemaElementMeta> {
  const widget = el as WidgetElement
  // Extend WidgetMeta with the runtime-populated `data` field (SSR-only, not in static type)
  const meta = widget.toMeta() as import('../schema/Widget.js').WidgetMeta & { type: 'widget'; data?: unknown }

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

  return meta as unknown as PanelSchemaElementMeta
}
