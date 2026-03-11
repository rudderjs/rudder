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
  const isLoadMore = (ResourceClass as any).paginationType === 'loadMore'
  const loadMoreTarget = isLoadMore ? Number(params.get('page') ?? 1) : 1
  const page   = isLoadMore ? 1 : Number(params.get('page') ?? 1)
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

    const perPage = Math.min(Number(params.get('perPage') ?? (ResourceClass as any).perPage ?? 15), 100)

    // In loadMore mode, fetch pages 1..N in a single query
    const effectivePerPage = isLoadMore && loadMoreTarget > 1 ? perPage * loadMoreTarget : perPage
    const result = await q.paginate(page, effectivePerPage)
    const rawRecords: unknown[] = result.data

    // Apply display transforms + computed fields
    const allFields = flattenFields(resource.fields())
    const computedFields = allFields.filter((f: any) => f.getType?.() === 'computed' && typeof f.apply === 'function')
    const displayFields  = allFields.filter((f: any) => typeof f.hasDisplay === 'function' && f.hasDisplay())

    if (computedFields.length || displayFields.length) {
      records = (rawRecords as Record<string, unknown>[]).map((r: any) => {
        const rec = { ...r }
        for (const f of computedFields) rec[(f as any).getName()] = (f as any).apply(rec)
        for (const f of displayFields)  rec[(f as any).getName()] = (f as any).applyDisplay(rec[(f as any).getName()], rec)
        return rec
      })
    } else {
      records = rawRecords
    }

    // For loadMore, report pagination in terms of the original perPage batch size
    const totalRecords = result.total
    const actualLastPage = Math.ceil(totalRecords / perPage)
    pagination = {
      total:       totalRecords,
      currentPage: isLoadMore ? loadMoreTarget : result.currentPage,
      lastPage:    isLoadMore ? actualLastPage : result.lastPage,
      perPage,
    }
  }

  const sessionUser = await getSessionUser(pageContext)
  const urlSearch = pageContext.urlOriginal.split('?')[1] ?? ''
  return { panelMeta, resourceMeta, records, pagination, pathSegment, slug, sessionUser, urlSearch }
}
