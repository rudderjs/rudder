import { PanelRegistry } from './registries/PanelRegistry.js'
import type { PanelMeta } from './Panel.js'
import type { ResourceMeta, FieldOrGrouping } from './Resource.js'
import type { Field } from './schema/Field.js'

function flattenFields(items: FieldOrGrouping[]): Field[] {
  const result: Field[] = []
  for (const item of items) {
    if ('getFields' in item) {
      result.push(...flattenFields(item.getFields()))
    } else {
      result.push(item as Field)
    }
  }
  return result
}

export interface ResourceDataContext {
  /** Panel path segment (e.g. 'admin' for a panel at /admin). */
  panel:    string
  /** Resource slug (e.g. 'users'). */
  resource: string
  /** Full request URL including query string, e.g. '/admin/users?sort=name&dir=ASC'. */
  url:      string
}

export interface ResourceDataResult {
  panelMeta:    PanelMeta
  resourceMeta: ResourceMeta
  records:      unknown[]
  pagination:   { total: number; currentPage: number; lastPage: number; perPage: number } | null
  pathSegment:  string
  slug:         string
}

export async function resourceData(ctx: ResourceDataContext): Promise<ResourceDataResult> {
  const { panel: pathSegment, resource: slug, url } = ctx

  const panel = PanelRegistry.all().find((p) => p.getPath() === `/${pathSegment}`)
  if (!panel) throw new Error(`Panel "/${pathSegment}" not found.`)

  const ResourceClass = panel.getResources().find((R) => R.getSlug() === slug)
  if (!ResourceClass) throw new Error(`Resource "${slug}" not found.`)

  const resource     = new ResourceClass()
  const resourceMeta = resource.toMeta()
  const panelMeta    = panel.toMeta()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Model  = ResourceClass.model as any
  const params         = new URLSearchParams(url.split('?')[1] ?? '')
  const page           = Number(params.get('page') ?? 1)
  const perPage        = Math.min(Number(params.get('perPage') ?? ResourceClass.perPage), 100)
  const sortDefault    = ResourceClass.defaultSort
  const sortDirDefault = ResourceClass.defaultSortDir ?? 'ASC'
  const sort           = params.get('sort') ?? sortDefault
  const dir            = (params.get('dir') ?? sortDirDefault).toUpperCase() as 'ASC' | 'DESC'
  const search         = params.get('search') ?? undefined

  let records: unknown[]  = []
  let pagination: { total: number; currentPage: number; lastPage: number; perPage: number } | null = null

  if (Model) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = Model.query()

    // Include belongsTo relations so the table can display names instead of raw IDs
    for (const f of flattenFields(resource.fields()).filter(f => f.getType() === 'belongsTo')) {
      const extra = f.toMeta().extra
      const name  = f.getName()
      const rel   = (extra['relationName'] as string) ?? (name.endsWith('Id') ? name.slice(0, -2) : name)
      q = q.with(rel)
    }

    if (sort) {
      const sortableFields = flattenFields(resource.fields()).filter((f) => f.isSortable()).map((f) => f.getName())
      if (sortableFields.includes(sort)) q = q.orderBy(sort, dir)
    }

    if (search) {
      const cols = flattenFields(resource.fields()).filter((f) => f.isSearchable()).map((f) => f.getName())
      if (cols.length > 0) {
        q = q.where(cols[0] ?? '', 'LIKE', `%${search}%`)
        for (let i = 1; i < cols.length; i++) q = q.orWhere(cols[i] ?? '', `%${search}%`)
      }
    }

    for (const filter of resource.filters()) {
      const value = params.get(`filter[${filter.getName()}]`)
      if (value !== null && value !== '') {
        q = filter.applyToQuery(q, value)
      }
    }

    const result = await q.paginate(page, perPage)
    records    = result.data
    pagination = {
      total:       result.total,
      currentPage: result.currentPage,
      lastPage:    result.lastPage,
      perPage:     result.perPage,
    }
  }

  return { panelMeta, resourceMeta, records, pagination, pathSegment, slug }
}
