import type { ModelClass, RecordRow } from '../../../types.js'
import { loadAi } from '../lazyImports.js'

/**
 * Build a "delete_record" server tool that requires user approval before
 * executing. Demonstrates the `needsApproval` flow end-to-end: the agent
 * loop pauses, the browser shows a confirmation modal, and execution only
 * proceeds after the user clicks Approve.
 */
export async function buildDeleteRecordTool(deps: {
  Model:    ModelClass<RecordRow>
  recordId: string
}) {
  const { Model, recordId } = deps
  const { toolDefinition, z } = await loadAi()

  return toolDefinition({
    name: 'delete_record',
    description: 'Permanently delete the current record. Requires explicit user approval.',
    inputSchema: z.object({
      reason: z.string().describe('Why this record should be deleted'),
    }),
    needsApproval: true,
  }).server(async ({ reason }: { reason: string }) => {
    // Only runs after the user clicks Approve in the inline card — see
    // `needsApproval` enforcement in @rudderjs/ai's runAgentLoop.
    const record = await Model.find(recordId)
    if (!record) return `Record ${recordId} not found.`

    // `Model.delete(id)` is a STATIC method on @rudderjs/orm Model classes.
    // It honors the model's `softDeletes` flag (sets `deletedAt`) when the
    // model opts in, otherwise hard-deletes via the query builder.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (Model as any).delete(recordId)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isSoft = (Model as any).softDeletes === true
    return isSoft
      ? `Record ${recordId} soft-deleted. Reason: ${reason}`
      : `Record ${recordId} deleted. Reason: ${reason}`
  })
}
