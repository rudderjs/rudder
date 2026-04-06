import type { AppRequest, AppResponse } from '@rudderjs/core'
import type { Resource } from '../../Resource.js'
import type { Action } from '../../schema/Action.js'
import type { ModelClass, RecordRow } from '../../types.js'
import { buildContext, liveBroadcast } from '../shared/context.js'

export function handleAction(
  ResourceClass: typeof Resource,
  slug: string,
  Model: ModelClass<RecordRow> | undefined,
  isLive: boolean,
) {
  return async (req: AppRequest, res: AppResponse) => {
    const resource = new ResourceClass()
    const ctx      = buildContext(req)
    if (!await resource.policy('update', ctx)) return res.status(403).json({ message: 'Forbidden.' })

    const actionName = (req.params as Record<string, string | undefined>)['action'] ?? ''
    const tableActions = resource._resolveTable().getConfig().actions
    const action       = tableActions.find((a: Action) => a.getName() === actionName)
    if (!action) return res.status(404).json({ message: `Action "${actionName}" not found.` })

    const { ids, formData } = req.body as { ids?: string[]; formData?: Record<string, unknown> }
    if (!ids?.length) return res.status(422).json({ message: 'No records selected.' })

    const records: unknown[] = []
    if (Model) {
      for (const id of ids) {
        const record = await Model.find(id)
        if (record) records.push(record)
      }
    }

    await action.execute(records, formData)
    if (isLive) liveBroadcast(slug, 'action.executed', { action: actionName, ids })
    return res.json({ message: 'Action executed successfully.' })
  }
}
