# Server-Side AI Cursor & Y.XmlText Editing — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** AI agents edit collaborative text fields via server-side Y.XmlText operations with a visible AI cursor, preserving all users' cursors and selections. Block data updates are also handled server-side via Y.XmlElement attributes.

**Architecture:** For collaborative fields, `edit_text` becomes a server tool that edits the Yjs document directly via `Live.editText()` (text ops) and `Live.editBlock()` (block ops). A dedicated AI awareness state (name: "AI Assistant", color: purple) is broadcast to the Y.Doc room so all connected users see the AI's presence during edits. For non-collaborative fields, server-side string manipulation + `Live.updateMap()` replaces the old client-side SSE path.

**Tech Stack:** Yjs (`Y.XmlText`, `Y.XmlElement`, awareness via `lib0` encoding), `@rudderjs/live`, `@rudderjs/panels` (ResourceAgent), Lexical-Yjs binding (auto-syncs Y.Doc changes to editor)

---

## Context & Key Learnings

### Current state (what's built)
- `edit_text` is a `.client()` tool — AI agent yields it via SSE, browser applies edits via Lexical `editor.update()` + `splitText()`/`setTextContent()`
- Works for both collaborative (Lexical) and non-collaborative (plain textarea) fields
- **Problem**: `splitText()` destroys the TextNode, causing all users to lose cursor/focus
- Client-side plumbing: SSE `client_tool_call` event → `AiChatContext` → `SchemaForm.handleClientToolCall` → editor ref `applyEdits()`

### Target state
- **Collaborative fields**: `edit_text` is a `.server()` tool → uses `Live.editText()` / `Live.editBlock()` → edits Y.XmlText/Y.XmlElement directly → Yjs syncs to all clients → Lexical binding updates editors → AI cursor visible to all users
- **Non-collaborative fields**: `edit_text` is a `.server()` tool → applies string ops on server → writes result via `Live.updateMap()` → Y.Map syncs to form state
- No more client-side `edit_text` execution — everything is server-side

### Why server-side Y.XmlText is better for collab fields
1. Yjs relative positions preserve all users' cursors through edits
2. AI gets its own awareness entry (cursor + name + color) — visible as a collaborator
3. No cursor hijacking — the triggering user's cursor stays put
4. Simpler client — no `applyEdits()` needed for AI edits, Yjs binding handles everything
5. Same architecture as Tiptap's Content AI

### Yjs tree structure for Lexical
The Lexical-Yjs binding (`@lexical/yjs` CollabDecoratorNode) stores content as:
```
Y.Doc
  └── 'root' (Y.XmlText)
        ├── Y.XmlElement('paragraph')
        │     └── (inline text content as Y.XmlText runs)
        ├── Y.XmlElement('heading')
        │     └── (inline text content)
        ├── Y.XmlElement('custom-block')  ← BlockNode (DecoratorNode)
        │     ├── attribute: __type = 'custom-block'
        │     ├── attribute: __blockType = 'callToAction'
        │     └── attribute: __blockData = '{"title":"Sign Up","buttonText":"Click"}'
        └── Y.XmlElement('paragraph')
              └── (more text)
```

**Text operations**: Walk root → iterate XmlElements → get element text content → find search string → compute offset → `element.delete(offset, len)` + `element.insert(offset, text)`.

**Block operations**: Walk root → find Y.XmlElement with matching `__blockType` attribute (by index if multiple) → update `__blockData` attribute via `element.setAttribute('__blockData', newJSON)`.

### Lexical Y.Doc room naming
- Form fields Y.Map: `panel:{resource}:{recordId}`
- Text fields: `panel:{resource}:{recordId}:text:{fieldName}`
- Rich text fields: `panel:{resource}:{recordId}:richcontent:{fieldName}`

### Awareness protocol (wire format)
The live module already hand-rolls y-protocols binary format using `lib0` (a dependency). Awareness messages are:
```
[messageAwareness=1 (varint)]
  [numberOfClients (varint)]
    [clientID (varint)]
    [clock (varint)]
    [stateJSON_length (varint)]
    [stateJSON (utf8 bytes)]
```
To broadcast an AI cursor, we encode a synthetic awareness update with a fixed client ID (e.g. `999999`) and state `{"user":{"name":"AI Assistant","color":"#8b5cf6"}}`. To clear, send the same client ID with `null` state.

The `lib0` package provides `encoding.createEncoder()`, `encoding.writeVarUint()`, `encoding.writeVarString()`, `encoding.toUint8Array()` for building these messages.

### Field metadata available from Resource
The `Field` base class exposes:
- `field.getType()` → `'text'`, `'textarea'`, `'richcontent'`, etc.
- `field.isYjs()` → `true` if `.collaborative()` or `.persist(['websocket', ...])` was called
- `field.getName()` → field name string

The Resource's `_resolveForm()` returns a `Form` with `getFields()` that includes full field metadata. This is how we'll pass field type info to agents — no new builder method needed.

### Key files
| File | Role |
|------|------|
| `packages/live/src/index.ts` | Live singleton, room management, WebSocket handler, awareness relay |
| `packages/panels/src/agents/ResourceAgent.ts` | `buildTools()`, currently has `edit_text` as `.client()` |
| `packages/panels/src/handlers/panelChat.ts` | Outer router also has `edit_text` as `.client()` |
| `packages/panels/src/Resource.ts` | `_resolveForm()`, `agents()`, `toMeta()` |
| `packages/panels/src/schema/Field.ts` | Base field class: `getType()`, `isYjs()`, `getName()` |
| `packages/panels/pages/_components/agents/AiChatContext.tsx` | SSE parser with `client_tool_call` handler |
| `packages/panels/pages/_components/SchemaForm.tsx` | `handleClientToolCall` with fallback for non-collab |
| `packages/panels-lexical/src/CollaborativePlainText.tsx` | `applyTextOp()`, `EditorHandle` interface |
| `packages/panels-lexical/src/LexicalEditor.tsx` | `EditorRefPlugin` with `applyEdits()` + block support |
| `packages/panels-lexical/src/lexical/BlockNode.tsx` | `BlockNode` DecoratorNode, `__blockType`, `__blockData`, `setBlockData()` |

---

## Task 1: Add `Live.editText()` — surgical Y.XmlText editing

Add a method to the Live singleton that walks the Yjs tree to find text and apply surgical edits.

**Files:**
- Modify: `packages/live/src/index.ts`

**Step 1: Implement text tree walker**

The root `Y.XmlText` contains `Y.XmlElement` children. Each element's text content is inline. To find a search string, we need to walk the tree element by element.

Add a private helper that finds text across Y.XmlElement children:

```ts
/** Walk Y.XmlElement children of a root Y.XmlText and find a text match.
 *  Returns { element, offset } where offset is the character position within that element. */
function findTextInXmlTree(
  root: Y.XmlText,
  search: string,
): { element: Y.XmlText | Y.XmlElement; offset: number } | null {
  // Iterate the root's children via toDelta()
  // Each delta item is either:
  //   { insert: string }                         — inline text run
  //   { insert: Y.XmlElement }                   — embedded element (paragraph, heading, etc.)
  //   { insert: Y.XmlText }                      — nested text fragment
  
  // For Lexical docs, content is in Y.XmlElement children (paragraphs).
  // Each paragraph element contains inline text as its own content.
  // We need to get the text content of each element and search within it.
  
  let childIdx = 0
  let item = root._first  // Walk the linked list of Y.XmlText content
  while (item) {
    const content = item.content
    if (content instanceof Y.XmlElement) {
      // Get the element's text content
      const text = content.toString()  // Returns text content of the XmlElement
      const idx = text.indexOf(search)
      if (idx !== -1) {
        return { element: content, offset: idx }
      }
    }
    item = item.right
    childIdx++
  }
  
  return null
}
```

**Important caveat**: `Y.XmlText._first` is an internal API. A safer approach is to use `root.toArray()` or iterate via `root.length` and `root.get(i)`. Check what Yjs exposes publicly — if needed, reconstruct text via `root.toDelta()` which returns an array of insert operations.

Actually, the cleaner approach:

```ts
function findTextInXmlTree(root: Y.XmlText, search: string) {
  // Y.XmlText.toDelta() returns array of { insert: string | Y.XmlElement | Y.XmlText }
  const delta = root.toDelta()
  let globalOffset = 0
  
  for (const item of delta) {
    if (item.insert instanceof Y.XmlElement) {
      // Get element's inline text content
      const elemText = item.insert.toString()
      const idx = elemText.indexOf(search)
      if (idx !== -1) {
        return { element: item.insert, offset: idx }
      }
    }
    globalOffset++
  }
  return null
}
```

Wait — for `Y.XmlElement` children in a Lexical doc, the text content is stored as the element's own inline content. We edit it via:
- `element.delete(offset, length)` — removes characters at offset
- `element.insert(offset, text)` — inserts text at offset

But `Y.XmlElement` doesn't have `delete`/`insert` for text. The text is in a child `Y.XmlText` inside the element. Let me reconsider...

Actually, in the Lexical-Yjs binding, each paragraph/heading is a `Y.XmlElement` that contains a `Y.XmlText` child for its inline content. The text operations need to target that inner `Y.XmlText`.

Revised approach — iterate root's children, for each `Y.XmlElement`, get its first text child:

```ts
function findTextInRoot(root: Y.XmlText, search: string) {
  const delta = root.toDelta()
  for (const item of delta) {
    if (!(item.insert instanceof Y.XmlElement)) continue
    const elem = item.insert as Y.XmlElement
    
    // Skip non-text elements (blocks/decorators)
    if (elem.nodeName === 'custom-block') continue
    
    // Get text content — XmlElement's text is in its inline content
    const textContent = elem.toString()
    const idx = textContent.indexOf(search)
    if (idx !== -1) {
      return { element: elem, offset: idx }
    }
  }
  return null
}
```

For the actual edit, `Y.XmlElement` extends `Y.XmlFragment` which has `insert(index, content)` and `delete(index, length)` — but these operate on *child nodes*, not characters.

The real approach: each `Y.XmlElement` (paragraph) contains `Y.XmlText` runs as children. We need to find the correct `Y.XmlText` child and edit it. But actually, in Lexical's Yjs binding, paragraphs are stored as `Y.XmlElement` with their text content directly embedded (not as a child `Y.XmlText`). Let me verify...

From the Lexical Yjs source (`CollabElementNode`), paragraph elements store their children as a linked list in the `Y.XmlElement`. Text nodes become `Y.Map` items within the element, and the actual text is stored via `Y.XmlText` inline content.

**This is getting complex. The safest approach is to use `Y.XmlText` operations on the inner text, but the exact structure depends on the Lexical-Yjs binding version.**

Let me take a different, simpler approach that works regardless of internal structure:

```ts
// Get the full text, find the match, compute the absolute offset,
// then use Y.XmlText.delete() + insert() on the root directly.
// Y.XmlText operations at the root level will be intercepted by
// the Lexical binding and mapped to the correct nodes.
```

Wait, that won't work either because the root Y.XmlText contains mixed content (text runs + XmlElement embeds).

**Best approach: Read the Yjs doc as Lexical JSON, manipulate, write back.**

No — that defeats the purpose of surgical editing.

**Actual best approach: use the Y.XmlElement's `toString()` to find text, then use its internal `_first` linked list to navigate to the correct Y.XmlText child and apply `delete`/`insert` character operations.**

This needs careful implementation. I'll specify the algorithm precisely in the task.

**Step 2: Implement `Live.editText()`**

Add to the Live object:

```ts
/**
 * Surgically edit text in a Lexical Y.Doc room.
 * Walks the Y.XmlText root → Y.XmlElement children (paragraphs/headings) →
 * finds the search string → applies delete+insert at the character level.
 *
 * Returns true if the edit was applied, false if search text not found.
 */
editText(
  docName: string,
  operation: { type: 'replace'; search: string; replace: string }
           | { type: 'insert_after'; search: string; text: string }
           | { type: 'delete'; search: string },
): boolean {
  const persistence = this.persistence()
  const room = getOrCreateRoom(docName, persistence)
  const root = room.doc.get('root', Y.XmlText)
  
  // Find the search string across paragraph elements
  const match = findTextInXmlElements(root, operation.search)
  if (!match) return false
  
  room.doc.transact(() => {
    const { xmlText, offset } = match
    switch (operation.type) {
      case 'replace':
        xmlText.delete(offset, operation.search.length)
        xmlText.insert(offset, operation.replace)
        break
      case 'insert_after':
        xmlText.insert(offset + operation.search.length, operation.text)
        break
      case 'delete':
        xmlText.delete(offset, operation.search.length)
        break
    }
  }, SERVER_ORIGIN)  // SERVER_ORIGIN triggers broadcast to WS clients
  
  return true
}
```

The key helper `findTextInXmlElements` needs to:
1. Walk the root Y.XmlText's delta entries
2. For each Y.XmlElement child (paragraph, heading, list-item, quote, etc.)
3. Get the element's text content
4. If search string found, determine which inner Y.XmlText fragment contains it and at what offset
5. Return `{ xmlText, offset }` — the specific Y.XmlText and character position

**Implementation note**: The inner text structure of a Y.XmlElement depends on how many text formatting runs exist. A plain paragraph might have one text run; a formatted one might have several. The `toString()` method concatenates them. To find the right inner fragment:

```ts
function findTextInXmlElements(
  root: Y.XmlText,
  search: string,
): { xmlText: Y.XmlText; offset: number } | null {
  // Y.XmlText.toDelta() gives us the top-level structure
  const delta = root.toDelta()
  
  for (const entry of delta) {
    if (!(entry.insert instanceof Y.XmlElement)) continue
    const elem = entry.insert as Y.XmlElement
    if (elem.nodeName === 'custom-block') continue  // Skip decorator nodes
    
    // Get full text of this element
    const fullText = elem.toString()
    const searchIdx = fullText.indexOf(search)
    if (searchIdx === -1) continue
    
    // The element itself is an XmlFragment — its text content is
    // accessible via the element treated as an XmlText/XmlFragment.
    // For Lexical binding: each element has inline content that we
    // can edit via the element's own delete/insert (inherited from XmlFragment).
    //
    // XmlElement extends XmlFragment, but text editing uses the
    // inner content. We cast to access the text editing API.
    return { xmlText: elem as unknown as Y.XmlText, offset: searchIdx }
  }
  
  return null
}
```

**CRITICAL**: Need to verify at implementation time whether `Y.XmlElement.delete(offset, length)` and `Y.XmlElement.insert(offset, string)` work for character-level text editing. If not, we need to access the inner `Y.XmlText` child. The implementation should include a debug step where we log `root.toDelta()` for a real Lexical doc to verify the exact structure.

**Step 3: Build and verify**

```bash
cd packages/live && pnpm build
```

**Step 4: Commit**

```bash
git commit -m "feat(live): add editText for surgical Y.XmlText editing"
```

---

## Task 2: Add `Live.editBlock()` — Y.XmlElement attribute updates

Add a method to update block data stored as Y.XmlElement attributes.

**Files:**
- Modify: `packages/live/src/index.ts`

**Step 1: Implement block finder**

Blocks are `Y.XmlElement` nodes with `nodeName='custom-block'` embedded in the root Y.XmlText. Their data is stored as XML attributes:
- `__type` = `'custom-block'`
- `__blockType` = e.g. `'callToAction'`, `'video'`
- `__blockData` = JSON string, e.g. `'{"title":"Sign Up","buttonText":"Click"}'`

```ts
/**
 * Find a block (DecoratorNode) by type and index in a Lexical Y.Doc.
 */
function findBlockInRoot(
  root: Y.XmlText,
  blockType: string,
  blockIndex: number,
): Y.XmlElement | null {
  const delta = root.toDelta()
  let matchIdx = 0
  
  for (const entry of delta) {
    if (!(entry.insert instanceof Y.XmlElement)) continue
    const elem = entry.insert as Y.XmlElement
    
    if (elem.getAttribute('__blockType') === blockType) {
      if (matchIdx === blockIndex) return elem
      matchIdx++
    }
  }
  return null
}
```

**Step 2: Implement `Live.editBlock()`**

```ts
/**
 * Update a block's data field in a Lexical Y.Doc room.
 * Finds the block by type + index, then merges the new field into __blockData.
 *
 * Returns true if the block was found and updated.
 */
editBlock(
  docName: string,
  blockType: string,
  blockIndex: number,
  field: string,
  value: unknown,
): boolean {
  const persistence = this.persistence()
  const room = getOrCreateRoom(docName, persistence)
  const root = room.doc.get('root', Y.XmlText)
  
  const elem = findBlockInRoot(root, blockType, blockIndex)
  if (!elem) return false
  
  room.doc.transact(() => {
    const existing = elem.getAttribute('__blockData')
    const data = typeof existing === 'string' ? JSON.parse(existing) : (existing ?? {})
    data[field] = value
    elem.setAttribute('__blockData', JSON.stringify(data))
  }, SERVER_ORIGIN)
  
  return true
}
```

**Important**: The Lexical-Yjs binding's `syncPropertiesFromYjs` watches for attribute changes on Y.XmlElement nodes via the `CollabDecoratorNode`. When `__blockData` changes, the binding calls `$syncPropertiesFromYjs` which updates the Lexical `BlockNode.__blockData`, triggering a re-render. This is the same path as when a user edits a block field in the UI — fully supported by the existing binding.

**Step 3: Build and verify**

```bash
cd packages/live && pnpm build
```

**Step 4: Commit**

```bash
git commit -m "feat(live): add editBlock for Y.XmlElement attribute updates"
```

---

## Task 3: Add AI awareness to Live rooms

When the AI edits a document, broadcast a temporary awareness state so other users see "AI Assistant" with a purple cursor.

**Files:**
- Modify: `packages/live/src/index.ts`

**Step 1: Implement awareness message encoding**

The awareness protocol format (from y-protocols source):
```
[messageAwareness=1 (varint)]
  awarenessUpdate:
    [numberOfClients (varint)]
    for each client:
      [clientID (varint)]
      [clock (varint)]
      [stateJSON_length (varint)]
      [stateJSON (utf8)]
```

Use `lib0/encoding` (already a dependency) to build the message:

```ts
import * as encoding from 'lib0/encoding'

const AI_CLIENT_ID = 999_999_999  // Synthetic ID, won't collide with real Yjs client IDs (which are random 30-bit)
let aiAwarenessClock = 0

function encodeAiAwareness(state: Record<string, unknown> | null): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, messageAwareness)  // message type
  encoding.writeVarUint(encoder, 1)                  // 1 client in this update
  encoding.writeVarUint(encoder, AI_CLIENT_ID)       // client ID
  encoding.writeVarUint(encoder, ++aiAwarenessClock) // incrementing clock
  encoding.writeVarString(encoder, state ? JSON.stringify(state) : 'null')
  return encoding.toUint8Array(encoder)
}
```

**Step 2: Add `Live.setAiAwareness()` and `Live.clearAiAwareness()`**

```ts
/**
 * Set AI awareness state on a room — shows "AI Assistant" presence to all connected clients.
 * Uses a synthetic client ID (999999999) that doesn't collide with real Yjs clients.
 */
setAiAwareness(docName: string, state: { name: string; color: string }): void {
  const persistence = this.persistence()
  const room = getOrCreateRoom(docName, persistence)
  const msg = encodeAiAwareness({ user: state })
  
  // Broadcast to all connected WebSocket clients
  for (const client of room.clients) {
    if (client.readyState === 1 /* OPEN */) {
      client.send(msg)
    }
  }
  
  // Store in awarenessMap so newly connecting clients also see it
  // Use a sentinel key (we store by WsSocket, but AI has no socket)
  // Store on the room object directly instead
  room._aiAwarenessMsg = msg
}

/**
 * Clear AI awareness state — removes the AI cursor from all clients.
 */
clearAiAwareness(docName: string): void {
  const persistence = this.persistence()
  const room = getOrCreateRoom(docName, persistence)
  const msg = encodeAiAwareness(null)
  
  for (const client of room.clients) {
    if (client.readyState === 1 /* OPEN */) {
      client.send(msg)
    }
  }
  
  delete room._aiAwarenessMsg
}
```

**Step 3: Send stored AI awareness to newly connecting clients**

In `handleConnection`, after sending existing awareness states (line 351), also send the AI awareness if present:

```ts
// After the existing awareness loop
if ((room as any)._aiAwarenessMsg) {
  ws.send((room as any)._aiAwarenessMsg)
}
```

**Step 4: Add `_aiAwarenessMsg` to Room interface**

```ts
interface Room {
  doc:     Y.Doc
  clients: Set<import('ws').WebSocket>
  ready:   Promise<void>
  awarenessMap: Map<import('ws').WebSocket, Uint8Array>
  /** Stored AI awareness message — sent to newly connecting clients. */
  _aiAwarenessMsg?: Uint8Array
}
```

**Step 5: Build and test**

```bash
cd packages/live && pnpm build
```

**Step 6: Commit**

```bash
git commit -m "feat(live): add AI awareness state for visible AI cursor"
```

---

## Task 4: Extract field metadata from Resource for agents

Instead of a new `_fieldTypes` builder method, extract field type info from the existing `Resource._resolveForm()`.

**Files:**
- Modify: `packages/panels/src/agents/ResourceAgent.ts` — add `_fieldMeta` map, update `buildTools()`
- Modify: `packages/panels/src/Resource.ts` — pass field metadata when building agents
- Modify: `packages/panels/src/handlers/panelChat.ts` — same metadata passing

**Step 1: Add field metadata to ResourceAgentContext**

```ts
export interface FieldMeta {
  type: string       // 'text', 'textarea', 'richcontent', etc.
  yjs:  boolean      // true if .collaborative() or .persist(['websocket', ...])
}

export interface ResourceAgentContext {
  record:       Record<string, unknown>
  resourceSlug: string
  recordId:     string
  panelSlug:    string
  /** Field type metadata — keyed by field name. */
  fieldMeta?:   Record<string, FieldMeta>
}
```

**Step 2: Extract field metadata in Resource agent building**

In `panelChat.ts` and `agentRun.ts`, where the resource is resolved and agents are built, extract field metadata from the form:

```ts
// After resolving the resource
const resource = new ResourceClass()
const form = resource._resolveForm()

// Build field metadata map
const fieldMeta: Record<string, FieldMeta> = {}
function extractFields(items: any[]) {
  for (const item of items) {
    if (item.getName && item.getType && item.isYjs) {
      fieldMeta[item.getName()] = { type: item.getType(), yjs: item.isYjs() }
    }
    // Recurse into sections/tabs
    if (item.getFields) extractFields(item.getFields())
    if (item.getTabs) {
      for (const tab of item.getTabs()) {
        if (tab.fields) extractFields(tab.fields)
      }
    }
  }
}
extractFields(form.getFields())

// Pass to agent context
agentCtx = {
  record, resourceSlug, recordId, panelSlug,
  fieldMeta,
}
```

**Step 3: Expose `_resolveForm()` or add a `getFieldMeta()` helper on Resource**

The `_resolveForm()` is currently a private-ish method (underscore prefix). Add a public method:

```ts
// In Resource.ts
/** Get field metadata map: { fieldName: { type, yjs } } */
getFieldMeta(): Record<string, { type: string; yjs: boolean }> {
  const form = this._resolveForm()
  const meta: Record<string, { type: string; yjs: boolean }> = {}
  
  function extract(items: FormItem[]) {
    for (const item of items) {
      if ('getName' in item && 'getType' in item && 'isYjs' in item) {
        const field = item as Field
        meta[field.getName()] = { type: field.getType(), yjs: field.isYjs() }
      }
      // Recurse sections
      if ('getFields' in item) extract((item as any).getFields())
      // Recurse tabs
      if ('getTabs' in item) {
        for (const tab of (item as any).getTabs()) {
          if (tab.fields) extract(tab.fields)
        }
      }
    }
  }
  extract(form.getFields())
  return meta
}
```

**Step 4: Commit**

```bash
git commit -m "feat(panels): expose field metadata for agent routing"
```

---

## Task 5: Convert `edit_text` to server tool with collab/non-collab routing

ResourceAgent's `edit_text` becomes a `.server()` tool that routes based on field metadata.

**Files:**
- Modify: `packages/panels/src/agents/ResourceAgent.ts`

**Step 1: Replace the `.client()` edit_text with `.server()`**

```ts
const editText = toolDefinition({
  name: 'edit_text',
  description: [
    'Surgically edit text or blocks in a field without replacing all content.',
    'Use for rich text or long text fields where you want to change specific words, sentences, or block fields.',
    'For short fields like titles or slugs, use update_field instead.',
    'For embedded blocks (callToAction, video, etc.), use the update_block operation type.',
    'Available fields: ' + allFields.join(', '),
  ].join(' '),
  inputSchema: z.object({
    field: z.enum(allFields as [string, ...string[]]),
    operations: z.array(z.union([
      z.object({
        type: z.literal('replace'),
        search: z.string().describe('The exact text to find (must match exactly)'),
        replace: z.string().describe('The replacement text'),
      }),
      z.object({
        type: z.literal('insert_after'),
        search: z.string().describe('The text to find — new text will be inserted after it'),
        text: z.string().describe('The text to insert'),
      }),
      z.object({
        type: z.literal('delete'),
        search: z.string().describe('The exact text to delete'),
      }),
      z.object({
        type: z.literal('update_block'),
        blockType: z.string().describe('The block type (e.g. "callToAction", "video")'),
        blockIndex: z.number().describe('0-based index if multiple blocks of the same type'),
        field: z.string().describe('The block field to update (e.g. "title", "buttonText")'),
        value: z.string().describe('The new value'),
      }),
    ])),
  }),
}).server(async (input: { field: string; operations: Array<any> }) => {
  const fieldInfo = this.context.fieldMeta?.[input.field]
  const isCollab = fieldInfo?.yjs === true
  
  // Determine Y.Doc room name for collaborative fields
  const fragment = fieldInfo?.type === 'richcontent' ? 'richcontent' : 'text'
  const fieldDocName = `${docName}:${fragment}:${input.field}`
  
  if (isCollab) {
    // ── Collaborative field: edit Y.XmlText/Y.XmlElement directly ──
    
    // Set AI awareness cursor
    Live.setAiAwareness(fieldDocName, { name: `AI: ${this._label}`, color: '#8b5cf6' })
    
    try {
      let applied = 0
      for (const op of input.operations) {
        if (op.type === 'update_block') {
          if (Live.editBlock(fieldDocName, op.blockType, op.blockIndex, op.field, op.value)) {
            applied++
          }
        } else {
          if (Live.editText(fieldDocName, op)) {
            applied++
          }
        }
      }
      return `Applied ${applied}/${input.operations.length} edit(s) to "${input.field}"`
    } finally {
      // Clear AI cursor after a brief delay (so users see it)
      setTimeout(() => Live.clearAiAwareness(fieldDocName), 2000)
    }
    
  } else {
    // ── Non-collaborative field: apply string ops and write to Y.Map ──
    let current = String(this.context.record[input.field] ?? '')
    
    // Read latest from Yjs if available
    try {
      const yjsFields = Live.readMap(docName, 'fields')
      if (yjsFields[input.field] != null) {
        current = String(yjsFields[input.field])
      }
    } catch { /* Live not available */ }
    
    for (const op of input.operations) {
      if (op.type === 'update_block') continue  // Blocks only exist in collab fields
      if (op.type === 'replace' && op.search) {
        current = current.replace(op.search, op.replace)
      } else if (op.type === 'insert_after' && op.search) {
        const idx = current.indexOf(op.search)
        if (idx !== -1) {
          current = current.slice(0, idx + op.search.length) + op.text + current.slice(idx + op.search.length)
        }
      } else if (op.type === 'delete' && op.search) {
        current = current.replace(op.search, '')
      }
    }
    
    // Write result via Y.Map (syncs to form state)
    await Live.updateMap(docName, 'fields', input.field, current)
    return `Updated "${input.field}" successfully`
  }
})
```

**Step 2: Update `loadLive` to include new methods**

```ts
async function loadLive() {
  const mod = await import(/* @vite-ignore */ '@rudderjs/live') as any
  return mod.Live as {
    updateMap(docName: string, mapName: string, field: string, value: unknown): Promise<void>
    readMap(docName: string, mapName: string): Record<string, unknown>
    editText(docName: string, operation: any): boolean
    editBlock(docName: string, blockType: string, blockIndex: number, field: string, value: unknown): boolean
    setAiAwareness(docName: string, state: { name: string; color: string }): void
    clearAiAwareness(docName: string): void
  }
}
```

**Step 3: Build and verify**

```bash
cd packages/panels && pnpm build
```

**Step 4: Commit**

```bash
git commit -m "feat(panels): server-side edit_text with collab/non-collab routing and AI cursor"
```

---

## Task 6: Convert panelChat.ts outer edit_text to server tool

The outer AI chat router in `panelChat.ts` also has an `edit_text` tool (for direct edits without going through a named agent). Convert it to the same server-side pattern.

**Files:**
- Modify: `packages/panels/src/handlers/panelChat.ts`

**Step 1: Convert `editTextTool` from `.client()` to `.server()`**

Same logic as Task 5, but using the `agentCtx.fieldMeta` from the handler context. The outer `editTextTool` (lines 180-205) currently returns `'Edits applied on client'` — replace with server-side execution.

**Step 2: Remove `client_tool_call` SSE forwarding for `edit_text`**

Since `edit_text` is now server-side, the `tool-call` chunk for `edit_text` will be a normal server tool result — no `client_tool_call` event needed.

In both `handleForceAgent` and `handleAiChat`:
```ts
// BEFORE:
case 'tool-call':
  if (chunk.toolCall?.name === 'edit_text') {
    send('client_tool_call', { tool: chunk.toolCall.name, input: chunk.toolCall.arguments })
  } else {
    send('tool_call', { tool: chunk.toolCall?.name, input: chunk.toolCall?.arguments })
  }
  break

// AFTER:
case 'tool-call':
  send('tool_call', { tool: chunk.toolCall?.name, input: chunk.toolCall?.arguments })
  break
```

Keep the `client_tool_call` SSE event type in `AiChatContext.tsx` for potential future client tools, but `edit_text` will no longer trigger it.

**Step 3: Do the same in `agentRun.ts`**

**Step 4: Build and verify**

```bash
cd packages/panels && pnpm build
```

**Step 5: Commit**

```bash
git commit -m "refactor(panels): convert outer edit_text to server tool, remove client_tool_call for edit_text"
```

---

## Task 7: Clean up client-side plumbing

With all `edit_text` execution server-side, simplify the client.

**Files:**
- Modify: `packages/panels/pages/_components/SchemaForm.tsx` — simplify `handleClientToolCall`
- Keep: `packages/panels/pages/_components/agents/AiChatContext.tsx` — keep `client_tool_call` handler for future tools
- Keep: `packages/panels-lexical/src/CollaborativePlainText.tsx` — keep `applyEdits()` for version restore
- Keep: `packages/panels-lexical/src/LexicalEditor.tsx` — keep `applyEdits()` for version restore

**Step 1: Remove `edit_text`-specific logic from SchemaForm**

The `handleClientToolCall` in SchemaForm (lines 462-504) currently handles `edit_text` by resolving editor refs and calling `applyEdits()`. Since `edit_text` is now server-side (edits flow via Yjs sync), this code path won't fire for `edit_text` anymore.

Simplify to only keep the generic handler shell:

```ts
useEffect(() => {
  if (!setOnClientToolCall) return
  setOnClientToolCall(async (tool: string, input: Record<string, unknown>) => {
    // edit_text is now server-side — no client handling needed.
    // Keep this handler for potential future client tools.
    console.warn(`[SchemaForm] Unhandled client tool call: ${tool}`)
  })
}, [setOnClientToolCall])
```

Or remove the entire effect and just don't register the callback. The `AiChatContext` will silently skip if no handler is registered.

**Step 2: Keep editor ref `applyEdits()` for version restore**

The `applyEdits()` method on editor refs is still used by the version restore feature (imperative editor refs). Do NOT remove it.

**Step 3: Build**

```bash
pnpm --filter @rudderjs/panels build
```

**Step 4: Commit**

```bash
git commit -m "refactor(panels): remove client-side edit_text handling (now server-side via Yjs)"
```

---

## Task 8: Integration test

**Step 1: Build all affected packages**

```bash
pnpm --filter @rudderjs/live --filter @rudderjs/panels --filter @rudderjs/panels-lexical build
```

**Step 2: Manual smoke test**

**AI cursor visibility:**
1. Open article edit in two browser tabs
2. In tab 1, trigger "replace 'hello' with 'world' in the excerpt" via AI chat
3. Verify: Tab 2 sees a purple "AI: [Agent Name]" cursor appear briefly
4. Verify: The text changes in both tabs simultaneously
5. Verify: Neither tab loses cursor position

**Surgical text edits:**
6. Type "replace 'hello' with 'world' in the excerpt"
7. Verify: Only that word changes, surrounding text untouched
8. Verify: No cursor jump in either tab
9. Verify: Yjs persistence stores the change (refresh → text persists)

**Block edits (critical new path):**
10. Add a CTA block in the content field (rich text with blocks)
11. Type "change the CTA button text to 'Learn More'"
12. Verify: Block re-renders with updated text
13. Verify: Other block fields (title, url) unchanged
14. Verify: Tab 2 sees the block update in real-time

**Non-collaborative fields:**
15. Type "update the meta title to 'New Title'"
16. Verify: `update_field` still works via Y.Map for simple fields
17. Verify: Form state updates correctly

**Edge cases:**
18. Search string not found → agent reports failure, no crash
19. Multiple operations in one call → all applied atomically
20. Agent running while user is typing → no conflicts (Yjs CRDT handles it)

**Step 3: Commit**

```bash
git commit -m "feat: server-side AI cursor & Y.XmlText editing for collaborative fields"
```

---

## Summary of changes by file

| File | Change |
|------|--------|
| `packages/live/src/index.ts` | `editText()`, `editBlock()`, `setAiAwareness()`, `clearAiAwareness()`, `findTextInXmlElements()`, `findBlockInRoot()`, `encodeAiAwareness()`, Room interface update |
| `packages/panels/src/agents/ResourceAgent.ts` | `edit_text` → `.server()` with collab/non-collab routing, `loadLive` updated for new methods |
| `packages/panels/src/Resource.ts` | `getFieldMeta()` helper method |
| `packages/panels/src/handlers/panelChat.ts` | Outer `edit_text` → `.server()`, remove `client_tool_call` for `edit_text`, pass `fieldMeta` to agent context |
| `packages/panels/src/handlers/agentRun.ts` | Remove `client_tool_call` for `edit_text`, pass `fieldMeta` |
| `packages/panels/pages/_components/SchemaForm.tsx` | Remove `edit_text` client handler (keep shell for future tools) |
| `packages/panels/pages/_components/agents/AiChatContext.tsx` | Keep `client_tool_call` handler (no changes, future-proof) |
| `packages/panels-lexical/src/CollaborativePlainText.tsx` | No changes (keep `applyEdits` for version restore) |
| `packages/panels-lexical/src/LexicalEditor.tsx` | No changes (keep `applyEdits` for version restore) |

## Architecture decision: two execution paths

```
edit_text tool called by AI agent
       │
       ├── Field has yjs: true?
       │      │
       │      ├── Text op (replace/insert_after/delete)?
       │      │      → Live.setAiAwareness() — show purple AI cursor
       │      │      → Live.editText(docName, op) — Y.XmlText delete/insert
       │      │      → Yjs syncs to all clients via WebSocket
       │      │      → Lexical binding updates editors
       │      │      → All users' cursors preserved (relative positions)
       │      │      → Live.clearAiAwareness() after 2s
       │      │
       │      └── Block op (update_block)?
       │             → Live.setAiAwareness() — show purple AI cursor
       │             → Live.editBlock(docName, type, idx, field, val)
       │             → Y.XmlElement.setAttribute('__blockData', newJSON)
       │             → Lexical binding syncs to BlockNode.__blockData
       │             → BlockNodeComponent re-renders
       │             → Live.clearAiAwareness() after 2s
       │
       └── Field has yjs: false?
              │
              → Apply string ops on server (replace/indexOf/slice)
              → Live.updateMap(docName, 'fields', field, result)
              → Y.Map syncs to form state
              → Field value updates in SchemaForm
```

## Open questions for implementation

1. **Y.XmlElement text editing API**: Need to verify at implementation time whether `Y.XmlElement` (which extends `Y.XmlFragment`) supports character-level `delete(offset, length)` / `insert(offset, string)`. If not, we need to navigate to the inner `Y.XmlText` or `Y.Map` children. A debug session with `root.toDelta()` on a real Lexical document will clarify the exact structure.

2. **Cross-element search**: The current design searches within individual elements (paragraphs). A search string that spans two paragraphs won't be found. This matches the client-side behavior (`applyTextOp` also searches per-TextNode). Document this limitation.

3. **Awareness clock persistence**: The `aiAwarenessClock` counter is module-level. If the server restarts, it resets to 0. This is fine — awareness is ephemeral by design and clients handle clock resets gracefully.

4. **Concurrent AI edits**: If two agents edit the same field simultaneously, Yjs CRDT handles merge. The AI cursors will both appear. The `finally` block clears awareness per-agent, which is correct since we use one `AI_CLIENT_ID`. If we want multiple simultaneous AI cursors, each agent invocation needs a unique synthetic client ID.
