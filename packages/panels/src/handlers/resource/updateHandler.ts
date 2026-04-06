import type { AppRequest, AppResponse } from '@rudderjs/core'
import type { Resource } from '../../Resource.js'
import type { ModelClass, RecordRow } from '../../types.js'
import { buildContext, liveBroadcast } from '../shared/context.js'
import { coercePayload } from '../shared/coercion.js'
import { validatePayload } from '../shared/validation.js'

export function handleUpdate(
  ResourceClass: typeof Resource,
  slug: string,
  Model: ModelClass<RecordRow>,
  isLive: boolean,
) {
  return async (req: AppRequest, res: AppResponse) => {
    const resource = new ResourceClass()
    const ctx      = buildContext(req)
    if (!await resource.policy('update', ctx)) return res.status(403).json({ message: 'Forbidden.' })

    const id = (req.params as Record<string, string | undefined>)['id'] ?? ''
    const exists = await Model.find(id)
    if (!exists) return res.status(404).json({ message: 'Record not found.' })

    const raw    = req.body as Record<string, unknown>
    const body   = coercePayload(resource, raw, 'update')
    const errors = await validatePayload(resource, { ...body, id }, 'update')
    if (errors) return res.status(422).json({ message: 'Validation failed.', errors })

    const record = await Model.query().update(id, body)
    if (isLive) liveBroadcast(slug, 'record.updated', { id })
    return res.json({ data: record })
  }
}
