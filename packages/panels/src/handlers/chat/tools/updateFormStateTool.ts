import { loadAi } from '../lazyImports.js'

/**
 * Build an `update_form_state` client tool — definition only, no `.server()`.
 *
 * Companion to `read_form_state`: where read fetches the user's live in-browser
 * form values, this writes back to them. The browser handler is registered in
 * `packages/panels/pages/_components/SchemaForm.tsx` via
 * `registerClientTool('update_form_state', ...)` and dispatches each op against
 * either:
 *   1. The React form state (`valuesRef` + `setField`) for plain fields.
 *   2. The live `LexicalEditor` instance via `editor.update()` for collab text
 *      and rich-content fields, surfaced through `lexicalRegistry`.
 *
 * Why this exists alongside the server-side `edit_text` tool:
 *
 * - `edit_text` is the **server-side** path: it mutates the Y.Doc directly via
 *   `@rudderjs/live`. Fast, no browser round-trip, but only works on
 *   collaborative fields and can't see the user's unsaved edits to non-collab
 *   fields.
 * - `update_form_state` is the **browser-routed** path: it's slower (one SSE
 *   round-trip per call), but it works on any field type — including
 *   `select` / `boolean` / `number` / `date` and non-collaborative text — and
 *   it always sees the user's unsaved local edits because it operates on the
 *   same React/Lexical state the user is typing into.
 *
 * The system prompt teaches the agent when to pick which (see
 * `ResourceChatContext.buildSystemPrompt`).
 */
export async function buildUpdateFormStateTool(allFields: string[]) {
  if (allFields.length === 0) return null
  const { toolDefinition, z } = await loadAi()

  return toolDefinition({
    name: 'update_form_state',
    description: [
      'Write to any form field by routing the edit through the user\'s browser.',
      'Use this tool when:',
      '(a) the field is non-collaborative (no `.collaborative()` / `.persist([\'websocket\'])`),',
      '(b) the field is a non-text type (select, boolean, number, date, tags, relation),',
      '(c) the user has unsaved changes you need to preserve, or',
      '(d) the field is currently focused / actively being edited by the user.',
      'For collaborative text/rich-content fields when none of the above apply,',
      'prefer `edit_text` for a faster path that skips the browser round-trip.',
      `Available fields: ${allFields.join(', ')}`,
    ].join(' '),
    inputSchema: z.object({
      field: z.enum(allFields as [string, ...string[]]),
      operations: z.array(z.union([
        // Any-field
        z.object({
          type: z.literal('set_value'),
          value: z.unknown().describe('The new value — any JSON type matching the field schema'),
        }),
        // Text/string ops
        z.object({
          type: z.literal('rewrite_text'),
          text: z.string().describe('The complete new text content — replaces everything in the field'),
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
        // Rich-text formatting ops (Lexical fields only)
        z.object({
          type: z.literal('format_text'),
          search: z.string().describe('Exact text whose formatting should change. Must lie within a single text run.'),
          marks: z.object({
            bold:          z.boolean().optional(),
            italic:        z.boolean().optional(),
            underline:     z.boolean().optional(),
            strikethrough: z.boolean().optional(),
            code:          z.boolean().optional(),
          }).describe('Set true to apply, false to remove. Omit to leave unchanged.'),
        }),
        z.object({
          type: z.literal('set_link'),
          search: z.string().describe('Exact text to wrap in a link'),
          url: z.string().describe('Link URL (absolute or root-relative)'),
        }),
        z.object({
          type: z.literal('unset_link'),
          search: z.string().describe('Text within the link to unwrap'),
        }),
        z.object({
          type: z.literal('set_paragraph_type'),
          selector: z.union([
            z.object({ paragraphIndex: z.number().describe('0-based child index of the paragraph to convert') }),
            z.object({ textContains: z.string().describe('First paragraph whose text content contains this substring') }),
          ]),
          paragraphType: z.enum(['paragraph', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'quote', 'code'])
            .describe('Target paragraph node type'),
        }),
        z.object({
          type: z.literal('insert_paragraph'),
          text: z.string().describe('Plain text content for the new paragraph'),
          position: z.number().optional().describe('0-based child index. Omit to append at end.'),
        }),
        // Block ops (rich-content fields only — allowlist enforced client-side)
        z.object({
          type: z.literal('insert_block'),
          blockType: z.string().describe('Block type from the available block catalog for this field'),
          blockData: z.record(z.string(), z.unknown()).describe('Field values keyed by the block schema field names'),
          position: z.number().optional().describe('0-based child index. Omit to append at end.'),
        }),
        z.object({
          type: z.literal('update_block'),
          blockType: z.string().describe('The block type (e.g. "callToAction", "video")'),
          blockIndex: z.number().describe('0-based index across blocks of this type within the field'),
          field: z.string().describe('The block field to update (e.g. "title", "buttonText")'),
          value: z.unknown().describe('The new value'),
        }),
        z.object({
          type: z.literal('delete_block'),
          blockType: z.string().describe('The block type to delete'),
          blockIndex: z.number().describe('0-based index across blocks of this type within the field'),
        }),
      ])),
    }),
  })
  // No `.server()` — this is a client tool. The browser executes it.
}
