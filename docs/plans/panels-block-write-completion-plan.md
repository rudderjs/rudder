# Panels Block Write Completion Plan

Complete the AI agent's block-editing capability by adding **insert** and **delete** operations alongside the existing **update** flow. Block introspection (Plan 5.3) is already done — the agent now knows what blocks exist and what fields they have, but it can only mutate blocks that are already in the document.

**Status:** DONE (2026-04-08)
**Estimated LOC:** ~210 (actual: ~280 incl. allowlist hardening)
**Packages affected:** `@rudderjs/live`, `@rudderjs/panels`
**Depends on:** Panels AI 5.3 (block introspection) — DONE 2026-04-08
**Related:** `feedback_block_field_detection.md`, `project_product_identity.md` (VS Code framing — this plan delivers the equivalent of "insert function call" / "delete statement", not just "rename variable")

---

## Goal

Today the AI chat in `@rudderjs/panels` can:

- **Read** block types via the structured catalog injected into the system prompt (Plan 5.3)
- **Update** an existing block's field via `Live.editBlock()` and the `update_block` operation in `edit_text`

It cannot:

- **Insert** a new block into a `RichContentField` / `BuilderField`
- **Delete** an existing block
- Reorder blocks (out of scope for v1 — see "Future" section)

When the user asks "add a callToAction block at the end" or "remove the second video block", the agent has no tool to call. The only response it can give is text, which is misleading because it claims a capability the framework doesn't expose.

This plan closes the gap by extending `@rudderjs/live` with insert/delete primitives and exposing them through the existing `edit_text` tool.

---

## Non-Goals

- **Block reordering** — separate concern, can be modeled as `delete_block` + `insert_block` for v1.
- **Cross-paragraph block migration** — moving a block from one paragraph to another. Same workaround as above.
- **Custom paragraph styling around inserted blocks** — new blocks always go in their own paragraph; styling is the user's job.
- **Server-side block validation against schema** — we trust the catalog the agent received; if it sends garbage `__blockData`, the editor will render it as-is. Validation is a future hardening pass.
- **Undo/redo integration** — Yjs handles this naturally via its update history; no special work needed.

---

## Background — the Lexical Y.Doc tree shape

This is the structural contract the implementation must match. Documented in `packages/live/src/index.ts:572` and `docs/claude/panels.md` § "Lexical Y.Doc tree structure":

```
root (Y.XmlText)                             ← top of the rich-content document
  ├── Y.XmlText (paragraph)                  ← __type='paragraph' (or 'heading', 'list', …)
  │     ├── Y.XmlElement (custom-block)      ← THE BLOCK
  │     │     attrs:
  │     │       __blockType  = 'callToAction'
  │     │       __blockData  = { title: '…', buttonText: '…', … }   ← raw object, NOT JSON string
  │     ├── Y.Map (__type='text')            ← TextNode metadata
  │     └── "actual text content"
```

Critical invariants the implementation must preserve:

1. **Blocks live inside paragraph Y.XmlText nodes**, not at root. A block at root will not render.
2. **`__blockData` is a raw JS object**, not a JSON string. The Lexical-Yjs binding will serialize it itself.
3. **The custom-block element's `nodeName` must be `'custom-block'`** for the Lexical adapter to pick it up.
4. **Each block paragraph should be its own paragraph Y.XmlText.** Putting a block alongside text in the same paragraph works but creates editing surprises (cursor lands in the wrong place after the block). For inserts, always create a fresh paragraph.
5. **The root Y.XmlText must already exist** (from the SeedPlugin or prior content). If it doesn't, the editor isn't initialized and we should no-op rather than crash.

`findBlockInXmlTree(root, blockType, blockIndex)` already exists at `live/src/index.ts:636` and walks paragraph children counting `__blockType === blockType` matches. We reuse it for delete and as an "insert position" reference.

---

## Approach

Three layers, each with its own concern:

### Layer 1 — `@rudderjs/live` block primitives (~120 LOC)

Add two methods to the `Live` facade alongside the existing `editBlock`:

```ts
// packages/live/src/index.ts

/**
 * Insert a new block into a Lexical Y.Doc room. The block is wrapped in a
 * fresh paragraph Y.XmlText and appended to root, or inserted at the given
 * paragraph index when `position` is provided.
 *
 * Returns true on success, false if the room or root XmlText is missing.
 *
 * @param docName    e.g. 'panel:articles:42:richcontent:content'
 * @param blockType  e.g. 'callToAction'
 * @param blockData  Raw object — keys must match the block schema's field names.
 * @param position   Optional 0-based paragraph index. Omitted → append at end.
 *                   Negative → counted from the end (-1 = before last paragraph).
 */
insertBlock(
  docName: string,
  blockType: string,
  blockData: Record<string, unknown>,
  position?: number,
): boolean

/**
 * Remove a block from a Lexical Y.Doc room. Identifies the block via the
 * same `findBlockInXmlTree` helper used by `editBlock`. The parent paragraph
 * Y.XmlText is removed in its entirety — text content alongside the block
 * is destroyed with it.
 *
 * Returns true if the block was found and removed.
 */
removeBlock(
  docName: string,
  blockType: string,
  blockIndex: number,
): boolean
```

**Implementation notes for `insertBlock`:**

1. Look up or create the room via the existing `getRoom(docName)` helper.
2. Get `root` via `doc.get('root', Y.XmlText)`. Bail with `false` if `root.length === 0` (uninitialized).
3. Construct a new `Y.XmlText` paragraph and set `__type='paragraph'` (and any other attrs the existing tree uses — confirm by inspection during implementation).
4. Construct a new `Y.XmlElement('custom-block')`.
5. `setAttribute('__blockType', blockType)` and `setAttribute('__blockData', blockData)` (raw object, not JSON string — same convention as `editBlock`).
6. Insert the element into the paragraph at offset 0 via `paragraph.insertEmbed(0, customBlock)` (Y.XmlText's insert API for embedded elements).
7. Walk root to find the insertion index for the new paragraph:
   - If `position === undefined`: append at the end of root.
   - If `position >= 0`: insert before the paragraph currently at that index.
   - If `position < 0`: insert before the paragraph at `(paragraphCount + position)`.
8. Use `root.insertEmbed(rootOffset, paragraph)` where `rootOffset` is the cumulative offset of the target paragraph's start (computed by walking root and tracking offsets — same pattern as `findBlockInXmlTree`).

**Implementation notes for `removeBlock`:**

1. Use `findBlockInXmlTree(root, blockType, blockIndex)` to locate the custom-block element.
2. Walk back up to find its parent paragraph (the iteration in `findBlockInXmlTree` already has the parent in scope — refactor to return both element and parent, or add a sibling helper).
3. Compute the parent paragraph's offset in root.
4. Call `root.delete(parentOffset, 1)` to remove the entire paragraph.
5. If the parent paragraph contained other content (text, other blocks), that content is destroyed too. This is intentional — partial paragraph cleanup is out of scope, and the framing in the catalog tells the agent that "blocks have their own paragraphs". If real-world testing surfaces resources where blocks share paragraphs with text, we add a more surgical mode in v2.

**Why these primitives live in `@rudderjs/live` and not `@rudderjs/panels`:**

- They operate on Y.Doc rooms — that's `@rudderjs/live`'s job.
- They mirror the existing `editBlock` / `editText` / `rewriteText` APIs that already live there.
- `@rudderjs/panels` already imports `Live` lazily for editText; we just call into a fatter facade.

### Layer 2 — `edit_text` tool operations (~50 LOC)

Extend the operation union in `packages/panels/src/handlers/chat/tools/editTextTool.ts` with two new variants:

```ts
z.object({
  type: z.literal('insert_block'),
  blockType: z.string().describe('Block type from the "Available block types" catalog'),
  blockData: z.record(z.string(), z.unknown())
    .describe('Field values keyed by the block schema field names'),
  position: z.number().optional()
    .describe('0-based paragraph index. Omit to append at end. Negative counts from end.'),
}),
z.object({
  type: z.literal('delete_block'),
  blockType: z.string(),
  blockIndex: z.number().describe('0-based index of the block to remove (across all blocks of the same type in this field)'),
}),
```

The handler dispatch grows two new cases:

```ts
} else if (op.type === 'insert_block') {
  if (Live.insertBlock(fieldDocName, op.blockType, op.blockData, op.position)) applied++
} else if (op.type === 'delete_block') {
  if (Live.removeBlock(fieldDocName, op.blockType, op.blockIndex)) applied++
}
```

These only fire on the **collab branch** of `edit_text` (the field is a `RichContentField`/`BuilderField` with `.collaborative()` or `.persist(['websocket','indexeddb'])`). Non-collab block fields are out of scope — there's no Y.Doc to mutate, and the JSON-in-Y.Map fallback path doesn't have a meaningful concept of "block paragraphs".

### Layer 3 — system prompt update (~20 LOC)

Update `formatBuilderCatalog()` in `packages/panels/src/handlers/chat/blockCatalog.ts` to teach the agent all three operations, not just `update_block`:

```ts
lines.push('Block operations available via `edit_text`:')
lines.push('  • insert_block: { type: "insert_block", blockType: "<name>", blockData: { …field values… }, position?: number }')
lines.push('  • update_block: { type: "update_block", blockType: "<name>", blockIndex: 0, field: "<field name>", value: "<new value>" }')
lines.push('  • delete_block: { type: "delete_block", blockType: "<name>", blockIndex: 0 }')
lines.push('Use `blockIndex` (0-based) to disambiguate multiple blocks of the same type. Omit `position` on insert to append at the end of the field.')
```

Also update the corresponding `editTextDescription` in `editTextTool.ts` so the tool's own description hints at the new operations.

The static-injection design from Plan 5.3 carries over unchanged — the model walks into the conversation already knowing what to call.

---

## Implementation Phases

### Phase 1 — `Live.insertBlock` + `Live.removeBlock`

**Files:**
- `packages/live/src/index.ts` — add both methods
- `packages/live/src/index.test.ts` — add unit tests

**Acceptance:**
- `insertBlock('room', 'callToAction', { title: 'Hi' })` produces a Y.Doc structure that, when read back via the existing `live/src/index.ts:578` walker, contains the new block at the end.
- `insertBlock('room', 'video', { url: '…' }, 0)` inserts at the start.
- `insertBlock('room', 'video', { url: '…' }, -1)` inserts before the last existing paragraph.
- `removeBlock('room', 'callToAction', 0)` removes the first CTA, and the next call with the same args removes what was originally the second CTA.
- Both methods return `false` and no-op when the room or root is uninitialized (instead of throwing).
- After insert + remove, the document round-trips through the existing `readText`/`findBlockInXmlTree` helpers without errors.

**Tests:**
- Insert at end into empty paragraph-only document
- Insert at end into document with existing blocks
- Insert at index 0 (start)
- Insert at negative index (-1)
- Insert with empty `blockData`
- Insert into uninitialized room → returns false, no-op
- Remove first / middle / last block of a type
- Remove block, then re-insert with different data, round-trip is correct
- Remove non-existent block (wrong type, out-of-range index) → returns false

### Phase 2 — `edit_text` operations

**Files:**
- `packages/panels/src/handlers/chat/tools/editTextTool.ts` — extend the operation union, add dispatch cases
- `packages/panels/src/__tests__/blockCatalog.test.ts` — extend formatter tests to assert the new operation descriptions

**Acceptance:**
- The Zod schema accepts `insert_block` and `delete_block` operations.
- A tool call with `insert_block` reaches `Live.insertBlock` and the count returned matches the operations applied.
- A tool call with `delete_block` reaches `Live.removeBlock`.
- Non-collab fields silently skip block operations (same as existing `update_block` handling).

### Phase 3 — system prompt update

**Files:**
- `packages/panels/src/handlers/chat/blockCatalog.ts` — extend `formatBuilderCatalog`
- `packages/panels/src/__tests__/blockCatalog.test.ts` — assert prompt mentions `insert_block`, `delete_block`, `update_block`

**Acceptance:**
- The injected system prompt section lists all three operations with example shapes.
- The catalog tests confirm `formatBuilderCatalog()` output contains all three operation names.

### Phase 4 — Playground end-to-end smoke test

**Files:** None (manual testing in `playground/`)

**Acceptance scenarios** (run each in the article chat after restarting `pnpm dev`):

1. **Insert at end** — "add a callToAction block with title 'Subscribe' and button text 'Join now'"
   → Verify: new CTA appears at the end of the rich content field.
2. **Insert at position** — "add a video block at the top with url 'https://example.com/v1'"
   → Verify: video appears before existing content.
3. **Update inserted block** — immediately after #1, "change the button text to 'Sign up'"
   → Verify: button text updates without inserting a new block.
4. **Delete by index** — "delete the first call to action"
   → Verify: only the first CTA is removed; other CTAs remain.
5. **Insert + delete + insert** — "remove all video blocks, then add a new video at the end with url 'https://example.com/final'"
   → Verify: end state is one video block at the bottom.
6. **Across the catalog boundary** — "add a quote block" (not in the catalog)
   → Verify: agent refuses or asks for clarification, doesn't make up a `quote` blockType.

If any of these fail, the failure modes to look for first:
- Block inserted but renders empty → `__blockData` was stringified instead of passed as raw object
- Block inserted at wrong position → root offset computation is off-by-one
- Block inserted but Lexical doesn't pick it up → `nodeName !== 'custom-block'` or the paragraph is missing a required attr
- Editor crashes on hydration → Y.XmlText paragraph attrs don't match what existing paragraphs use; copy from a working block's parent

### Phase 5 — Memory + docs update

**Files:**
- `~/.claude/projects/.../memory/project_roadmap_status.md` — extend the 5.3 entry to mention insert/delete completion
- `docs/claude/panels.md` — extend the "Block introspection" bullet to say "introspection + read + insert + update + delete"
- `packages/panels/README.md` — if there's a section on AI block editing, mention the new operations
- This plan doc itself: status → DONE, add a note about which acceptance scenarios surfaced bugs (so future-me can learn from them)

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Y.Doc paragraph attrs vary by source (heading vs paragraph vs list) — picking the wrong default produces non-rendering blocks | During implementation, snapshot a working block's parent paragraph attrs from the dev tools and copy verbatim. If multiple shapes exist, default to plain `paragraph` and only special-case if a real-world resource needs it. |
| `insertEmbed` API on Y.XmlText might not exist for elements (only for text) | Check `live/src/index.ts:1145` — `editBlock` uses `setAttribute` on an existing element, doesn't insert new ones. Need to verify the correct insertion API. Yjs has `insert(index, content)` for arrays/text — for XmlText with embedded elements, the equivalent is `insertEmbed`. If that's not available, use the lower-level Y.XmlElement constructor + manual sibling linkage. |
| Lexical CollaborationPlugin re-applies its own defaults on top of inserted nodes, overwriting `__blockData` | The existing `SeedPlugin` retry pattern (see `feedback_yjs_idb_ws_order.md` and `docs/claude/panels.md`) suggests this is a real risk. If it bites, check whether `editBlock` has the same problem — if not, mirror its insertion strategy. |
| Block schema requires fields the agent didn't supply, breaking the rendered block | Catalog already tells the agent which fields are `required`. If the agent omits them, the rendered block will look broken but the document stays valid. v2 hardening: server-side default-fill from the schema before insert. |
| Multiple agents inserting simultaneously create racy paragraph order | Yjs CRDT handles concurrent inserts naturally via its op log. Worst case: two blocks at the same logical position end up in arbitrary order. Acceptable. |
| Removing a block destroys text in the same paragraph | Documented in the system prompt: "blocks have their own paragraphs". If a real resource has mixed paragraphs and the user complains, add a `removeBlockOnly` mode that surgically removes just the element. |

---

## Files Touched

```
packages/live/src/index.ts                                   ← +insertBlock, +removeBlock
packages/live/src/index.test.ts                              ← +tests for both
packages/panels/src/handlers/chat/tools/editTextTool.ts      ← +insert_block, +delete_block ops
packages/panels/src/handlers/chat/blockCatalog.ts            ← extend formatter to teach all 3 ops
packages/panels/src/__tests__/blockCatalog.test.ts           ← assert formatter output
docs/claude/panels.md                                        ← update block-introspection bullet
packages/panels/README.md                                    ← if AI section exists
~/.claude/projects/.../memory/project_roadmap_status.md      ← extend 5.3 entry
docs/plans/panels-block-write-completion-plan.md             ← this doc — flip status to DONE on completion
```

---

## Future (out of scope)

- **Reorder via `move_block` operation** — once insert/delete are stable, a `move_block` op is just `delete_block` + `insert_block` server-side, but exposing it as one operation gives the agent a clearer mental model.
- **Server-side block schema validation** — reject inserts with unknown fields, fill in defaults for missing required fields, coerce types.
- **Cross-field block migration** — "move this CTA from the body to the sidebar". Requires a multi-field tool, not just multi-op.
- **Block templates / presets** — "add a 'sign up' CTA template" instead of providing each field.
- **Undo a single agent operation** — Yjs makes the whole agent turn undoable as one unit; finer granularity would need awareness integration.

---

## Acceptance Summary

This plan is DONE when:

- [x] `Live.insertBlock` and `Live.removeBlock` exist with unit tests covering the cases listed in Phase 1.
- [x] `edit_text` accepts `insert_block` and `delete_block` operations and dispatches them correctly for collab fields.
- [x] The injected system prompt section lists all three block operations.
- [x] All six playground smoke-test scenarios pass without manual intervention.
- [x] Memory + CLAUDE docs are updated to reflect that 5.3 covers introspection + read + insert + update + delete.
- [x] The article chat agent in the playground can complete this multi-step task in one turn: "remove the existing CTA, add a new video at the top, then update the existing video's caption to 'Watch this'."

---

## Post-implementation notes (2026-04-08)

What surprised us during execution:

1. **Lexical-Yjs DecoratorNode shape was wrong in the Background section.** The Background said "the custom-block element's `nodeName` must be `'custom-block'`". That's wrong. `LexicalYjs.dev.mjs:925` shows that for DecoratorNodes, Lexical-Yjs creates a bare `new XmlElement()` (no nodeName arg — Yjs defaults to `'UNDEFINED'`) and writes the Lexical type as a `__type='custom-block'` **attribute**. Our first implementation used the nodeName arg and skipped the `__type` attribute; the block landed in the Y.Doc but `CollabDecoratorNode` filters by attribute, not nodeName, so it was invisible to the editor. Fixed by mirroring the exact shape; added a regression test (`Live.insertBlock — produces a Lexical-compatible block shape`) that asserts the `__type` attribute. The Background section in this plan should be considered superseded by `live/src/index.ts:1170-1175` for future maintainers.

2. **The "trust the catalog" non-goal didn't survive contact with reality.** The plan listed server-side block validation as a v2 hardening pass on the assumption the agent would honor the system prompt's allowlist. Smoke test #6 (refusal scenario) demonstrated otherwise — Claude inserted a `quote` block despite the catalog only listing `callToAction` and `video`. Worse, the editor rendered it as "Unknown block type: quote" which the agent saw as success. Added a `FieldBlockAllowlist` parameter to `buildEditTextTool` and `extractBuilderCatalog`-derived allowlist in `ResourceChatContext`. Rejected ops are reported back in the tool result so the agent can self-correct. After this fix, the agent now responds to the same prompt with "It looks like 'quote' is not a valid block type for the content field…" — surfaces the constraint rather than fabricating success.

3. **`live:inspect` was incomplete for debugging.** It only dumped inner content for `Y.XmlElement` children, not for `Y.XmlText` paragraph nodes — so a 70-paragraph document showed up as 70 unhelpful `YXmlText` lines. Extended the helper to dump paragraph attributes, text content, and embedded blocks so future block-shape debugging is tractable. Lift this into a memory note: when debugging Lexical Y.Doc state, this is the tool — the dump is verbose but it's the only thing that shows the actual stored shape.

4. **Build/restart cadence cost a lot of time.** `pnpm dev` in the playground hot-reloads via vite for the frontend but server-side handlers are loaded from `packages/panels/dist/`, which means every iteration on `editTextTool.ts` requires a root `pnpm build` + restart. Lift this into a feedback memory.
