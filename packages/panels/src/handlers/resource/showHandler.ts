import type { AppRequest, AppResponse } from '@rudderjs/core'
import type { Resource, FieldOrGrouping } from '../../Resource.js'
import type { ModelClass, QueryBuilderLike, RecordRow } from '../../types.js'
import { flattenFields } from '../shared/fields.js'
import { buildContext } from '../shared/context.js'
import { applyTransforms } from '../shared/transforms.js'

export function handleShow(
  ResourceClass: typeof Resource,
  slug: string,
  Model: ModelClass<RecordRow>,
) {
  return async (req: AppRequest, res: AppResponse) => {
    const resource = new ResourceClass()
    const ctx      = buildContext(req)
    if (!await resource.policy('view', ctx)) return res.status(403).json({ message: 'Forbidden.' })

    const id = (req.params as Record<string, string | undefined>)['id'] ?? ''

    const showFormFields = flattenFields(resource._resolveForm().getFields() as FieldOrGrouping[])
    const manyRelations = showFormFields
      .filter(f => f.getType() === 'belongsToMany')
      .map(f => f.getName())

    let q: QueryBuilderLike<RecordRow> = Model.query()
    for (const rel of manyRelations) q = q.with(rel)
    const record = await q.find(id)

    if (!record) return res.status(404).json({ message: 'Record not found.' })

    // Strip unreadable fields
    const readableNames = new Set(
      showFormFields.filter(f => f.canRead(ctx)).map(f => f.getName())
    )
    readableNames.add('id')
    const filteredRecord = Object.fromEntries(
      Object.entries(record as Record<string, unknown>).filter(([k]) => readableNames.has(k))
    )
    const [transformedRecord] = applyTransforms(resource, [filteredRecord])
    return res.json({ data: transformedRecord })
  }
}
