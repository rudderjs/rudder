# Panels Rich Text Authoring Plan

Give the AI agent in `@rudderjs/panels` the ability to author **structured rich text** — not just plain strings. Today the agent can `replace`/`insert_after`/`delete`/`rewrite` raw text and `update_block` custom blocks. It cannot bold a word, link a phrase, turn a paragraph into a heading, build a bulleted list, or change font family. The Y.Doc tree already supports all of this — the gap is purely on the `@rudderjs/live` API and `edit_text` tool surface.

**Status:** SUPERSEDED (2026-04-08) — formatting ops delivered via `chat-update-form-state-plan.md` Phase 4 instead. The new path runs in the browser via Lexical's `editor.update()` API rather than walking Y.XmlText fragments server-side. `format_text`, `set_link`/`unset_link`, `set_paragraph_type`, `insert_paragraph` all ship as `update_form_state` ops, executed against the live `LexicalEditor` instance registered in `pages/_components/agents/lexicalRegistry.ts`. List ops (`insert_list_item`/`remove_list_item`) and font/style ops are NOT delivered — punt until concrete need.

**Keep this doc for:** the Y.Doc spike notes are still useful if/when **headless** rich-text formatting is needed (background agents, queue workers, scheduled jobs, webhooks — anywhere there's no browser to route through). At that point, resurrect this plan and implement the formatting ops on top of `@rudderjs/live` so they land in `edit_text` server-side. Until a real headless use case appears, the browser-routed path is sufficient.

**Original status:** PROPOSED (2026-04-08)
**Estimated LOC:** ~650
**Packages affected:** `@rudderjs/live`, `@rudderjs/panels`
**Depends on:** `panels-block-write-completion-plan` (insert/delete blocks) — recommended to ship first so block ops and text-structure ops land in stable order.
**Related:** `project_product_identity.md` (VS Code-for-content north star — this plan delivers the equivalent of "format on save" / "wrap selection in tag" / "convert to list"), `chat-update-form-state-plan.md` (the plan that superseded this one for the interactive case)

---

## Goal

After this plan, the agent can answer all of these in one turn:

- "Bold the word **critical** in the intro paragraph"
- "Make the second paragraph an `<h2>`"
- "Turn this list into a numbered list"
- "Link 'docs' to https://rudderjs.dev/docs"
- "Make the whole article body use the 'serif' font family"
- "Convert paragraph 3 into a blockquote"
- "Italicize 'in situ' everywhere it appears"
- "Add a bullet list with three items: foo, bar, baz, after the intro"

It can do all of this against any `RichContentField` collaborative document, with the same surgical-edit ergonomics the existing `editText` already provides for plain text.

---

## Non-Goals

- **Tables.** Lexical's TableNode is its own subtree shape — separate plan.
- **Images / media inside text flow.** Already covered by the block insert/delete plan; images-as-inline-elements (not custom blocks) are out of scope.
- **Code blocks with syntax highlighting.** The `__type='code'` paragraph type is in scope (toggle on/off); language selection and tokenization is not.
- **Custom font upload / web font registration.** This plan changes the `__style` attribute on text nodes; the available font families are whatever the Lexical theme already exposes.
- **Color, background-color, font-size as discrete ops.** Bundled into a generic `set_text_style` op that takes raw CSS, since Lexical stores them all the same way (`__style="font-family: serif; color: red"`).
- **Undo/redo of agent ops.** Yjs handles this naturally per-transaction; finer granularity is out of scope.
- **Validation of text-style values.** If the agent writes `__style="font-family: Comic Sans"` the editor will render it as-is. Schema-driven allowed-styles is a v2 hardening pass.

---

## Background — Lexical Y.Doc structure for rich text

This is the contract the implementation must match. Documented in `packages/live/src/index.ts:563-585`:

```
root (Y.XmlText)
  ├── Y.XmlText                                    ← paragraph-level container
  │     attrs: __type='heading', __tag='h1'
  │     ├── Y.Map (__type='text', __format=1)     ← inline marks (bitmask)
  │     │     attrs:
  │     │       __format = 1                      ← bold (see bitmask below)
  │     │       __style  = 'font-family: serif'   ← inline CSS string
  │     │       __mode   = 0                      ← normal=0, token=1, segmented=2
  │     │       __detail = 0
  │     └── "actual text content"
  ├── Y.XmlText (__type='paragraph')
  │     ├── Y.Map (__type='text', __format=0)
  │     ├── "plain "
  │     ├── Y.Map (__type='text', __format=2)    ← italic
  │     ├── "italic "
  │     ├── Y.Map (__type='text', __format=0)
  │     └── "again"
  ├── Y.XmlText (__type='list', __tag='ul', __listType='bullet')
  │     ├── Y.XmlText (__type='listitem', __value=1)
  │     │     ├── Y.Map (__type='text')
  │     │     └── "first item"
  │     └── Y.XmlText (__type='listitem', __value=2) ...
  ├── Y.XmlText (__type='quote') ...
  └── Y.XmlText (__type='code', __language='ts') ...
```

### The Lexical `__format` bitmask

Lexical packs inline marks into a single integer. The bits are:

| Bit | Value | Meaning       |
|----:|------:|---------------|
| 0   | 1     | bold          |
| 1   | 2     | italic        |
| 2   | 4     | strikethrough |
| 3   | 8     | underline     |
| 4   | 16    | code          |
| 5   | 32    | subscript     |
| 6   | 64    | superscript   |
| 7   | 128   | highlight     |

So **bold + italic** = `3`, **bold + underline** = `9`, etc. `__format=0` means plain.

Source of truth: `lexical/src/nodes/LexicalTextNode.ts` in the Lexical repo. We copy these constants into `@rudderjs/live` as a frozen object — no runtime dep on Lexical from `live`.

### Inline links

Links are NOT a `__format` bit. They are a **separate sibling Y.XmlText** with `__type='link'` and an `__url` attribute, wrapping the linked text run:

```
Y.XmlText (__type='paragraph')
  ├── Y.Map (__type='text')
  ├── "Read the "
  ├── Y.XmlText (__type='link', __url='https://…')
  │     ├── Y.Map (__type='text')
  │     └── "docs"
  └── " for more"
```

This means inserting a link requires **splitting** the surrounding text run — same hard problem as applying inline format to a substring (see Risks below).

### Paragraph type vs paragraph node

Critical subtlety: in Lexical, a `ParagraphNode`, `HeadingNode`, `QuoteNode`, etc. are **different node classes**. In the Y.Doc, however, they are all `Y.XmlText` distinguished only by `__type` and (sometimes) `__tag`. This means we can flip a paragraph to a heading **by mutating attributes** — we do not need to delete the node and re-create it. **This is the single biggest leverage point in this plan.**

(Lists are an exception — `list` and `listitem` are nested Y.XmlText nodes. Converting a paragraph → list requires building the nested structure.)

### The "split a run to apply formatting" problem

The hard part of this whole plan: applying formatting to a **substring** of a text run.

Given:
```
Y.Map (__format=0)  "the quick brown fox"
```

To bold "quick", we need:
```
Y.Map (__format=0)  "the "
Y.Map (__format=1)  "quick"
Y.Map (__format=0)  " brown fox"
```

Yjs's `Y.XmlText` exposes `delete(offset, len)` and `insert(offset, content)`. Inserting a `Y.Map` between two text runs **does not exist directly** — we have to:

1. Delete the original text run from `offset+matchStart` for `matchLen` chars
2. Insert a new `Y.Map` at that offset with `__format=newFormat`
3. Insert the matched text after the Y.Map

The Y.Map sibling acts as the "format marker" for the runs that follow it, until the next Y.Map appears. **Verify this during implementation by inspecting an existing bold run** with `live:inspect` — if the binding instead uses delta `attributes` on the text run itself, we use `Y.XmlText.format(offset, len, attrs)` and skip the Y.Map dance entirely.

> **Open question to resolve in Phase 0:** does the Lexical-Yjs binding use Y.Map siblings or Y.XmlText delta attributes for inline marks? The answer determines 80% of the implementation. Spend the first hour confirming this against a real document, before writing any code.

---

## Approach

Three layers, mirroring the block plan:

### Layer 1 — `@rudderjs/live` rich-text primitives (~400 LOC)

New methods on the `Live` facade:

#### Inline formatting

```ts
/**
 * Apply (or clear) inline formatting marks on a text range.
 *
 * @param search    Text to find (within the field's flattened text content).
 * @param marks     Object with bool fields for each mark; missing fields are
 *                  left unchanged. Pass `false` to explicitly clear a mark.
 * @param occurrence  0 = first match, -1 = all matches, n = nth match.
 *                    Default: 0.
 *
 * @example
 * Live.formatText('panel:articles:42:richcontent:body', 'critical',
 *   { bold: true, italic: true })
 */
formatText(
  docName: string,
  search: string,
  marks: Partial<{
    bold: boolean
    italic: boolean
    underline: boolean
    strikethrough: boolean
    code: boolean
    subscript: boolean
    superscript: boolean
    highlight: boolean
  }>,
  occurrence?: number,
): boolean

/**
 * Set inline CSS style on a text range. Replaces the entire __style attribute.
 * Pass empty string to clear.
 *
 * @example
 * Live.setTextStyle(docName, 'hero copy', 'font-family: serif; color: #333')
 */
setTextStyle(
  docName: string,
  search: string,
  style: string,
  occurrence?: number,
): boolean

/**
 * Wrap a text range in a link. If the range is already inside a link, updates
 * the URL instead of nesting.
 */
setLink(
  docName: string,
  search: string,
  url: string,
  occurrence?: number,
): boolean

/** Remove a link wrapper, preserving the inner text. */
unsetLink(
  docName: string,
  search: string,
  occurrence?: number,
): boolean
```

#### Paragraph type / structure

```ts
/**
 * Change the type of a paragraph-level node. Identifies the target by
 * either zero-based paragraph index OR a search string contained in the
 * paragraph's text.
 *
 * For 'heading', `tag` is required ('h1'..'h6').
 * For 'list', `listType` is required ('bullet' | 'number' | 'check').
 *
 * Converting to/from 'list' rebuilds the node (paragraph → list-with-one-item;
 * list → first-item-as-paragraph). All other conversions are pure attribute flips.
 */
setParagraphType(
  docName: string,
  selector: { paragraphIndex: number } | { textContains: string },
  type: 'paragraph' | 'heading' | 'quote' | 'code' | 'list',
  options?: {
    tag?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
    listType?: 'bullet' | 'number' | 'check'
    language?: string  // for code blocks
  },
): boolean

/**
 * Insert a new paragraph-level node at a given index (or at the end).
 * Same selector semantics as `insertBlock` (negative index counts from end).
 */
insertParagraph(
  docName: string,
  text: string,
  options?: {
    type?: 'paragraph' | 'heading' | 'quote' | 'code'
    tag?: string
    position?: number
  },
): boolean

/**
 * Add an item to an existing list (identified by paragraphIndex).
 * Position omitted → append.
 */
insertListItem(
  docName: string,
  paragraphIndex: number,
  text: string,
  position?: number,
): boolean

/** Remove a list item by index within the list. */
removeListItem(
  docName: string,
  paragraphIndex: number,
  itemIndex: number,
): boolean
```

#### Read helpers (needed by the agent so it can target ops correctly)

```ts
/**
 * Snapshot a structured view of the document — paragraph types, text content,
 * inline marks. Used by the agent's read path so it can issue targeted ops.
 *
 * Returns: array of paragraphs with index, type, tag, plain text, and a list
 * of formatted runs ({ text, format, style, link }).
 */
inspectRichText(docName: string): RichTextSnapshot
```

The snapshot is what the agent reads when planning ops — much higher-fidelity than the existing `readText` which flattens everything to plain strings.

**Implementation notes:**

1. **Phase 0 spike** — verify whether inline marks live in Y.Map siblings or Y.XmlText delta attributes. Write one throwaway test that bolds a word in a known fixture and dumps the resulting tree. Branch the implementation accordingly. **Do not proceed past this step until the answer is known.**
2. All mutating methods take an `aiCursor` arg like `editText` does, and set awareness to highlight the affected range while the op is in flight.
3. All mutations happen inside a single `room.doc.transact(..., SERVER_ORIGIN)` so a multi-mark op produces one Yjs update.
4. Reuse `findTextInXmlTree` from `live/src/index.ts:596` for the search part; extend it to return the parent paragraph node and the within-paragraph offset (currently it only returns target + flat offset).
5. For `setParagraphType`, the attribute-flip path is straightforward (`node.setAttribute('__type', ...)`). For list ↔ non-list, build the new node, copy text content, replace at the same root offset.
6. For `formatText` with `occurrence: -1`, walk the tree once and collect all matches before mutating, to avoid offset drift mid-loop.

### Layer 2 — `edit_text` tool operations (~150 LOC)

Extend the Zod operation union in `editTextTool.ts` with:

```ts
z.object({
  type: z.literal('format_text'),
  search: z.string(),
  marks: z.object({
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    strikethrough: z.boolean().optional(),
    code: z.boolean().optional(),
    subscript: z.boolean().optional(),
    superscript: z.boolean().optional(),
    highlight: z.boolean().optional(),
  }),
  occurrence: z.number().optional().describe('0 = first match, -1 = all, n = nth'),
}),
z.object({
  type: z.literal('set_text_style'),
  search: z.string(),
  style: z.string().describe('Inline CSS — e.g. "font-family: serif; color: #333"'),
  occurrence: z.number().optional(),
}),
z.object({
  type: z.literal('set_link'),
  search: z.string(),
  url: z.string().url(),
  occurrence: z.number().optional(),
}),
z.object({
  type: z.literal('unset_link'),
  search: z.string(),
  occurrence: z.number().optional(),
}),
z.object({
  type: z.literal('set_paragraph_type'),
  selector: z.union([
    z.object({ paragraphIndex: z.number() }),
    z.object({ textContains: z.string() }),
  ]),
  paragraphType: z.enum(['paragraph', 'heading', 'quote', 'code', 'list']),
  tag: z.enum(['h1','h2','h3','h4','h5','h6']).optional(),
  listType: z.enum(['bullet','number','check']).optional(),
  language: z.string().optional(),
}),
z.object({
  type: z.literal('insert_paragraph'),
  text: z.string(),
  paragraphType: z.enum(['paragraph','heading','quote','code']).optional(),
  tag: z.string().optional(),
  position: z.number().optional(),
}),
z.object({
  type: z.literal('insert_list_item'),
  paragraphIndex: z.number(),
  text: z.string(),
  position: z.number().optional(),
}),
z.object({
  type: z.literal('remove_list_item'),
  paragraphIndex: z.number(),
  itemIndex: z.number(),
}),
```

Dispatch each to the corresponding `Live.*` method on the **collab branch only**. Non-collab fields silently skip these ops (same convention as `update_block`).

### Layer 3 — system prompt + read path (~100 LOC)

Two changes:

1. **`formatBuilderCatalog` (or a sibling formatter)** in `packages/panels/src/handlers/chat/blockCatalog.ts` — extend to teach all the new ops. Group them by purpose:

   ```
   Inline formatting:
     • format_text:    { type: "format_text", search: "...", marks: { bold: true, ... } }
     • set_text_style: { type: "set_text_style", search: "...", style: "font-family: serif" }
     • set_link:       { type: "set_link", search: "...", url: "https://..." }
     • unset_link:     { type: "unset_link", search: "..." }

   Paragraph structure:
     • set_paragraph_type: { type: "set_paragraph_type",
                             selector: { paragraphIndex: 0 } | { textContains: "..." },
                             paragraphType: "heading", tag: "h2" }
     • insert_paragraph:   { type: "insert_paragraph", text: "...",
                             paragraphType: "heading", tag: "h2", position: 1 }
     • insert_list_item:   { type: "insert_list_item", paragraphIndex: 3, text: "...", position?: 0 }
     • remove_list_item:   { type: "remove_list_item", paragraphIndex: 3, itemIndex: 0 }
   ```

2. **Read path** — the agent's existing record-loading path returns flat strings from `Live.readText`. For richcontent fields, optionally also include the structured snapshot from `Live.inspectRichText` so the agent can see paragraph types and existing formatting before issuing ops. Gate this by field type to avoid bloating the prompt for plain-text fields.

---

## Implementation Phases

### Phase 0 — Tree-shape spike (no production code)

**Goal:** answer the open question about Y.Map siblings vs delta attributes.

**Steps:**
1. Add a temporary script `packages/live/scripts/inspect-formatting.ts` that opens a known richcontent room, dumps `root.toDelta()` and per-paragraph deltas to JSON.
2. In the playground, manually bold a word, italicize another, add a link, and re-run the script.
3. Document the actual storage format in `docs/claude/panels.md` (extend the Lexical Y.Doc tree section) and in this plan's Background section.
4. Delete the script after the format is documented.

**Acceptance:** the Background section above is verified against a real document and amended if wrong. **No further phases start until this is done.**

### Phase 1 — `Live.formatText` + `Live.setTextStyle`

**Files:**
- `packages/live/src/index.ts` — both methods + extended tree walker
- `packages/live/src/index.test.ts` — fixture-based unit tests

**Acceptance:**
- Bold a single word in the middle of a paragraph; round-trip via `inspectRichText` shows `format=1` on the matching run only.
- Apply bold + italic in one call → `format=3`.
- Apply bold to a word that's already italic → `format=3` (preserves existing marks).
- Pass `bold: false` to clear bold from a `format=3` run → `format=2`.
- `occurrence: -1` formats every match in the document.
- Search text not found → return false, no mutation.

### Phase 2 — `Live.setLink` + `Live.unsetLink`

**Files:** same as Phase 1.

**Acceptance:**
- Wrap a word in a link → tree shows new `Y.XmlText __type='link' __url='…'` with the word inside.
- `setLink` on a word already inside a link with a different URL → updates `__url` in place, no nesting.
- `unsetLink` removes the wrapper, leaves the text in the parent paragraph.
- Wrapping multi-word text spanning existing inline marks preserves those marks.

### Phase 3 — `Live.setParagraphType` + `Live.insertParagraph`

**Files:** same as Phase 1.

**Acceptance:**
- Flip paragraph 1 to `heading` with `tag='h2'` → `__type='heading'`, `__tag='h2'`, text content unchanged, inline marks unchanged.
- Flip heading back to paragraph → attrs reset, content survives.
- Flip paragraph to `quote` / `code` — text preserved.
- Flip paragraph to `list` (bullet) → original paragraph becomes a list with one item containing the original text.
- Flip list back to paragraph → first item's text becomes the new paragraph; other items are dropped (documented behavior, see Risks).
- `insertParagraph(..., { position: 0 })` adds at the top.
- `insertParagraph(..., { type: 'heading', tag: 'h1', text: 'Title' })` inserts a fresh h1.

### Phase 4 — List operations

**Files:** same as Phase 1.

**Acceptance:**
- `insertListItem(docName, paragraphIndex, 'new item')` appends to an existing list.
- `insertListItem(..., position: 0)` prepends.
- `removeListItem` by index works at start / middle / end.
- Removing the last item of a list — the list node remains as an empty list (does not auto-collapse to paragraph). Documented behavior; agents can follow with `setParagraphType` if they want collapse.

### Phase 5 — `Live.inspectRichText` snapshot

**Files:** same as Phase 1.

**Acceptance:**
- Returns one entry per root child, with index, type, tag, plain text, and an array of formatted runs.
- Each run includes text, format bitmask (decoded into `{ bold, italic, … }`), style string, and link URL if any.
- For lists, items are nested with their own runs.
- Schema is round-trip stable: feeding the snapshot back through the mutating ops produces the same tree.

### Phase 6 — `edit_text` tool wiring

**Files:**
- `packages/panels/src/handlers/chat/tools/editTextTool.ts` — extend operation union + dispatch
- `packages/panels/src/__tests__/editTextTool.test.ts` — extend tests

**Acceptance:**
- All eight new operation types parse via Zod and dispatch to the right `Live.*` method.
- Mixed batches (e.g. `set_paragraph_type` + `format_text` + `insert_list_item`) apply in order in a single response.
- Non-collab fields short-circuit the new ops with the existing "silently skip" pattern.

### Phase 7 — System prompt + read path

**Files:**
- `packages/panels/src/handlers/chat/blockCatalog.ts` (or new sibling `richTextOps.ts`) — extend the formatter
- `packages/panels/src/handlers/chat/...` — extend the record-loading path to include `inspectRichText` for richcontent fields
- `packages/panels/src/__tests__/blockCatalog.test.ts` — assert all eight ops appear in the prompt

**Acceptance:**
- The injected system prompt section lists all rich-text ops grouped by purpose, with example payloads.
- The agent sees structured paragraph info (types, current formatting) for richcontent fields in its record snapshot.

### Phase 8 — Playground end-to-end smoke test

Run each in the article chat after `pnpm dev`:

1. **Bold a word** — "bold the word 'critical' in the second paragraph"
2. **Italic + link** — "italicize 'docs' and link it to https://rudderjs.dev/docs"
3. **Heading conversion** — "make the first paragraph an h1"
4. **List build** — "after the intro, add a bulleted list with three items: foo, bar, baz"
5. **List → numbered** — "change that list to a numbered list"
6. **Quote** — "convert paragraph 3 into a blockquote"
7. **Font family** — "set the whole second paragraph to use serif font"
8. **Multi-op turn** — "make paragraph 2 an h2, bold the first three words, and add a quote paragraph after it that says 'attribution: anonymous'"
9. **Clear formatting** — "remove all bold formatting from the document"
10. **Across catalog boundary** — "make this paragraph use the dancing script font" (not in any allowlist)
    → Verify: agent sets `__style='font-family: "Dancing Script"'` and the editor renders it (we don't validate, by design).

If any fail, primary failure modes to check:
- Format applied to wrong run → `findTextInXmlTree` returned the wrong parent; check the offset math
- Bold "lost" after a save → Y.Map sibling vs delta attribute mismatch; revisit Phase 0 findings
- Heading conversion crashes editor → Lexical's HeadingNode requires both `__type` and `__tag`; verify both are set
- List conversion produces empty list → list/listitem nesting attrs missing; copy from a working list
- Link wrapping breaks adjacent formatting → run-splitting logic discarded sibling Y.Maps; preserve them across the split

### Phase 9 — Memory + docs

**Files:**
- `~/.claude/projects/.../memory/project_roadmap_status.md` — add a "Rich Text Authoring DONE" entry
- `docs/claude/panels.md` — extend the AI capabilities section: "introspect + read + insert/delete blocks + author rich text (formatting, structure, links, lists)"
- `packages/panels/README.md` — extend the AI section
- This plan: status → DONE, append "what surprised us" notes

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **Phase 0 reveals inline marks use a third storage format** we didn't anticipate (e.g. mixed Y.Map + delta attrs depending on Lexical version) | Phase 0 is explicitly a spike. Adjust plan before Phase 1. Worst case: implement against the format we observe and pin the lexical-yjs binding version in playground. |
| **Run-splitting math is wrong**, producing corrupted documents that crash the editor on hydration | Heavy fixture-based unit tests in Phase 1. Test corner cases: format at start of run, end of run, exactly one run, spanning multiple runs, spanning a link boundary, spanning a block boundary. |
| **Lexical re-creates nodes on hydration**, dropping our attribute-only paragraph-type flips | If observed, fall back to delete + re-insert pattern for paragraph type changes. Slower, but correct. The block plan's Layer 1 already has working insertion code we can lift. |
| **List conversion drops items** when going list → paragraph | Documented behavior — the agent can remove unwanted items first or use a different op. If users complain, add an `expansionMode: 'first' \| 'all-as-paragraphs'` option to `setParagraphType`. |
| **`occurrence: -1` on a huge document is slow** because we walk the tree per match | Acceptable for v1 — agents won't issue this on 10MB documents. If it becomes a problem, batch into one tree walk. |
| **Agent issues style ops with arbitrary CSS that crashes Lexical's CSS parser** | Lexical accepts any string in `__style` and renders via the DOM, which is forgiving. Worst case: invalid CSS is ignored. We do not validate. |
| **Concurrent agent + human edits to the same paragraph** produce surprising merges | Yjs CRDT handles this naturally. AI awareness (cursor highlight) reduces accidental overlap. Same risk profile as the existing `editText` ops — no new mitigation needed. |
| **Bitmask drift** if a future Lexical version reassigns format bits | Pin the bitmask in `live` and add a startup assertion that compares against a tiny round-trip test. Surface a clear error if it ever changes. |
| **`textContains` selector is ambiguous** when the same text appears in multiple paragraphs | Document: matches the **first** paragraph containing the text. Agents that need disambiguation should use `paragraphIndex` (which they get from `inspectRichText`). |

---

## Files Touched

```
packages/live/src/index.ts                                     ← +8 mutators, +inspectRichText, extended tree walker
packages/live/src/index.test.ts                                ← fixture-based tests for each method
packages/panels/src/handlers/chat/tools/editTextTool.ts        ← +8 op types, dispatch
packages/panels/src/handlers/chat/blockCatalog.ts              ← extend formatter (or new richTextOps.ts sibling)
packages/panels/src/handlers/chat/...                          ← record-load path includes inspectRichText for richcontent
packages/panels/src/__tests__/blockCatalog.test.ts             ← assert ops in prompt
packages/panels/src/__tests__/editTextTool.test.ts             ← op dispatch tests
docs/claude/panels.md                                          ← document verified tree shape + AI capabilities
packages/panels/README.md                                      ← AI section update
~/.claude/projects/.../memory/project_roadmap_status.md        ← record completion
docs/plans/panels-rich-text-authoring-plan.md                  ← this doc — flip to DONE
```

---

## Future (out of scope)

- **Tables** — TableNode subtree authoring
- **Inline images** without going through the custom-block system
- **Code blocks with language picker** and syntax highlighting hints
- **Style allowlists** per resource — schema-driven validation of font families, colors, etc.
- **Selection-based ops** — when the user has selected text in the editor, scope agent ops to that selection automatically (the existing `selection` parameter already exists; this plan honors it but doesn't extend it)
- **Format painter** — "copy the formatting from paragraph 2 onto paragraph 5"
- **Find & replace with formatting** — "replace 'foo' with 'bar' and bold the new text"
- **Per-character mark queries** — "is the word 'critical' bold anywhere?" via a query API instead of inspectRichText

---

## Acceptance Summary

This plan is DONE when:

- [ ] Phase 0 spike has answered the Y.Map vs delta-attribute question and the Background section reflects reality
- [ ] `Live.formatText`, `setTextStyle`, `setLink`, `unsetLink`, `setParagraphType`, `insertParagraph`, `insertListItem`, `removeListItem`, `inspectRichText` all exist with unit tests
- [ ] `edit_text` accepts and dispatches all eight new operation types on collab fields
- [ ] The injected system prompt teaches all eight ops grouped by purpose
- [ ] Richcontent fields include the structured snapshot in the agent's record view
- [ ] All ten playground smoke-test scenarios pass without manual intervention
- [ ] Memory + CLAUDE docs reflect the new AI authoring capabilities
- [ ] The article chat agent can complete this multi-step turn in one response: "convert the first paragraph to an h1, bold the word 'critical' in paragraph 2, link 'docs' to https://rudderjs.dev/docs, then add a bulleted list at the end with items 'one', 'two', 'three'"
