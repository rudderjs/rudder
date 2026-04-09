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
        '⚠️ HEADLESS-ONLY text-editing tool. Edits plain text in a field.',
        'Use "rewrite" to replace the entire field content with new text.',
        'Use "replace"/"insert_after"/"delete" for surgical edits to specific text.',
        'Block operations (insert_block / update_block / delete_block) are NOT supported here — they are only on `update_form_state`.',
        '🚫 DO NOT CALL THIS TOOL when there is a user interacting with the page; use `update_form_state` instead.',
        'Available fields: ' + allFields.join(', '),
      ].join(' ')

  return toolDefinition({
    name: 'edit_text',
    description: editTextDescription,
    // Block operations (insert_block / update_block / delete_block) are
    // intentionally absent from this schema. `edit_text` writes server-
    // side directly to the Y.Doc, which the browser may not be listening
    // to (non-collab fields, mid-edit collab fields), so block ops here
    // would silently lie to the user. Block ops live exclusively on
    // `update_form_state` (the browser-routed write path) — see
    // `updateFormStateTool.ts`. Removing the variants from the schema
    // is the structural enforcement; the soft prompt-side rule was
    // ignored by the model.
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

      let applied = 0
      for (const op of input.operations) {
        if (op.type === 'rewrite') {
          if (Live.rewriteText(fieldDocName, op.content as string, aiCursor)) applied++
        } else {
          if (Live.editText(fieldDocName, op as any, aiCursor)) applied++
        }
      }
      setTimeout(() => Live.clearAiAwareness(fieldDocName), 2000)
      return `Applied ${applied}/${input.operations.length} edit(s) to "${targetField}"`
    } else {
      let current = String(record[targetField] ?? '')
      try {
        const yjsFields = Live.readMap(docName, 'fields')
        if (yjsFields[targetField] != null) current = String(yjsFields[targetField])
      } catch { /* */ }

      for (const op of input.operations) {
        if (op.type === 'rewrite') { current = op.content as string; continue }
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
