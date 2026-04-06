import type { AppRequest, AppResponse } from '@rudderjs/core'
import type { Resource, FieldOrGrouping } from '../../Resource.js'
import type { ModelClass, QueryBuilderLike, RecordRow } from '../../types.js'
import { flattenFields, relationName } from '../shared/fields.js'
import { buildContext } from '../shared/context.js'
import { applyTransforms } from '../shared/transforms.js'
import { applySearch, applyFilters, parseUrlFilters, applyColumnTransforms } from '../../utils/queryHelpers.js'

export function handleList(
  ResourceClass: typeof Resource,
  slug: string,
  Model: ModelClass<RecordRow>,
  isDraftable: boolean,
) {
  return async (req: AppRequest, res: AppResponse) => {
    const resource = new ResourceClass()
    const ctx      = buildContext(req)
    if (!await resource.policy('viewAny', ctx)) return res.status(403).json({ message: 'Forbidden.' })

    const table       = resource._resolveTable()
    const tableConfig = table.getConfig()
    const formFields  = flattenFields(resource._resolveForm().getFields() as FieldOrGrouping[])

    const page    = Number((req.query as Record<string, string>)['page']    ?? 1)
    const perPage = Math.min(Number((req.query as Record<string, string>)['perPage'] ?? tableConfig.perPage), 100)

    const url    = new URL(req.url, 'http://localhost')
    const sort   = url.searchParams.get('sort') ?? undefined
    const dir    = (url.searchParams.get('dir') ?? 'ASC').toUpperCase() as 'ASC' | 'DESC'
    const search = url.searchParams.get('search') ?? undefined

    let q: QueryBuilderLike<RecordRow> = Model.query()

    // Scope filter
    const activeTab = url.searchParams.get('tab') ?? ''
    if (activeTab && tableConfig.scopes) {
      const scope = tableConfig.scopes.find((s) => s.label.toLowerCase().replace(/\s+/g, '-') === activeTab)
      if (scope?.scope) {
        q = scope.scope(q) as QueryBuilderLike<RecordRow>
      }
    }

    // Soft deletes
    const hasSoftDeletes = tableConfig.softDeletes
    const trashed        = url.searchParams.get('trashed') === 'true'
    if (hasSoftDeletes) {
      if (trashed) {
        q = q.where('deletedAt', '!=', null)
      } else {
        q = q.where('deletedAt', null)
      }
    }

    // Draftable
    const draftFilter = url.searchParams.get('draft')
    if (isDraftable) {
      if (draftFilter === 'true') {
        q = q.where('draftStatus', 'draft')
      } else if (draftFilter === 'false') {
        q = q.where('draftStatus', 'published')
      }
    }

    // Include belongsTo relations
    for (const f of formFields.filter(f => f.getType() === 'belongsTo')) {
      q = q.with(relationName(f))
    }

    // Sort
    if (sort) {
      const sortableFields = formFields.filter(f => f.isSortable()).map(f => f.getName())
      if (sortableFields.includes(sort)) {
        q = q.orderBy(sort, dir)
      }
    }

    // Search
    if (search) {
      const searchableCols = tableConfig.searchColumns
        ?? formFields.filter(f => f.isSearchable()).map(f => f.getName())
      q = applySearch(q, searchableCols, search)
    }

    // Filters
    const urlFilters = parseUrlFilters(url)
    q = applyFilters(q, tableConfig.filters, urlFilters)

    // Paginate or limit
    let result: { data: unknown[]; total: number; currentPage: number; perPage: number; lastPage: number }
    if (tableConfig.paginationType) {
      result = await q.paginate(page, perPage)
    } else {
      const records = await q.limit(tableConfig.limit).get()
      result = { data: records, total: records.length, currentPage: 1, perPage: records.length, lastPage: 1 }
    }

    // Strip unreadable fields
    const readableNames = new Set(
      formFields.filter(f => f.canRead(ctx)).map(f => f.getName())
    )
    readableNames.add('id')
    result.data = (result.data as Record<string, unknown>[]).map((r) =>
      Object.fromEntries(Object.entries(r).filter(([k]) => readableNames.has(k)))
    )

    result.data = applyTransforms(resource, result.data as unknown[]) as typeof result.data

    // Column transforms
    const tableColumns = tableConfig.columns ?? []
    applyColumnTransforms(result.data as RecordRow[], tableColumns)

    return res.json({
      data: result.data,
      meta: {
        total:       result.total,
        currentPage: result.currentPage,
        perPage:     result.perPage,
        lastPage:    result.lastPage,
        type:        tableConfig.paginationType ?? 'pages',
        ...(hasSoftDeletes ? { trashed } : {}),
      },
    })
  }
}

export function handleRelated(
  ResourceClass: typeof Resource,
  slug: string,
  Model: ModelClass<RecordRow>,
) {
  return async (req: AppRequest, res: AppResponse) => {
    const url     = new URL(req.url, 'http://localhost')
    const fk      = url.searchParams.get('fk')
    const id      = url.searchParams.get('id')
    const through = url.searchParams.get('through') === 'true'
    const page    = Number(url.searchParams.get('page') ?? 1)

    if (!fk || !id) return res.status(422).json({ message: 'fk and id query params are required.' })

    let q: QueryBuilderLike<RecordRow> = through
      ? Model.query().where(fk, { some: { id } })
      : Model.query().where(fk, id)

    const relFormFields = flattenFields(new ResourceClass()._resolveForm().getFields() as FieldOrGrouping[])
    for (const f of relFormFields) {
      if (f.getType() === 'belongsTo')    q = q.with(relationName(f))
      if (f.getType() === 'belongsToMany') q = q.with(f.getName())
    }

    const result = await q.paginate(page, 15)
    return res.json({
      data: result.data,
      meta: {
        total:       result.total,
        currentPage: result.currentPage,
        perPage:     result.perPage,
        lastPage:    result.lastPage,
      },
    })
  }
}

export function handleSchema(ResourceClass: typeof Resource) {
  return async (_req: AppRequest, res: AppResponse) => {
    const resource     = new ResourceClass()
    const resourceMeta = resource.toMeta()
    return res.json({ resourceMeta })
  }
}

export function handleOptions(Model: ModelClass<RecordRow>) {
  return async (req: AppRequest, res: AppResponse) => {
    const url   = new URL(req.url, 'http://localhost')
    const label = url.searchParams.get('label') ?? 'name'

    const records: RecordRow[] = await Model.query().all()
    const options = records.map((r) => ({
      value: String(r['id']),
      label: String(r[label] ?? r['id']),
    }))
    return res.json(options)
  }
}
