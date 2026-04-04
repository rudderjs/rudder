# Surgical AI Text Editing — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** AI agents edit specific words/sentences in Lexical editors without replacing all content, using client-side tool execution.

**Architecture:** The AI agent defines an `edit_text` tool as `.client()`. The agent loop yields client tool calls via SSE to the browser. The browser receives the operations (replace/insert/delete/update_block) and applies them directly to the Lexical editor via `editor.update()` + `splitText()`/`setTextContent()`/`BlockNode.setBlockData()`. Changes propagate to Yjs automatically through CollaborationPlugin.

**Tech Stack:** Lexical (`$nodesOfType`, `TextNode.splitText`, `TextNode.setTextContent`, `BlockNode`, `DecoratorNode`), @rudderjs/ai (client tools), SSE streaming, React refs

---

## Overview

### Current flow (full replacement)
```
AI Agent (server) → update_field tool → Live.updateMap(string) → WebSocket → Client Y.Map
                                                                                  ↓
                                                          setContent() → root.clear() + rebuild
```

### New flow (surgical editing)
```
AI Agent (server) → edit_text tool (client) → SSE `client_tool_call` event → Browser
                                                                                ↓
                                                          editor.update(() => {
                                                            // find node, splitText, setTextContent
                                                          })
                                                                                ↓
                                                          CollaborationPlugin → Yjs sync (automatic)
```

### Key decisions
- `update_field` stays for simple Y.Map fields (metaTitle, slug, etc.)
- `edit_text` is a NEW `.client()` tool for text/richcontent fields with Lexical editors
- The `@rudderjs/ai` agent loop already handles `.client()` tools — just needs to yield them in streaming mode
- Editor refs already exist (`getCollabTextRef`, `getRichContentRef`) — we extend them with a `findAndReplace` method
- No new packages or dependencies needed

---

## Task 1: Yield client tool calls in the streaming agent loop

The agent loop currently skips client tools without yielding them. SSE consumers never see them.

**Files:**
- Modify: `packages/ai/src/agent.ts:349-356`
- Test: `packages/ai/src/__tests__/agent.test.ts`

**Step 1: Write the failing test**

Add to the existing agent test file:

```ts
test('streaming agent yields client tool calls', async () => {
  const clientTool = toolDefinition({
    name: 'highlight',
    description: 'Highlight text',
    inputSchema: z.object({ text: z.string() }),
  }).client(async (input) => input)

  const a = agent({
    instructions: 'Call the highlight tool with "hello"',
    tools: [clientTool],
  })

  const { stream, response } = a.stream('test')
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) {
    chunks.push(chunk)
  }
  await response

  const toolCallChunks = chunks.filter(c => c.type === 'tool-call' && c.toolCall?.name === 'highlight')
  assert.ok(toolCallChunks.length > 0, 'Should yield client tool call chunk')
})
```

**Step 2: Run test to verify it fails**

Run: `cd packages/ai && pnpm test -- --test-name-pattern "yields client tool calls"`
Expected: FAIL — no `tool-call` chunk with name `highlight` in the stream

**Step 3: Implement — yield client tool calls in streaming loop**

In `packages/ai/src/agent.ts`, modify the client tool handling block (around line 351):

```ts
// BEFORE:
if (!tool || tool.type === 'client') {
  const result = !tool ? `Error: Unknown tool "${tc.name}"` : '[client tool — execute on client]'
  toolResults.push({ toolCallId: tc.id, result })
  messages.push({ role: 'tool', content: result, toolCallId: tc.id })
  continue
}

// AFTER:
if (!tool) {
  toolResults.push({ toolCallId: tc.id, result: `Error: Unknown tool "${tc.name}"` })
  messages.push({ role: 'tool', content: `Error: Unknown tool "${tc.name}"`, toolCallId: tc.id })
  continue
}
if (tool.type === 'client') {
  toolResults.push({ toolCallId: tc.id, result: '[client tool — execute on client]' })
  messages.push({ role: 'tool', content: '[client tool — execute on client]', toolCallId: tc.id })
  // Yield so SSE consumers can forward the call to the client
  yield { type: 'tool-call' as const, toolCall: tc }
  continue
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/ai && pnpm test`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add packages/ai/src/agent.ts packages/ai/src/__tests__/agent.test.ts
git commit -m "feat(ai): yield client tool calls in streaming agent loop"
```

---

## Task 2: Extend editor refs with surgical edit capabilities

Currently editor refs only expose `setContent(text)` (full replace). Add `findAndReplace()` for surgical edits.

**Files:**
- Modify: `packages/panels-lexical/src/CollaborativePlainText.tsx` (PlainTextEditorRefPlugin)
- Modify: `packages/panels-lexical/src/LexicalEditor.tsx` (EditorRefPlugin)

**Step 1: Define the shared editor ref interface**

Add to `packages/panels-lexical/src/CollaborativePlainText.tsx`, extend the `PlainTextEditorRefPlugin`:

```ts
// Current ref interface:
{ setContent(text: string): void }

// New ref interface:
{
  setContent(text: string): void
  applyEdits(operations: EditOperation[]): void
  getTextContent(): string
}
```

Where `EditOperation` is:
```ts
export type EditOperation =
  | { type: 'replace'; search: string; replace: string }
  | { type: 'insert_after'; search: string; text: string }
  | { type: 'delete'; search: string }
  | { type: 'update_block'; blockType: string; blockIndex: number; field: string; value: unknown }
```

The `update_block` operation targets custom `BlockNode` (DecoratorNode) instances embedded in the rich text editor. Blocks like `callToAction` or `video` store their data in `__blockData` — a JSON object with fields like `title`, `buttonText`, `url`. The AI can read these via `read_record` (blocks appear in the serialized Lexical JSON) and update individual block fields without touching surrounding text.

**Step 2: Implement `applyEdits` in PlainTextEditorRefPlugin**

In `packages/panels-lexical/src/CollaborativePlainText.tsx`, update the `PlainTextEditorRefPlugin`:

```ts
function PlainTextEditorRefPlugin({ editorRef }: {
  editorRef: React.MutableRefObject<PlainTextEditorHandle | null>
}) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    editorRef.current = {
      setContent(text: string) {
        editor.update(() => {
          const root = $getRoot()
          root.clear()
          const p = $createParagraphNode()
          p.append($createTextNode(text))
          root.append(p)
        })
      },

      applyEdits(operations: EditOperation[]) {
        editor.update(() => {
          for (const op of operations) {
            // ── Block operations ──
            if (op.type === 'update_block') {
              // BlockNode is a DecoratorNode with __blockType + __blockData
              // Walk all root children to find matching blocks
              let matchIndex = 0
              for (const child of $getRoot().getChildren()) {
                if ($isBlockNode(child) && child.__blockType === op.blockType) {
                  if (matchIndex === op.blockIndex) {
                    child.setBlockData({ ...child.__blockData, [op.field]: op.value })
                    break
                  }
                  matchIndex++
                }
              }
              continue
            }

            // ── Text operations (replace, insert_after, delete) ──
            const textNodes = $getRoot().getAllTextNodes()
            for (const node of textNodes) {
              const text = node.getTextContent()
              const idx = text.indexOf(op.search)
              if (idx === -1) continue

              switch (op.type) {
                case 'replace': {
                  const parts = node.splitText(idx, idx + op.search.length)
                  const target = idx === 0 ? parts[0] : parts[1]
                  target.setTextContent(op.replace)
                  break
                }
                case 'insert_after': {
                  const parts = node.splitText(idx + op.search.length)
                  const afterNode = idx + op.search.length >= text.length ? parts[parts.length - 1] : parts[1]
                  const insertNode = $createTextNode(op.text)
                  if (afterNode) afterNode.insertBefore(insertNode)
                  else node.insertAfter(insertNode)
                  break
                }
                case 'delete': {
                  const parts = node.splitText(idx, idx + op.search.length)
                  const target = idx === 0 ? parts[0] : parts[1]
                  target.remove()
                  break
                }
              }
              break // Only apply to first match per operation
            }
          }
        })
      },

      getTextContent(): string {
        return editor.getEditorState().read(() => $getRoot().getTextContent())
      },
    }
    return () => { editorRef.current = null }
  }, [editor, editorRef])

  return null
}
```

**Step 3: Apply the same pattern to EditorRefPlugin in LexicalEditor.tsx**

Same `applyEdits` method in the rich text `EditorRefPlugin`. The Lexical API is identical — `$getRoot().getAllTextNodes()` works across both plain and rich text editors. The rich text editor also needs `$isBlockNode` imported from `./lexical/BlockNode.js` for `update_block` operations.

**Note:** `CollaborativePlainText` does NOT need `update_block` support (plain text editors don't have blocks). Only include the block case in `LexicalEditor.tsx`'s `EditorRefPlugin`.

**Step 4: Export the EditOperation type**

In `packages/panels-lexical/src/index.ts`, export:
```ts
export type { EditOperation } from './CollaborativePlainText.js'
```

**Step 5: Build and verify**

Run: `cd packages/panels-lexical && pnpm build`
Expected: Clean build, no errors

**Step 6: Commit**

```bash
git add packages/panels-lexical/
git commit -m "feat(panels-lexical): add surgical applyEdits to editor refs"
```

---

## Task 3: Add `edit_text` client tool to ResourceAgent

**Files:**
- Modify: `packages/panels/src/agents/ResourceAgent.ts`

**Step 1: Add `edit_text` tool definition in `buildTools()`**

After the existing `update_field` and `read_record` tools, add:

```ts
const textFields = this._fields // All fields — client will filter to those with Lexical editors

const editText = toolDefinition({
  name: 'edit_text',
  description: [
    'Surgically edit text or blocks in a field without replacing all content.',
    'Use this for rich text or long text fields where you want to change specific words, sentences, or block fields.',
    'For short fields like titles or slugs, use update_field instead.',
    'For embedded blocks (callToAction, video, etc.), use the update_block operation to change individual block fields.',
    'Available fields: ' + textFields.join(', '),
  ].join(' '),
  inputSchema: z.object({
    field: z.enum(textFields as [string, ...string[]]),
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
        blockIndex: z.number().describe('0-based index if multiple blocks of the same type exist'),
        field: z.string().describe('The block field to update (e.g. "title", "buttonText", "url")'),
        value: z.unknown().describe('The new value for the block field'),
      }),
    ])),
  }),
}).client(async () => {
  // Client-side execution — this function runs in the browser, not here.
  // The agent loop yields this as a tool-call chunk for the SSE handler.
  return 'Edits applied on client'
})

return [updateField, editText, readRecord, ...this._tools, ...this.extraTools()]
```

**Step 2: Build and verify**

Run: `cd packages/panels && pnpm build`
Expected: Clean build

**Step 3: Commit**

```bash
git add packages/panels/src/agents/ResourceAgent.ts
git commit -m "feat(panels): add edit_text client tool to ResourceAgent"
```

---

## Task 4: Forward client tool calls via SSE

The SSE handlers in `panelChat.ts` and `agentRun.ts` need to detect client tool calls and send them as a distinct event type.

**Files:**
- Modify: `packages/panels/src/handlers/panelChat.ts`
- Modify: `packages/panels/src/handlers/agentRun.ts`

**Step 1: Add `client_tool_call` SSE event in both handlers**

In both `handleForceAgent` and the `handleAiChat` inner agent loop, where we currently handle `tool-call` chunks:

```ts
// BEFORE:
case 'tool-call':
  send('tool_call', { tool: chunk.toolCall?.name, input: chunk.toolCall?.arguments })
  break

// AFTER:
case 'tool-call': {
  const toolName = chunk.toolCall?.name
  const toolInput = chunk.toolCall?.arguments
  // Check if this is a client tool by looking at the tool definition
  // Client tools: edit_text. Server tools: update_field, read_record.
  // Simple heuristic: known client tool names get a different event type.
  if (toolName === 'edit_text') {
    send('client_tool_call', { tool: toolName, input: toolInput })
  } else {
    send('tool_call', { tool: toolName, input: toolInput })
  }
  break
}
```

**Note:** A more robust approach would be to check the tool's `type` property. But since the SSE handler doesn't have direct access to the tool definitions (they're inside the agent), matching by name is the pragmatic choice. If we add more client tools later, we add their names here.

**Step 2: Build and verify**

Run: `cd packages/panels && pnpm build`

**Step 3: Commit**

```bash
git add packages/panels/src/handlers/panelChat.ts packages/panels/src/handlers/agentRun.ts
git commit -m "feat(panels): forward client tool calls as client_tool_call SSE events"
```

---

## Task 5: Handle `client_tool_call` in AiChatContext

The frontend SSE parser needs to receive `client_tool_call` events, resolve the editor ref, and apply the operations.

**Files:**
- Modify: `packages/panels/pages/_components/agents/AiChatContext.tsx`

**Step 1: Add a new callback for client tool execution**

Add a new context value `onClientToolCall` that SchemaForm will provide:

```ts
// New type
export type OnClientToolCall = (
  tool: string,
  input: Record<string, unknown>,
) => void

// Add to context interface
onClientToolCall: OnClientToolCall
```

**Step 2: Handle `client_tool_call` in `parseSSELines`**

In the `parseSSELines` function, add a new case:

```ts
case 'client_tool_call': {
  const toolData = data as { tool: string; input?: Record<string, unknown> }
  // Add as a tool_call part in the chat message (for visual display)
  setMessages(prev => prev.map(m => {
    if (m.id !== assistantId) return m
    const parts = [...(m.parts ?? []), { type: 'tool_call' as const, tool: toolData.tool, input: toolData.input }]
    return { ...m, parts }
  }))
  // Execute client-side
  if (toolData.input) {
    onClientToolCallRef.current?.(toolData.tool, toolData.input)
  }
  break
}
```

**Step 3: Commit**

```bash
git add packages/panels/pages/_components/agents/AiChatContext.tsx
git commit -m "feat(panels): handle client_tool_call SSE events in AiChatContext"
```

---

## Task 6: Execute `edit_text` operations in SchemaForm

SchemaForm receives the client tool call and applies operations to the Lexical editor.

**Files:**
- Modify: `packages/panels/pages/_components/SchemaForm.tsx`

**Step 1: Add `onClientToolCall` handler**

In SchemaForm, add a handler that resolves the editor ref and calls `applyEdits`:

```ts
async function handleClientToolCall(tool: string, input: Record<string, unknown>) {
  if (tool !== 'edit_text') return

  const fieldName = input.field as string
  const operations = input.operations as Array<{ type: string; search: string; replace?: string; text?: string }>
  if (!fieldName || !operations) return

  // Try to resolve the editor ref (plain text or rich text)
  const collabRef = await resolveCollabRef(fieldName)
  if (collabRef && 'applyEdits' in collabRef) {
    (collabRef as any).applyEdits(operations)
    return
  }

  // Fallback for rich content
  try {
    const { getRichContentRef } = await import('./fields/RichContentInput.js')
    const richRef = getRichContentRef(fieldName)
    if (richRef && 'applyEdits' in richRef) {
      (richRef as any).applyEdits(operations)
      return
    }
  } catch { /* not a rich content field */ }
}
```

**Step 2: Pass the handler to AiChatContext**

Wire `handleClientToolCall` into the chat context via the `onClientToolCall` prop.

**Step 3: Build and test manually**

Run: `cd packages/panels && pnpm build`
Test: Create an article with content, open AI chat, ask "replace 'hello' with 'world' in the excerpt"

**Step 4: Commit**

```bash
git add packages/panels/pages/_components/SchemaForm.tsx
git commit -m "feat(panels): execute edit_text client tool operations on Lexical editors"
```

---

## Task 7: Visual feedback for surgical edits

Instead of the character-by-character typing animation (which doesn't make sense for surgical edits), briefly highlight the changed text.

**Files:**
- Modify: `packages/panels-lexical/src/CollaborativePlainText.tsx`
- Modify: `packages/panels-lexical/src/LexicalEditor.tsx`

**Step 1: Add highlight after edit**

In the `applyEdits` method, after replacing text, apply a temporary Lexical format or CSS class to highlight the changed node, then remove it after 1.5s:

```ts
case 'replace': {
  const parts = node.splitText(idx, idx + op.search.length)
  const target = idx === 0 ? parts[0] : parts[1]
  target.setTextContent(op.replace)
  // Briefly highlight the changed text
  target.setStyle('background-color: rgba(59, 130, 246, 0.15); transition: background-color 1.5s;')
  setTimeout(() => {
    editor.update(() => {
      try { target.setStyle('') } catch { /* node may have been modified */ }
    })
  }, 1500)
  break
}
```

This uses Lexical's inline style support. The blue highlight fades via CSS transition.

**Step 2: Build and test**

Run: `cd packages/panels-lexical && pnpm build`
Test: Trigger an agent edit and verify the changed text briefly highlights blue

**Step 3: Commit**

```bash
git add packages/panels-lexical/
git commit -m "feat(panels-lexical): highlight surgically edited text briefly"
```

---

## Task 8: Integration test — end to end

**Step 1: Manual smoke test checklist**

**Text operations:**
1. Create an article, write a paragraph in the excerpt (rich text)
2. Open AI chat sidebar
3. Type: "Replace 'hello world' with 'goodbye world' in the excerpt"
4. Verify: Only "hello" changes to "goodbye", rest of content untouched
5. Verify: Changed text briefly highlights blue
6. Verify: Other collaborative clients see the change (Yjs sync)

**Block operations:**
7. Add a Call to Action block in the content field (via slash command)
8. Fill in: title="Sign Up", buttonText="Click Here", url="/signup"
9. Type in chat: "Change the call to action button text to 'Get Started'"
10. Verify: Only the `buttonText` field in the CTA block changes, everything else untouched
11. Verify: Block re-renders with new button text

**Backwards compatibility:**
12. Verify: `update_field` still works for metaTitle/metaDescription (simple fields)
13. Verify: Force-agent (dropdown) still works for SEO agent
14. Verify: Full-replace typing animation still works for simple string fields

**Step 2: Verify no regressions**

Run: `cd packages/ai && pnpm test`
Run: `cd packages/panels && pnpm build`
Run: `cd packages/panels-lexical && pnpm build`

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: surgical AI text editing via client-side tools"
```

---

## Summary of changes by file

| File | Change |
|------|--------|
| `packages/ai/src/agent.ts` | Yield `tool-call` chunk for client tools in streaming loop |
| `packages/panels-lexical/src/CollaborativePlainText.tsx` | `applyEdits()` (text ops) + `getTextContent()` on editor ref, highlight effect |
| `packages/panels-lexical/src/LexicalEditor.tsx` | `applyEdits()` (text ops + `update_block` via `BlockNode.setBlockData()`) on editor ref, highlight effect |
| `packages/panels-lexical/src/index.ts` | Export `EditOperation` type |
| `packages/panels/src/agents/ResourceAgent.ts` | Add `edit_text` client tool with replace/insert_after/delete/update_block operations |
| `packages/panels/src/handlers/panelChat.ts` | Forward `edit_text` as `client_tool_call` SSE event |
| `packages/panels/src/handlers/agentRun.ts` | Same SSE forwarding |
| `packages/panels/pages/_components/agents/AiChatContext.tsx` | Parse `client_tool_call` events, call handler |
| `packages/panels/pages/_components/SchemaForm.tsx` | `handleClientToolCall` — resolve editor ref + apply ops |

## How blocks work with AI

Blocks are Lexical `DecoratorNode` instances (`BlockNode`) with:
- `__blockType` — e.g. `'callToAction'`, `'video'`
- `__blockData` — e.g. `{ title: 'Sign Up', buttonText: 'Click', url: '/signup' }`

They appear in the serialized Lexical JSON (returned by `read_record`) as:
```json
{ "type": "custom-block", "blockType": "callToAction", "blockData": { "title": "Sign Up", ... } }
```

The AI sees this JSON and can target individual block fields via `update_block` operations.
`BlockNode.setBlockData()` calls `getWritable()` (Lexical's immutable update) and the CollaborationPlugin binding syncs the change to Yjs automatically.
