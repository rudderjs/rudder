import type { Panel }         from './Panel.js'
import type { PanelContext }  from './types.js'
import type {
  TextElementMeta,
  HeadingElementMeta,
  StatsElementMeta,
  TableElementMeta,
} from './schema/index.js'

export type PanelSchemaElementMeta =
  | TextElementMeta
  | HeadingElementMeta
  | StatsElementMeta
  | TableElementMeta

// ─── Schema resolver ───────────────────────────────────────

export async function resolveSchema(
  panel: Panel,
  ctx: PanelContext,
): Promise<PanelSchemaElementMeta[]> {
  const schemaDef = panel.getSchema()
  if (!schemaDef) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const elements: any[] = typeof schemaDef === 'function'
    ? await (schemaDef as (ctx: PanelContext) => Promise<unknown[]>)(ctx)
    : schemaDef as unknown[]

  const result: PanelSchemaElementMeta[] = []

  for (const el of elements) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const type = (el as any).getType?.() as string | undefined
    if (!type) continue

    if (type === 'text' || type === 'heading' || type === 'stats') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      result.push((el as any).toMeta() as PanelSchemaElementMeta)
      continue
    }

    if (type === 'table') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config = (el as any).getConfig() as import('./schema/Table.js').TableConfig
      if (!config.resource) continue

      const ResourceClass = panel.getResources().find(
        (R) => R.getSlug() === config.resource,
      )
      if (!ResourceClass) continue

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Model = (ResourceClass as any).model as any
      if (!Model) continue

      // Build query
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = Model.query()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sortCol = config.sortBy ?? (ResourceClass as any).defaultSort
      if (sortCol) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dir = config.sortBy ? config.sortDir : ((ResourceClass as any).defaultSortDir ?? 'DESC')
        q = q.orderBy(sortCol, dir)
      }
      q = q.limit(config.limit)

      let records: unknown[] = []
      try { records = await q.get() } catch { /* empty model */ }

      // Determine columns
      const resource   = new ResourceClass()
      const flatFields = flattenFields(resource.fields())

      const columnNames: string[] = config.columns.length > 0
        ? config.columns
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        : flatFields
            .filter((f: any) => !f.isHiddenFrom('table') && f.getType() !== 'hasMany')
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((f: any) => f.getName() as string)
            .slice(0, 5)

      const columns = columnNames.map((name) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const field = flatFields.find((f: any) => f.getName() === name)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { name, label: field ? (field as any).getLabel() as string : titleCase(name) }
      })

      result.push({
        type:     'table',
        title:    config.title,
        resource: config.resource,
        columns,
        records,
        href:     `${panel.getPath()}/${config.resource}`,
      } satisfies TableElementMeta)
    }
  }

  return result
}

// ─── Helpers ───────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function flattenFields(items: any[]): any[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any[] = []
  for (const item of items) {
    if (typeof item.getFields === 'function') {
      result.push(...flattenFields(item.getFields()))
    } else {
      result.push(item)
    }
  }
  return result
}

function titleCase(str: string): string {
  return str.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()).trim()
}
