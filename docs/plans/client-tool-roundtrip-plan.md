# Client Tool Round-Trip + Tool Approval Plan

Enable AI agents to (1) call tools that execute on the browser (client-side) and (2) require user approval before executing destructive or sensitive tools — both via a shared re-submission infrastructure.

**Status:** DONE (2026-04-07)
**Estimated LOC:** ~220 (reduced from ~320 — see "Depends on" below)
**Packages affected:** `@rudderjs/ai`, `@rudderjs/panels`
**Depends on:** `chat-context-refactor-plan.md` must land first. That plan collapses the three duplicated branches in `chatHandler.ts` into a single dispatcher and fixes the conversation persistence bugs that this plan would otherwise have to fix as a precondition. Phase 2 below assumes the dispatcher exists.

---

## Goal

Two related capabilities, one shared infrastructure:

### 1. Client tool execution
Solve the gap where the AI agent can't see local-only state from the user's browser (e.g. non-collab field values that live only in React state). Today, server-side tools cannot access client-only data. This plan introduces a generic client-side tool execution mechanism.

### 2. Tool approval (`needsApproval`)
Today, `needsApproval` is a stub in `packages/ai/src/types.ts:197` — declared but not enforced by the agent loop. This plan wires it up so destructive or sensitive tools (delete record, send email, charge card) can pause the agent and request user approval before executing.

These features share the same stop/resume infrastructure, so they're bundled.

---

## Approach

**Re-submission pattern** (Vercel AI SDK convention) for both features:

1. Server agent loop runs
2. When the loop hits a "needs to stop" condition (client tool call OR approval required), it:
   - Yields the relevant SSE event
   - Stops with an appropriate `finishReason`
   - Closes the stream
3. Client receives the event:
   - **Client tool:** runs the registered local handler
   - **Approval required:** shows a modal, awaits user decision
4. Client re-POSTs `/chat` with the updated `messages` array (and optionally an `approveToolCallId` flag)
5. Server resumes naturally — same endpoint, new request, conversation continues
6. Repeats until the model finishes

**Why re-submission over a pause/resume bridge?**
- No server-side pending state (no in-memory Map, no second endpoint)
- Multi-replica friendly (no sticky sessions needed)
- Matches industry convention (Vercel AI SDK v6, TanStack AI)
- Smaller, simpler code

---

## `needsApproval` semantics

`needsApproval` is **orthogonal** to where the tool runs. All four combinations are valid:

| | Server tool (`.server(handler)`) | Client tool (no `.server()`) |
|---|---|---|
| **`needsApproval: false`** | Server runs immediately | Client runs immediately |
| **`needsApproval: true`** | Server asks user → on approve, server runs | Client asks user → on approve, client runs |

`needsApproval` lives on the **tool definition**, not split between server and client registration. The agent loop checks it before executing (server tools) or before yielding the call to the client (client tools).

---

## Backward compatibility

All changes are **additive**. Honors the Laravel-style API stability commitment of `@rudderjs/ai`:

- Existing tools that don't set `needsApproval` are unaffected
- Existing tools with `needsApproval` already set in their definition (currently a no-op stub) start behaving correctly — but since the runtime ignored the flag before, no one is depending on the old broken behavior
- Client-tool stopping behavior is opt-in via `agent()` option `toolCallStreamingMode: 'stop-on-client-tool'`. Default preserves the existing placeholder behavior
- The `dynamicTool()` helper is purely additive

---

## Phase 1 — `@rudderjs/ai` core (~120 LOC)

### 1.1 Add opt-in client-tool stopping mode

**File:** `packages/ai/src/types.ts`
- Add to `AgentPromptOptions`:
  ```ts
  toolCallStreamingMode?: 'placeholder' | 'stop-on-client-tool'  // default: 'placeholder'
  ```
- Add `'client_tool_calls'` and `'tool_approval_required'` as valid `finishReason` values

**File:** `packages/ai/src/agent.ts` — `runAgentLoop` and `runAgentLoopStreaming`
- Locate the two existing client-tool branches (lines 468 and 708, post-§1.3 they read `if (!tool.execute)`)
- Wrap them so the new mode breaks out of the iteration loop instead of writing a placeholder:
  ```ts
  if (!tool.execute) {
    if (options?.toolCallStreamingMode === 'stop-on-client-tool') {
      pendingClientToolCalls.push(tc)
      finishReason = 'client_tool_calls'
      break
    }
    // Existing placeholder behavior (unchanged for back-compat)
    toolResults.push({ toolCallId: tc.id, result: '[client tool — execute on client]' })
    messages.push({ role: 'tool', content: '[client tool — execute on client]', toolCallId: tc.id })
    continue
  }
  ```

**Non-streaming variant (`runAgentLoop`)** returns the pending tool calls to the caller via the existing result shape — add a `pendingToolCalls?: ToolCall[]` field to `AgentLoopResult` so `chatHandler.ts` can read them after the loop exits with `finishReason: 'client_tool_calls'` or `'tool_approval_required'`.

**Streaming variant (`runAgentLoopStreaming`)** emits the pending tool calls as a new SSE chunk type before closing. Add to the streaming chunk union in `agent.ts`:
```ts
type AgentStreamChunk =
  | { type: 'text-delta'; text: string }
  | ...existing chunks
  | { type: 'pending-client-tools'; toolCalls: ToolCall[] }
  | { type: 'pending-approval'; toolCall: ToolCall; isClientTool: boolean }
```
The loop yields one of these chunks immediately before yielding the final `finish` chunk with the new `finishReason`. `chatHandler.ts` translates them to the wire-level SSE events `pending_client_tools` and `tool_approval_required` (see §2.1).

### 1.2 Wire up `needsApproval` enforcement

**File:** `packages/ai/src/agent.ts` (both `runAgentLoop` and `runAgentLoopStreaming`)

Before executing a server tool, check `needsApproval`:
```ts
// (after existing client-tool branch, before tool.execute)
const needsApproval = tool.definition.needsApproval
const requiresApproval = typeof needsApproval === 'function'
  ? await needsApproval(toolArgs)
  : !!needsApproval

if (requiresApproval) {
  // Check if this tool call is already pre-approved via options.approvedToolCallIds
  const isApproved = options?.approvedToolCallIds?.includes(tc.id)
  const isRejected = options?.rejectedToolCallIds?.includes(tc.id)

  if (isRejected) {
    const rejectionResult = '{"rejected": true, "reason": "User rejected this tool call"}'
    toolResults.push({ toolCallId: tc.id, result: { rejected: true } })
    messages.push({ role: 'tool', content: rejectionResult, toolCallId: tc.id })
    continue
  }

  if (!isApproved) {
    // Stop the loop and signal that approval is required
    finishReason = 'tool_approval_required'
    break
  }
  // else: proceed to execute below
}

// existing execute call
const result = await tool.execute(toolArgs)
```

For **client tools with `needsApproval`**, the same check happens but in a different order: the tool call is yielded to the client with metadata indicating approval is required, then the loop stops. The client shows the approval UI and decides whether to run the local handler.

**Add to `AgentPromptOptions`:**
```ts
approvedToolCallIds?: string[]   // tool call ids the user has approved
rejectedToolCallIds?: string[]   // tool call ids the user has rejected
```

### 1.3 Collapse to a single `Tool` type (Vercel-style)

The current `ServerTool` / `ClientTool` discriminated union is broken: `ClientTool.execute` is a server-side stub that carries no real information, and `.client(execute)` is conceptually wrong (client tools execute on the client). Replace the union with a single `Tool` type where `execute` is optional — its presence/absence is the discriminator. This matches Vercel AI SDK v4+ and TanStack AI.

**File:** `packages/ai/src/types.ts`
- Replace `ServerTool`, `ClientTool`, and `AnyTool` with one interface:
  ```ts
  export interface Tool<TInput = unknown, TOutput = unknown> {
    readonly definition: ToolDefinitionOptions<any, any>
    readonly execute?: ToolExecuteFn<TInput, TOutput>  // absent = client tool
  }
  ```

**File:** `packages/ai/src/tool.ts`
- `ToolBuilder` implements `Tool` directly — a builder with no `.server()` call is itself a valid client tool (`{ definition }` with no `execute`):
  ```ts
  export class ToolBuilder<TInput, TOutput> implements Tool<z.infer<TInput>, never> {
    readonly definition: ToolDefinitionOptions<TInput, TOutput>
    constructor(options) { this.definition = options }

    server<TReturn>(execute: ToolExecuteFn<z.infer<TInput>, TReturn>): Tool<z.infer<TInput>, TReturn> {
      return { definition: this.definition, execute }
    }
    // toSchema() unchanged
  }
  ```
- **Delete `.client(execute)`** — there are zero call sites in the repo, and the method is conceptually wrong. Client handlers register separately via the `clientTools.ts` registry on the panels side (§2.2).

**File:** `packages/ai/src/agent.ts`
- Replace both `if (tool.type === 'client')` checks (lines 468 and 708) with `if (!tool.execute)`. TypeScript narrows `tool.execute` to defined in the `else` branch automatically.

**Migration impact:** ~15 lines outside the new code. All 8 existing `.server(handler)` call sites are unchanged. `AnyTool` references become `Tool`. No test changes — `index.test.ts` uses `.server()` exclusively.

### 1.4 Add `dynamicTool()` helper

**File:** `packages/ai/src/tool.ts` (new export)
- Thin wrapper around `toolDefinition()` that types input/output as `unknown`
- For tools whose schemas are built at runtime from user data
- Formalizes a pattern we already do ad-hoc in `ResourceAgent.ts:146-161`

### 1.5 Tests

**File:** `packages/ai/test/client-tools.test.ts` (new)
- Tool without `.server()` is marked `type: 'client'`
- `toolCallStreamingMode: 'placeholder'` (default) preserves old behavior
- `toolCallStreamingMode: 'stop-on-client-tool'` stops the loop, `finishReason` is `client_tool_calls`
- `dynamicTool()` accepts unknown input/output

**File:** `packages/ai/test/tool-approval.test.ts` (new)
- Server tool with `needsApproval: true` stops the loop, `finishReason` is `tool_approval_required`
- Server tool with `needsApproval: (args) => args.destructive === true` only stops when predicate returns true
- `approvedToolCallIds: [id]` lets the tool execute on the next loop run
- `rejectedToolCallIds: [id]` skips execution and emits a rejection result
- Client tool with `needsApproval: true` is yielded with approval metadata and stops the loop

---

## Phase 2 — Panels chat client wiring (~150 LOC)

### 2.1 Server-side: accept message-array continuation

**File:** `packages/panels/src/handlers/chat/types.ts`
- Add to `ChatRequestBody`:
  ```ts
  messages?: AiMessage[]                   // optional — used instead of message + history
  approvedToolCallIds?: string[]           // approve specific pending tool calls
  rejectedToolCallIds?: string[]           // reject specific pending tool calls
  ```
- Document new SSE events: `pending_client_tools`, `tool_approval_required`

**File:** `packages/panels/src/handlers/chat/chatHandler.ts` (the slim dispatcher, post-Plan-0)
- In the single `runChat` function, if `body.messages` is set, use it as the conversation **after validating it against the persisted conversation** (see security checks below)
- Pass `toolCallStreamingMode: 'stop-on-client-tool'`, `approvedToolCallIds`, `rejectedToolCallIds` to `agent()`
- Because Plan 0 collapsed the three branches into one dispatcher, this wiring happens in exactly one place — it automatically applies to resource, page, and global contexts
- On `finishReason === 'client_tool_calls'`, send `pending_client_tools` SSE event with the tool calls, close stream
- On `finishReason === 'tool_approval_required'`, send `tool_approval_required` SSE event with the tool call (name, args, description, isClientTool flag), close stream

**Security checks (must implement, not optional):**

1. **Validate `messages` against `ConversationStore`.** When `body.messages` is provided, load the persisted conversation and verify that the prefix matches what the server already wrote. The client may only *append* (its own user message + tool result messages from the previous round) — never rewrite history. Reject the request with 400 if the prefix diverges.

2. **Validate `approvedToolCallIds` / `rejectedToolCallIds`.** For each id in either array, verify it exists in the most recent assistant message of the loaded conversation and corresponds to a tool call that's actually pending approval. Reject unknown ids with 400. Without this check, an attacker can POST `approvedToolCallIds: ['anything']` to bypass approval gates.

3. **Scope "always approve" decisions to the conversation, not globally.** If §2.4 adds an "always approve `tool_name`" checkbox, the allowlist lives on the `Conversation` row in `ConversationStore`, not in client-side state or a session-wide map. This prevents cross-conversation privilege escalation.

### 2.2 Client-side: tool registry

**File:** `packages/panels/pages/_components/agents/clientTools.ts` (new, ~30 LOC)
```ts
type ClientToolHandler = (args: unknown) => Promise<unknown> | unknown

const handlers = new Map<string, ClientToolHandler>()

export function registerClientTool(name: string, handler: ClientToolHandler): () => void {
  handlers.set(name, handler)
  return () => handlers.delete(name)
}

export function hasClientTool(name: string): boolean {
  return handlers.has(name)
}

export async function executeClientTool(name: string, args: unknown): Promise<unknown> {
  const h = handlers.get(name)
  if (!h) throw new Error(`No client handler for tool "${name}"`)
  return await h(args)
}
```

### 2.3 Client-side: re-submission loop

**File:** `packages/panels/pages/_components/agents/AiChatContext.tsx`
- Track conversation as `messages: AiMessage[]`
- Add SSE handler for `pending_client_tools`:
  1. For each pending tool call, run `executeClientTool(name, args)`
  2. Build tool result messages: `{ role: 'tool', content: result, toolCallId }`
  3. Append assistant message + tool result messages to local `messages`
  4. POST `/chat` again with `{ messages, conversationId, ... }`
  5. Continue streaming
- Add SSE handler for `tool_approval_required`:
  1. Show approval modal (see 2.4)
  2. On approve: POST `/chat` with `{ messages, approvedToolCallIds: [id] }` → server executes
  3. On reject: POST `/chat` with `{ messages, rejectedToolCallIds: [id] }` → agent gets rejection result
  4. For client tools needing approval: same flow, but on approve, client runs the handler locally instead of POSTing the approval flag (handler runs, then POSTs the result)
- Add `isExecutingClientTool: boolean` and `pendingApproval: { tool, args } | null` to context

### 2.4 Approval modal component

**File:** `packages/panels/pages/_components/agents/ToolApprovalModal.tsx` (new, ~50 LOC)
- Shows tool name, description, and JSON-formatted arguments
- Approve and Reject buttons
- Optional: "Always approve `tool_name`" checkbox for the current session
- Calls back to `AiChatContext` with the user's decision

---

## Phase 3 — First concrete tools (~50 LOC)

### 3.1 `read_form_state` (client tool, no approval)

**File:** `packages/panels/src/handlers/chat/tools/readFormStateTool.ts` (new)
```ts
import { toolDefinition, z } from '@rudderjs/ai'

export function buildReadFormStateTool() {
  return toolDefinition({
    name: 'read_form_state',
    description: 'Read the user\'s current local form values, including unsaved changes to non-collaborative fields.',
    inputSchema: z.object({
      fields: z.array(z.string()).optional().describe('Optional list of field names to read; omit for all fields'),
    }),
  })  // ← no .server() = client tool
}
```

**File:** `packages/panels/pages/_components/SchemaForm.tsx`
- Register the handler:
  ```ts
  useEffect(() => {
    return registerClientTool('read_form_state', ({ fields }) => {
      const all = valuesRef.current
      if (!fields) return all
      return Object.fromEntries(Object.entries(all).filter(([k]) => fields.includes(k)))
    })
  }, [])
  ```

### 3.2 `delete_record` (server tool, needs approval)

**File:** `packages/panels/src/handlers/chat/tools/deleteRecordTool.ts` (new)
```ts
import { toolDefinition, z } from '@rudderjs/ai'

export function buildDeleteRecordTool(resourceSlug: string, recordId: string) {
  return toolDefinition({
    name: 'delete_record',
    description: 'Permanently delete the current record. Requires user approval.',
    inputSchema: z.object({
      reason: z.string().describe('Why this record should be deleted'),
    }),
    needsApproval: true,
  }).server(async ({ reason }) => {
    // Actual delete logic — only runs after user approves
    const Resource = panel.getResources().find(R => R.getSlug() === resourceSlug)
    const Model = Resource?.model
    await Model?.query().delete(recordId)
    return `Record ${recordId} deleted. Reason: ${reason}`
  })
}
```

### 3.3 Manual tests

**Test 1 (client tool):**
1. Create a non-collab field (`TextField` with no `.collaborative()`/`.persist()`)
2. Edit page → type into the field WITHOUT saving
3. Open AI chat → ask "what's the current value of \<field\>?"
4. Verify: chat shows `read_form_state` tool call, response cites the local value

**Test 2 (server tool needing approval):**
1. Open an article edit page
2. Ask AI: "delete this record"
3. Verify: modal pops up showing tool name, args, Approve/Reject buttons
4. Click Approve → record is deleted, agent confirms
5. Repeat — click Reject → agent says it was rejected, no deletion

**Test 3 (`needsApproval` predicate):**
1. Define a tool with `needsApproval: (args) => args.destructive === true`
2. Call with `destructive: false` → executes immediately
3. Call with `destructive: true` → requires approval

---

## File summary

### New files (6)
- `packages/ai/test/client-tools.test.ts`
- `packages/ai/test/tool-approval.test.ts`
- `packages/panels/pages/_components/agents/clientTools.ts`
- `packages/panels/pages/_components/agents/ToolApprovalModal.tsx`
- `packages/panels/src/handlers/chat/tools/readFormStateTool.ts`
- `packages/panels/src/handlers/chat/tools/deleteRecordTool.ts`

### Modified files (7)
- `packages/ai/src/types.ts` — `AgentPromptOptions` additions, new `finishReason` values
- `packages/ai/src/agent.ts` — opt-in client-tool stopping logic, `needsApproval` enforcement
- `packages/ai/src/tool.ts` — auto-detect client tools, add `dynamicTool()`
- `packages/panels/src/handlers/chat/types.ts` — `ChatRequestBody.messages`, approval ids, new SSE event types
- `packages/panels/src/handlers/chat/chatHandler.ts` — accept message-array, emit pending events, register new tools
- `packages/panels/pages/_components/agents/AiChatContext.tsx` — tool registry, re-submission loop, approval modal state
- `packages/panels/pages/_components/SchemaForm.tsx` — register `read_form_state` handler

---

## Risks

1. **SSE re-submission latency** — each client tool call or approval triggers a new SSE stream. For typical chat (1-2 stops per turn), invisible. For tool-heavy reasoning (10+ calls), adds up. Acceptable.

2. **Conversation state divergence** — client now holds the source of truth across re-submissions. Multi-tab editing the same conversation could diverge. Mitigation: server still owns the persisted conversation via `ConversationStore`.

3. **`messages` array on the wire** — bigger requests for long conversations. Mitigation: server can load `loadedHistory` from store and accept `messages` as a delta. Defer optimization.

(Approval-bypass and "always approve" scope concerns are now hard requirements in §2.1, not deferred risks.)

---

## Order of work

1. Phase 1 — `@rudderjs/ai` core (client tools + needsApproval)
2. Phase 2 — Panels chat client wiring
3. Phase 3 — Concrete tools and end-to-end tests
4. Changeset (`minor` for `@rudderjs/ai` and `@rudderjs/panels`)

---

## Skipped (deliberately)

- **`UIMessage` / `ModelMessage` split** — bigger refactor, defer
- **Tool execution streaming (async generator execute)** — nice but not blocking
- **MCP tool source for chat** — separate concern
- **Standardized SSE protocol parts** — works fine today
- **Always-approve UX** — add later if users complain about modal fatigue

---

## References

- Vercel AI SDK v6 docs: https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling
- TanStack AI: https://tanstack.com/ai/latest
- Existing `@rudderjs/ai` agent loop: `packages/ai/src/agent.ts`
- Existing panels chat handler: `packages/panels/src/handlers/chat/chatHandler.ts`
- Existing `needsApproval` stub: `packages/ai/src/types.ts:197`
