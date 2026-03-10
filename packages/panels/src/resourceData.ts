import { PanelRegistry } from './PanelRegistry.js'
import type { PanelMeta } from './Panel.js'
import type { ResourceMeta } from './Resource.js'

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
  const params = new URLSearchParams(url.split('?')[1] ?? '')
  const page   = Number(params.get('page') ?? 1)
  const sort   = params.get('sort') ?? undefined
  const dir    = (params.get('dir') ?? 'ASC').toUpperCase() as 'ASC' | 'DESC'
  const search = params.get('search') ?? undefined

  let records: unknown[]  = []
  let pagination: { total: number; currentPage: number; lastPage: number; perPage: number } | null = null

  if (Model) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = Model.query()

    if (sort) {
      const sortableFields = resource.fields().filter((f: any) => f.isSortable()).map((f: any) => f.getName())
      if (sortableFields.includes(sort)) q = q.orderBy(sort, dir)
    }

    if (search) {
      const cols = resource.fields().filter((f: any) => f.isSearchable()).map((f: any) => f.getName())
      if (cols.length > 0) {
        q = q.where(cols[0]!, 'LIKE', `%${search}%`)
        for (let i = 1; i < cols.length; i++) q = q.orWhere(cols[i]!, `%${search}%`)
      }
    }

    for (const filter of resource.filters()) {
      const value = params.get(`filter[${filter.getName()}]`)
      if (value !== null && value !== '') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const applied = (filter as any).apply({}, value) as Record<string, unknown>
        for (const [col, val] of Object.entries(applied)) {
          if (col === '_search') {
            const { value: sv, columns } = val as { value: string; columns: string[] }
            if (columns[0]) q = q.where(columns[0], 'LIKE', `%${sv}%`)
            for (let i = 1; i < columns.length; i++) q = q.orWhere(columns[i]!, `%${sv}%`)
          } else {
            q = q.where(col, val)
          }
        }
      }
    }

    const result = await q.paginate(page, 15)
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
