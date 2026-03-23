import type { Panel } from '../Panel.js'
import type { PanelContext, SchemaElementLike } from '../types.js'
import type { PanelSchemaElementMeta } from '../resolveSchema.js'
import type { WidgetElement, ResolveSchemaFn } from './types.js'
import { debugWarn } from '../debug.js'

export async function resolveWidget(
  el: SchemaElementLike,
  panel: Panel,
  ctx: PanelContext,
  resolveSchemaFn: ResolveSchemaFn,
): Promise<PanelSchemaElementMeta> {
  const widget = el as WidgetElement
  const meta = widget.toMeta() as import('../schema/Widget.js').WidgetMeta & {
    type: 'widget'
    schema?: PanelSchemaElementMeta[]
  }

  if (!meta.lazy) {
    const schemaFn = widget.getSchemaFn?.()
    if (schemaFn) {
      try {
        const elements = await schemaFn(ctx)
        const innerPanel = Object.create(panel, {
          getSchema: { value: () => elements },
        }) as Panel
        meta.schema = await resolveSchemaFn(innerPanel, ctx)
      } catch (e) {
        debugWarn('widget.schema', e)
        meta.schema = []
      }
    }
  }

  return meta as unknown as PanelSchemaElementMeta
}
