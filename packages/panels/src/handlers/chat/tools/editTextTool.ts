import type { PanelAgentContext } from '../../../agents/PanelAgent.js'
import { loadAi, loadLive } from '../lazyImports.js'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Map from field name to the allowed block type names declared on that field
 * via `BuilderField.blocks([...])` or `RichContentField.blocks([...])`.
 * Used to reject `insert_block` calls with unknown block types — without this
 * the agent can hallucinate block types and the editor renders them as
 * "Unknown block type: …".
 */
export type FieldBlockAllowlist = Record<string, Set<string>>

export async function buildEditTextTool(
  agentCtx: PanelAgentContext,
  allFields: string[],
  record: Record<string, unknown>,
  selection?: { field: string; text: string } | undefined,
  blockAllowlist: FieldBlockAllowlist = {},
) {
  if (allFields.length === 0) return null

  const { toolDefinition, z } = await loadAi()
  const Live = await loadLive()

  const selectionField = selection?.field

  // When selection is active, lock the tool to only the selected field
  const editFieldSchema = selectionField && allFields.includes(selectionField)
    ? z.literal(selectionField)
    : z.enum(allFields as [string, ...string[]])

  const editTextDescription = selectionField
    ? `Edit text in the "${selectionField}" field. The user selected specific text — your operations MUST target that text within "${selectionField}". Do NOT edit other fields.`
    : [
        'Edit text or blocks in a field.',
        'Use "rewrite" to replace the entire field content with new text (for full rewrites, translations, shortening).',
        'Use "replace"/"insert_after"/"delete" for surgical edits to specific text.',
        'Use "insert_block"/"update_block"/"delete_block" for embedded blocks shown as [BLOCK: ...] in the record.',
        'Available fields: ' + allFields.join(', '),
      ].join(' ')

  return toolDefinition({
    name: 'edit_text',
    description: editTextDescription,
    inputSchema: z.object({
      field: editFieldSchema,
      operations: z.array(z.union([
        z.object({
          type: z.literal('rewrite'),
          content: z.string().describe('The complete new text content — replaces everything in the field'),
        }),
        z.object({
          type: z.literal('replace'),
          search: z.string().describe('Exact text to find'),
          replace: z.string().describe('Replacement text'),
        }),
        z.object({
          type: z.literal('insert_after'),
          search: z.string().describe('Text to find — new text inserted after it'),
          text: z.string().describe('Text to insert'),
        }),
        z.object({
          type: z.literal('delete'),
          search: z.string().describe('Exact text to delete'),
        }),
        z.object({
          type: z.literal('update_block'),
          blockType: z.string().describe('The block type (e.g. "callToAction", "video")'),
          blockIndex: z.number().describe('0-based index if multiple blocks of the same type'),
          field: z.string().describe('The block field to update (e.g. "title", "buttonText")'),
          value: z.string().describe('The new value'),
        }),
        z.object({
          type: z.literal('insert_block'),
          blockType: z.string().describe('Block type from the available block catalog'),
          blockData: z.record(z.string(), z.unknown()).describe('Field values keyed by the block schema field names'),
          position: z.number().optional().describe('0-based paragraph index. Omit to append at end. Negative counts from end.'),
        }),
        z.object({
          type: z.literal('delete_block'),
          blockType: z.string().describe('The block type to delete (e.g. "callToAction")'),
          blockIndex: z.number().describe('0-based index of the block to remove (across all blocks of this type)'),
        }),
      ])),
    }),
  }).server(async (input: { field: string; operations: Array<Record<string, unknown>> }) => {
    const targetField = selectionField && allFields.includes(selectionField) ? selectionField : input.field
    const fieldInfo = agentCtx.fieldMeta?.[targetField]
    const isCollab = fieldInfo?.yjs === true
    const docName = `panel:${agentCtx.resourceSlug}:${agentCtx.recordId}`

    if (isCollab) {
      const fragment = fieldInfo.type === 'richcontent' ? 'richcontent' : 'text'
      const fieldDocName = `${docName}:${fragment}:${targetField}`
      const aiCursor = { name: 'AI Assistant', color: '#8b5cf6' }
      const allowedBlocks = blockAllowlist[targetField]

      let applied = 0
      const rejected: string[] = []
      for (const op of input.operations) {
        // Reject block ops with types not declared on this field, regardless
        // of whether the system prompt taught the agent the catalog. The
        // editor renders unknown blocks as "Unknown block type: ..." which
        // looks like a successful edit, so the agent can't self-correct.
        if (
          allowedBlocks &&
          (op.type === 'insert_block' || op.type === 'update_block' || op.type === 'delete_block') &&
          typeof op.blockType === 'string' &&
          !allowedBlocks.has(op.blockType)
        ) {
          rejected.push(`${op.type}: "${op.blockType}" is not a valid block type for "${targetField}". Allowed: ${[...allowedBlocks].join(', ') || '(none)'}`)
          continue
        }
        if (op.type === 'rewrite') {
          if (Live.rewriteText(fieldDocName, op.content as string, aiCursor)) applied++
        } else if (op.type === 'update_block') {
          if (Live.editBlock(fieldDocName, op.blockType as string, (op.blockIndex as number) ?? 0, op.field as string, op.value)) applied++
        } else if (op.type === 'insert_block') {
          if (Live.insertBlock(
            fieldDocName,
            op.blockType as string,
            (op.blockData as Record<string, unknown>) ?? {},
            op.position as number | undefined,
          )) applied++
        } else if (op.type === 'delete_block') {
          if (Live.removeBlock(fieldDocName, op.blockType as string, (op.blockIndex as number) ?? 0)) applied++
        } else {
          if (Live.editText(fieldDocName, op as any, aiCursor)) applied++
        }
      }
      setTimeout(() => Live.clearAiAwareness(fieldDocName), 2000)
      const summary = `Applied ${applied}/${input.operations.length} edit(s) to "${targetField}"`
      return rejected.length > 0
        ? `${summary}. Rejected: ${rejected.join('; ')}`
        : summary
    } else {
      let current = String(record[targetField] ?? '')
      try {
        const yjsFields = Live.readMap(docName, 'fields')
        if (yjsFields[targetField] != null) current = String(yjsFields[targetField])
      } catch { /* */ }

      for (const op of input.operations) {
        if (op.type === 'rewrite') { current = op.content as string; continue }
        if (op.type === 'update_block' || op.type === 'insert_block' || op.type === 'delete_block') continue
        const search = op.search as string
        if (op.type === 'replace' && search) current = current.replace(search, () => op.replace as string)
        else if (op.type === 'insert_after' && search) {
          const idx = current.indexOf(search)
          if (idx !== -1) current = current.slice(0, idx + search.length) + (op.text as string) + current.slice(idx + search.length)
        }
        else if (op.type === 'delete' && search) current = current.replace(search, () => '')
      }
      await Live.updateMap(docName, 'fields', targetField, current)
      return `Updated "${targetField}" successfully`
    }
  })
}

/* eslint-enable @typescript-eslint/no-explicit-any */
