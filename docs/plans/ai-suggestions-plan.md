# AI Suggestions / Tracked Changes Plan

> **Status**: NOT STARTED
> **Repos**: pilotiq (lexical, panels), pilotiq-pro (ai)
> **Depends on**: `.ai()` field API (done), `update_form_state` client tool (done), Lexical editor (done)

## Overview

When `.aiSuggestions()` is enabled on a field, AI edits land as **pending suggestions** instead of direct writes. The user sees a visual diff and accepts or rejects each change.

Two implementations behind one API:
- **Lexical fields** (Text, Textarea, RichText): inline red/green decoration nodes
- **Non-Lexical fields** (Select, Boolean, Checkbox, Number, Date, Tags, etc.): field updates to new value, shows "was: old" label + accept/reject

---

## Phase 1: Field API + Serialization

**Repo**: `pilotiq/packages/panels`

### 1.1 `.aiSuggestions()` on Field base class

```ts
// Field.ts
aiSuggestions(): this {
  this._aiSuggestions = true
  return this
}
```

Usage:
```ts
RichText.make('body')
  .ai()
  .aiSuggestions()

TextField.make('title')
  .ai(['rewrite', 'expand'])
  .aiSuggestions()

SelectField.make('status')
  .options(['draft', 'published', 'archived'])
  .ai()
  .aiSuggestions()
```

### 1.2 Serialize to FieldMeta

Add `aiSuggestions: boolean` to `FieldMeta` interface and `toMeta()` output. Frontend reads this flag to decide how to handle incoming AI tool results.

---

## Phase 2: Suggestion State Management

**Repo**: `pilotiq/packages/panels`

### 2.1 Suggestion Store

A per-form suggestion store (React context or zustand) holding pending suggestions:

```ts
interface FieldSuggestion {
  id: string
  fieldName: string
  oldValue: unknown          // snapshot before AI edit
  newValue: unknown          // what the AI proposed
  timestamp: number
  agentName?: string         // "AI" or specific agent label
  status: 'pending' | 'accepted' | 'rejected'
}
```

For Lexical fields, `oldValue`/`newValue` are not used — the diff lives inside the editor as suggestion nodes. The store just tracks `{ id, fieldName, status }`.

### 2.2 Client Tool Interception

When `update_form_state` executes on a field with `aiSuggestions: true`:

1. Snapshot the current field value as `oldValue`
2. Apply the new value (so the user sees the result)
3. Push a `FieldSuggestion` into the store with `status: 'pending'`
4. Return success to the agent (it doesn't know about suggestions — just thinks the edit worked)

For Lexical fields, instead of applying the edit directly, route it through the suggestion plugin (Phase 3).

### 2.3 Accept / Reject Logic

- **Accept**: remove the suggestion from the store (value already applied)
- **Reject**: revert the field to `oldValue`, remove suggestion
- **Accept All**: accept every pending suggestion on the form
- **Reject All**: revert all pending suggestions

---

## Phase 3: Lexical Suggestion Plugin

**Repo**: `pilotiq/packages/lexical`

> **Important**: The suggestion plugin is **pure Lexical** — no Y.js dependency. It works on any text field regardless of persistence mode (ephemeral, session, localStorage, indexeddb, ywebsocket). When collab IS active, suggestion nodes sync automatically because they're part of the Lexical node tree — but that's a side effect, not a requirement.

| Layer | Concern | Y.js required? |
|---|---|---|
| SuggestionPlugin | Nodes, commands, inline UI | No — pure Lexical |
| SuggestionStore | Original snapshots, pending state | No — uses field's own persistence |
| CollaborationPlugin | If enabled, nodes sync automatically | Only if field is collab |

### 3.1 Suggestion Nodes

Two custom Lexical nodes:

```ts
// SuggestionAddNode — wraps inserted text
class SuggestionAddNode extends TextNode {
  __suggestionId: string
  // Renders with green background
}

// SuggestionDeleteNode — wraps deleted text
class SuggestionDeleteNode extends TextNode {
  __suggestionId: string
  // Renders with red background + strikethrough
}
```

Both nodes:
- Share a `suggestionId` linking them to the same suggestion
- Are non-editable by the user (read-only decorations)
- Render with author badge ("AI")
- **Original snapshot**: serialized `EditorState` JSON stored in the SuggestionStore — used by reject to fully restore. Not Y.js-specific.

### 3.2 SuggestionPlugin (React component)

```ts
export function SuggestionPlugin({ enabled }: { enabled: boolean }) {
  const [editor] = useLexicalComposerContext()
  // Exposes commands:
  //   SUGGEST_INSERT — wrap new text in SuggestionAddNode
  //   SUGGEST_DELETE — wrap removed text in SuggestionDeleteNode
  //   SUGGEST_REPLACE — delete old + insert new (two nodes, same suggestionId)
  //   ACCEPT_SUGGESTION — remove decoration, keep added text, remove deleted text
  //   REJECT_SUGGESTION — remove decoration, remove added text, restore deleted text
  //   ACCEPT_ALL / REJECT_ALL
}
```

### 3.3 Intercept AI Operations

When `aiSuggestions` is enabled on a Lexical field, the client tool handler translates `update_form_state` operations into suggestion commands:

| Operation | Without suggestions | With suggestions |
|---|---|---|
| `rewrite_text` | Direct `editor.update()` | `SUGGEST_DELETE` old + `SUGGEST_INSERT` new |
| `replace` | Direct text replacement | `SUGGEST_DELETE` old + `SUGGEST_INSERT` new |
| `format_text` | Direct formatting | `SUGGEST_DELETE` unformatted + `SUGGEST_INSERT` formatted |
| `insert_paragraph` | Direct insert | `SUGGEST_INSERT` new paragraph |
| `set_value` | Direct set | `SUGGEST_DELETE` all + `SUGGEST_INSERT` new |

### 3.4 Accept/Reject Inline UI

Floating action bar near each suggestion group (same `suggestionId`):

```
[✓ Accept] [✗ Reject]    AI
```

Positioned via `floating-ui` (already used by toolbar). Shows on hover/focus of a suggestion node.

---

## Phase 4: Non-Lexical Field Suggestion UI

**Repo**: `pilotiq/packages/panels`

### 4.1 SuggestionOverlay Component

A wrapper component rendered below any non-Lexical field that has a pending suggestion:

```tsx
<SuggestionOverlay
  fieldName="status"
  oldValue="Draft"
  onAccept={() => accept(suggestion.id)}
  onReject={() => reject(suggestion.id)}
/>

// Renders:
// was: Draft    [✓] [✗]
```

Styled with muted text for "was:", subtle background to distinguish from regular field chrome.

### 4.2 Integration with SchemaRenderer

In the field rendering pipeline, after each field component:
- Check if `field.aiSuggestions` is true
- Check if there's a pending suggestion for this field
- If yes, render `<SuggestionOverlay>` below the field

---

## Phase 5: Bulk Actions + Polish

### 5.1 Form-Level Actions

When any suggestions are pending, show a floating bar at the top/bottom of the form:

```
3 AI suggestions pending    [Accept All] [Reject All]
```

### 5.2 Visual Polish

- Suggestion count badge on the form
- Smooth transitions on accept/reject (fade out suggestion decorations)
- Keyboard shortcuts: `Cmd+Enter` accept focused suggestion, `Cmd+Backspace` reject

### 5.3 Agent-Side Awareness (optional, deferred)

The agent currently doesn't know its edits are suggestions. Future enhancement: tell the agent via system prompt so it can batch related changes into one logical suggestion group.

---

## File Changes Summary

| File | Repo | Change |
|---|---|---|
| `packages/panels/src/schema/Field.ts` | pilotiq | Add `.aiSuggestions()` method |
| `packages/panels/src/resolvers/resolveField.ts` | pilotiq | Serialize `aiSuggestions` to meta |
| `packages/panels/src/types.ts` | pilotiq | Add `aiSuggestions` to `FieldMeta` |
| `packages/panels/src/registries/SuggestionStore.ts` | pilotiq | New — suggestion state management |
| `packages/panels/src/components/SuggestionOverlay.tsx` | pilotiq | New — non-Lexical field diff UI |
| `packages/panels/src/components/SuggestionBar.tsx` | pilotiq | New — form-level accept/reject all |
| `packages/lexical/src/lexical/SuggestionAddNode.ts` | pilotiq | New — green inline node |
| `packages/lexical/src/lexical/SuggestionDeleteNode.ts` | pilotiq | New — red strikethrough node |
| `packages/lexical/src/lexical/SuggestionPlugin.tsx` | pilotiq | New — plugin + commands + inline UI |
| `packages/lexical/src/LexicalEditor.tsx` | pilotiq | Register suggestion nodes + plugin |
| Client tool handler (update_form_state) | pilotiq-pro | Intercept when aiSuggestions enabled |

---

## Resolved Questions

### 1. Persistence

Suggestions follow the field's own persistence mode:

- **Ephemeral fields** (no `persist()`): suggestions live in memory only — lost on navigation
- **`persist('session')`, `persist('localStorage')`, `persist('indexeddb')`**: suggestions persist to the same backend alongside field state — survive navigation within the session/tab
- **`persist('ywebsocket')` / collab fields**: suggestions persist via Y.js — see Q3

Implementation: the `SuggestionStore` reads each field's persistence config and delegates storage accordingly. No separate suggestion persistence layer.

### 2. Multi-turn: Replace Against Original

Only **one pending suggestion per field** at a time. The original value (before any AI edit) is the anchor.

- **AI round 1**: snapshot the original value → apply AI edit → show diff against original
- **AI round 2 on same field**: discard round 1 suggestion → apply new AI edit → diff against the **same original**
- **Accept**: commit the suggestion, clear the original anchor
- **Reject**: restore the original value, clear the suggestion

For **Lexical fields**: clear previous suggestion nodes, recompute new `SuggestionAddNode` / `SuggestionDeleteNode` decorations against the original snapshot.

For **non-Lexical fields**: replace the field value with the new AI value, keep "was: X" pointing to the same original.

### 3. Collab Sync

Follows the field's persistence/collab mode:

- **Non-collab fields**: suggestions are local to the user who triggered the AI — other users don't see them
- **Collab fields** (`persist('indexeddb', 'ywebsocket')` or similar): suggestions sync via Y.js — all collaborators see the pending suggestion decorations and can accept/reject

For Lexical collab fields, `SuggestionAddNode` and `SuggestionDeleteNode` are Y.js-aware (Lexical's `CollaborationPlugin` already syncs the node tree). The suggestion state is part of the document, not a side-channel.

For non-Lexical collab fields, the suggestion metadata (oldValue, newValue, status) can be stored in a Y.Map alongside the field value, synced through the existing collab transport.

### 4. Undo Integration (Cmd+Z)

Accept/reject should be undoable — but needs investigation before committing:

- **Non-collab Lexical fields**: Lexical's `HistoryPlugin` should handle this naturally since accept/reject are `editor.update()` calls
- **Collab Lexical fields**: Y.js has its own undo manager (`Y.UndoManager`) — need to verify that accepting/rejecting suggestion nodes integrates correctly with Y.js undo scopes. **Must spike this before implementing.**
- **Non-Lexical fields**: simpler — push old/new values onto a local undo stack

**Decision**: implement undo for non-collab fields first. Collab + Y.js undo is a spike task in Phase 5.
