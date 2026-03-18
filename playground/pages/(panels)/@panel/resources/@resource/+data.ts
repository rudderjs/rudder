import { PanelRegistry } from '@boostkit/panels'
import type { FieldOrGrouping, Field, QueryBuilderLike, RecordRow } from '@boostkit/panels'
import { getSessionUser } from '../../../_lib/getSessionUser.js'

/** A Field with an optional `.apply(record)` method (ComputedField). */
interface ComputedFieldLike extends Field {
  apply(record: RecordRow): unknown
}

function flattenFields(items: FieldOrGrouping[]): Field[] {
  const result: Field[] = []
  for (const item of items) {
    if ('getFields' in item) result.push(...flattenFields((item as { getFields(): FieldOrGrouping[] }).getFields()))
    else result.push(item as Field)
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
  const isLoadMore = ResourceClass.paginationType === 'loadMore'
  const loadMoreTarget = isLoadMore ? Number(params.get('page') ?? 1) : 1
  const page   = isLoadMore ? 1 : Number(params.get('page') ?? 1)
  const sort   = params.get('sort') ?? undefined
  const dir    = (params.get('dir') ?? 'ASC').toUpperCase() as 'ASC' | 'DESC'
  const search = params.get('search') ?? undefined

  let records: unknown[]  = []
  let pagination: { total: number; currentPage: number; lastPage: number; perPage: number } | null = null

  if (Model) {
    let q: QueryBuilderLike<RecordRow> = Model.query()

    // Tab filter — apply active tab's query modifier
    const activeTab = params.get('tab') ?? ''
    if (activeTab) {
      const tabs = resource.tabs()
      const tab  = tabs.find((t) => t.getName() === activeTab)
      const tabQuery = tab?.getQueryFn()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (tabQuery) q = tabQuery(q as any) as QueryBuilderLike<RecordRow>
    }

    // Soft deletes — filter by trashed status
    const hasSoftDeletes = ResourceClass.softDeletes
    const trashed        = params.get('trashed') === 'true'
    if (hasSoftDeletes) {
      if (trashed) {
        q = q.where('deletedAt', '!=', null)
      } else {
        q = q.where('deletedAt', null)
      }
    }

    // Draftable — filter by draft status
    const hasDraftable = ResourceClass.draftable
    const draftFilter  = params.get('draft')
    if (hasDraftable) {
      if (draftFilter === 'true') {
        q = q.where('draftStatus', 'draft')
      } else if (draftFilter === 'false') {
        q = q.where('draftStatus', 'published')
      }
    }

    // Include belongsTo and belongsToMany relations so the table shows names instead of raw IDs
    for (const f of flattenFields(resource.fields())) {
      const type = f.getType()
      const name = f.getName()
      if (type === 'belongsTo') {
        const rel = ((f as unknown as { _extra: Record<string, unknown> })._extra?.['relationName'] as string) ?? (name.endsWith('Id') ? name.slice(0, -2) : name)
        q = q.with(rel)
      } else if (type === 'belongsToMany') {
        q = q.with(name)
      }
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
        q = filter.applyToQuery(q, value) as QueryBuilderLike<RecordRow>
      }
    }

    const perPage = Math.min(Number(params.get('perPage') ?? ResourceClass.perPage ?? 15), 100)

    // In loadMore mode, fetch pages 1..N in a single query
    const effectivePerPage = isLoadMore && loadMoreTarget > 1 ? perPage * loadMoreTarget : perPage
    const result = await q.paginate(page, effectivePerPage)
    const rawRecords: RecordRow[] = result.data

    // Apply display transforms + computed fields
    const allFields = flattenFields(resource.fields())
    const computedFields = allFields.filter((f): f is ComputedFieldLike => f.getType() === 'computed' && typeof (f as unknown as ComputedFieldLike).apply === 'function')
    const displayFields  = allFields.filter((f) => f.hasDisplay())

    if (computedFields.length || displayFields.length) {
      records = rawRecords.map((r) => {
        const rec: RecordRow = { ...r }
        for (const f of computedFields) rec[f.getName()] = f.apply(rec)
        for (const f of displayFields)  rec[f.getName()] = f.applyDisplay(rec[f.getName()], rec)
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
