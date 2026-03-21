import type { Panel } from '../Panel.js'
import type { PanelContext, SchemaElementLike } from '../types.js'
import type { Section } from '../schema/Section.js'
import type { PanelSchemaElementMeta } from '../resolveSchema.js'
import type { ResolveSchemaFn } from './types.js'

export async function resolveSection(
  el: SchemaElementLike,
  panel: Panel,
  ctx: PanelContext,
  resolveSchema: ResolveSchemaFn,
): Promise<PanelSchemaElementMeta> {
  const section = el as Section
  if (typeof section.hasFields === 'function' && !section.hasFields() && section.getItems().length > 0) {
    // Schema element section — resolve items recursively
    const items = section.getItems()
    const sectionPanel = Object.create(panel, {
      getSchema: { value: () => items },
    }) as Panel
    const resolved = await resolveSchema(sectionPanel, ctx)
    const meta = section.toMeta()
    meta.elements = resolved
    return meta as unknown as PanelSchemaElementMeta
  }
  // Field section — pass through toMeta()
  return section.toMeta() as unknown as PanelSchemaElementMeta
}
