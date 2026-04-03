import type { Panel }         from './Panel.js'
import type { PanelContext, SchemaElementLike }  from './types.js'
import type {
  TextElementMeta,
  HeadingElementMeta,
  CodeElementMeta,
  StatsElementMeta,
  ChartElementMeta,
  ListElementMeta,
} from './schema/index.js'
import type { DataViewElementMeta } from './resolvers/resolveListElement.js'
import type { FormElementMeta } from './schema/Form.js'
import type { DialogElementMeta } from './schema/Dialog.js'
import type { SnippetElementMeta } from './schema/Snippet.js'
import type { ExampleElementMeta } from './schema/Example.js'
import type { Example } from './schema/Example.js'
import type { CardElementMeta } from './schema/Card.js'
import type { Card } from './schema/Card.js'
import type { AlertElementMeta } from './schema/Alert.js'
import type { DividerElementMeta } from './schema/Divider.js'
import type { EachElementMeta } from './schema/Each.js'
import type { Each } from './schema/Each.js'
import type { ViewElementMeta } from './schema/View.js'
import type { View } from './schema/View.js'
import type { PlaygroundElementMeta } from './schema/Playground.js'
import type { Playground } from './schema/Playground.js'

import { resolveSection }   from './resolvers/resolveSection.js'
import { resolveTabs }      from './resolvers/resolveTabs.js'
import { resolveDataView }  from './resolvers/resolveListElement.js'
import { resolveDashboard } from './resolvers/resolveDashboard.js'
import { resolveDialog }    from './resolvers/resolveDialog.js'
import { resolveForm }      from './resolvers/resolveForm.js'
import { resolveWidget }    from './resolvers/resolveWidget.js'
import { resolveStats }     from './resolvers/resolveStats.js'
import { resolveChart }     from './resolvers/resolveChart.js'
import { resolveList }      from './resolvers/resolveList.js'
import { resolveField }     from './resolvers/resolveField.js'
import { getResolver }      from './registries/ResolverRegistry.js'
import { validateSerializable } from '@rudderjs/support'

export type PanelSchemaElementMeta =
  | TextElementMeta
  | HeadingElementMeta
  | CodeElementMeta
  | StatsElementMeta
  | DataViewElementMeta
  | ChartElementMeta
  | ListElementMeta
  | FormElementMeta
  | DialogElementMeta
  | SnippetElementMeta
  | ExampleElementMeta
  | CardElementMeta
  | AlertElementMeta
  | DividerElementMeta
  | EachElementMeta
  | ViewElementMeta
  | PlaygroundElementMeta

// ─── Schema resolver ───────────────────────────────────────

let resolveDepth = 0

export async function resolveSchema(
  panel: Panel,
  ctx: PanelContext,
): Promise<PanelSchemaElementMeta[]> {
  resolveDepth++
  const isTopLevel = resolveDepth === 1

  const schemaDef = panel.getSchema()
  if (!schemaDef) { resolveDepth--; return [] }

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

    if (type === 'table' || type === 'dataview') {
      const meta = await resolveDataView(el, panel, ctx)
      if (meta) result.push(meta)
      continue
    }

    if (type === 'dashboard') {
      result.push(await resolveDashboard(el, panel, ctx, resolveSchema))
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
      result.push(await resolveWidget(el, panel, ctx, resolveSchema))
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

    if (type === 'card') {
      const card = el as unknown as Card
      const meta = card.toMeta()
      const cardElements = card.getSchema()
      if (cardElements.length > 0) {
        const cardPanel = Object.create(panel, {
          getSchema: { value: () => cardElements },
        })
        meta.elements = await resolveSchema(cardPanel, ctx)
      }
      result.push(meta as unknown as PanelSchemaElementMeta)
      continue
    }

    if (type === 'each') {
      const each = el as unknown as Each
      const meta = each.toMeta()
      const contentFn = each.getContentFn()

      // Resolve data source
      let records: Record<string, unknown>[] = []
      const model = each.getModel()
      const dataSource = each.getDataSource()
      const staticItems = each.getStaticItems()

      if (model) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let q: any = model.query()
        const scopeFn = each.getScope()
        if (scopeFn) q = scopeFn(q)
        try { records = await q.get() } catch { /* empty */ }
      } else if (dataSource) {
        const { resolveDataSource } = await import('./datasource.js')
        records = await resolveDataSource(dataSource, ctx)
      } else if (staticItems.length > 0 && !contentFn) {
        // Static items — resolve each item's schema directly
        for (const itemSchema of staticItems) {
          const itemPanel = Object.create(panel, {
            getSchema: { value: () => itemSchema },
          })
          const resolved = await resolveSchema(itemPanel, ctx)
          meta.items.push({ elements: resolved })
        }
        result.push(meta as unknown as PanelSchemaElementMeta)
        continue
      }

      // Generate schema per record using content function
      if (contentFn) {
        for (const record of records) {
          const itemElements = contentFn(record)
          const itemPanel = Object.create(panel, {
            getSchema: { value: () => itemElements },
          })
          const resolved = await resolveSchema(itemPanel, ctx)
          meta.items.push({ elements: resolved })
        }
      }
      result.push(meta as unknown as PanelSchemaElementMeta)
      continue
    }

    if (type === 'view') {
      const view = el as unknown as View
      const meta = view.toMeta()
      const contentFn = view.getContentFn()
      const dataFn = view.getData()

      if (contentFn && dataFn) {
        // Resolve data (sync or async)
        let data: Record<string, unknown>
        if (typeof dataFn === 'function') {
          data = await dataFn(ctx)
        } else {
          data = dataFn
        }
        const viewElements = contentFn(data)
        const viewPanel = Object.create(panel, {
          getSchema: { value: () => viewElements },
        })
        meta.elements = await resolveSchema(viewPanel, ctx)
      }
      result.push(meta as unknown as PanelSchemaElementMeta)
      continue
    }

    if (type === 'playground') {
      const playground = el as unknown as Playground
      const meta = playground.toMeta()
      const previewFn = playground.getPreviewFn()
      if (previewFn) {
        const defaults = playground.getDefaults()
        const previewElements = previewFn(defaults)
        const previewPanel = Object.create(panel, {
          getSchema: { value: () => previewElements },
        })
        meta.elements = await resolveSchema(previewPanel, ctx)
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

    // Check resolver registry — plugins register async resolvers for custom types
    const customResolver = getResolver(type)
    if (customResolver) {
      try {
        result.push(await customResolver(el, ctx) as unknown as PanelSchemaElementMeta)
      } catch { /* resolver failed */ }
      continue
    }

    // All other element types (text, heading, etc.)
    // — pass through their toMeta() directly
    if (typeof (el as SchemaElementLike).toMeta === 'function') {
      result.push((el as SchemaElementLike).toMeta() as unknown as PanelSchemaElementMeta)
    }
  }

  resolveDepth--
  if (isTopLevel) {
    validateSerializable(result, 'resolveSchema', 'panels')
  }
  return result
}
