import type { AppRequest, AppResponse } from '@rudderjs/core'
import type { Resource } from '../../Resource.js'
import type { ModelClass, RecordRow } from '../../types.js'
import { buildContext, liveBroadcast } from '../shared/context.js'

export function handleDelete(
  ResourceClass: typeof Resource,
  slug: string,
  Model: ModelClass<RecordRow>,
  isLive: boolean,
) {
  return async (req: AppRequest, res: AppResponse) => {
    const resource = new ResourceClass()
    const ctx      = buildContext(req)
    if (!await resource.policy('delete', ctx)) return res.status(403).json({ message: 'Forbidden.' })

    const id = (req.params as Record<string, string | undefined>)['id'] ?? ''
    const exists = await Model.find(id)
    if (!exists) return res.status(404).json({ message: 'Record not found.' })

    const softDeletes = resource._resolveTable().getConfig().softDeletes
    if (softDeletes) {
      await Model.query().update(id, { deletedAt: new Date() })
    } else {
      await Model.query().delete(id)
    }
    if (isLive) liveBroadcast(slug, 'record.deleted', { id })
    return res.json({ message: 'Deleted successfully.' })
  }
}

export function handleBulkDelete(
  ResourceClass: typeof Resource,
  slug: string,
  Model: ModelClass<RecordRow>,
  isLive: boolean,
) {
  return async (req: AppRequest, res: AppResponse) => {
    const resource = new ResourceClass()
    const ctx      = buildContext(req)
    if (!await resource.policy('delete', ctx)) return res.status(403).json({ message: 'Forbidden.' })

    const { ids } = req.body as { ids?: string[] }
    if (!ids?.length) return res.status(422).json({ message: 'No records selected.' })

    const softDeletes = resource._resolveTable().getConfig().softDeletes
    let deleted = 0
    for (const id of ids) {
      const exists = await Model.find(id)
      if (exists) {
        if (softDeletes) {
          await Model.query().update(id, { deletedAt: new Date() })
        } else {
          await Model.query().delete(id)
        }
        deleted++
      }
    }

    if (isLive) liveBroadcast(slug, 'records.deleted', { ids, deleted })
    return res.json({ message: `${deleted} records deleted.`, deleted })
  }
}
