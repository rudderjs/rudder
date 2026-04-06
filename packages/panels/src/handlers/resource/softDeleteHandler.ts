import type { AppRequest, AppResponse } from '@rudderjs/core'
import type { Resource } from '../../Resource.js'
import type { ModelClass, RecordRow } from '../../types.js'
import { buildContext, liveBroadcast } from '../shared/context.js'

export function handleRestore(
  ResourceClass: typeof Resource,
  slug: string,
  Model: ModelClass<RecordRow>,
  isLive: boolean,
) {
  return async (req: AppRequest, res: AppResponse) => {
    const resource = new ResourceClass()
    const ctx      = buildContext(req)
    if (!await resource.policy('restore', ctx)) return res.status(403).json({ message: 'Forbidden.' })

    const id = (req.params as Record<string, string | undefined>)['id'] ?? ''
    const exists = await Model.find(id)
    if (!exists) return res.status(404).json({ message: 'Record not found.' })

    await Model.query().update(id, { deletedAt: null })
    if (isLive) liveBroadcast(slug, 'record.restored', { id })
    return res.json({ message: 'Record restored.' })
  }
}

export function handleForceDelete(
  ResourceClass: typeof Resource,
  slug: string,
  Model: ModelClass<RecordRow>,
  isLive: boolean,
) {
  return async (req: AppRequest, res: AppResponse) => {
    const resource = new ResourceClass()
    const ctx      = buildContext(req)
    if (!await resource.policy('forceDelete', ctx)) return res.status(403).json({ message: 'Forbidden.' })

    const id = (req.params as Record<string, string | undefined>)['id'] ?? ''
    const exists = await Model.find(id)
    if (!exists) return res.status(404).json({ message: 'Record not found.' })

    await Model.query().delete(id)
    if (isLive) liveBroadcast(slug, 'record.forceDeleted', { id })
    return res.json({ message: 'Permanently deleted.' })
  }
}

export function handleBulkRestore(
  ResourceClass: typeof Resource,
  slug: string,
  Model: ModelClass<RecordRow>,
  isLive: boolean,
) {
  return async (req: AppRequest, res: AppResponse) => {
    const resource = new ResourceClass()
    const ctx      = buildContext(req)
    if (!await resource.policy('restore', ctx)) return res.status(403).json({ message: 'Forbidden.' })

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
  }
}

export function handleBulkForceDelete(
  ResourceClass: typeof Resource,
  slug: string,
  Model: ModelClass<RecordRow>,
  isLive: boolean,
) {
  return async (req: AppRequest, res: AppResponse) => {
    const resource = new ResourceClass()
    const ctx      = buildContext(req)
    if (!await resource.policy('forceDelete', ctx)) return res.status(403).json({ message: 'Forbidden.' })

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
  }
}
