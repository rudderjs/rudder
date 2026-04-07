# Chat Context Refactor Plan

Extract the three hardcoded branches in `packages/panels/src/handlers/chat/chatHandler.ts` into a pluggable `ChatContext` provider architecture, and fix the conversation persistence bugs that block tool-message round-tripping.

**Status:** NOT STARTED
**Estimated LOC:** ~180 (net: +230 new, -50 deleted)
**Packages affected:** `@rudderjs/panels` only (per §3.4 recommendation, the `pageSlug` addition to `ConversationStoreMeta` in `@rudderjs/ai` is deferred to the future page-chat plan)
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
import type { AiMessage, AnyTool, ConversationStoreMeta } from '@rudderjs/ai'

export interface ChatContext {
  readonly kind: 'resource' | 'page' | 'global'

  /** Build the system prompt the model sees */
  buildSystemPrompt(): string

  /** Build the tool set available to this chat. Tools are constructed with deps already injected at context construction time (see async factory below). */
  buildTools(): AnyTool[]

  /** Conversation metadata for store.create() — varies by context kind */
  getConversationMeta(): ConversationStoreMeta

  /** Whether to load prior conversation history. ResourceChatContext returns false in selection mode (one-shot edits). Default true. */
  shouldLoadHistory(): boolean

  /** Transform the user's input before passing to the agent. ResourceChatContext re-injects record state on multi-turn chats so long conversations don't drift. Default identity. */
  transformUserInput(input: string, history: AiMessage[]): string
}
```

**Async construction via static factory.** Contexts need to do async work during construction (load record, run policy check, overlay live Yjs state). Constructors can't be async, so each context exposes a `create()` factory:

```ts
class ResourceChatContext implements ChatContext {
  static async create(deps: {
    body: ChatRequestBody
    panel: Panel
    req: AppRequest
    send: SSESend          // injected so tools can emit SSE events from inside .execute
  }): Promise<ResourceChatContext> { /* ... */ }

  // Constructor is private — use create()
  private constructor(private readonly state: ResolvedResourceState) {}

  buildTools() { /* state already has agents, agentCtx, record, send, message — closure forms here */ }
  buildSystemPrompt() { /* uses state.record, state.selection */ }
  // ...
}
```

The factory throws on 4xx conditions (resource not found, policy denied) — see §1.2 for how the dispatcher handles these.

### 1.2 Resolver

**File:** `packages/panels/src/handlers/chat/contexts/resolveContext.ts` (new, ~30 LOC)

```ts
export class ChatContextError extends Error {
  constructor(public readonly status: number, message: string) { super(message) }
}

export async function resolveContext(deps: {
  body: ChatRequestBody
  panel: Panel
  req: AppRequest
  send: SSESend
}): Promise<ChatContext> {
  const { body } = deps
  if (body.resourceContext) return ResourceChatContext.create(deps)
  if (body.pageContext)     return PageChatContext.create(deps)
  return GlobalChatContext.create(deps)
}
```

The factories throw `ChatContextError` for 4xx conditions (resource not found → 404, policy denied → 403). The dispatcher catches these and returns JSON before opening the SSE stream — `chatHandler.ts:351` shows that the readable from `createSSEStream()` is not wired to the actual `Response` until the very end of `handlePanelChat`, so returning JSON after `createSSEStream()` but before that wiring is safe (the orphan readable gets garbage collected). Today's code already does this at `:244-246`.

---

## Phase 2 — Implement the three contexts

### 2.1 `ResourceChatContext`

**File:** `packages/panels/src/handlers/chat/contexts/ResourceChatContext.ts` (new, ~140 LOC — most of it lifted verbatim from the current `handleAiChat`)

`ResourceChatContext.create()` (the async factory) does:
1. Look up resource class from `panel.getResources()` — throw `ChatContextError(404)` if not found
2. Instantiate resource, run `policy('view', ctx)` — throw `ChatContextError(403)` if denied
3. Load the record via `Model.find(recordId)`
4. Overlay unsaved Yjs fields (lift the existing logic at `chatHandler.ts:264-282` verbatim)
5. Pre-build the tool deps: `agents = resource.agents()`, `agentCtx`, `allFields`, etc.
6. Resolve the selected `ResourceAgent` if `body.forceAgent` is set — throw `ChatContextError(404)` if agent slug unknown
7. Construct and return the instance with everything resolved

Methods:
- `buildSystemPrompt()`: returns the existing prompt string (lift `chatHandler.ts:69-110` verbatim — both selection-aware and default variants)
- `buildTools()`: returns `[runAgentTool, editTextTool]`. Both tools close over `state.send`, `state.message`, `state.agentCtx`, etc., which were captured at construction time. The factory calls `await buildRunAgentTool(...)` and `await buildEditTextTool(...)` once during `create()` — async work happens there, not in `buildTools()`.
- `getConversationMeta()`: returns `{ resourceSlug, recordId, userId? }`
- `shouldLoadHistory()`: returns `!body.selection` — selection mode is a one-shot edit, not a multi-turn conversation (matches today's `if (!selection)` gate at `chatHandler.ts:216`)
- `transformUserInput(input, history)`: matches the `effectiveMessage` logic at `chatHandler.ts:133-135`:
  ```ts
  if (history.length > 0 && !this.state.selection && Object.keys(this.state.record).length > 0) {
    return `${input}\n\n[Current record state: ${JSON.stringify(this.state.record)}]`
  }
  return input
  ```
- Public method `getForceAgent(): ResourceAgent | null` — used by the dispatcher's force-agent branch (see §3.1)

**`handleForceAgent` does NOT cleanly fold into `buildTools` + `toolChoice`.** The current `handleForceAgent` (`chatHandler.ts:17-48`) doesn't call `agent()` at all — it calls `agentDef.stream(agentCtx, input)` directly on a `ResourceAgent` instance, which is a panels-level class that internally constructs and runs its own `@rudderjs/ai` agent. These are two different execution paths.

**Resolution:** Keep force-agent as an explicit branch inside the dispatcher's `runChat`, but localized to ~10 lines and gated on `context.kind === 'resource' && context.getForceAgent() !== null`. The 30 lines of `handleForceAgent` move into a small private `runForceAgent` helper. The function `handleForceAgent` is deleted as a top-level export, but the logic lives on in a contained branch. Honest about the special case rather than pretending it disappears.

### 2.2 `GlobalChatContext`

**File:** `packages/panels/src/handlers/chat/contexts/GlobalChatContext.ts` (new, ~40 LOC)

- `static create(deps)`: trivial — no resource lookup, no policy check, no record load
- `buildSystemPrompt()`: `'You are a helpful assistant for an admin panel. Be concise.'` (matches today's no-resource branch)
- `buildTools()`: `[]` for now — placeholder for future global tools (`navigate_to`, `search_resources`)
- `getConversationMeta()`: returns `{ userId? }` only (extracted from req)
- `shouldLoadHistory()`: returns `true`
- `transformUserInput(input)`: identity (returns `input` unchanged)

This replaces the inline no-resource branch at `chatHandler.ts:305-346`.

### 2.3 `PageChatContext` (skeleton only)

**File:** `packages/panels/src/handlers/chat/contexts/PageChatContext.ts` (new, ~30 LOC)

- `static create(deps)`: stub — accepts `pageContext: { pageSlug }` from body, no other resolution
- `buildSystemPrompt()`: stub default (`'You are a helpful assistant for the {pageSlug} page.'`)
- `buildTools()`: returns `[]` — placeholder for future per-page tool registry
- `getConversationMeta()`: returns `{ userId?, pageSlug }` (note: `ConversationStoreMeta` may need a `pageSlug` field added — see §3.4)
- `shouldLoadHistory()`: `true`
- `transformUserInput(input)`: identity
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

  // Resolve context FIRST — may throw ChatContextError → return JSON 4xx
  // (safe because the readable isn't wired to the Response until the end of this function)
  let context: ChatContext
  try {
    context = await resolveContext({ body, panel, req, send })
  } catch (err) {
    if (err instanceof ChatContextError) {
      return res.status(err.status).json({ message: err.message })
    }
    throw err
  }

  // Resolve store + conversation id
  const store = await resolveConversationStore().catch(() => null)
  let conversationId = body.conversationId
  let loadedHistory: AiMessage[] = []
  if (store) {
    if (conversationId) {
      if (context.shouldLoadHistory()) {
        loadedHistory = await store.load(conversationId)  // ← full AiMessage[], no map
      }
    } else {
      conversationId = await store.create(undefined, { ...context.getConversationMeta(), userId: extractUserId(req) })
      send('conversation', { conversationId, isNew: true })
    }
  }

  // Run the chat (fire-and-forget — SSE pumps from the stream)
  runChat({ send, close, context, body, loadedHistory, conversationId, store }).catch(err => {
    send('error', { message: err instanceof Error ? err.message : 'Chat failed.' })
    close()
  })

  // Return SSE response (unchanged from today's pattern at chatHandler.ts:350-358)
  return makeSSEResponse(res, readable)
}
```

`runChat` is the single shared loop:

```ts
async function runChat({ send, close, context, body, loadedHistory, conversationId, store }) {
  // Force-agent branch (only meaningful for ResourceChatContext)
  const forceAgent = context.kind === 'resource'
    ? (context as ResourceChatContext).getForceAgent()
    : null

  if (forceAgent) {
    return runForceAgent({ send, close, agentDef: forceAgent, context: context as ResourceChatContext, body, conversationId, store })
  }

  // Normal agent loop
  const { agent: agentFn } = await loadAi()
  const systemPrompt = context.buildSystemPrompt()
  const tools = context.buildTools()

  const userInput = body.message ?? extractLastUserMessage(body.messages!)
  const transformedInput = context.transformUserInput(userInput, loadedHistory)

  const a = agentFn({ instructions: systemPrompt, tools, model: body.model })
  const { stream, response } = a.stream(transformedInput, {
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
    await persistConversation(store, conversationId, userInput, result, loadedHistory.length === 0)
  }

  close()
}
```

`runForceAgent` is the localized special case (~30 LOC, lifted from today's `handleForceAgent`). Lives in the same file, not exported. Reuses the resolved `agentCtx` from `ResourceChatContext` so the resource lookup isn't duplicated.

`handleAiChat`, `handleForceAgent`, and the inline no-resource branch are all **deleted**. ~150 lines removed, ~30 lines added in their place.

### 3.2 Fix persistence (round-trip tool messages)

**File:** `packages/panels/src/handlers/chat/persistence.ts` (new, ~40 LOC)

```ts
export async function persistConversation(
  store: ConversationStoreLike,
  conversationId: string,
  userInput: string,
  result: AgentResponse,
  isFirstTurn: boolean,
) {
  // Build the full AiMessage[] to append.
  // Note: persist the ORIGINAL user input, not the context.transformUserInput() output.
  // The transformed version is an implementation detail of multi-turn priming and shouldn't
  // pollute the persisted conversation history.
  const messagesToAppend: AiMessage[] = [
    { role: 'user', content: userInput },
  ]

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
    generateConversationTitle(store, conversationId, userInput, text).catch(() => {})
  }
}
```

This is the bug fix. Today the chat handler writes only `[user, assistant-text]` and drops everything in between. After this, the full message graph is preserved, which is the precondition for the client-tool round-trip plan to validate `body.messages` against `ConversationStore.load()`.

### 3.3 Fix `loadedHistory` shape

**File:** `packages/panels/src/handlers/chat/types.ts`

- Change `ConversationStoreLike.load` return type from `Array<{role,content,toolCallId?,toolCalls?}>` to `Promise<AiMessage[]>` (matches the underlying `ConversationStore` interface in `@rudderjs/ai`)
- Change `ConversationStoreLike.append` parameter to `AiMessage[]`

`PrismaConversationStore` already returns and accepts the right shape — only the structural type in `types.ts` needs to widen.

### 3.4 Update `ChatRequestBody` and `ConversationStoreMeta`

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

**File:** `packages/ai/src/types.ts` — `ConversationStoreMeta`

`PageChatContext.getConversationMeta()` wants to return `{ pageSlug }`, but the existing `ConversationStoreMeta` only has `userId`/`resourceSlug`/`recordId` (`packages/ai/src/types.ts:358-362`). Add an optional `pageSlug?: string` field. This is the only `@rudderjs/ai` change in Plan 0 — purely additive, backwards-compatible.

`PrismaConversationStore.create()` already accepts and ignores unknown meta keys via `data: { ..., resourceSlug: meta?.resourceSlug, recordId: meta?.recordId }` — adding `pageSlug` requires either (a) a Prisma migration to add the column, or (b) passing it through into a JSON `meta` blob. Decide:
- **(a) Schema migration:** cleaner long-term, but adds a Prisma migration to this plan.
- **(b) Defer:** `PageChatContext.getConversationMeta()` returns `{ userId }` only for now; `pageSlug` filtering becomes a future page-chat plan concern.

**Recommendation:** defer (option b). Plan 0 doesn't actually need `pageSlug` in storage — `PageChatContext` is a stub anyway. Add the schema column when the page-chat plan lands and there's a real query that needs it.

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
