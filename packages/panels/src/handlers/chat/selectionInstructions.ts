/**
 * Builds the system-prompt instructions block for "selection mode" — when the
 * user has highlighted text in a field and the agent should run a scoped edit
 * against ONLY that selection.
 *
 * Single source of truth shared between the chat path
 * (`ResourceChatContext.buildSystemPrompt()`) and the standalone path
 * (`PanelAgent.resolveInstructions()`). Without this helper the two paths
 * drift — see `feedback_chat_selection_mode_prompt.md` for the bug that
 * motivated extracting it.
 *
 * The block tells the model to:
 *   - Use `update_form_state` (never `edit_text`) — load-bearing for
 *     non-collaborative fields where `edit_text` silently no-ops while
 *     reporting success
 *   - Pass the selected text as the `search` argument for whichever op
 *     matches the user intent (replace / delete / format_text / etc.)
 *   - Treat every action verb as scoped to the selection, not the field
 *     or the record (defends against "delete selected" being misread as
 *     "delete the record")
 *   - Stop after one tool call (defends against the agent loop continuing
 *     past the scoped edit)
 *
 * Callers must ALSO filter the toolkit to `update_form_state` +
 * `read_form_state` only — the prompt is the soft defense, the toolkit
 * filter is the structural one.
 */
export function buildSelectionInstructions(selection: { field: string; text: string }): string {
  return [
    `## ACTIVE SELECTION — "${selection.field}" field`,
    'The user selected this text:',
    '"""',
    selection.text,
    '"""',
    '',
    'INSTRUCTIONS:',
    `1. You MUST call \`update_form_state\` to apply the change. Do NOT use \`edit_text\` — it cannot reliably write to non-collaborative fields and has no formatting ops, so calling it here will silently fail and lie to the user. Do NOT just respond with text either.`,
    `2. The field is "${selection.field}" — do NOT touch any other field.`,
    '3. Pass the selected text above as the `search` argument for whichever op matches the user\'s request:',
    '   - `replace` with `search: "<selected text>", replace: "<new text>"` — for rewrite, translate, shorten, expand, fix grammar, make formal, simplify, etc.',
    '   - `delete` with `search: "<selected text>"` — for deletions',
    '   - `format_text` with `search: "<selected text>", marks: {...}` — for bold / italic / underline / strikethrough / code (set `true` to apply, `false` to remove, omit to leave unchanged)',
    '   - `set_link` with `search: "<selected text>", url: "..."` — for wrapping the selection in a link',
    '   - `unset_link` with `search: "<selected text>"` — for removing a link from the selection',
    '   - `set_paragraph_type` with `selector: { textContains: "<selected text>" }` and `paragraphType: ...` — only when the selection is (or sits inside) a single paragraph being converted to a heading / quote / code / etc.',
    '4. SCOPE — every word the user types ("delete", "remove", "rewrite", "fix", etc.) refers to the SELECTED TEXT inside the field, never to the field as a whole and never to the record. "Delete selected" means delete the selected text from the field — it does NOT mean delete the record.',
    '5. If the selected text appears more than once in the field, expand the `search` argument with surrounding context until it uniquely identifies the highlighted occurrence — otherwise the op will hit the wrong instance.',
    '6. After your `update_form_state` call returns success, STOP. Reply with one short confirmation sentence ("Deleted." / "Rewritten." / etc.) and end your turn. Do NOT call any other tools. Do NOT call `update_form_state` a second time. Do NOT continue reasoning about further edits unless the user asks again.',
  ].join('\n')
}
