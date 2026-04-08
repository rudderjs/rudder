# Chat Update Form State Plan

Add an `update_form_state` client tool that lets the AI agent write to **any** form field — including non-collaborative ones — by routing edits through the browser's live React + Lexical instances instead of the server-side Y.Doc. Symmetric with the existing `read_form_state` client tool, which already closes the **read** side of the non-collab gap.

**Status:** DONE (2026-04-08)
**Estimated LOC:** ~450
**Packages affected:** `@rudderjs/panels`, `@rudderjs/panels-lexical`, `@rudderjs/ai` (no changes; relies on existing client-tool roundtrip)
**Depends on:** `client-tool-roundtrip-plan.md` (DONE 2026-04-07), `panels-block-write-completion-plan.md` (DONE 2026-04-08)
**Related:** `feedback_validate_agent_inputs.md`, `feedback_lexical_decorator_shape.md`, `project_product_identity.md` (VS Code framing — this delivers "edit the open buffer" semantics, where today the agent can only edit "files on disk")

---

## Goal

Today the AI agent can:

- **Read** any field via `read_form_state` (client tool — sees in-progress unsaved edits)
- **Edit text** in collab fields via `Live.editText` (server-side Y.XmlText mutation)
- **Author blocks** in collab `richcontent` fields via `Live.insertBlock` / `editBlock` / `removeBlock`

It cannot:

- **Edit non-collab fields** of any type (text/textarea via `Live.updateMap` half-works for plain text, but non-collab `richcontent` corrupts the field)
- **Edit non-text fields** (select, boolean, number, date, tags, relation) — `edit_text` is text-only by design
- **Authoring on a field whose editor is currently focused by the user**, where the source of truth is the unsaved in-browser state, not the server-side Y.Doc snapshot

After this plan, the agent can do all of the above by issuing `update_form_state` operations that are executed by a browser-side handler against the live React + Lexical instances. It naturally:

- Sees the user's unsaved edits (operates on `valuesRef`, the same source `read_form_state` reads)
- Works for any field type the form supports
- Works for both collab and non-collab fields uniformly (because Lexical with Yjs binding still goes through `editor.update()`)

---

## Non-Goals

- **Replace the server-side `edit_text` path.** Background agents, queue workers, scheduled jobs, and any chat session without a browser open still need server-side edits. Both paths coexist.
- **Implement field-type-specific UIs in the browser handler.** The handler operates on existing React state (`valuesRef`) and existing Lexical editors (registered via refs) — no new UI.
- **Build an editor-instance registry across the entire panel.** Scope: only fields in the currently-mounted `SchemaForm` are addressable. Same scope as `read_form_state` today.
- **Solve concurrent agent + human typing conflicts beyond what Yjs already handles.** For Lexical fields, `editor.update()` interleaves naturally with user input via Lexical's transactional model. For non-Lexical fields, last-write-wins on `valuesRef` — same as a human typing two characters in quick succession.
- **Validate agent inputs against field type schemas.** That's a separate, larger concern (the `Field` schema doesn't have a runtime validator API). For v1, the handler trusts the op shape and Lexical / React handle malformed values the same way they do for human input.
- **Cross-field operations** (e.g. "set title from the first heading of body"). Each op targets one field. Composition is the agent's job.

---

## Background

### How `read_form_state` works (the precedent we mirror)

1. **Server-side tool definition** (`packages/panels/src/handlers/chat/tools/readFormStateTool.ts`):
   ```ts
   return toolDefinition({
     name: 'read_form_state',
     description: '...',
     inputSchema: z.object({ fields: z.array(z.string()).optional() }),
   })
   // No .server() — this is a client tool.
   ```
2. **Browser-side handler** (`packages/panels/pages/_components/SchemaForm.tsx`):
   ```ts
   useEffect(() => registerClientTool('read_form_state', (args) => {
     const all = valuesRef.current
     // ... filter by args.fields
     return all
   }), [])
   ```
3. **Server-side dispatcher** stops the agent loop when the model calls a tool with no `execute`, emits `pending_client_tools` SSE event with the tool call ID + args.
4. **Browser receives the SSE event**, calls `executeClientTool('read_form_state', args)`, which dispatches to the registered handler, then re-POSTs to `/api/_chat` with `messages: [...full history including the tool result...]`.
5. **Server validates the continuation** (`continuation.ts` prefix check + tool-call ID match), resumes the agent loop with the result.

The roundtrip is invisible to the agent — it just sees a tool call resolve with a result.

### How Lexical exposes `editor.update()`

`@lexical/react` exposes `useLexicalComposerContext()` which returns the active `LexicalEditor` instance. There's already an `editorRef` pattern in `packages/panels-lexical/src/CollaborativePlainText.tsx:99-118`:

```tsx
editorRef?: React.MutableRefObject<EditorHandle | null>
```

Inside `editor.update(() => { ... })`, you can call any Lexical mutation API:

- `$createTextNode('hi').setFormat('bold')` — text + inline marks
- `$insertNodes([$createBlockNode('callToAction', { title: 'Hi' })])` — insert blocks
- `$createHeadingNode('h2')` — paragraph types
- `$patchStyleText(selection, { color: 'red' })` — inline CSS
- `node.replace($createParagraphNode())` — replace nodes

These are the same APIs the user's keyboard input goes through. They work whether the editor has a Yjs binding or not. **This is the key insight that makes the client-tool path so clean compared to the server-side Y.Doc tree walks.**

### What the registry needs to look like

For text/select/boolean/etc. fields, `valuesRef.current[fieldName]` is enough. For Lexical fields (`richcontent`, `text` with collaborative plain-text editor), we need a per-field registry of `LexicalEditor` instances:

```ts
// packages/panels/pages/_components/agents/lexicalRegistry.ts
const editors = new Map<string, LexicalEditor>()

export function registerLexicalEditor(fieldName: string, editor: LexicalEditor): () => void {
  editors.set(fieldName, editor)
  return () => { if (editors.get(fieldName) === editor) editors.delete(fieldName) }
}

export function getLexicalEditor(fieldName: string): LexicalEditor | undefined {
  return editors.get(fieldName)
}
```

Each `RichContentField` / `CollaborativePlainText` mounts → registers its editor → unregisters on unmount. The `update_form_state` handler looks up the editor by field name and calls `editor.update(...)` against it.

This is the new infrastructure. Everything else is shapes around it.

---

## Approach

Three layers:

### Layer 1 — Lexical editor registry + client handler (~250 LOC)

**New files:**

- `packages/panels/pages/_components/agents/lexicalRegistry.ts` — `registerLexicalEditor` / `getLexicalEditor` (15 LOC)
- `packages/panels/pages/_components/agents/updateFormStateHandler.ts` — the client tool handler that dispatches ops to either `valuesRef` or the registered Lexical editor (200 LOC)

**Modified files:**

- `packages/panels-lexical/src/RichContentField.tsx` — register the editor instance under its field name on mount, unregister on unmount
- `packages/panels-lexical/src/CollaborativePlainText.tsx` — same registration pattern (text/textarea fields with collab plain-text editor)
- `packages/panels/pages/_components/SchemaForm.tsx` — register the `update_form_state` client tool, wire it to the new handler

**Handler shape:**

```ts
// updateFormStateHandler.ts
import { $getRoot, $createParagraphNode, $createTextNode, $insertNodes } from 'lexical'
import { $createHeadingNode } from '@lexical/rich-text'
import { $patchStyleText } from '@lexical/selection'
import { $createBlockNode } from '@rudderjs/panels-lexical'
import { getLexicalEditor } from './lexicalRegistry.js'
import type { ValuesRef } from '../SchemaForm.js'

type Op =
  | { type: 'set_value'; value: unknown }                                       // any field
  | { type: 'rewrite_text'; text: string }                                       // text/textarea/richcontent
  | { type: 'replace'; search: string; replace: string }                         // text/richcontent
  | { type: 'insert_after'; search: string; text: string }                       // text/richcontent
  | { type: 'delete'; search: string }                                           // text/richcontent
  | { type: 'insert_block'; blockType: string; blockData: object; position?: number }  // richcontent
  | { type: 'update_block'; blockType: string; blockIndex: number; field: string; value: unknown }
  | { type: 'delete_block'; blockType: string; blockIndex: number }
  | { type: 'format_text'; search: string; marks: { bold?: boolean; italic?: boolean; ... } }
  | { type: 'set_paragraph_type'; selector: { paragraphIndex: number } | { textContains: string }; paragraphType: 'paragraph'|'heading'|'quote'|'code'|'list'; tag?: string }

export function makeUpdateFormStateHandler(valuesRef: ValuesRef, fieldMeta: FieldMetaMap, allowlist: BlockAllowlist) {
  return async function handler(args: { field: string; operations: Op[] }) {
    const meta = fieldMeta[args.field]
    if (!meta) return { applied: 0, error: `Unknown field "${args.field}"` }

    const editor = getLexicalEditor(args.field)
    let applied = 0
    const rejected: string[] = []

    if (editor) {
      // Lexical-backed field — use editor.update()
      editor.update(() => {
        for (const op of args.operations) {
          if (op.type === 'insert_block' || op.type === 'update_block' || op.type === 'delete_block') {
            const allowed = allowlist[args.field]
            if (allowed && !allowed.has(op.blockType)) {
              rejected.push(`${op.type}: "${op.blockType}" not allowed. Allowed: ${[...allowed].join(', ')}`)
              continue
            }
          }
          if (applyOpToLexical(op)) applied++
        }
      })
    } else {
      // Plain field — set valuesRef and trigger React update
      for (const op of args.operations) {
        if (op.type === 'set_value') {
          valuesRef.setField(args.field, op.value)
          applied++
        } else if (op.type === 'rewrite_text') {
          valuesRef.setField(args.field, op.text)
          applied++
        } else if (op.type === 'replace' || op.type === 'insert_after' || op.type === 'delete') {
          const current = String(valuesRef.current[args.field] ?? '')
          const next = applyTextOpToString(current, op)
          if (next !== current) {
            valuesRef.setField(args.field, next)
            applied++
          }
        } else {
          rejected.push(`${op.type}: not supported on non-Lexical field "${args.field}"`)
        }
      }
    }

    return {
      applied,
      total: args.operations.length,
      ...(rejected.length > 0 && { rejected }),
    }
  }
}
```

**`applyOpToLexical(op)` is where the Lexical mutation logic lives.** Each op type maps to a small function:

- `rewrite_text` → walk `$getRoot()`, replace all paragraph text content
- `replace` / `insert_after` / `delete` → walk text nodes, find the search string, splice
- `insert_block` → `$insertNodes([$createBlockNode(blockType, blockData)])` (positional via `$getRoot().getChildAtIndex()`)
- `update_block` → walk root for matching `BlockNode`, call `node.setBlockData(...)`
- `delete_block` → walk root, find match, call `node.remove()`
- `format_text` → use `$patchStyleText` after selecting the matched range
- `set_paragraph_type` → resolve the paragraph by index/text-contains, call `node.replace($createHeadingNode('h2'))` etc.

**This is the same op vocabulary as `edit_text`** — deliberately. The agent already knows it. The only difference is the routing target.

`valuesRef.setField` is a new method on the SchemaForm valuesRef that wraps `setValues` + dependent recompute (the same path human input goes through). Today `valuesRef.current = next` is done inline in `handleChange` — we extract that into a method so the client handler can call it without bypassing the dependent-field recompute logic.

### Layer 2 — Server-side tool definition + dispatcher wiring (~120 LOC)

**New file:**

- `packages/panels/src/handlers/chat/tools/updateFormStateTool.ts` — client tool definition (no `.server()`), Zod schema for the op union, identical shape to what the browser handler expects

**Modified files:**

- `packages/panels/src/handlers/chat/contexts/ResourceChatContext.ts` — instantiate the new tool, pass it to the agent alongside the existing tools
- `packages/panels/src/handlers/chat/blockCatalog.ts` — extend `formatBuilderCatalog()` to teach the agent that block ops are also available via `update_form_state` (not just `edit_text`), and clarify when to use which

**Tool definition:**

```ts
export async function buildUpdateFormStateTool(allFields: string[], blockAllowlist: FieldBlockAllowlist) {
  if (allFields.length === 0) return null
  const { toolDefinition, z } = await loadAi()

  return toolDefinition({
    name: 'update_form_state',
    description: [
      'Write to any form field, including non-collaborative ones, by sending the edit',
      'to the user\'s browser. Use this when the user has unsaved changes you need to',
      'preserve, or when editing a field type other than collaborative text/rich-content',
      '(select, boolean, number, date, etc.). For collaborative rich text or simple',
      'background text edits, prefer `edit_text` which avoids a browser round-trip.',
    ].join(' '),
    inputSchema: z.object({
      field: z.enum(allFields as [string, ...string[]]),
      operations: z.array(z.union([
        z.object({ type: z.literal('set_value'), value: z.unknown() }),
        z.object({ type: z.literal('rewrite_text'), text: z.string() }),
        z.object({ type: z.literal('replace'), search: z.string(), replace: z.string() }),
        z.object({ type: z.literal('insert_after'), search: z.string(), text: z.string() }),
        z.object({ type: z.literal('delete'), search: z.string() }),
        z.object({
          type: z.literal('insert_block'),
          blockType: z.string(),
          blockData: z.record(z.string(), z.unknown()),
          position: z.number().optional(),
        }),
        z.object({
          type: z.literal('update_block'),
          blockType: z.string(),
          blockIndex: z.number(),
          field: z.string(),
          value: z.unknown(),
        }),
        z.object({
          type: z.literal('delete_block'),
          blockType: z.string(),
          blockIndex: z.number(),
        }),
        // format_text, set_paragraph_type, etc. — added in Phase 4 (lifted from rich-text plan)
      ])),
    }),
  })
  // No .server() — client tool.
}
```

### Layer 3 — System prompt + tool selection guidance (~80 LOC)

The agent now has TWO tools that overlap in capability: `edit_text` (server-side, collab-only, no browser needed) and `update_form_state` (client-tool roundtrip, any field, browser required). It needs guidance on when to use which.

**Update `formatBuilderCatalog` and the resource chat system prompt builder** to include a "Tool selection guide" section:

```
## When to use which edit tool

- **`update_form_state`** — Use this for non-collaborative fields, non-text field types
  (select, boolean, number, date, tags, relation), and when the user has unsaved changes
  you need to preserve. This tool routes through the user's browser.

- **`edit_text`** — Use this for collaborative text/rich-content fields when no browser
  round-trip is needed. Faster, but only works on fields marked `.collaborative()` or
  `.persist(['websocket'])`. Cannot edit select/boolean/number fields.

- **Block operations** (`insert_block` / `update_block` / `delete_block`) work in BOTH tools
  for `richcontent` fields. Prefer `update_form_state` if the user is actively editing
  that field; prefer `edit_text` if they aren't.
```

This guidance is critical. Without it the agent will pick arbitrarily and we'll see flaky behavior. The wording above prioritizes `update_form_state` as the safer default.

---

## Implementation Phases

### Phase 0 — Validate the editor registry pattern works under hot reload

**Goal:** confirm that registering a Lexical editor instance in a Map keyed by field name survives the playground's HMR cadence and doesn't leak.

**Steps:**
1. Add `lexicalRegistry.ts` with the bare register/unregister API.
2. Wire it in `RichContentField.tsx` as a `useEffect` that registers on mount and unregisters on cleanup.
3. Add a temporary `window.__getLexicalEditor` for manual browser-console testing.
4. In the playground, open an article, run `window.__getLexicalEditor('content').update(() => $getRoot().clear())` from devtools — confirm the editor clears.
5. Trigger a HMR reload (edit a non-Lexical file). Re-run the same line — confirm it still works (the editor was re-registered).
6. Open a second article, switch back — confirm only the active editor is registered.

**Acceptance:** the registry holds exactly one editor per field name at any moment, survives HMR, cleans up on navigation. No further phases start until this is verified.

### Phase 1 — `valuesRef.setField` + non-Lexical client handler

**Files:**
- `packages/panels/pages/_components/SchemaForm.tsx` — extract `setField` from `handleChange`, expose it on `valuesRef`
- `packages/panels/pages/_components/agents/updateFormStateHandler.ts` — handler skeleton, only the non-Lexical branch (set_value, rewrite_text, replace/insert_after/delete on plain strings)

**Acceptance:**
- Calling the handler with `{ field: 'title', operations: [{ type: 'set_value', value: 'New Title' }] }` updates the form's title input visibly.
- Dependent field recompute fires (e.g. slug auto-generation triggered by title change).
- `replace` / `insert_after` / `delete` work on plain text fields.
- Unknown ops on plain fields are rejected with a clear error in the response.

### Phase 2 — Lexical editor branch (text + block ops)

**Files:**
- `packages/panels/pages/_components/agents/lexicalRegistry.ts`
- `packages/panels-lexical/src/RichContentField.tsx` — register editor on mount
- `packages/panels-lexical/src/CollaborativePlainText.tsx` — register editor on mount
- `packages/panels/pages/_components/agents/updateFormStateHandler.ts` — Lexical branch with `editor.update()` dispatching to per-op functions

**Acceptance:**
- Calling the handler against a Lexical field with `{ type: 'rewrite_text', text: '...' }` replaces the editor content in place — visible to the user.
- `insert_block` inserts a new BlockNode with proper Lexical class instances (not raw Y.Doc — `$createBlockNode` from `@rudderjs/panels-lexical`).
- `update_block` updates an existing block's data via `node.setBlockData()`.
- `delete_block` removes the matching block.
- All ops respect the block allowlist passed from the server tool definition.
- Operations applied in one `editor.update()` transaction → single undo step.

### Phase 3 — Wire the server tool definition + ResourceChatContext

**Files:**
- `packages/panels/src/handlers/chat/tools/updateFormStateTool.ts`
- `packages/panels/src/handlers/chat/contexts/ResourceChatContext.ts` — instantiate, pass to agent
- `packages/panels/src/handlers/chat/blockCatalog.ts` — extend prompt with tool selection guidance

**Acceptance:**
- The agent receives `update_form_state` in its tool list.
- Calling it from the chat panel triggers the existing `pending_client_tools` SSE flow (no new server code needed — `client-tool-roundtrip-plan.md` already handles it).
- Browser handler runs, returns result, agent sees it via continuation.
- System prompt mentions both tools with clear "use this for X" guidance.

### Phase 4 — Lift formatting + paragraph type ops from the rich-text plan

This is where the rich-text-authoring plan's scope collapses. Instead of building Y.Doc primitives in `@rudderjs/live`, we add the client-side handlers that call Lexical APIs directly.

**New op handlers in `updateFormStateHandler.ts`:**
- `format_text` → `$patchStyleText(selection, ...)` after selecting the matched range
- `set_text_style` → same path, with raw style object
- `set_link` / `unset_link` → use `@lexical/link` `TOGGLE_LINK_COMMAND`
- `set_paragraph_type` → resolve paragraph, `node.replace($createHeadingNode(tag))` etc.
- `insert_paragraph` → `$insertNodes([...])`
- `insert_list_item` / `remove_list_item` → use `@lexical/list` commands

**Update `updateFormStateTool.ts`** Zod schema with the new ops.
**Update the system prompt** to teach all of them.

This is where the LOC count spikes (~150 of the 450 total).

### Phase 5 — Smoke tests + memory + docs

**Playground scenarios** (run each in the article chat):

1. **Set a non-text field**: "set the featured boolean to true" → checkbox flips
2. **Set a select field**: "set the status to draft" → select changes
3. **Edit a non-collab text field with unsaved changes**: type "WIP" in a field, then ask "expand my unsaved title" → agent reads via `read_form_state`, writes via `update_form_state`, the WIP value is preserved
4. **Insert a block on a collab rich-content field**: "add a callToAction at the end with title 'Hi'" → block appears (same as `edit_text`, but via the browser path)
5. **Bold a word**: "bold the word 'critical' in the second paragraph" → text formatting applied (this is rich-text authoring delivered for free via Phase 4)
6. **Convert paragraph to h1**: "make the first paragraph an h1" → paragraph type changes
7. **Mixed turn**: "set status to published, then bold the word 'critical' in the body, then add a CTA at the end" → all three ops succeed in one agent turn
8. **Refusal**: with no Lexical editor mounted (e.g. detail view), "add a callToAction" → handler returns error, agent reports it can't because no editor is open

**Memory + docs:**
- Add `feedback_client_tool_for_authoring.md` — design rationale for browser-routed authoring vs server-side
- Update `project_roadmap_status.md` — `update_form_state` shipped, non-collab edit gap closed
- Update `docs/claude/panels.md` — extend the AI capabilities section with the two-tool model + selection guide
- Update `panels-rich-text-authoring-plan.md` — mark superseded by this plan for the formatting ops; keep the Y.Doc spike notes for headless future use
- Flip this plan's status to DONE

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **Editor registry leaks across navigations**, leaving stale references | Phase 0 spike. Use `useEffect` cleanup function religiously. Add a dev-mode warning if a register call replaces an existing entry without it being unregistered first. |
| **`editor.update()` runs while user is mid-typing**, causing cursor jumps or input loss | Lexical's transactional model handles this — concurrent updates are queued and merged. The user might see a brief jump if their cursor was in the affected range, but no input is lost. Acceptable for v1. If complaints arise, gate the handler on `editor.isComposing()` and queue ops until composition ends. |
| **Block insertion via `$createBlockNode` requires the BlockNode class to be registered** in the editor's nodes config — easy to forget on a new field | Already handled by `RichContentField` — it registers `BlockNode` in its `LexicalComposer` config. Document it: "any field that wants AI block authoring must include `BlockNode` in `nodes`". Add a runtime check in the handler that emits a clear error if `BlockNode` isn't registered. |
| **Server tool selection ambiguity** — agent picks `edit_text` when it should pick `update_form_state` (or vice versa) | The system prompt's "Tool selection guide" is the front line. If smoke tests show flaky picks, add a runtime hint in the `update_form_state` rejection messages: "this field is collaborative; you can also use `edit_text` for a faster path". Long-term option: deprecate one tool. |
| **Client handler runs before the editor is mounted** (e.g. agent calls it before user opens the field) | Handler returns `{ applied: 0, error: 'No editor mounted for field "X". Open the field first.' }` — agent surfaces it. Smoke test #8 covers this. |
| **`replace` / `insert_after` / `delete` on Lexical fields needs Lexical-aware string walking** that doesn't break formatting | Reuse the same approach as `Live.editText` — find the matching text within an unbroken text run, then splice. If the search spans formatting boundaries, fall back to a clearer error: "search text spans formatting boundaries; try a more specific search". |
| **HMR reload leaves stale handler closures** with the wrong `valuesRef` | The handler is registered inside a `useEffect` that re-runs on every mount, so it always closes over the latest refs. Phase 0 verifies. |
| **Race between browser handler and a concurrent server-side `edit_text` call** on the same collab field | Yjs CRDT merges them. Last-writer wins for non-overlapping edits; for overlapping ones, one is dropped. This is the same risk profile as two humans editing concurrently. Acceptable. |
| **Block allowlist must be re-derivable client-side**, since the server-side `extractBuilderCatalog` runs in the dispatcher path only | Pass the allowlist to the client handler at registration time. The chat panel already receives the resource catalog as part of the agent context — extend that payload with the per-field block allowlist. |
| **Op vocabulary divergence** between `edit_text` and `update_form_state` | Keep them identical. Both tools share a `Op` type union exported from a single file (`packages/panels/src/handlers/chat/tools/editOps.ts`). Phase 2 of this plan extracts the union from `editTextTool.ts` so both tools import it. |

---

## Files Touched

```
packages/panels/pages/_components/agents/lexicalRegistry.ts            ← NEW — editor instance registry
packages/panels/pages/_components/agents/updateFormStateHandler.ts     ← NEW — client tool handler
packages/panels/pages/_components/agents/clientTools.ts                ← unchanged (already supports any tool name)
packages/panels/pages/_components/SchemaForm.tsx                       ← register the tool, expose valuesRef.setField
packages/panels-lexical/src/RichContentField.tsx                       ← register editor instance
packages/panels-lexical/src/CollaborativePlainText.tsx                 ← register editor instance
packages/panels/src/handlers/chat/tools/updateFormStateTool.ts         ← NEW — server tool def
packages/panels/src/handlers/chat/tools/editOps.ts                     ← NEW — shared op union
packages/panels/src/handlers/chat/tools/editTextTool.ts                ← refactor to import shared op union
packages/panels/src/handlers/chat/contexts/ResourceChatContext.ts      ← instantiate the new tool
packages/panels/src/handlers/chat/blockCatalog.ts                      ← extend prompt with tool selection guide
packages/panels/src/__tests__/updateFormStateTool.test.ts              ← NEW — tool def + dispatch tests
docs/claude/panels.md                                                  ← document the two-tool model
~/.claude/projects/.../memory/project_roadmap_status.md                ← record completion
docs/plans/chat-update-form-state-plan.md                              ← this doc — flip to DONE on completion
docs/plans/panels-rich-text-authoring-plan.md                          ← mark formatting ops as delivered via this plan
```

---

## Future (out of scope)

- **Headless rich-text authoring** — for background agents without a browser. The original `panels-rich-text-authoring-plan.md` Y.Doc primitives become the implementation here. Build them on demand if/when a real headless use case appears.
- **Deprecating the server-side `edit_text` collab branch** in favor of a unified browser-driven path. Only viable once headless use cases are confirmed unnecessary.
- **Multi-editor batch ops** — "set title and add a CTA in the body in one call". v1 takes one field per call; the agent issues two tool calls for two fields.
- **Optimistic preview / dry-run mode** — show the agent's intended changes in a diff overlay before applying. Pairs naturally with the suggestion/tracked-changes plan (5.2 NOT STARTED).
- **Schema-driven input validation** — validate `set_value` against the field's type/options before applying. Requires a runtime validator API on `Field` that doesn't exist yet.
- **Selection-aware ops** — when the user has selected text in the editor, scope client-tool ops to that selection automatically. Mirror the existing `selection` parameter that `edit_text` honors.

---

## Acceptance Summary

This plan is DONE when:

- [x] `lexicalRegistry.ts` exists and Phase 0 verification passes
- [x] `updateFormStateHandler.ts` handles all op types listed in Phase 2 + Phase 4
- [x] `updateFormStateTool.ts` is registered as a client tool in `ResourceChatContext`
- [x] System prompt teaches both `edit_text` and `update_form_state` with clear "use this for X" guidance (hard-rule the formatting ops to `update_form_state` since `edit_text` has none)
- [x] All 8 playground smoke-test scenarios pass (see Implementation Notes below)
- [ ] ~~The shared `editOps.ts` op union is consumed by both tools~~ — DEFERRED. `edit_text` and `update_form_state` keep separate op vocabularies (`rewrite` vs `rewrite_text`, etc.) because aligning would be a breaking change to the existing `edit_text` schema. Documented as a future consolidation.
- [x] Block allowlist is enforced in the browser handler (not just on the server) — derived from `field._extra.blocks` in SchemaForm and passed via `blockAllowlist` dep
- [x] Memory + CLAUDE docs reflect the two-tool model and the Lexical registry pattern (`feedback_client_tool_for_authoring.md`, `project_roadmap_status.md`, `docs/claude/panels.md`)
- [x] The article chat agent can complete the multi-step task in one turn (verified via Phase 4 fresh-conversation smoke test)

## Implementation Notes (post-DONE)

- **`CollaborativePlainText` registration was a Phase 2 follow-up.** The original Phase 2 only wired `LexicalEditor.tsx` (rich-content). When user tried to rewrite `title` (a collab plain text field), the slug recomputed but the input didn't change — proof the plain branch ran. Fix: also added `onEditorMount` to `CollaborativePlainText` and wired it from `TextInput.tsx` and `TextareaInput.tsx`.
- **Phase 4 list ops not delivered.** `insert_list_item` / `remove_list_item` require Lexical's nested ListNode/ListItemNode structure manipulation; deferred until concrete need. Heading/quote/code conversions land via `set_paragraph_type`.
- **Tool routing edge case.** Agent occasionally picked `edit_text` for formatting requests during Phase 4 testing and narrated fake success. Fixed in Phase 5 by adding a HARD RULE to the system prompt: any formatting/link/paragraph-type op MUST use `update_form_state`.
- **Known follow-up: continuation prefix bug.** Multi-turn conversations can 400 with `Continuation diverges from persisted conversation at message N` after a tool call whose arguments contain arrays/objects with non-stable JSON serialization. Tracked in `~/.claude/.../memory/project_continuation_array_args_bug.md`. Not specific to this plan — affects any tool with object/array args. Fix is to canonicalize JSON in `continuation.ts:93` before comparing.
- **`update_field` (ResourceAgent's own write tool) is unrelated.** It's an older field-write mechanism scoped to a `ResourceAgent`'s `.fields([...])` allowlist. Phase 5 noted but did not consolidate it into `update_form_state`. Future cleanup.
