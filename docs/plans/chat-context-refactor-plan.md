# Chat Context Refactor Plan

Extract the three hardcoded branches in `packages/panels/src/handlers/chat/chatHandler.ts` into a pluggable `ChatContext` provider architecture, and fix the conversation persistence bugs that block tool-message round-tripping.

**Status:** NOT STARTED
**Estimated LOC:** ~150 (net: +200 new, -50 deleted)
**Packages affected:** `@rudderjs/panels` only — no `@rudderjs/ai` changes
**Blocks:** `client-tool-roundtrip-plan.md` (this should land first)

---

## Goal

Today `chatHandler.ts` has three independent code paths that each build their own system prompt, tool set, persistence calls, and SSE pipeline:

1. `handleAiChat` — chat with a resource context (record edit page)
2. The inline no-resource branch at `:305-346` — chat with no specific scope
3. `handleForceAgent` — bypass the AI loop and run a `ResourceAgent` directly

This duplication blocks every future feature: client-tool round-trip, page-level chat, global chat, field-level AI affordances, conversation persistence fixes, security checks. Each one would otherwise need to be implemented three times.

This plan collapses the three branches into **one dispatcher + N context providers**, so every future feature is wired in once.

It also fixes two existing bugs that fall out naturally during the refactor:
- **Persistence drops tool messages** (`chatHandler.ts:170-173`, `:333-336`) — only `{role,content}` pairs are written, throwing away `toolCalls` and `tool`-role messages even though `PrismaConversationStore` already supports them.
- **`loadedHistory` shape erosion** (`chatHandler.ts:217-218`) — `msgs.map(m => ({ role, content }))` strips `toolCallId`/`toolCalls`, breaking any conversation that used tools.

---

## Approach

```
Request → resolveContext() → ChatContext provider → dispatcher → SSE
                                  │
                                  ├── buildSystemPrompt()
                                  ├── buildTools()
                                  └── liveContext()  (optional)
```

The dispatcher is the only place that:
- Loads/persists messages (full `AiMessage[]`, including tool calls and results)
- Wires the SSE stream
- Will later host the client-tool stopping logic and security checks (added by `client-tool-roundtrip-plan.md`)

Each context provider is a small class that knows how to build a system prompt and a tool set for its kind of chat.

---

## Phase 1 — Extract `ChatContext` interface

### 1.1 Define the interface

**File:** `packages/panels/src/handlers/chat/contexts/types.ts` (new)

```ts
import type { AnyTool } from '@rudderjs/ai'

export interface ChatContext {
  readonly kind: 'resource' | 'page' | 'global'

  /** Build the system prompt the model sees */
  buildSystemPrompt(): string | Promise<string>

  /** Build the tool set available to this chat */
  buildTools(): AnyTool[] | Promise<AnyTool[]>

  /**
   * Optional live data appended to the system prompt as "trust this over conversation history".
   * Used by ResourceChatContext to inject the current record state.
   */
  liveContext?(): Record<string, unknown> | Promise<Record<string, unknown>>
}
```

### 1.2 Resolver

**File:** `packages/panels/src/handlers/chat/contexts/resolveContext.ts` (new, ~30 LOC)

```ts
export async function resolveContext(
  body: ChatRequestBody,
  panel: Panel,
  req: AppRequest,
): Promise<ChatContext> {
  if (body.resourceContext) {
    return new ResourceChatContext(body, panel, req)
  }
  if (body.pageContext) {
    return new PageChatContext(body, panel, req)
  }
  return new GlobalChatContext(body, panel, req)
}
```

The resolver throws on invalid context (e.g. resource not found, policy denied) so the dispatcher can return a clean 4xx.

---

## Phase 2 — Implement the three contexts

### 2.1 `ResourceChatContext`

**File:** `packages/panels/src/handlers/chat/contexts/ResourceChatContext.ts` (new, ~120 LOC — most of it lifted verbatim from the current `handleAiChat`)

- Resolves the resource class, runs `policy('view')`, loads the record
- Overlays unsaved Yjs fields (the existing logic at `chatHandler.ts:264-282`)
- `buildSystemPrompt()`: returns the existing prompt string from `chatHandler.ts:69-110` (selection-aware variant included)
- `buildTools()`: returns `[runAgentTool, editTextTool]` exactly as today
- `liveContext()`: returns the merged record

**`forceAgent` is folded in:** if `body.forceAgent` is set, `buildTools()` returns just the one agent's tools and the dispatcher passes `toolChoice: { name: forceAgent }` to `agent()`. `handleForceAgent` is **deleted entirely** — its 30 lines collapse into one config branch in `ResourceChatContext`.

### 2.2 `GlobalChatContext`

**File:** `packages/panels/src/handlers/chat/contexts/GlobalChatContext.ts` (new, ~30 LOC)

- `buildSystemPrompt()`: `'You are a helpful assistant for an admin panel. Be concise.'` (matches today's no-resource branch)
- `buildTools()`: `[]` for now — placeholder for future global tools (`navigate_to`, `search_resources`)
- No `liveContext()`

This replaces the inline no-resource branch at `chatHandler.ts:305-346`.

### 2.3 `PageChatContext` (skeleton only)

**File:** `packages/panels/src/handlers/chat/contexts/PageChatContext.ts` (new, ~20 LOC)

- Stub implementation that returns an empty tool set
- Documents the extension point for panel pages to register their own tools
- **Not wired into any UI yet** — exists so the resolver branch is meaningful and the future plan has somewhere to land

We're not implementing actual page-level chat in this plan. The skeleton is here so the architecture is complete and the next plan (`page-chat-plan.md`, future) drops in cleanly.

---

## Phase 3 — Refactor the dispatcher

### 3.1 Slim down `chatHandler.ts`

**File:** `packages/panels/src/handlers/chat/chatHandler.ts` (modified, net ~-150 LOC)

After this phase, `handlePanelChat` looks roughly like:

```ts
export async function handlePanelChat(req, res, panel) {
  const body = req.body as ChatRequestBody
  if (!body?.message && !body?.messages) {
    return res.status(400).json({ message: 'Missing "message" or "messages".' })
  }

  const { readable, send, close } = createSSEStream()

  // Resolve store + conversation id (unchanged)
  const store = await resolveConversationStore().catch(() => null)
  let conversationId = body.conversationId
  let loadedHistory: AiMessage[] = []
  if (store) {
    if (conversationId) {
      loadedHistory = await store.load(conversationId)  // ← full AiMessage[], no map
    } else {
      conversationId = await store.create(undefined, buildMeta(body, req))
      send('conversation', { conversationId, isNew: true })
    }
  }

  // Resolve context
  let context: ChatContext
  try {
    context = await resolveContext(body, panel, req)
  } catch (err) {
    return res.status(err.status ?? 400).json({ message: err.message })
  }

  // Run the chat
  runChat({ send, close, context, body, loadedHistory, conversationId, store })

  // Return SSE response (unchanged)
  return makeSSEResponse(res, readable)
}
```

`runChat` is the single shared agent loop:

```ts
async function runChat({ send, close, context, body, loadedHistory, conversationId, store }) {
  const { agent: agentFn } = await loadAi()
  const systemPrompt = await context.buildSystemPrompt()
  const tools = await context.buildTools()

  const a = agentFn({ instructions: systemPrompt, tools, model: body.model })
  const inputMessage = body.message ?? extractLastUserMessage(body.messages!)

  const { stream, response } = a.stream(inputMessage, {
    history: loadedHistory.length > 0 ? loadedHistory : undefined,
  })

  // SSE pump (unchanged from today)
  for await (const chunk of stream) {
    switch (chunk.type) {
      case 'text-delta': if (chunk.text) send('text', { text: chunk.text }); break
      case 'tool-call':  send('tool_call', { tool: chunk.toolCall?.name, input: chunk.toolCall?.arguments }); break
    }
  }

  const result = await response
  send('complete', { done: true, usage: result.usage, steps: result.steps.length })

  // Persistence — fixed to round-trip tool messages
  if (conversationId && store) {
    await persistConversation(store, conversationId, body, result, loadedHistory.length === 0)
  }

  close()
}
```

`handleAiChat`, `handleForceAgent`, and the inline no-resource branch are all **deleted**. ~150 lines removed, ~30 lines added in their place.

### 3.2 Fix persistence (round-trip tool messages)

**File:** `packages/panels/src/handlers/chat/persistence.ts` (new, ~40 LOC)

```ts
export async function persistConversation(
  store: ConversationStoreLike,
  conversationId: string,
  body: ChatRequestBody,
  result: AgentResponse,
  isFirstTurn: boolean,
) {
  // Build the full AiMessage[] to append
  const userMsg: AiMessage = body.message
    ? { role: 'user', content: body.message }
    : extractLastUserMessage(body.messages!)

  const messagesToAppend: AiMessage[] = [userMsg]

  // Each step contains: assistant message (with toolCalls) + tool result messages
  for (const step of result.steps) {
    messagesToAppend.push(step.message)  // assistant, may have toolCalls
    for (const tr of step.toolResults) {
      messagesToAppend.push({
        role: 'tool',
        content: typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result),
        toolCallId: tr.toolCallId,
      })
    }
  }

  await store.append(conversationId, messagesToAppend)

  if (isFirstTurn) {
    const lastAssistant = result.steps[result.steps.length - 1]?.message
    const text = typeof lastAssistant?.content === 'string' ? lastAssistant.content : ''
    generateConversationTitle(store, conversationId, userMsg.content as string, text).catch(() => {})
  }
}
```

This is the bug fix. Today the chat handler writes only `[user, assistant-text]` and drops everything in between. After this, the full message graph is preserved, which is the precondition for the client-tool round-trip plan to validate `body.messages` against `ConversationStore.load()`.

### 3.3 Fix `loadedHistory` shape

**File:** `packages/panels/src/handlers/chat/types.ts`

- Change `ConversationStoreLike.load` return type from `Array<{role,content,toolCallId?,toolCalls?}>` to `Promise<AiMessage[]>` (matches the underlying `ConversationStore` interface in `@rudderjs/ai`)
- Change `ConversationStoreLike.append` parameter to `AiMessage[]`

`PrismaConversationStore` already returns and accepts the right shape — only the structural type in `types.ts` needs to widen.

### 3.4 Update `ChatRequestBody`

**File:** `packages/panels/src/handlers/chat/types.ts`

```ts
export interface ChatRequestBody {
  // Either of these is required (not both)
  message?: string
  messages?: AiMessage[]  // ← reserved for client-tool plan, not used yet

  conversationId?: string
  model?: string

  // Discriminated context (one or zero of these)
  resourceContext?: { resourceSlug: string; recordId: string }
  pageContext?: { pageSlug: string }
  // No field for "global" — the absence of all others implies global

  // Existing fields
  forceAgent?: string
  selection?: { field: string; text: string }
  history?: AiMessage[]  // legacy fallback when no store available
}
```

`messages` is added now (not used by this plan) so the wire format is stable when the client-tool plan starts.

---

## Phase 4 — Tests

**File:** `packages/panels/test/handlers/chat/contexts.test.ts` (new)

- `resolveContext` returns `ResourceChatContext` when `body.resourceContext` is set
- `resolveContext` returns `GlobalChatContext` when no context fields are set
- `ResourceChatContext` rejects unknown resource slugs
- `ResourceChatContext` enforces `policy('view')`
- `ResourceChatContext.buildTools()` includes `runAgentTool` and `editTextTool`
- `GlobalChatContext.buildTools()` returns `[]`

**File:** `packages/panels/test/handlers/chat/persistence.test.ts` (new)

- After a turn with no tool calls, `store.append` is called with `[user, assistant]`
- After a turn with one tool call, `store.append` is called with `[user, assistant{toolCalls}, tool, assistant]` — full graph preserved
- `loadedHistory` round-trips: load → pass to `agent()` → tool messages survive
- Title generation only fires on the first turn

---

## What this plan does NOT do

- **No new features.** Behavior is identical to today from the user's perspective.
- **No client-tool stopping.** That's `client-tool-roundtrip-plan.md`, which now drops in cleanly because there's only one branch to wire.
- **No `needsApproval` enforcement.** Same — deferred to the client-tool plan.
- **No actual page chat.** `PageChatContext` is a stub. The next plan fills it in.
- **No field-level AI affordances** (`media.ai()` etc.). Future, separate plan.
- **No new SSE event types.** Same wire format as today.
- **No `@rudderjs/ai` changes.** This plan is panels-only.

---

## File summary

### New files (7)
- `packages/panels/src/handlers/chat/contexts/types.ts`
- `packages/panels/src/handlers/chat/contexts/resolveContext.ts`
- `packages/panels/src/handlers/chat/contexts/ResourceChatContext.ts`
- `packages/panels/src/handlers/chat/contexts/GlobalChatContext.ts`
- `packages/panels/src/handlers/chat/contexts/PageChatContext.ts` (stub)
- `packages/panels/src/handlers/chat/persistence.ts`
- `packages/panels/test/handlers/chat/contexts.test.ts`
- `packages/panels/test/handlers/chat/persistence.test.ts`

### Modified files (2)
- `packages/panels/src/handlers/chat/chatHandler.ts` — gutted to a thin dispatcher (~150 LOC removed)
- `packages/panels/src/handlers/chat/types.ts` — `ConversationStoreLike` shapes widen to `AiMessage[]`, `ChatRequestBody` gains `pageContext` and `messages`

### Deleted code (in chatHandler.ts)
- `handleAiChat` function
- `handleForceAgent` function
- Inline no-resource branch
- The `Array<{role,content}>` reductions

---

## Risks

1. **Behavioral regression on edge cases.** The current `chatHandler.ts` has subtle conditionals (selection vs no-selection prompt building, `effectiveMessage` injection at `:133-135`, `aiHistory.length === 0` title-generation gate). The refactor must preserve all of these. Mitigation: contexts.test.ts covers the matrix; manual smoke test on resource edit + no-resource chat before merging.

2. **`ConversationStoreLike.load` shape widening.** Anything that consumed the old reduced shape (`{role,content}`-only) and assumed `toolCalls` was absent will now see real tool calls. Grep confirms only `chatHandler.ts` consumes this — no other call sites — so the blast radius is contained.

3. **Old conversations contain `[client tool — execute on client]` placeholder strings.** These get loaded back as real `tool`-role messages. Inert (the model just sees odd text), but ugly. Decision: ignore — the client-tool plan replaces the placeholder with real round-trips, and old conversations age out naturally.

---

## Order of work

1. Phase 1 — Define `ChatContext` interface and resolver
2. Phase 2 — Implement the three contexts (most code is lifted verbatim from `chatHandler.ts`)
3. Phase 3 — Refactor the dispatcher; delete the three old branches; fix persistence and shape bugs
4. Phase 4 — Tests
5. Manual smoke test (resource edit chat + no-context chat + force-agent path)
6. Changeset (`patch` for `@rudderjs/panels` — no public API change)

---

## What this unblocks

- **`client-tool-roundtrip-plan.md`** — shrinks ~30%. Phase 2 wires the new SSE events into one dispatcher instead of three branches. Persistence and shape bugs are already fixed.
- **Future page-chat plan** — `PageChatContext` already exists; just needs to be filled in.
- **Future field-level AI plan** (`media.ai()`, `image.ai()`, etc.) — adds a `FieldChatContext` alongside the existing three; per-field-type tool builders register there.
- **Any future security or audit work on chat** — one place to add it, not three.
