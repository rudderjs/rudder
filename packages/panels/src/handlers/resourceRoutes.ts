import type { MiddlewareHandler, AppRequest, AppResponse } from '@rudderjs/core'
import type { RouterLike } from './types.js'
import type { Panel } from '../Panel.js'
import type { Resource } from '../Resource.js'
import type { Action } from '../schema/Action.js'
import type { ModelClass, QueryBuilderLike, RecordRow } from '../types.js'
import {
  flattenFields, relationName, buildContext,
  coercePayload, validatePayload, applyTransforms, liveBroadcast,
} from './utils.js'
import { applySearch, applyFilters, parseUrlFilters, applyColumnTransforms } from '../utils/queryHelpers.js'
import { mountVersionRoutes } from './versionRoutes.js'
import { handleAgentRun } from './agentRun.js'

/** Extract a named route parameter — always returns a string (empty if somehow absent). */
function param(req: AppRequest, name: string): string {
  return (req.params as Record<string, string | undefined>)[name] ?? ''
}

export function mountResourceRoutes(
  router: RouterLike,
  panel: Panel,
  ResourceClass: typeof Resource,
  mw: MiddlewareHandler[],
): void {
  const slug    = ResourceClass.getSlug()
  const base    = `${panel.getApiBase()}/${slug}`

  const Model   = ResourceClass.model as ModelClass<RecordRow> | undefined

  // Resolve resource config once at mount time
  const mountResource = new ResourceClass()
  const mountTableConfig = Model ? mountResource._resolveTable().getConfig() : undefined
  const mountFormMeta = mountResource._resolveForm().toMeta()
  const isLive = mountTableConfig?.live ?? false
  const isDraftable = !!mountFormMeta.draftable
  const isVersioned = !!mountFormMeta.versioned

  // ── GET /panel/api/resource — list (paginated) ────────
  router.get(base, async (req, res) => {
    const resource = new ResourceClass()
    const ctx      = buildContext(req)
    if (!await resource.policy('viewAny', ctx)) return res.status(403).json({ message: 'Forbidden.' })
    if (!Model) return res.status(500).json({ message: `Resource "${slug}" has no model defined.` })

    // Resolve table and form config
    const table       = resource._resolveTable()
    const tableConfig = table.getConfig()
    const formFields  = flattenFields(resource._resolveForm().getFields() as import('../Resource.js').FieldOrGrouping[])

    const page    = Number((req.query as Record<string, string>)['page']    ?? 1)
    const perPage = Math.min(Number((req.query as Record<string, string>)['perPage'] ?? tableConfig.perPage), 100)

    const url    = new URL(req.url, 'http://localhost')
    const sort   = url.searchParams.get('sort') ?? undefined
    const dir    = (url.searchParams.get('dir') ?? 'ASC').toUpperCase() as 'ASC' | 'DESC'
    const search = url.searchParams.get('search') ?? undefined

    let q: QueryBuilderLike<RecordRow> = Model.query()

    // Scope filter — apply active scope's query function
    const activeTab = url.searchParams.get('tab') ?? ''
    if (activeTab && tableConfig.scopes) {
      const scope = tableConfig.scopes.find((s) => s.label.toLowerCase().replace(/\s+/g, '-') === activeTab)
      if (scope?.scope) {
        q = scope.scope(q) as QueryBuilderLike<RecordRow>
      }
    }

    // Soft deletes — filter by trashed status
    const hasSoftDeletes = tableConfig.softDeletes
    const trashed        = url.searchParams.get('trashed') === 'true'
    if (hasSoftDeletes) {
      if (trashed) {
        q = q.where('deletedAt', '!=', null)
      } else {
        q = q.where('deletedAt', null)
      }
    }

    // Draftable — filter by draft status
    const hasDraftable = isDraftable === true
    const draftFilter  = url.searchParams.get('draft')
    if (hasDraftable) {
      if (draftFilter === 'true') {
        q = q.where('draftStatus', 'draft')
      } else if (draftFilter === 'false') {
        q = q.where('draftStatus', 'published')
      }
      // no filter param = show all (drafts + published)
    }

    // Include belongsTo relations so the table can show display names
    for (const f of formFields.filter(f => f.getType() === 'belongsTo')) {
      q = q.with(relationName(f))
    }

    // Sort — only on fields marked sortable()
    if (sort) {
      const sortableFields = formFields.filter(f => f.isSortable()).map(f => f.getName())
      if (sortableFields.includes(sort)) {
        q = q.orderBy(sort, dir)
      }
    }

    // Search — LIKE across all searchable fields (OR)
    if (search) {
      const searchableCols = tableConfig.searchColumns
        ?? formFields.filter(f => f.isSearchable()).map(f => f.getName())
      q = applySearch(q, searchableCols, search)
    }

    // Filters — ?filter[field]=value
    const urlFilters = parseUrlFilters(url)
    q = applyFilters(q, tableConfig.filters, urlFilters)

    // Use paginate() when table has .paginated(), otherwise limit()
    let result: { data: unknown[]; total: number; currentPage: number; perPage: number; lastPage: number }
    if (tableConfig.paginationType) {
      result = await q.paginate(page, perPage)
    } else {
      const records = await q.limit(tableConfig.limit).get()
      result = { data: records, total: records.length, currentPage: 1, perPage: records.length, lastPage: 1 }
    }

    // Strip unreadable fields from each record
    const readableNames = new Set(
      formFields.filter(f => f.canRead(ctx)).map(f => f.getName())
    )
    readableNames.add('id')
    result.data = (result.data as Record<string, unknown>[]).map((r) =>
      Object.fromEntries(Object.entries(r).filter(([k]) => readableNames.has(k)))
    )

    result.data = applyTransforms(resource, result.data as unknown[]) as typeof result.data

    // Apply Column.compute() + Column.display() transforms (e.g. virtual computed columns)
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
  }, mw)

  // ── GET /panel/api/resource/_related — hasMany reverse relation records ──
  router.get(`${base}/_related`, async (req, res) => {
    if (!Model) return res.status(500).json({ message: `Resource "${slug}" has no model defined.` })

    const url     = new URL(req.url, 'http://localhost')
    const fk      = url.searchParams.get('fk')
    const id      = url.searchParams.get('id')
    const through = url.searchParams.get('through') === 'true'
    const page    = Number(url.searchParams.get('page') ?? 1)

    if (!fk || !id) return res.status(422).json({ message: 'fk and id query params are required.' })

    let q: QueryBuilderLike<RecordRow> = through
      // M2M: WHERE relation.some.id = parentId (Prisma nested filter)
      ? Model.query().where(fk, { some: { id } })
      // FK:  WHERE foreignKey = parentId
      : Model.query().where(fk, id)

    // Include belongsTo and belongsToMany relations so display values are available
    const relFormFields = flattenFields(new ResourceClass()._resolveForm().getFields() as import('../Resource.js').FieldOrGrouping[])
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
  }, mw)

  // ── GET /panel/api/resource/_schema — field definitions for inline create ──
  router.get(`${base}/_schema`, async (_req, res) => {
    const resource     = new ResourceClass()
    const resourceMeta = resource.toMeta()
    return res.json({ resourceMeta })
  }, mw)

  // ── GET /panel/api/resource/_options — relation select options ──
  router.get(`${base}/_options`, async (req, res) => {
    if (!Model) return res.status(500).json({ message: `Resource "${slug}" has no model defined.` })

    const url   = new URL(req.url, 'http://localhost')
    const label = url.searchParams.get('label') ?? 'name'

    const records: RecordRow[] = await Model.query().all()
    const options = records.map((r) => ({
      value: String(r['id']),
      label: String(r[label] ?? r['id']),
    }))
    return res.json(options)
  }, mw)

  // ── GET /panel/api/resource/:id — show ────────────────
  router.get(`${base}/:id`, async (req, res) => {
    const resource = new ResourceClass()
    const ctx      = buildContext(req)
    if (!await resource.policy('view', ctx)) return res.status(403).json({ message: 'Forbidden.' })
    if (!Model) return res.status(500).json({ message: `Resource "${slug}" has no model defined.` })

    const id     = param(req, 'id')

    // Include belongsToMany relations so the edit form can populate multi-selects
    const showFormFields = flattenFields(resource._resolveForm().getFields() as import('../Resource.js').FieldOrGrouping[])
    const manyRelations = showFormFields
      .filter(f => f.getType() === 'belongsToMany')
      .map(f => f.getName())

    let q: QueryBuilderLike<RecordRow> = Model.query()
    for (const rel of manyRelations) q = q.with(rel)
    const record = await q.find(id)

    if (!record) return res.status(404).json({ message: 'Record not found.' })

    // Strip unreadable fields
    const readableNamesForShow = new Set(
      showFormFields.filter(f => f.canRead(ctx)).map(f => f.getName())
    )
    readableNamesForShow.add('id')
    const filteredRecord = Object.fromEntries(
      Object.entries(record as Record<string, unknown>).filter(([k]) => readableNamesForShow.has(k))
    )
    const [transformedRecord] = applyTransforms(resource, [filteredRecord])
    return res.json({ data: transformedRecord })
  }, mw)

  // ── POST /panel/api/resource — create ─────────────────
  router.post(base, async (req, res) => {
    const resource = new ResourceClass()
    const ctx      = buildContext(req)
    if (!await resource.policy('create', ctx)) return res.status(403).json({ message: 'Forbidden.' })
    if (!Model) return res.status(500).json({ message: `Resource "${slug}" has no model defined.` })

    const raw    = req.body as Record<string, unknown>
    const body   = coercePayload(resource, raw, 'create')
    const errors = await validatePayload(resource, body, 'create')
    if (errors) return res.status(422).json({ message: 'Validation failed.', errors })

    // Draftable: default draftStatus to 'draft' unless explicitly set
    if (isDraftable && !body['draftStatus']) {
      body['draftStatus'] = 'draft'
    }

    const record = await Model.create(body)
    if (isLive) liveBroadcast(slug, 'record.created', { id: (record as RecordRow)['id'] })
    return res.status(201).json({ data: record })
  }, mw)

  // ── PUT /panel/api/resource/:id — update ──────────────
  router.put(`${base}/:id`, async (req, res) => {
    const resource = new ResourceClass()
    const ctx      = buildContext(req)
    if (!await resource.policy('update', ctx)) return res.status(403).json({ message: 'Forbidden.' })
    if (!Model) return res.status(500).json({ message: `Resource "${slug}" has no model defined.` })

    const id     = param(req, 'id')
    const exists = await Model.find(id)
    if (!exists) return res.status(404).json({ message: 'Record not found.' })

    const raw    = req.body as Record<string, unknown>
    const body   = coercePayload(resource, raw, 'update')
    // Inject id so per-field validators can exclude the current record (e.g. unique slug)
    const errors = await validatePayload(resource, { ...body, id }, 'update')
    if (errors) return res.status(422).json({ message: 'Validation failed.', errors })

    const record = await Model.query().update(id, body)
    if (isLive) liveBroadcast(slug, 'record.updated', { id })
    return res.json({ data: record })
  }, mw)

  // ── DELETE /panel/api/resource/:id — delete (or soft-delete) ───
  router.delete(`${base}/:id`, async (req, res) => {
    const resource = new ResourceClass()
    const ctx      = buildContext(req)
    if (!await resource.policy('delete', ctx)) return res.status(403).json({ message: 'Forbidden.' })
    if (!Model) return res.status(500).json({ message: `Resource "${slug}" has no model defined.` })

    const id     = param(req, 'id')
    const exists = await Model.find(id)
    if (!exists) return res.status(404).json({ message: 'Record not found.' })

    const delSoftDeletes = resource._resolveTable().getConfig().softDeletes
    if (delSoftDeletes) {
      await Model.query().update(id, { deletedAt: new Date() })
    } else {
      await Model.query().delete(id)
    }
    if (isLive) liveBroadcast(slug, 'record.deleted', { id })
    return res.json({ message: 'Deleted successfully.' })
  }, mw)

  // ── DELETE /panel/api/resource — bulk delete (or soft-delete) ──
  router.delete(base, async (req, res) => {
    const resource = new ResourceClass()
    const ctx      = buildContext(req)
    if (!await resource.policy('delete', ctx)) return res.status(403).json({ message: 'Forbidden.' })
    if (!Model) return res.status(500).json({ message: `Resource "${slug}" has no model defined.` })

    const { ids } = req.body as { ids?: string[] }
    if (!ids?.length) return res.status(422).json({ message: 'No records selected.' })

    const bulkSoftDeletes = resource._resolveTable().getConfig().softDeletes
    let deleted = 0
    for (const id of ids) {
      const exists = await Model.find(id)
      if (exists) {
        if (bulkSoftDeletes) {
          await Model.query().update(id, { deletedAt: new Date() })
        } else {
          await Model.query().delete(id)
        }
        deleted++
      }
    }

    if (isLive) liveBroadcast(slug, 'records.deleted', { ids, deleted })
    return res.json({ message: `${deleted} records deleted.`, deleted })
  }, mw)

  // ── POST /panel/api/resource/_action/:action — bulk action
  router.post(`${base}/_action/:action`, async (req, res) => {
    const resource = new ResourceClass()
    const ctx      = buildContext(req)
    if (!await resource.policy('update', ctx)) return res.status(403).json({ message: 'Forbidden.' })

    const actionName = param(req, 'action')
    const tableActions = resource._resolveTable().getConfig().actions
    const action       = tableActions.find((a: Action) => a.getName() === actionName)
    if (!action) return res.status(404).json({ message: `Action "${actionName}" not found.` })

    const { ids } = req.body as { ids?: string[] }
    if (!ids?.length) return res.status(422).json({ message: 'No records selected.' })

    // Fetch the records and execute the action
    const records: unknown[] = []
    if (Model) {
      for (const id of ids) {
        const record = await Model.find(id)
        if (record) records.push(record)
      }
    }

    await action.execute(records)
    if (isLive) liveBroadcast(slug, 'action.executed', { action: actionName, ids })
    return res.json({ message: 'Action executed successfully.' })
  }, mw)

  // ── Soft-delete routes (restore + force delete) ───
  const resolvedSoftDeletes = new ResourceClass()._resolveTable().getConfig().softDeletes
  if (resolvedSoftDeletes) {
    // POST /panel/api/resource/:id/_restore — restore a soft-deleted record
    router.post(`${base}/:id/_restore`, async (req: AppRequest, res: AppResponse) => {
      const resource = new ResourceClass()
      const ctx      = buildContext(req)
      if (!await resource.policy('restore', ctx)) return res.status(403).json({ message: 'Forbidden.' })
      if (!Model) return res.status(500).json({ message: `Resource "${slug}" has no model defined.` })

      const id     = param(req, 'id')
      const exists = await Model.find(id)
      if (!exists) return res.status(404).json({ message: 'Record not found.' })

      await Model.query().update(id, { deletedAt: null })
      if (isLive) liveBroadcast(slug, 'record.restored', { id })
      return res.json({ message: 'Record restored.' })
    }, mw)

    // DELETE /panel/api/resource/:id/_force — permanently delete
    router.delete(`${base}/:id/_force`, async (req: AppRequest, res: AppResponse) => {
      const resource = new ResourceClass()
      const ctx      = buildContext(req)
      if (!await resource.policy('forceDelete', ctx)) return res.status(403).json({ message: 'Forbidden.' })
      if (!Model) return res.status(500).json({ message: `Resource "${slug}" has no model defined.` })

      const id     = param(req, 'id')
      const exists = await Model.find(id)
      if (!exists) return res.status(404).json({ message: 'Record not found.' })

      await Model.query().delete(id)
      if (isLive) liveBroadcast(slug, 'record.forceDeleted', { id })
      return res.json({ message: 'Permanently deleted.' })
    }, mw)

    // POST /panel/api/resource/_restore — bulk restore
    router.post(`${base}/_restore`, async (req: AppRequest, res: AppResponse) => {
      const resource = new ResourceClass()
      const ctx      = buildContext(req)
      if (!await resource.policy('restore', ctx)) return res.status(403).json({ message: 'Forbidden.' })
      if (!Model) return res.status(500).json({ message: `Resource "${slug}" has no model defined.` })

      const { ids } = req.body as { ids?: string[] }
      if (!ids?.length) return res.status(422).json({ message: 'No records selected.' })

      let restored = 0
      for (const id of ids) {
        const exists = await Model.find(id)
        if (exists) {
          await Model.query().update(id, { deletedAt: null })
          restored++
        }
      }

      if (isLive) liveBroadcast(slug, 'records.restored', { ids, restored })
      return res.json({ message: `${restored} records restored.`, restored })
    }, mw)

    // DELETE /panel/api/resource/_force — bulk force delete
    router.delete(`${base}/_force`, async (req: AppRequest, res: AppResponse) => {
      const resource = new ResourceClass()
      const ctx      = buildContext(req)
      if (!await resource.policy('forceDelete', ctx)) return res.status(403).json({ message: 'Forbidden.' })
      if (!Model) return res.status(500).json({ message: `Resource "${slug}" has no model defined.` })

      const { ids } = req.body as { ids?: string[] }
      if (!ids?.length) return res.status(422).json({ message: 'No records selected.' })

      let deleted = 0
      for (const id of ids) {
        const exists = await Model.find(id)
        if (exists) {
          await Model.query().delete(id)
          deleted++
        }
      }

      if (isLive) liveBroadcast(slug, 'records.forceDeleted', { ids, deleted })
      return res.json({ message: `${deleted} records permanently deleted.`, deleted })
    }, mw)
  }

  // ── Agent routes (resources with AI agents) ─────────────────
  if (mountResource.agents().length > 0) {
    router.post(`${base}/:id/_agents/:agentSlug`, async (req, res) => {
      return handleAgentRun(req, res, ResourceClass, panel.getName())
    }, mw)
  }

  // ── Version routes (versioned or collaborative resources) ───
  const versionResource = new ResourceClass()
  const hasCollabFields = flattenFields(versionResource._resolveForm().getFields() as import('../Resource.js').FieldOrGrouping[]).some(f => f.isYjs())
  if (isVersioned || hasCollabFields) {
    mountVersionRoutes(router, panel, ResourceClass, mw)
  }
}
