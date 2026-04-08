/**
 * Browser-side handler for the AI `update_form_state` client tool.
 *
 * Routes write ops to one of two targets:
 *   1. **Plain field branch** — applies the op against `valuesRef` via the
 *      SchemaForm `setField` callback, which fires the same dependent-field
 *      recompute, persistence, and Y.Map sync as a human input event.
 *   2. **Lexical editor branch** — looks up the live editor in `lexicalRegistry`
 *      and runs the op inside `editor.update()`. Implemented in Phase 2.
 *
 * The op vocabulary intentionally mirrors the server-side `edit_text` tool so
 * the agent can use one mental model regardless of routing.
 */

import { getLexicalEditor } from './lexicalRegistry.js'

// ── Op union ────────────────────────────────────────────────

export type UpdateFormStateOp =
  // Any-field ops
  | { type: 'set_value'; value: unknown }
  // Text/string ops (work on plain text fields and Lexical text in Phase 2)
  | { type: 'rewrite_text'; text: string }
  | { type: 'replace'; search: string; replace: string }
  | { type: 'insert_after'; search: string; text: string }
  | { type: 'delete'; search: string }
  // Lexical-only ops (Phase 2+)
  | { type: 'insert_block'; blockType: string; blockData: Record<string, unknown>; position?: number }
  | { type: 'update_block'; blockType: string; blockIndex: number; field: string; value: unknown }
  | { type: 'delete_block'; blockType: string; blockIndex: number }

export interface UpdateFormStateArgs {
  field:      string
  operations: UpdateFormStateOp[]
}

export interface UpdateFormStateResult {
  applied:   number
  total:     number
  rejected?: string[]
  error?:    string
}

// ── Handler factory ────────────────────────────────────────

export interface UpdateFormStateDeps {
  /** Read-current-values ref kept up to date by SchemaForm. */
  valuesRef: { current: Record<string, unknown> }
  /** Stable callback to write a field value through SchemaForm.handleChange. */
  setField:  (name: string, value: unknown) => void
  /** Set of valid field names — used to reject unknown fields up front. */
  knownFields: () => Set<string>
}

export function makeUpdateFormStateHandler(deps: UpdateFormStateDeps) {
  return function handler(rawArgs: unknown): UpdateFormStateResult {
    const args = rawArgs as UpdateFormStateArgs | undefined
    if (!args || typeof args !== 'object' || typeof args.field !== 'string') {
      return { applied: 0, total: 0, error: 'Invalid arguments: expected { field, operations }' }
    }

    const known = deps.knownFields()
    if (!known.has(args.field)) {
      return {
        applied: 0,
        total: args.operations?.length ?? 0,
        error: `Unknown field "${args.field}". Known fields: ${[...known].join(', ')}`,
      }
    }

    const ops = Array.isArray(args.operations) ? args.operations : []
    if (ops.length === 0) {
      return { applied: 0, total: 0, error: 'No operations supplied' }
    }

    // Phase 2 will branch here on getLexicalEditor(args.field). For Phase 1
    // we reject Lexical-only ops with a clear "not yet implemented" message
    // but still apply the plain-field ops below.
    const editor = getLexicalEditor(args.field)
    if (editor) {
      return {
        applied: 0,
        total: ops.length,
        error: `Field "${args.field}" is backed by a Lexical editor; the editor branch is not implemented yet (Phase 2).`,
      }
    }

    let applied = 0
    const rejected: string[] = []

    for (const op of ops) {
      const result = applyPlainOp(op, args.field, deps)
      if (result === true) applied++
      else if (typeof result === 'string') rejected.push(`${op.type}: ${result}`)
    }

    return {
      applied,
      total: ops.length,
      ...(rejected.length > 0 && { rejected }),
    }
  }
}

// ── Plain-field op application ─────────────────────────────

/** Returns true on success, a string on rejection (the rejection reason). */
function applyPlainOp(
  op: UpdateFormStateOp,
  field: string,
  deps: UpdateFormStateDeps,
): true | string {
  switch (op.type) {
    case 'set_value': {
      deps.setField(field, op.value)
      return true
    }
    case 'rewrite_text': {
      deps.setField(field, op.text)
      return true
    }
    case 'replace': {
      const current = String(deps.valuesRef.current[field] ?? '')
      if (!current.includes(op.search)) {
        return `search text "${op.search}" not found in field "${field}"`
      }
      deps.setField(field, current.split(op.search).join(op.replace))
      return true
    }
    case 'insert_after': {
      const current = String(deps.valuesRef.current[field] ?? '')
      const idx = current.indexOf(op.search)
      if (idx === -1) {
        return `search text "${op.search}" not found in field "${field}"`
      }
      const cut = idx + op.search.length
      deps.setField(field, current.slice(0, cut) + op.text + current.slice(cut))
      return true
    }
    case 'delete': {
      const current = String(deps.valuesRef.current[field] ?? '')
      if (!current.includes(op.search)) {
        return `search text "${op.search}" not found in field "${field}"`
      }
      deps.setField(field, current.split(op.search).join(''))
      return true
    }
    case 'insert_block':
    case 'update_block':
    case 'delete_block':
      return `block ops only work on Lexical-backed rich-content fields; "${field}" is plain`
    default: {
      const exhaustive: never = op
      return `unknown op "${(exhaustive as { type: string }).type}"`
    }
  }
}
