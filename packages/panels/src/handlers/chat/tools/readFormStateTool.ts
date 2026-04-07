import { loadAi } from '../lazyImports.js'

/**
 * Build a "read_form_state" client tool — definition only, no `execute`.
 * The browser handler is registered in the panels frontend via
 * `registerClientTool('read_form_state', ...)` in SchemaForm.
 *
 * Use case: lets the AI assistant ask for the user's current local form
 * values, including unsaved edits to non-collaborative fields that don't
 * sync to the server-side Yjs document.
 */
export async function buildReadFormStateTool() {
  const { toolDefinition, z } = await loadAi()

  return toolDefinition({
    name: 'read_form_state',
    description: [
      'Read the user\'s current local form values, including unsaved changes',
      'to non-collaborative fields. Use this when the user asks about a field',
      'value and the record loaded from the server may be stale (typically',
      'because they\'ve been editing without saving).',
    ].join(' '),
    inputSchema: z.object({
      fields: z.array(z.string()).optional().describe('Optional list of field names to read; omit for all fields'),
    }),
  })
  // No `.server()` — this is a client tool. The browser executes it.
}
