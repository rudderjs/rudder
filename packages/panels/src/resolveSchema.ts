import type { Panel }         from './Panel.js'
import type { PanelContext, SchemaElementLike }  from './types.js'
import type {
  TextElementMeta,
  HeadingElementMeta,
  CodeElementMeta,
  StatsElementMeta,
  TableElementMeta,
  ChartElementMeta,
  ListElementMeta,
} from './schema/index.js'
import type { FormElementMeta } from './schema/Form.js'
import type { DialogElementMeta } from './schema/Dialog.js'
import type { SnippetElementMeta } from './schema/Snippet.js'
import type { ExampleElementMeta } from './schema/Example.js'
import type { Example } from './schema/Example.js'

import { resolveSection }   from './resolvers/resolveSection.js'
import { resolveTabs }      from './resolvers/resolveTabs.js'
import { resolveTable }     from './resolvers/resolveTable.js'
import { resolveDashboard } from './resolvers/resolveDashboard.js'
import { resolveDialog }    from './resolvers/resolveDialog.js'
import { resolveForm }      from './resolvers/resolveForm.js'
import { resolveWidget }    from './resolvers/resolveWidget.js'
import { resolveStats }     from './resolvers/resolveStats.js'
import { resolveChart }     from './resolvers/resolveChart.js'
import { resolveList }      from './resolvers/resolveList.js'
import { resolveField }     from './resolvers/resolveField.js'

export type PanelSchemaElementMeta =
  | TextElementMeta
  | HeadingElementMeta
  | CodeElementMeta
  | StatsElementMeta
  | TableElementMeta
  | ChartElementMeta
  | ListElementMeta
  | FormElementMeta
  | DialogElementMeta
  | SnippetElementMeta
  | ExampleElementMeta

// ─── Schema resolver ───────────────────────────────────────

export async function resolveSchema(
  panel: Panel,
  ctx: PanelContext,
): Promise<PanelSchemaElementMeta[]> {
  const schemaDef = panel.getSchema()
  if (!schemaDef) return []

  const elements: SchemaElementLike[] = typeof schemaDef === 'function'
    ? await (schemaDef as (ctx: PanelContext) => Promise<SchemaElementLike[]>)(ctx)
    : schemaDef as SchemaElementLike[]

  const result: PanelSchemaElementMeta[] = []

  for (const el of elements) {
    const type = (el as SchemaElementLike).getType?.() as string | undefined
    if (!type) continue

    if (type === 'section') {
      result.push(await resolveSection(el, panel, ctx, resolveSchema))
      continue
    }

    if (type === 'tabs') {
      const meta = await resolveTabs(el, panel, ctx, resolveSchema)
      if (meta) result.push(meta)
      continue
    }

    if (type === 'table') {
      const meta = await resolveTable(el, panel, ctx)
      if (meta) result.push(meta)
      continue
    }

    if (type === 'dashboard') {
      result.push(await resolveDashboard(el, panel, ctx))
      continue
    }

    if (type === 'dialog') {
      result.push(await resolveDialog(el, panel, ctx, resolveSchema))
      continue
    }

    if (type === 'form') {
      result.push(await resolveForm(el, panel, ctx))
      continue
    }

    if (type === 'widget') {
      result.push(await resolveWidget(el, ctx))
      continue
    }

    if (type === 'stats') {
      result.push(await resolveStats(el, panel, ctx))
      continue
    }

    if (type === 'chart') {
      result.push(await resolveChart(el, ctx))
      continue
    }

    if (type === 'list') {
      result.push(await resolveList(el, ctx))
      continue
    }

    if (type === 'example') {
      const example = el as unknown as Example
      const meta = example.toMeta()
      // Resolve inner schema elements for the live preview
      const innerElements = example.getSchema()
      if (innerElements.length > 0) {
        const examplePanel = Object.create(panel, {
          getSchema: { value: () => innerElements },
        })
        meta.elements = await resolveSchema(examplePanel, ctx)
      }
      result.push(meta as unknown as PanelSchemaElementMeta)
      continue
    }

    // Standalone field — wrap in a synthetic form (no submit button)
    const fieldMeta = await resolveField(el, panel, ctx)
    if (fieldMeta) {
      result.push(fieldMeta)
      continue
    }

    // All other element types (text, heading, etc.)
    // — pass through their toMeta() directly
    if (typeof (el as SchemaElementLike).toMeta === 'function') {
      result.push((el as SchemaElementLike).toMeta() as unknown as PanelSchemaElementMeta)
    }
  }

  return result
}
