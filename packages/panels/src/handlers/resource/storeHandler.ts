import type { AppRequest, AppResponse } from '@rudderjs/core'
import type { Resource } from '../../Resource.js'
import type { ModelClass, RecordRow } from '../../types.js'
import { buildContext, liveBroadcast } from '../shared/context.js'
import { coercePayload } from '../shared/coercion.js'
import { validatePayload } from '../shared/validation.js'

export function handleStore(
  ResourceClass: typeof Resource,
  slug: string,
  Model: ModelClass<RecordRow>,
  isDraftable: boolean,
  isLive: boolean,
) {
  return async (req: AppRequest, res: AppResponse) => {
    const resource = new ResourceClass()
    const ctx      = buildContext(req)
    if (!await resource.policy('create', ctx)) return res.status(403).json({ message: 'Forbidden.' })

    const raw    = req.body as Record<string, unknown>
    const body   = coercePayload(resource, raw, 'create')
    const errors = await validatePayload(resource, body, 'create')
    if (errors) return res.status(422).json({ message: 'Validation failed.', errors })

    if (isDraftable && !body['draftStatus']) {
      body['draftStatus'] = 'draft'
    }

    const record = await Model.create(body)
    if (isLive) liveBroadcast(slug, 'record.created', { id: (record as RecordRow)['id'] })
    return res.status(201).json({ data: record })
  }
}
