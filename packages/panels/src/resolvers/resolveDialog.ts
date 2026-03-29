import type { Panel } from '../Panel.js'
import type { PanelContext, SchemaElementLike } from '../types.js'
import type { PanelSchemaElementMeta } from '../resolveSchema.js'
import type { DialogElement, ResolveSchemaFn } from './types.js'
import { resolveChildSchema } from './utils.js'

export async function resolveDialog(
  el: SchemaElementLike,
  panel: Panel,
  ctx: PanelContext,
  resolveSchema: ResolveSchemaFn,
): Promise<PanelSchemaElementMeta> {
  const dialog = el as DialogElement
  const meta = dialog.toMeta()
  meta.elements = await resolveChildSchema(panel, ctx, dialog.getItems(), resolveSchema)
  return meta as unknown as PanelSchemaElementMeta
}
