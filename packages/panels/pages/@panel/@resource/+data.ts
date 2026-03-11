import { PanelRegistry } from '@boostkit/panels'
import { getSessionUser } from '../../_lib/getSessionUser.js'

function flattenFields(items: any[]): any[] {
  const result: any[] = []
  for (const item of items) {
    if ('getFields' in item) result.push(...flattenFields(item.getFields()))
    else result.push(item)
  }
  return result
}
import type { PageContextServer } from 'vike/types'

export type Data = Awaited<ReturnType<typeof data>>

export async function data(pageContext: PageContextServer) {
  const { panel: pathSegment, resource: slug } = pageContext.routeParams as { panel: string; resource: string }

  const panel = PanelRegistry.all().find((p) => p.getPath() === `/${pathSegment}`)
  if (!panel) throw new Error(`Panel "/${pathSegment}" not found.`)

  const ResourceClass = panel.getResources().find((R) => R.getSlug() === slug)
  if (!ResourceClass) throw new Error(`Resource "${slug}" not found.`)

  const resource     = new ResourceClass()
  const resourceMeta = resource.toMeta()
  const panelMeta    = panel.toMeta()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Model  = ResourceClass.model as any
  const params = new URLSearchParams(pageContext.urlOriginal.split('?')[1] ?? '')
  const page   = Number(params.get('page') ?? 1)
  const sort   = params.get('sort') ?? undefined
  const dir    = (params.get('dir') ?? 'ASC').toUpperCase() as 'ASC' | 'DESC'
  const search = params.get('search') ?? undefined

  let records: unknown[]  = []
  let pagination: { total: number; currentPage: number; lastPage: number; perPage: number } | null = null

  if (Model) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = Model.query()

    // Include belongsTo relations so the table shows names instead of raw IDs
    for (const f of flattenFields(resource.fields())) {
      if ((f as any).getType?.() === 'belongsTo') {
        const name = (f as any).getName() as string
        const rel  = ((f as any)._extra?.['relationName'] as string) ?? (name.endsWith('Id') ? name.slice(0, -2) : name)
        q = q.with(rel)
      }
    }

    if (sort) {
      const sortableFields = flattenFields(resource.fields()).filter((f: any) => f.isSortable()).map((f: any) => f.getName())
      if (sortableFields.includes(sort)) q = q.orderBy(sort, dir)
    }

    if (search) {
      const cols = flattenFields(resource.fields()).filter((f: any) => f.isSearchable()).map((f: any) => f.getName())
      if (cols.length > 0) {
        q = q.where(cols[0]!, 'LIKE', `%${search}%`)
        for (let i = 1; i < cols.length; i++) q = q.orWhere(cols[i]!, `%${search}%`)
      }
    }

    for (const filter of resource.filters()) {
      const value = params.get(`filter[${filter.getName()}]`)
      if (value !== null && value !== '') {
        q = (filter as any).applyToQuery(q, value)
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

  const sessionUser = await getSessionUser(pageContext)
  return { panelMeta, resourceMeta, records, pagination, pathSegment, slug, sessionUser }
}
