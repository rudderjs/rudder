# Mixed Tool Continuation Plan

Fix the dispatcher so the agent can call **both** server-side and client-side tools in the same assistant turn without breaking the continuation prefix check. Today the browser is unaware of server-tool results that ran inline, so it posts a message list that diverges from the persisted state and 400s.

**Status:** DONE (2026-04-08)
**Actual LOC:** ~245 (close to ~250 estimate; Phase 0 expanded slightly because `@rudderjs/ai` did not yet emit `tool-result` chunks)
**Packages affected:** `@rudderjs/panels` (`chatHandler.ts`, `continuation.ts`, `pages/_components/agents/AiChatContext.tsx`, `pages/_components/agents/AiChatPanel.tsx`, parsers in `pages/_components/agents/sse/`)
**Depends on:** `client-tool-roundtrip-plan.md` (DONE 2026-04-07) — this plan extends its SSE protocol
**Related:** `chat-update-form-state-plan.md` (DONE 2026-04-08) — exposes the bug because it makes mixed-tool turns plausible for the first time, `feedback_client_tool_for_authoring.md`, `project_continuation_array_args_bug.md` (separate canonicalization fix already shipped)

---

## Goal

After this plan, the agent can issue an assistant turn like:

```
toolCalls: [
  { name: 'update_form_state', arguments: { field: 'content', operations: [...] } },  // client tool
  { name: 'edit_text',         arguments: { field: 'title',   operations: [...] } },  // server tool
]
```

…and the round-trip completes successfully. Both tool results land in the persisted conversation in the right order, the browser's continuation post matches the prefix check, and the next turn proceeds normally.

This unblocks the load-bearing smoke test from `chat-update-form-state-plan.md` ("set status, bold word, add CTA, convert to h1 in one turn") which today 400s mid-stream because the model picks both tools.

---

## Non-Goals

- **Eliminate the continuation prefix check entirely.** It's load-bearing for security (`continuation.ts` top-of-file comment): without it a client could rewrite history or forge approvals. We keep the check; we fix the divergence.
- **Reorder tool execution.** Server tools still execute inline during the loop step; we don't defer them until after client tools resolve.
- **Reduce server-tool count.** Allowing mixed turns is the simpler answer to the prompt-engineering workaround ("hard rule: never mix tools in one turn"). Both should be possible.
- **Change `@rudderjs/ai`.** All changes live in the panels chat dispatcher and the browser chat context. The agent loop already produces correct `result.steps[i].toolResults` — the issue is purely how panels' SSE protocol surfaces them to the browser.
- **Re-architect to "stateless browser" (Option C below).** That's a bigger refactor of the continuation protocol contract and is parked as a future cleanup.

---

## Background

### What happens today (the bug)

A multi-tool assistant turn flows like this:

1. **Server** (`@rudderjs/ai` agent loop, `agent.ts:482-561`) — model returns N tool calls in one step.
2. Loop iterates over each tool call:
   - **Client tool** (no `execute`) → push to `pendingClientToolCalls`, set `stopForClientTools = true`, `continue` (no placeholder pushed to messages).
   - **Server tool** (has `execute`) → call it, push the result to `toolResults` AND push a `tool` role message to `messages`.
3. Loop step finishes with `loopFinishReason = 'client_tool_calls'`, exits.
4. `result.steps[0]` contains:
   - `step.message` = assistant message with all N tool calls
   - `step.toolResults` = results for the server-side tools only
5. **Server** (`chatHandler.ts:228-234`, `persistence.ts:60-83`) — `persistConversation` writes:
   - `user` message
   - `assistant{toolCalls=[A, B, ...]}`
   - `tool{result=…, toolCallId=B.id}` (one per server tool result)
6. **Server** (`chatHandler.ts:201-222`) — emits SSE events. The relevant ones for tool calls:
   - `tool_call` (informational, fired for every tool call as the model emits it)
   - `pending_client_tools` (only client tools)
   - **No event** for server-side tool results — they're persisted but never streamed to the browser.
7. **Browser** (`AiChatContext.tsx:525-555`) — builds `wireMessagesRef` from the SSE stream:
   - Appends one assistant message containing the captured tool calls
   - For each pending client tool: executes, captures the result, appends a `tool` role message to `wireMessagesRef`
8. **Browser** posts continuation with `messages: wireMessagesRef`. The list at this point is `[user, assistant{toolCalls=[A,B]}, tool{client A result}]` — only the client tool result. Server-side tool results are missing.
9. **Server** (`continuation.ts:41-71`) — loads persisted (`[user, assistant, tool{server B result}]`) and prefix-compares with body (`[user, assistant, tool{client A result}]`). At index 2 the `content` field differs. Throws `ContinuationError(400)`.

The 400 from the user's smoke test:

```
Continuation diverges from persisted conversation at message 2:
content: persisted=Applied 1/1 edit(s) to "content"
         body={"applied":2,"total":2}
```

— is the *server* tool result `Applied 1/1...` vs the *client* tool result `{"applied":2,"total":2}` colliding at the same index.

### Why the existing canonicalization fix doesn't help

`continuation.ts` already canonicalizes JSON for tool call arguments comparison (sorted keys, dropped undefined). That fix was for a *different* deferred bug — same shape (HTTP 400, prefix check), different cause (key-order mismatch in args). The mixed-tool bug is structural, not serialization: the messages aren't the same data with different ordering, they're literally different messages at the same index.

### Why this only became visible now

Before `chat-update-form-state-plan.md` shipped, the only client tool was `read_form_state` — read-only, almost always called alone. Every other tool (`edit_text`, `delete_record`, etc.) was server-side. The agent never had a reason to mix tools in one turn.

`update_form_state` ships in Phase 4 with overlapping capability (formatting, blocks, plain text) against `edit_text`. The prompt teaches the agent to prefer `update_form_state` for "active" cases and `edit_text` for "idle" cases. When the user says *"bold the word X AND add a callToAction"*, the model sometimes splits — one op into each tool. The bug fires immediately.

---

## Approach

Three options. Plan picks **Option A**.

### Option A — Stream server-tool results over SSE (PICKED)

**Idea:** Emit a new `tool_result` SSE event after each server-side tool execution, in execution order. The browser appends each result to `wireMessagesRef` as it arrives. When the browser composes the continuation post, the message list is built in the same order as the persisted state.

**Why this is the right fix:**
- Smallest possible change: one new SSE event type, ~30 LOC server, ~30 LOC browser.
- Preserves the existing security model — the prefix check stays. The browser builds the same message graph the server persisted, the comparison just works.
- Reuses the existing `wireMessagesRef` mirror-of-persisted pattern from `client-tool-roundtrip-plan.md`. No new state machinery.
- Backward compatible — old conversations don't have mixed-tool turns; the new event is additive.

**The change in three layers:**

1. **`@rudderjs/ai` stream protocol** — already emits a `tool-result` chunk type? Let me verify in the implementation phase. If yes, we just consume it. If no, we add it to the chunk union and emit it from the agent loop right after each `tool.execute()` resolves (before moving to the next tool call in the step).

2. **`packages/panels/src/handlers/chat/chatHandler.ts`** — add a `case 'tool-result':` branch in the SSE switch (`chatHandler.ts:201-222`) that forwards to the browser as `send('tool_result', { id, name, result })`. The result is JSON-stringified the same way `persistence.ts` stringifies it for the store, so canonicalization is automatic.

3. **`packages/panels/pages/_components/agents/AiChatContext.tsx`** — extend the SSE parser (`turnState` accumulator) to recognize `tool_result` events and append a wire-format `tool` message to a per-turn server-result buffer. After the stream closes (`AiChatContext.tsx:523-530`), when assembling the assistant + client-tool-results into `wireMessagesRef`, also include the buffered server tool results in the right position.

   **Ordering question:** the agent loop interleaves execution across tool calls in a step. We need to preserve the ORDER in which results were emitted, not the order in which the model declared the calls. The simplest invariant: append every `tool_result` SSE event (server-side) and every locally-executed client tool result to `wireMessagesRef` in *arrival order*. Server-side ones arrive during the stream; client-side ones arrive after the stream closes. Persisted order is `[server results in step order]` — see point 4 below.

4. **Verify ordering matches `persistence.ts`** — `persistConversation` walks `result.steps[i].toolResults` in array order, which is the order tools were *executed* in the step. The agent loop pushes server results to `toolResults` synchronously as each `tool.execute` resolves, then `continue`s to the next call in the step. Client tools `continue` without pushing to `toolResults`. So the persisted order is "server tool results, in the order their owning calls appeared in `step.message.toolCalls`, with client tool results omitted."

   On the browser side, we need to produce the same order. Strategy: track a per-step counter, emit `tool_result` SSE events with the call index, and the browser inserts at that index. Or simpler: since the loop processes calls strictly in order and only pushes server results, just stream server results in execution order and append in arrival order. Client tools (which come last in the wire log because the browser appends them after the stream closes) live AFTER all server results in `wireMessagesRef`. **But persisted has them only as server results — no client placeholders at all.** So the browser also needs to NOT include client tool results in the prefix-comparable section…

   …actually wait. Client tool results DO get persisted on the next round (they arrive as part of `bodyMessages` and `persistContinuation` slices the tail and persists it via `clientAppended`). So persisted state at the moment of the *current* 400 still doesn't have client results. The browser's continuation post adds them at the tail. The prefix check only validates indices `0..persisted.length-1`. Anything in `bodyMessages.slice(persisted.length)` is the new tail and is not prefix-compared.

   **So the fix is:** the browser must build the prefix `[0..persisted.length-1]` to exactly mirror the persisted state, then APPEND the client tool results as the new tail. The new SSE `tool_result` events let it do that.

5. **`continuation.ts`** — no behavioral change. The diff message logging from the recent canonicalization fix stays. With Option A, divergences should disappear for legitimate mixed-tool turns. Actual security failures (forged history) still 400.

**Edge cases to think through:**
- **Client tool runs first in the step, server tool runs second.** Loop pushes pending client (no message), runs server, pushes server result. Persisted has server result at index N. Browser receives `tool_result` SSE during the stream → appends to wireMessagesRef at the right position before the assistant message? No — the assistant message is already in wireMessagesRef before tool results stream. Order: `[user, assistant, server_tool_result, client_tool_result]`. Persisted: `[user, assistant, server_tool_result]`. Browser tail: `[client_tool_result]`. Prefix check passes. ✅
- **Two server tools, no client tools.** No `pending_client_tools`, no continuation, no problem. Server tool results stream over SSE for *visibility* now (UI can show "Updated X" lines as they happen), but the wire log doesn't need them — the conversation completes normally.
- **Two client tools, no server tools.** No SSE `tool_result` events, no change from current behavior. ✅
- **Server tool fails (throws).** `agent.ts:553-560` pushes an error result to messages. The new SSE event must also fire for failures so the browser sees them in wireMessagesRef.
- **Server tool requires approval.** Approval interrupts the loop before the call runs (`agent.ts:516-521`). No tool result is produced. No `tool_result` event needed for that case.
- **Multi-step turn with mixed tools per step.** Each step pushes its own results. The fix is per-step, so multi-step works automatically.

### Option B — Include server-tool results in the `pending_client_tools` payload (rejected)

Bundle the server-side results into the same SSE event that ships the client tool calls:

```ts
send('pending_client_tools', {
  toolCalls:        pendingClient,
  serverToolResults: serverResults,  // NEW
})
```

**Rejected because:** it couples two concerns. The browser also wants to *display* server tool results inline as they happen (the chat panel renders "Updated X (edit_text)" lines per call), and Option A gives it both — UI updates AND wire-log fidelity — for one event. Option B forces all server results to surface at the same moment, which is also the moment the chat is about to pause for client-tool execution. Worse UX, more code branching.

### Option C — Stateless browser, server reconstructs the message graph (deferred)

Eliminate `wireMessagesRef` entirely. Instead of posting `messages: [...full graph...]`, the browser posts:

```json
{ "conversationId": "abc", "toolResults": [{ "toolCallId": "call_...", "result": ... }] }
```

The server loads persisted state, appends the new tool result(s), runs the agent loop. No prefix check needed (the server controls the entire graph), continuation security collapses to "tool result IDs must match outstanding pending IDs."

**Why this is the right *long-term* shape:**
- Eliminates a whole class of prefix-divergence bugs (the canonicalization fix and this plan would both become unnecessary).
- Smaller browser state machine.
- Simpler security model (one rule: "the IDs you're resolving must be pending").

**Why we're not doing it now:** it's a refactor of the continuation contract that touches `client-tool-roundtrip-plan.md`'s tests + UI flows + `chat-context-refactor-plan.md`'s persistence interleaving. Roughly 500–800 LOC. Compared to Option A's ~250, deferring earns us most of the value with a quarter of the risk. Park it as `chat-stateless-continuation-plan.md` and revisit if we hit a third class of prefix-check bugs.

---

## Implementation Phases

### Phase 0 — Verify `@rudderjs/ai` stream emits `tool-result` chunks

**Goal:** confirm whether the agent loop already streams server-tool results, so we can decide between "consume an existing event" and "add one."

**Steps:**
1. Search `packages/ai/src/agent.ts` for `'tool-result'` chunk emission inside `runAgentLoopStreaming` (or wherever the streaming variant lives).
2. If present: skip Phase 1 partially — just wire up the dispatcher to forward.
3. If absent: add it to the streaming loop in @rudderjs/ai. Emit after each `tool.execute()` resolves (success or error). Chunk shape: `{ type: 'tool-result', toolCallId, name, result }`.

**Acceptance:** clear "yes/no" answer. If yes, write the chunk shape we'll forward.

### Phase 1 — Forward `tool_result` over SSE in the panels dispatcher

**Files:**
- `packages/panels/src/handlers/chat/chatHandler.ts` — new `case 'tool-result':` in the SSE switch, calls `send('tool_result', { id, name, result })` (result stringified the same way persistence does it).

**Acceptance:**
- A multi-tool turn (e.g. two server tools, no client tool) results in two `tool_result` SSE events emitted in execution order.
- Existing single-tool flows are unaffected (no extra events on turns with one server tool that completes the loop).
- Network tab on a chat POST shows the `event: tool_result` lines.

### Phase 2 — Append `tool_result` events to `wireMessagesRef` in the browser

**Files:**
- `packages/panels/pages/_components/agents/AiChatContext.tsx` — extend `turnState` with a `serverToolResults: WireMessage[]` buffer. Update the SSE parser to push to it on `tool_result` events. After the stream closes, when assembling `wireMessagesRef`, splice the server results in the right position relative to the assistant message and client tool results.
- `packages/panels/pages/_components/agents/sse/parseSSELines.ts` (or wherever the parser lives) — recognize the new event type.

**Subtlety:** the persisted state for a mixed-tool turn is:
```
[..., assistant{toolCalls=[A_client, B_server]}, tool{B result, toolCallId=B.id}]
```

The browser needs to build the same shape:
```
wireMessagesRef = [..., assistant{toolCalls=[A_client, B_server]}, tool{B result, toolCallId=B.id}, tool{A result, toolCallId=A.id}]
```

Persisted prefix length is N+2 (everything up to and including B's tool result). Continuation body length is N+3. Prefix indices `0..N+1` match exactly. Index N+2 (the client tool result) is the new tail — not prefix-compared. ✅

Implementation: in the SSE handler, every `tool_result` event for a server tool gets pushed to `wireMessagesRef.current` *immediately during the stream*, alongside the existing logic that pushes the assistant message. After the stream closes, the existing code that runs `executeClientTool(...)` and pushes client results runs unchanged — they naturally land at the tail.

**Acceptance:**
- A mixed-tool turn round-trips successfully. Smoke test: *"set the status to draft, bold the word 'Lorem' in the content, add a callToAction at the end with title 'Subscribe', and convert the first paragraph to an h1"* completes in one turn with both tools used and no 400.
- Existing client-only and server-only turns still work.
- The chat panel's "Updated X (toolname)" rendering still works for server tools (it now reads from the `tool_result` events instead of the existing `tool_call` events for finer-grained tracking).

### Phase 3 — Surface server tool results in chat UI parts

**Files:**
- `packages/panels/pages/_components/agents/AiChatPanel.tsx`, `AgentOutput.tsx` — add a `tool_result` part type to the chat message rendering OR repurpose the existing `tool_call` rendering to include the result inline once available.

**Note:** today the chat shows "Updated content (edit_text)" based on the `tool_call` event, with no result feedback. After Phase 1 the browser knows the result. Optional Phase 3 use it for status icons (✅ on success, ⚠️ if `applied < total`). Not strictly required for the bug fix but a nice UX win that falls out of the fix.

**Acceptance (optional):** users can see whether each tool call actually succeeded, not just that it was issued.

### Phase 4 — Tests + smoke verification

**New tests in `packages/panels/src/__tests__/`:**
- `chat-mixed-tools.test.ts` — fake AI provider returns one assistant message with two tool calls (one server, one client). Assert that:
  1. Server emits SSE events in order: `tool_call` × 2, `tool_result` × 1 (server), `pending_client_tools` × 1, `complete`.
  2. Persisted store after the first turn contains `[user, assistant, tool{server result}]`.
  3. Continuation post with the simulated client tool result passes the prefix check.
  4. Multi-turn after a mixed-tool turn still works (no leftover prefix corruption).

**Smoke (manual):**
- Run the load-bearing prompt from `chat-update-form-state-plan.md` Phase 5.
- Network tab shows two tool calls, two SSE `tool_result`-or-equivalent events for the server side, one for client side via continuation, and a final 200 with `complete{done:true}`.

### Phase 5 — Prompt rule reconsideration

After this plan ships, the hard rule in `ResourceChatContext.buildSystemPrompt` ("any formatting request MUST use update_form_state") stays — it's still right because `edit_text` has no formatting ops. But the *related* soft preference ("don't mix tools in one turn") that we *could* have added as a workaround for this bug is no longer needed and shouldn't be added.

**Acceptance:** confirm `ResourceChatContext.ts` doesn't grow a "never mix tools in a turn" rule. Mixed turns are now first-class.

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **`@rudderjs/ai` doesn't emit `tool-result` chunks today** and adding them is non-trivial because of streaming-vs-non-streaming code paths | Phase 0 verification. If non-trivial, Phase 0 expands to ~80 LOC of @rudderjs/ai changes. Most likely the chunk type already exists; the panels dispatcher just doesn't handle it. |
| **Ordering bug**: server emits `tool_result` BEFORE the assistant message that owns the tool call | Streaming chunk order in `@rudderjs/ai` should always be: text-delta* → tool-call* → tool-result* (per call execution) → next iteration. Verify in Phase 0. If wrong, buffer assistant/tool-call events on the browser until the streaming loop step finishes, then flush in correct order. |
| **`wireMessagesRef` corruption from out-of-order appends across recursive `runChatTurn` calls** | The recursion happens AFTER stream close, so per-stream ordering is sequential within a recursion. Don't share buffers across recursion levels — `turnState` is fresh per call. |
| **Browser-side display now duplicates entries** if Phase 3 also renders tool results inline | Phase 3 is optional. Skip until UX feedback says it's needed. |
| **Persistence diff in `persistContinuation`** — `bodyMessages.slice(persisted.length)` may now contain server results that the server already persisted in the previous turn | After this fix, server results from a *previous* turn are already in persisted at this point. The browser doesn't re-send them — it just sends fresh client tool results in the tail. `persistContinuation` slices the tail (which is only client results + new turn output) and appends. No double-persisting. |
| **Security regression**: wider continuation surface area = more places a malicious client could forge | The prefix check stays. Tool result content is still server-controlled (the browser replays *its own* results from the SSE log it received). The added attack surface is "lie about server tool results" — but those are persisted server-side first, so a forgery would 400 immediately on prefix check. No regression. |
| **Test fixtures need a fake provider that returns multi-tool steps** | The existing AI test infra (`packages/ai/src/index.test.ts`) already does this for `stop-on-client-tool` testing. Reuse that fixture style. |

---

## Files Touched

```
packages/ai/src/agent.ts                                                     ← maybe — Phase 0 verifies; emit `tool-result` chunk if missing
packages/ai/src/types.ts                                                     ← maybe — add chunk type if Phase 0 says to
packages/panels/src/handlers/chat/chatHandler.ts                             ← +1 case in SSE switch, ~10 LOC
packages/panels/pages/_components/agents/AiChatContext.tsx                   ← buffer + ordered append, ~50 LOC
packages/panels/pages/_components/agents/sse/parseSSELines.ts                ← recognize new event, ~10 LOC (file may not exist yet — parser is currently inline in AiChatContext)
packages/panels/pages/_components/agents/AiChatPanel.tsx                     ← optional Phase 3 result rendering
packages/panels/pages/_components/agents/AgentOutput.tsx                     ← optional Phase 3
packages/panels/src/__tests__/chat-mixed-tools.test.ts                       ← NEW — Phase 4 tests
docs/plans/mixed-tool-continuation-plan.md                                   ← this doc
~/.claude/projects/.../memory/project_continuation_array_args_bug.md         ← amend with cross-reference (separate bug, separate fix)
~/.claude/projects/.../memory/MEMORY.md                                      ← bump pointer if needed
```

---

## Future (out of scope)

- **Stateless browser continuation (Option C)** — `chat-stateless-continuation-plan.md`. Drop `wireMessagesRef` entirely; browser posts only the new tool results, server reconstructs the graph from persisted state. Eliminates prefix-check class of bugs. Build when motivated by a third bug in this area.
- **Streaming progress for in-flight server tools** — emit `tool-progress` chunks while a long-running server tool is executing (e.g. `Live.editText` over a multi-MB Y.Doc), so the chat shows a spinner per call. Independent of this plan.
- **Per-step undo for mixed-tool turns** — currently each tool call is its own atomic operation. Could offer "undo this entire turn" as a chat action that walks `result.steps` and reverses each tool result. Independent.
- **Tool result middleware** — let `@rudderjs/ai` middlewares observe tool results as they stream, not just at end of step. Useful for live observability. Independent.

---

## Acceptance Summary

This plan is DONE when:

- [x] `@rudderjs/ai` reliably emits a `tool-result` chunk per server-side tool execution (Phase 0 found it MISSING; added `'tool-result'` to `StreamChunk.type` union + `result?: unknown` field in `types.ts`, and yields at every result-producing branch in `runAgentLoopStreaming` — success, error, unknown-tool, approval-rejected, middleware-skip, client-tool-placeholder mode).
- [x] `chatHandler.ts` forwards `tool-result` chunks as `tool_result` SSE events with shape `{ id, tool, toolCallId, content }`. Stringification mirrors `persistence.ts` (string passthrough, otherwise `JSON.stringify`) so the wire `content` byte-equals what the store holds.
- [x] `AiChatContext.tsx` consumes `tool_result` SSE events. New `serverToolResults: WireMessage[]` buffer on `TurnState`; appended to `wireMessagesRef` immediately after the assistant message and before any post-stream client-tool execution. Also surfaced as inline `tool_result` parts in the assistant bubble.
- [ ] The smoke prompt *"set the status to draft, bold the word 'Lorem' in the content, add a callToAction at the end with title 'Subscribe', and convert the first paragraph to an h1"* completes in one turn with mixed `update_form_state` + `edit_text` calls and no HTTP 400. **Pending manual smoke** — code changes shipped; needs `pnpm build` from root + `pnpm rudder vendor:publish --tag=panels-pages --force` from `playground/` before browser code lands in dev.
- [x] `chat-mixed-tools.test.ts` exercises persistence shape, success-path continuation, regression-guard for the bug, and post-continuation ordering. 4 tests pass. All 615 panels tests green.
- [x] `ResourceChatContext.buildSystemPrompt` no longer contains the "DO NOT MIX TOOLS IN ONE TURN" rule. Surrounding `edit_text` vs `update_form_state` guidance kept (still right because `edit_text` has no formatting ops).
- [x] Memory updated — `project_continuation_array_args_bug.md` and `reference_docs_plans.md` both flipped to DONE; `feedback_resourceagent_write_tools.md` already covers tool-picking guidance and needed no changes.

## Implementation notes (added on completion 2026-04-08)

**Surprises:**

1. The post-execute `yield { type: 'tool-call' }` in the streaming agent loop (`agent.ts:795/800/816/847`) duplicates the `tool-call` chunks the provider already streamed during `streamSource` consumption. Suspicious but pre-existing — left untouched. Worth a separate cleanup if it causes double-rendering of tool call cards.
2. The `ChatMessagePart` union in `AiChatContext.tsx` already had a `tool_result` variant from prior work, so no rendering changes were needed downstream — the new `case 'tool_result':` branch just constructs that part directly.
3. The bug only affects mixed-tool turns *with continuation*. When a turn has only server tools (no client tools), nothing re-POSTs — `wireMessagesRef` is touched but unused until the next user prompt sends a fresh message body. So the new `serverToolResults` append is a no-op in that path; it's free correctness for the case where the next continuation does happen.

**Files actually touched:**

```
packages/ai/src/types.ts                                                     ← +5 LOC (tool-result chunk type + result field)
packages/ai/src/agent.ts                                                     ← +20 LOC (yield tool-result at 6 branches in runAgentLoopStreaming)
packages/panels/src/handlers/chat/chatHandler.ts                             ← +13 LOC (case 'tool-result' in SSE switch)
packages/panels/src/handlers/chat/contexts/ResourceChatContext.ts            ← -1 LOC (removed workaround prompt rule)
packages/panels/pages/_components/agents/AiChatContext.tsx                   ← +40 LOC (TurnState buffer + parser case + wire-log splice)
packages/panels/src/__tests__/chat-mixed-tools.test.ts                       ← NEW, 165 LOC, 4 tests
docs/plans/mixed-tool-continuation-plan.md                                   ← this doc (status DONE + completion notes)
~/.claude/projects/.../memory/project_continuation_array_args_bug.md         ← updated to mark mixed-tool case resolved
~/.claude/projects/.../memory/reference_docs_plans.md                        ← entry 11 flipped to DONE
```

Total: ~245 LOC including tests. No changes to `runAgentLoopNonStreaming` (out of scope — this plan is streaming-only). No changes to `runForceAgent` branch in `chatHandler.ts` (not in the bug's path — no continuation). Phase 3 (UI status icons on tool result parts) skipped as optional.
