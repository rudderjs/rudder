import type { Panel } from '../Panel.js'
import type { PanelContext, SchemaElementLike } from '../types.js'
import type { Section } from '../schema/Section.js'
import type { PanelSchemaElementMeta } from '../resolveSchema.js'
import type { ResolveSchemaFn } from './types.js'
import { resolveChildSchema } from './utils.js'

export async function resolveSection(
  el: SchemaElementLike,
  panel: Panel,
  ctx: PanelContext,
  resolveSchema: ResolveSchemaFn,
): Promise<PanelSchemaElementMeta> {
  const section = el as Section
  if (typeof section.hasFields === 'function' && !section.hasFields() && section.getItems().length > 0) {
    const meta = section.toMeta()
    meta.elements = await resolveChildSchema(panel, ctx, section.getItems(), resolveSchema)
    return meta as unknown as PanelSchemaElementMeta
  }
  // Field section — pass through toMeta()
  return section.toMeta() as unknown as PanelSchemaElementMeta
}
