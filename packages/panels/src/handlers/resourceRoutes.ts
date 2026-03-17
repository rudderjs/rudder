import type { MiddlewareHandler, AppRequest, AppResponse } from '@boostkit/core'
import type { RouterLike } from './types.js'
import type { Panel } from '../Panel.js'
import type { Resource } from '../Resource.js'
import type { Action } from '../Action.js'
import {
  flattenFields, relationName, buildContext,
  coercePayload, validatePayload, applyTransforms, liveBroadcast,
} from './utils.js'
import { mountVersionRoutes } from './versionRoutes.js'

export function mountResourceRoutes(
  router: RouterLike,
  panel: Panel,
  ResourceClass: typeof Resource,
  mw: MiddlewareHandler[],
): void {
  const slug    = ResourceClass.getSlug()
  const base    = `${panel.getApiBase()}/${slug}`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Model   = ResourceClass.model as any

  // ── GET /panel/api/resource — list (paginated) ────────
  router.get(base, async (req, res) => {
    const resource = new ResourceClass()
    const ctx      = buildContext(req)
    if (!await resource.policy('viewAny', ctx)) return res.status(403).json({ message: 'Forbidden.' })
    if (!Model) return res.status(500).json({ message: `Resource "${slug}" has no model defined.` })

    const page    = Number((req.query as Record<string, string>)['page']    ?? 1)
    const perPage = Math.min(Number((req.query as Record<string, string>)['perPage'] ?? ResourceClass.perPage), 100)

    const url    = new URL(req.url, 'http://localhost')
    const sort   = url.searchParams.get('sort') ?? undefined
    const dir    = (url.searchParams.get('dir') ?? 'ASC').toUpperCase() as 'ASC' | 'DESC'
    const search = url.searchParams.get('search') ?? undefined

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = Model.query()

    // Soft deletes — filter by trashed status
    const hasSoftDeletes = (ResourceClass as any).softDeletes === true
    const trashed        = url.searchParams.get('trashed') === 'true'
    if (hasSoftDeletes) {
      if (trashed) {
        q = q.where('deletedAt', '!=', null)
      } else {
        q = q.where('deletedAt', null)
      }
    }

    // Draftable — filter by draft status
    const hasDraftable = (ResourceClass as any).draftable === true
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
    for (const f of flattenFields(resource.fields()).filter(f => f.getType() === 'belongsTo')) {
      q = q.with(relationName(f))
    }

    // Sort — only on fields marked sortable()
    if (sort) {
      const sortableFields = flattenFields(resource.fields()).filter(f => f.isSortable()).map(f => f.getName())
      if (sortableFields.includes(sort)) {
        q = q.orderBy(sort, dir)
      }
    }

    // Search — LIKE across all searchable fields (OR)
    if (search) {
      const searchableCols = flattenFields(resource.fields()).filter(f => f.isSearchable()).map(f => f.getName())
      if (searchableCols.length > 0) {
        q = q.where(searchableCols[0]!, 'LIKE', `%${search}%`)
        for (let i = 1; i < searchableCols.length; i++) {
          q = q.orWhere(searchableCols[i]!, `%${search}%`)
        }
      }
    }

    // Filters — ?filter[field]=value
    for (const filter of resource.filters()) {
      const value = url.searchParams.get(`filter[${filter.getName()}]`)
      if (value !== null && value !== '') {
        q = filter.applyToQuery(q, value)
      }
    }

    const result = await q.paginate(page, perPage)

    // Strip unreadable fields from each record
    const allFields = flattenFields(resource.fields())
    const readableNames = new Set(
      allFields.filter(f => f.canRead(ctx)).map(f => f.getName())
    )
    readableNames.add('id')
    result.data = (result.data as Record<string, unknown>[]).map((r) =>
      Object.fromEntries(Object.entries(r).filter(([k]) => readableNames.has(k)))
    )

    result.data = applyTransforms(resource, result.data as unknown[]) as typeof result.data

    return res.json({
      data: result.data,
      meta: {
        total:       result.total,
        currentPage: result.currentPage,
        perPage:     result.perPage,
        lastPage:    result.lastPage,
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = through
      // M2M: WHERE relation.some.id = parentId (Prisma nested filter)
      ? Model.query().where(fk, { some: { id } })
      // FK:  WHERE foreignKey = parentId
      : Model.query().where(fk, id)

    // Include belongsTo and belongsToMany relations so display values are available
    for (const f of flattenFields(new ResourceClass().fields())) {
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const records: any[] = await Model.query().all()
    const options = records.map((r: any) => ({
      value: String(r.id),
      label: String(r[label] ?? r.id),
    }))
    return res.json(options)
  }, mw)

  // ── GET /panel/api/resource/:id — show ────────────────
  router.get(`${base}/:id`, async (req, res) => {
    const resource = new ResourceClass()
    const ctx      = buildContext(req)
    if (!await resource.policy('view', ctx)) return res.status(403).json({ message: 'Forbidden.' })
    if (!Model) return res.status(500).json({ message: `Resource "${slug}" has no model defined.` })

    const id = (req.params as Record<string, string>)['id']

    // Include belongsToMany relations so the edit form can populate multi-selects
    const manyRelations = flattenFields(new ResourceClass().fields())
      .filter(f => f.getType() === 'belongsToMany')
      .map(f => f.getName())

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = Model.query()
    for (const rel of manyRelations) q = q.with(rel)
    const record = await q.find(id)

    if (!record) return res.status(404).json({ message: 'Record not found.' })

    // Strip unreadable fields
    const allFieldsForShow = flattenFields(resource.fields())
    const readableNamesForShow = new Set(
      allFieldsForShow.filter(f => f.canRead(ctx)).map(f => f.getName())
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
    if ((ResourceClass as any).draftable && !body['draftStatus']) {
      body['draftStatus'] = 'draft'
    }

    const record = await Model.create(body)
    if ((ResourceClass as any).live) liveBroadcast(slug, 'record.created', { id: (record as any).id })
    return res.status(201).json({ data: record })
  }, mw)

  // ── PUT /panel/api/resource/:id — update ──────────────
  router.put(`${base}/:id`, async (req, res) => {
    const resource = new ResourceClass()
    const ctx      = buildContext(req)
    if (!await resource.policy('update', ctx)) return res.status(403).json({ message: 'Forbidden.' })
    if (!Model) return res.status(500).json({ message: `Resource "${slug}" has no model defined.` })

    const id     = (req.params as Record<string, string>)['id']
    const exists = await Model.find(id)
    if (!exists) return res.status(404).json({ message: 'Record not found.' })

    const raw    = req.body as Record<string, unknown>
    const body   = coercePayload(resource, raw, 'update')
    // Inject id so per-field validators can exclude the current record (e.g. unique slug)
    const errors = await validatePayload(resource, { ...body, id }, 'update')
    if (errors) return res.status(422).json({ message: 'Validation failed.', errors })

    const record = await Model.query().update(id, body)
    if ((ResourceClass as any).live) liveBroadcast(slug, 'record.updated', { id })
    return res.json({ data: record })
  }, mw)

  // ── DELETE /panel/api/resource/:id — delete (or soft-delete) ───
  router.delete(`${base}/:id`, async (req, res) => {
    const resource = new ResourceClass()
    const ctx      = buildContext(req)
    if (!await resource.policy('delete', ctx)) return res.status(403).json({ message: 'Forbidden.' })
    if (!Model) return res.status(500).json({ message: `Resource "${slug}" has no model defined.` })

    const id     = (req.params as Record<string, string>)['id']
    const exists = await Model.find(id)
    if (!exists) return res.status(404).json({ message: 'Record not found.' })

    if ((ResourceClass as any).softDeletes) {
      await Model.query().update(id, { deletedAt: new Date() })
    } else {
      await Model.query().delete(id)
    }
    if ((ResourceClass as any).live) liveBroadcast(slug, 'record.deleted', { id })
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

    let deleted = 0
    for (const id of ids) {
      const exists = await Model.find(id)
      if (exists) {
        if ((ResourceClass as any).softDeletes) {
          await Model.query().update(id, { deletedAt: new Date() })
        } else {
          await Model.query().delete(id)
        }
        deleted++
      }
    }

    if ((ResourceClass as any).live) liveBroadcast(slug, 'records.deleted', { ids, deleted })
    return res.json({ message: `${deleted} records deleted.`, deleted })
  }, mw)

  // ── POST /panel/api/resource/_action/:action — bulk action
  router.post(`${base}/_action/:action`, async (req, res) => {
    const resource = new ResourceClass()
    const ctx      = buildContext(req)
    if (!await resource.policy('update', ctx)) return res.status(403).json({ message: 'Forbidden.' })

    const actionName = (req.params as Record<string, string>)['action']
    const action     = resource.actions().find((a: Action) => a.getName() === actionName)
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
    if ((ResourceClass as any).live) liveBroadcast(slug, 'action.executed', { action: actionName, ids })
    return res.json({ message: 'Action executed successfully.' })
  }, mw)

  // ── Soft-delete routes (restore + force delete) ───
  if ((ResourceClass as any).softDeletes) {
    // POST /panel/api/resource/:id/_restore — restore a soft-deleted record
    router.post(`${base}/:id/_restore`, async (req: AppRequest, res: AppResponse) => {
      const resource = new ResourceClass()
      const ctx      = buildContext(req)
      if (!await resource.policy('restore', ctx)) return res.status(403).json({ message: 'Forbidden.' })
      if (!Model) return res.status(500).json({ message: `Resource "${slug}" has no model defined.` })

      const id     = (req.params as Record<string, string>)['id']
      const exists = await Model.find(id)
      if (!exists) return res.status(404).json({ message: 'Record not found.' })

      await Model.query().update(id, { deletedAt: null })
      if ((ResourceClass as any).live) liveBroadcast(slug, 'record.restored', { id })
      return res.json({ message: 'Record restored.' })
    }, mw)

    // DELETE /panel/api/resource/:id/_force — permanently delete
    router.delete(`${base}/:id/_force`, async (req: AppRequest, res: AppResponse) => {
      const resource = new ResourceClass()
      const ctx      = buildContext(req)
      if (!await resource.policy('forceDelete', ctx)) return res.status(403).json({ message: 'Forbidden.' })
      if (!Model) return res.status(500).json({ message: `Resource "${slug}" has no model defined.` })

      const id     = (req.params as Record<string, string>)['id']
      const exists = await Model.find(id)
      if (!exists) return res.status(404).json({ message: 'Record not found.' })

      await Model.query().delete(id)
      if ((ResourceClass as any).live) liveBroadcast(slug, 'record.forceDeleted', { id })
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

      if ((ResourceClass as any).live) liveBroadcast(slug, 'records.restored', { ids, restored })
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

      if ((ResourceClass as any).live) liveBroadcast(slug, 'records.forceDeleted', { ids, deleted })
      return res.json({ message: `${deleted} records permanently deleted.`, deleted })
    }, mw)
  }

  // ── Version routes (versioned or collaborative resources) ───
  const hasCollabFields = flattenFields(new ResourceClass().fields()).some(f => f.isYjs())
  if ((ResourceClass as any).versioned || hasCollabFields) {
    mountVersionRoutes(router, panel, ResourceClass, mw)
  }
}
