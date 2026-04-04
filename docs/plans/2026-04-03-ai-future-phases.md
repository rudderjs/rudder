# Future: AI Enhancements, Field Assist, Suggestions & Block Tools

**Date:** 2026-04-03 (extracted from resource agents plan)
**Status:** Future — implement after ResourceAgent Phase 1-4 ships
**Dependencies:** `@rudderjs/ai`, `@rudderjs/panels`, `@rudderjs/panels-lexical`

---

## Phase A: AI Package Enhancements (`@rudderjs/ai`)

### A.1 Active Failover

Wire the existing `failover` config field:

```typescript
// In agent loop, wrap provider.generate() with failover logic
async function generateWithFailover(models: string[], options): Promise<ProviderResponse> {
  for (const model of models) {
    try {
      const adapter = AiRegistry.resolve(model)
      return await adapter.generate(options)
    } catch (err) {
      if (isLastModel) throw err
      // Log and try next
    }
  }
}
```

### A.2 Embeddings API

```typescript
// New in @rudderjs/ai
AI.embed('Some text')                           // single
AI.embed(['text1', 'text2'])                    // batch
AI.embed('text').using('openai/text-embedding-3-small')

// Provider adapter interface addition
interface ProviderAdapter {
  generate(options): Promise<ProviderResponse>
  stream(options): AsyncIterable<StreamChunk>
  embed?(input: string | string[]): Promise<EmbeddingResponse>  // new
}

interface EmbeddingResponse {
  embeddings: number[][]
  usage: TokenUsage
}
```

### A.3 DB-Backed ConversationStore

```typescript
// New: PrismaConversationStore
import { PrismaConversationStore } from '@rudderjs/ai'

// In config:
ai({
  ...config,
  conversations: new PrismaConversationStore()
})

// Usage in agents:
const response = await agent
  .forUser(userId)
  .continue(conversationId)
  .prompt('Follow up on the previous analysis...')
```

Prisma schema:
```prisma
model AiConversation {
  id        String   @id @default(cuid())
  userId    String?
  title     String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  messages  AiConversationMessage[]
}

model AiConversationMessage {
  id             String   @id @default(cuid())
  conversationId String
  role           String
  content        String
  toolCalls      String?  // JSON
  toolCallId     String?
  createdAt      DateTime @default(now())
  conversation   AiConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
}
```

---

## Phase B: Field-Level AI Assist (Client-Side)

### B.1 Inline AI on Any Text Field

```typescript
// In resource form definition
TextField.make('title')
  .ai()                    // enables AI sparkle button
  .ai('rewrite')           // specific action
  .ai(['rewrite', 'expand', 'shorten', 'fix-grammar'])  // multiple actions
```

### B.2 How It Works (Client-Side)

1. User clicks sparkle icon on a field, or selects text and clicks "Rewrite"
2. Client sends `POST /api/panels/:panel/ai/field-assist`
   ```json
   { "field": "title", "value": "current value", "action": "rewrite" }
   ```
3. Server runs a lightweight agent (no tools, just text generation)
4. Response streams back, client shows inline suggestion
5. User accepts → value written to field (via Yjs if collaborative)

### B.3 Predefined Field Actions

| Action | Prompt |
|--------|--------|
| `rewrite` | Rewrite this text to be more clear and engaging |
| `expand` | Expand this text with more detail |
| `shorten` | Make this text more concise |
| `fix-grammar` | Fix grammar and spelling errors |
| `professional` | Rewrite in a professional tone |
| `casual` | Rewrite in a casual, friendly tone |
| `translate:{lang}` | Translate to {language} |
| `seo` | Optimize this text for SEO |

---

## Phase C: Suggestion / Review System (Tiptap-inspired)

A **general-purpose suggestion system** for the Lexical editor — not AI-specific. Any change proposer (AI agent, human collaborator, automated workflow, version restore) goes through the same flow.

### C.1 Suggesting Mode

The editor supports three modes:
- **Editing** — direct changes (default)
- **Suggesting** — changes appear as tracked suggestions with accept/reject
- **Viewing** — read-only

```typescript
RichContentField.make('content')
  .suggesting()           // default to suggesting mode
  .suggesting('ai-only')  // only AI writes go through suggestions, humans edit directly
```

### C.2 Suggestion Nodes (Lexical)

Custom Lexical nodes that wrap proposed changes:

```typescript
// SuggestionNode — wraps inserted content (green highlight)
// DeletionNode  — wraps deleted content (red strikethrough)

// Visual diff in the editor:
// "The [quick]{old} [fast]{new} brown fox"
//       ^^^^red      ^^^^green
```

Each suggestion carries metadata:
```typescript
interface Suggestion {
  id: string
  authorId: string        // user ID or 'ai-agent:seo'
  authorName: string      // "Suleiman" or "SEO Agent"
  authorType: 'user' | 'agent'
  createdAt: Date
  field: string
  status: 'pending' | 'accepted' | 'rejected'
}
```

### C.3 Accept / Reject UI

Inline controls on each suggestion:
```
┌──────────────────────────────────────────────┐
│  The ~~quick~~ **fast** brown fox            │
│              ↑                               │
│  [✓ Accept] [✗ Reject]  — SEO Agent, 2m ago │
└──────────────────────────────────────────────┘
```

Bulk actions in toolbar:
- **Accept all** — apply all pending suggestions
- **Reject all** — discard all pending suggestions
- **Accept all from agent** — accept all from a specific agent run
- **Filter by author** — show only suggestions from a specific user/agent

### C.4 Collaborative Suggestions via Yjs

Suggestions sync through Y.Doc like any other edit:
- Agent writes a suggestion on server → syncs to all clients via WS
- Human writes a suggestion → syncs to all clients
- Accept/reject actions sync to all clients
- Suggestion metadata stored in a Y.Map alongside the content

### C.5 ResourceAgent Integration

When a ResourceAgent has `needsConfirmation()`, field updates create suggestions instead of direct writes:

```typescript
ResourceAgent.make('seo')
  .needsConfirmation()   // all field updates become suggestions
  .fields(['title', 'metaDescription', 'content'])

// Agent calls update_title('Better Title')
// → creates a Suggestion in the editor instead of overwriting
// → user sees the diff inline and can accept/reject
```

For `RichContentField` with blocks, suggestions work at the block level:
- Rewritten paragraph → old block struck through, new block highlighted green
- New block inserted → green highlight with accept/reject
- Deleted block → red strikethrough with accept/reject

---

## Phase D: Block-Level AI Tools (Lexical)

When a `ResourceAgent` targets a `RichContentField` with blocks, auto-generated tools understand the block structure.

**Key architecture decision:** All block operations happen **client-side** via Lexical's imperative API, triggered by SSE tool_call events. Server-side Y.Doc manipulation of Lexical's XmlText structure is fragile and doesn't work reliably. Instead, the agent calls a tool on the server → SSE event reaches the client → client uses `editor.update()` to modify specific nodes → Lexical's CollaborationPlugin syncs the change to all users via Yjs automatically.

This is the same pattern used by VS Code Copilot — precise client-side edits at specific locations.

### D.1 Block-Aware Tool Generation

```typescript
// ResourceAgent detects field type and generates appropriate tools:

// For TextField/TextareaField → simple string tools:
update_field({ field: 'title', value: 'new text' })

// For RichContentField with blocks → block-level tools:
read_blocks({ field: 'content' })                         → read block structure as JSON
update_block({ field: 'content', blockId, content })       → rewrite one block's text
insert_block({ field: 'content', afterId, type, content }) → add a new block
delete_block({ field: 'content', blockId })                → remove a block
```

The agent calls these tools on the server. The server-side handler is a **passthrough** — it doesn't modify any Y.Doc. Instead, it returns a result to the LLM and the tool_call SSE event carries the operation to the client.

### D.2 Block Serialization for LLM Context

The `read_blocks` tool reads from the client, not the server. Flow:

1. Agent calls `read_blocks({ field: 'content' })`
2. SSE sends `tool_call` event to client
3. Client serializes the Lexical editor state:

```json
[
  { "key": "abc", "type": "heading", "level": 2, "text": "Introduction" },
  { "key": "def", "type": "paragraph", "text": "TypeScript is a typed superset..." },
  { "key": "ghi", "type": "code", "language": "typescript", "text": "const x: number = 1" },
  { "key": "jkl", "type": "callout", "variant": "info", "text": "Note: This requires Node 18+" }
]
```

Only text + structure — no Lexical internals. Token-efficient.

**Note:** Lexical node keys are ephemeral (change across sessions). The `read_blocks` tool returns current keys, and the agent uses them within the same run. This is safe since a single agent run is a short-lived session.

### D.3 Client-Side Block Operations

When the SSE `tool_call` event arrives at the client:

```typescript
// Client receives: { tool: 'update_block', input: { field: 'content', blockId: 'def', content: 'Improved text...' } }

// Get the Lexical editor ref for this field
const editorRef = getRichContentRef('content')

editorRef.updateBlock('def', 'Improved text...')
// Internally:
// editor.update(() => {
//   const node = $getNodeByKey('def')
//   // Clear and re-insert text content
//   node.setTextContent(newContent)
// })
// → Lexical's CollaborationPlugin syncs the change to all users via Yjs
```

For `insert_block`:
```typescript
editorRef.insertBlock('def', 'paragraph', 'New paragraph text')
// editor.update(() => {
//   const afterNode = $getNodeByKey('def')
//   const newNode = $createParagraphNode()
//   newNode.append($createTextNode(text))
//   afterNode.insertAfter(newNode)
// })
```

### D.4 RichContentField Imperative Ref Extensions

`RichContentField` already exposes `setContent()` via imperative ref. Extend with block-level methods:

```typescript
interface RichContentEditorRef {
  setContent(content: unknown): void         // existing — full content replace
  getBlocks(): BlockInfo[]                   // new — serialize blocks to JSON
  updateBlock(key: string, content: string): void   // new — rewrite one block
  insertBlock(afterKey: string, type: string, content: string): void  // new
  deleteBlock(key: string): void             // new
}
```

### D.5 Selection-Scoped Context

When user selects text and triggers an AI action, only the selection is sent:

```typescript
// User selects 2 paragraphs, clicks "Rewrite" from field-level AI menu
// Client sends to agent:
{
  action: 'rewrite',
  selection: {
    blocks: [
      { key: 'def', type: 'paragraph', text: 'Selected paragraph 1...' },
      { key: 'ghi', type: 'paragraph', text: 'Selected paragraph 2...' },
    ],
  },
  // Full document NOT sent — token efficient
}
```

### D.6 DX Example

```typescript
class ArticleResource extends Resource {
  form(form) {
    return form.fields([
      TextField.make('title')
        .required()
        .ai(['rewrite', 'seo']),

      RichContentField.make('content')
        .blocks([HeadingBlock, ParagraphBlock, ImageBlock, CodeBlock, CalloutBlock])
        .ai(['rewrite', 'expand', 'fix-grammar']),   // per-block actions
    ])
  }

  agents() {
    return [
      ResourceAgent.make('content-editor')
        .label('Restructure Content')
        .icon('Layout')
        .instructions('Restructure this article: add subheadings, split long paragraphs, improve flow.')
        .fields(['content']),  // auto-detects RichContentField → uses block-level tools
    ]
  }
}
```

### D.7 Implementation Considerations

- `read_blocks` needs a **client → server → agent** roundtrip. The client sends block data back to the server via a callback endpoint or encodes it in the initial agent request.
- Alternatively, the record's content field value (stored in DB) can be parsed server-side to extract blocks — avoids the roundtrip but may be stale if user has unsaved edits.
- For the typing animation on block updates, the same `setValues` + `collabRef.setContent()` pattern works — the `update_block` tool call arrives via SSE and the client animates progressively into the targeted block.

---

## Out of Scope (Further Future)

- Client-side agents running in browser
- MCP server integration (expose panel resources to external AI agents)
- Image generation integration
- Voice input/output
- Agent marketplace / shared agent library
- Agent analytics / cost tracking dashboard
