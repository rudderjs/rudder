# Sub-Agent Client Tools Plan

Make client tools (`update_form_state`, `read_form_state`, any future `.client()` tool) work when invoked from a sub-agent run through the chat-level `run_agent` tool. Today they silently no-op, because a sub-agent running inside the parent loop can't suspend → bounce to the browser → resume.

**Status:** DRAFT 2026-04-09.

**Packages affected:** `@rudderjs/ai` (optional — depends on chosen approach), `@rudderjs/panels` (runAgentTool, chat continuation, runStore, chatHandler)

**Depends on:**
- `ai-loop-parity-plan.md` (DONE 2026-04-09) — async-generator tool executes + `tool-update` chunk wiring. This plan reuses the same generator-yield protocol for pause-and-resume control signals.
- `standalone-client-tools-plan.md` (DONE 2026-04-08) — single-level client-tool round-trip + runStore pattern. This plan generalizes runStore to nested runs.
- `mixed-tool-continuation-plan.md` (DONE 2026-04-08) — mixed server/client continuation prefix validation. Nested runs have to survive this check too.

**Related memory:** `bug_subagent_client_tools.md`, `project_ai_loop_parity.md`, `reference_panels_ai_surfaces.md`

---

## Goal

After this plan, the following works end-to-end in the panels chat:

1. User asks the chat agent "improve the meta title."
2. Chat agent calls `run_agent(seo)`.
3. Sub-agent `seo` calls `update_form_state({ field: 'metaTitle', ... })`.
4. The client-tool call **bubbles up** to the outer chat SSE as a `pending_client_tools` event.
5. Browser executes the client tool against its live React form state — the title input visibly updates.
6. Browser POSTs to `/continue` with the tool result.
7. Continuation **resumes the sub-agent**, not the parent, with the result injected.
8. Sub-agent completes. Its final summary flows back into the parent chat as the `run_agent` tool result.
9. Parent chat agent's loop resumes, streams the final assistant text, done.

Across this flow the browser sees exactly the same SSE event sequence it sees today for single-level client tools — no new event types the UI has to learn. Nesting is invisible to the client.

**Reference failure (current):** seen in the playground 2026-04-09, chat dispatches `improve-content` sub-agent via `run_agent`. Sub-agent calls `update_form_state({ field: 'title', ... })`. Loop runs in placeholder mode (no server executor, no suspension), returns `{applied:1}` to the sub-agent, sub-agent reports "title has been improved to …," UI never changes.

---

## Non-Goals

- **Arbitrary N-level nesting.** This plan handles exactly one level of nesting (chat → run_agent → sub-agent). Nested `run_agent`-inside-`run_agent` remains unsupported; the sub-agent toolkit does not include `run_agent` today, so this is enforced by omission.
- **Cross-request sub-agent streaming.** Mid-run text-deltas from a suspended sub-agent are not replayed on resume. The browser sees sub-agent progress (`tool_call`, `tool_update`, `agent_start`) only for steps the sub-agent actually executes in a given request.
- **New client-tool semantics.** Client tools keep their current contract: no `.server()`, browser executes against React/Lexical state, returns a JSON result. This plan changes only the *plumbing* between sub-agent and browser.
- **Approval gates inside sub-agents.** `pending-approval` from a sub-agent is out of scope (but noted as future work — the same suspension mechanism applies).
- **Persisted sub-run recovery across sessions.** Sub-run state lives in the same cache-backed runStore as top-level runs, with the same 5-minute TTL. No durable persistence.
- **Refactoring PanelAgent into a reusable "agent-with-pausable-toolkit" class.** The fix lives in `runAgentTool` + chat continuation glue.

---

## Background

### Today's single-level client-tool flow

1. `chatHandler.ts` builds an agent with the chat toolkit (includes `update_form_state` as a client tool) and calls `a.stream(input, { toolCallStreamingMode: 'stop-on-client-tool', ... })`.
2. `@rudderjs/ai` runs the loop. When the model emits a call to a client tool, the loop yields `'pending-client-tools'` and the stream ends. `response` resolves with `finishReason: 'client_tool_calls'`.
3. `streamAgentToSSE` (`agentStream/index.ts:96`) forwards that chunk as a `pending_client_tools` SSE event.
4. Browser executes the tools, POSTs to `/continue` with `{ messages, runId? }`.
5. `continuation.ts` validates the message prefix against the persisted history, then `chatHandler.ts` calls `a.stream('', { messages, toolCallStreamingMode: 'stop-on-client-tool', approvedToolCallIds, rejectedToolCallIds })`.
6. Agent re-runs from the appended message graph, picks up where the prior step left off.

Chat path stores nothing server-side between pauses — state is the persisted `messages` array in the conversation store. Standalone path (`agentRun.ts`) uses the same mechanism plus a `runStore` keyed by `runId` for fieldScope / selection metadata that doesn't round-trip through messages.

### Where it breaks for sub-agents

`runAgentTool.ts:86` calls `targetAgent.stream(agentCtx, message)` **without** `toolCallStreamingMode`. Two consequences:

1. The sub-agent loop tries to execute the client tool locally. There's no `.server()`, so `@rudderjs/ai` either runs it in placeholder mode (returning a stub success) or errors. Either way the browser never sees the call.
2. Even if we passed `stop-on-client-tool`, there's nowhere for the resulting `pending-client-tools` chunk to *go*: `runAgentTool`'s generator iterates `agentStream` and yields only `tool_call` progress updates (`runAgentTool.ts:89-97`). A `pending-client-tools` chunk from the sub-agent would be dropped, and the sub-agent's `response` promise would deadlock waiting for tool results that never arrive — hanging the parent loop.

The mismatch is **control-flow inversion**. Client tools need the call site to be "outside" the agent loop. Today sub-agents run "inside" a server tool's execute, which itself runs "inside" the parent agent loop. To make it work, pausing has to propagate outward through two loop layers.

---

## Architecture

### Chosen approach — server-side sub-run state + continuation dispatch

**Core idea:** treat the sub-agent's suspended state as a first-class object in the runStore. When the chat `/continue` endpoint sees pending client-tool results, it asks the runStore "was this pause from a sub-agent?"; if yes, it resumes the sub-agent first, then feeds its final result into the parent's message history and drives the parent loop from there.

From the browser's perspective, nothing changes. From `@rudderjs/ai`'s perspective, nothing changes — there is no new agent-level API. All the new logic lives in panels' `runAgentTool` + `chatHandler` + runStore.

### Data flow on initial pause

```
browser → POST /admin/api/chat { message: "improve meta title" }
  chatHandler
    → agent.stream(msg, { mode: stop-on-client-tool })
      → parent model calls run_agent(seo)
      → runAgentTool.execute runs
        → subAgent.stream(ctx, subMsg, { mode: stop-on-client-tool })
          → sub model calls update_form_state(...)
          → sub-agent yields 'pending-client-tools' + ends stream
        → runAgentTool detects sub-pause:
          • store sub-run state in runStore
              { kind: 'subagent',
                parentRunId,
                subAgentSlug,
                subMessages,     // sub-agent message history up to pause
                agentCtxSnapshot,
                pendingToolCalls,
              }
          • yield { kind: 'delegate-client-tools', subRunId, toolCalls: [...] }
          • return early from the generator with a sentinel result
      → runAgentTool's execute resolves with PENDING_SUBAGENT sentinel
      → parent loop sees PENDING_SUBAGENT as the tool result
      → parent loop short-circuits: emits 'pending-client-tools' on ITS stream,
        finishReason = 'client_tool_calls'
  chatHandler → streamAgentToSSE
    → forwards sub-agent's pending-client-tools as parent-level pending_client_tools
    → final SSE: { done: false, awaiting: 'client_tools', subRunId }
browser: executes tools, POSTs /continue { messages, subRunId? }
```

**Where the "delegation" lives in the parent message history:** the parent's last assistant message has the `run_agent` tool call. Its tool result in the parent messages is *deferred* — the parent loop doesn't append a `{ role: 'tool', toolCallId: runAgentCallId, content: ... }` message until the sub-run actually completes. On pause, no tool-result message is written for `run_agent`; the chat's persisted history ends at the assistant's tool-call message, and the conversation store carries a `subRunId` alongside the normal `runId`.

### Data flow on continuation

```
browser → POST /continue { messages, subRunId: 'abc...' }
  continuation.ts
    → detects subRunId in body
    → loads sub-run state from runStore(subRunId)
    → validates: messages ending with tool-result messages
      whose toolCallIds match subRunState.pendingToolCalls
  chatHandler.continueSubRun
    → rebuild sub-agent from subAgentSlug + agentCtxSnapshot
    → subMessages' = subMessages ∪ {tool-result messages from request}
    → subAgent.stream('', { messages: subMessages', mode: stop-on-client-tool,
                            approvedToolCallIds, rejectedToolCallIds })
    → drive loop:
      (a) sub-agent pauses again on another client tool
          → re-store state, re-emit pending_client_tools, done
      (b) sub-agent completes
          → collect final text + usage
          → build run_agent tool result: { label, text, steps, tokens }
          → append { role: 'tool', toolCallId: runAgentCallId, content } to PARENT messages
          → delete sub-run from runStore
          → resume PARENT agent loop:
              parentAgent.stream('', { messages: parentMessagesWithToolResult,
                                       mode: stop-on-client-tool })
          → parent streams final assistant text
          → emit final `complete` SSE
```

The continuation endpoint becomes a small state machine:
- `subRunId` present → resume sub-run first. If it finishes, fall through to parent loop. If it pauses again, return.
- `subRunId` absent → existing behavior (resume parent loop directly).

### Why not the alternatives

- **"Parent does writes" pattern (option B from the chat).** Loses sub-agent autonomy; every resource author has to hand-craft pass-through logic. Breaks the "PanelAgent is a self-contained loop" model.
- **"Strip client tools from sub-agent toolkits" pattern (option C).** Doesn't solve it for non-collab fields (the exact case we hit). Would regress the design decision to make `update_form_state` the universal write path.
- **"Inline the sub-agent into the parent".** Conceptually elegant — run the sub-agent as a sub-step of the parent loop, not as a separate loop — but requires invasive changes to `@rudderjs/ai` to support "spawn a scoped sub-loop with its own system prompt + toolkit." That's a bigger plan than this one.
- **New `@rudderjs/ai` sentinel chunk (`delegate-client-tools`).** I considered adding a first-class `'delegate-client-tools'` chunk type to `@rudderjs/ai` so the parent loop natively understands "propagate my child's pause." Rejected for this iteration because it pushes panels-specific nesting semantics into `@rudderjs/ai`; we can achieve the same effect by returning a sentinel value from `runAgentTool.execute` that the parent loop treats as a synthetic pause. Revisit if a second nesting site appears outside panels.

---

## Phases

### Phase 1 — runStore schema extension

Generalize `runStore` (`packages/panels/src/handlers/agentRun/runStore.ts`) to carry sub-run records.

Shape:
```ts
type SubRunState = {
  kind:             'subagent'
  parentRunId?:     string              // chat doesn't use a top-level runId, may be undefined
  parentToolCallId: string              // the run_agent call id in the parent messages
  subAgentSlug:     string
  agentCtx:         PanelAgentContext   // snapshot — record, resourceSlug, recordId, fieldMeta, fieldScope
  subMessages:      AiMessage[]         // sub-agent history up to pause
  pendingToolCalls: Array<{ id: string; name: string }>
  createdAt:        number
}
```

Store/consume/load helpers identical to existing runStore; TTL 5 minutes.

**Verification:** unit test — store a SubRunState, consume by subRunId, assert round-trip.

### Phase 2 — runAgentTool suspension path

Update `runAgentTool.ts`:

1. Pass `toolCallStreamingMode: 'stop-on-client-tool'` to `targetAgent.stream(...)`.
2. Watch the sub-agent stream for `'pending-client-tools'` chunks.
3. On detection:
   - Snapshot sub-agent messages from `(await agentResponse).messages` (or equivalent — confirm during implementation; may require an extra `.stream()` opts flag to expose interim messages, or use `response.steps`).
   - Generate `subRunId`, store `SubRunState`.
   - Return a `PENDING_SUBAGENT` sentinel as the tool result:
     ```ts
     { __pendingSubAgent: true, subRunId, toolCalls: [...] }
     ```
   - The async-generator `execute` `return`s (not `throw`s) so the parent loop's `await gen.next()` resolves normally.
4. `.modelOutput` is bypassed for the sentinel (it's not a real result); add a typeguard.

**Complication:** the parent `@rudderjs/ai` loop will try to JSON-serialize the sentinel and pass it to the model as a tool result. We need to intercept earlier. Options:

- (a) Have `runAgentTool.execute` `throw` a typed `SubAgentPendingClientTools` error. Parent loop's tool-execute wrapper catches typed errors and can re-emit a pending-client-tools chunk. Requires a `@rudderjs/ai` extension point.
- (b) Add a first-class `'pending-client-tools'` chunk type to the server-tool generator protocol so the tool's generator can directly yield "propagate my pause" to the parent loop. Smallest surface change in `@rudderjs/ai`; same shape as ai-loop-parity Phase 1's `tool-update` chunks.

**Decision during implementation:** pick (b) if it's a <30-line change in `@rudderjs/ai`; otherwise (a). Log the decision in the plan's DONE note.

**Verification:** unit test against a mock sub-agent that yields a fake pending-client-tools chunk. Assert parent loop emits pending-client-tools on its own stream, and SubRunState is stored.

### Phase 3 — chat /continue sub-run dispatch

Extend `continuation.ts` + `chatHandler.ts`:

1. On `/continue`, check `body.subRunId`. If present, load SubRunState.
2. Validate request messages contain tool-result messages for every `pendingToolCalls` id (reuse existing mixed-tool continuation validator).
3. Rebuild the sub-agent: look up `resource.agents()` by `subAgentSlug`, re-hydrate `agentCtx` from the snapshot.
4. Append incoming tool-result messages to `subMessages`.
5. Call `subAgent.stream('', { messages: subMessages', mode: stop-on-client-tool, approvedToolCallIds, rejectedToolCallIds })`.
6. Pipe the sub-agent's new chunks to the parent SSE wire via `streamAgentToSSE`, but **relabel** `agent_start`/`agent_complete` semantics — the browser's `agentRunRenderer` should keep updating the same run-agent tool card, not start a fresh one.
7. Branch on sub-agent outcome:
   - **Paused again** — re-store sub-run, emit a fresh `pending_client_tools` SSE with the new `subRunId`, final `complete` with `done:false, awaiting:'client_tools'`. Done.
   - **Completed** — delete sub-run from runStore. Build the `run_agent` tool result (`{ label, text, steps, tokens }`), apply `.modelOutput()`. Append as `{ role: 'tool', toolCallId: parentToolCallId, content: JSON.stringify(result) }` to the parent message history. Then call `parentAgent.stream('', { messages: parentMessages' })` to drive the parent loop forward.
8. Parent loop runs normally from there — may itself pause again (e.g., if the parent's next step calls another client tool), in which case the normal single-level path handles it.

**Verification:** playground end-to-end. `improve-content` sub-agent edits both `title` (non-collab) and `content` (RichContentField). Title field visibly updates in the form. Network tab shows one initial POST + one `/continue` with `subRunId`, followed by normal streaming.

### Phase 4 — UI continuity for the sub-agent card

`AiChatPanel.tsx` already registers `agentRunRenderer` against `run_agent` (ai-loop-parity Phase 4). Check that:

- The pending_client_tools emission from inside a sub-agent does not replace the `agentRunRenderer` card with a separate `update_form_state` card. Behavior we want: the `run_agent` card shows "awaiting browser approval" inline, the browser executes the client tools, the card continues updating as the sub-agent resumes.
- Sub-agent `tool_call` chunks for the client tool still show up as rows inside the agent card.
- On final completion, the card shows the sub-agent's full step list, including the client-tool rows, and the `agent_complete` totals are correct (includes post-resume steps).

**Verification:** manual. Record a GIF of the full flow for the plan DONE note.

### Phase 5 — Documentation + memory

1. Update `bug_subagent_client_tools.md` memory: mark as FIXED with plan reference.
2. Update `reference_panels_ai_surfaces.md`: add "sub-agent client-tool suspension" as a fourth AI surface wrinkle.
3. Add a section to `packages/panels/README.md` under "AI / Agents" describing sub-agent client-tool semantics (one paragraph — devs authoring resource agents should know that sub-agents can now use `update_form_state`).
4. Update `docs/plans/ai-loop-parity-plan.md` — remove the "Surfaced (NOT fixed)" note about this bug, link to this plan.

---

## Risks

- **R1: `@rudderjs/ai` extension for propagating sub-pauses.** If Phase 2 ends up requiring invasive changes to the agent loop (option (a) above), the scope doubles. **Mitigation:** prototype option (b) first — yielding a `pending-client-tools` chunk from a server tool generator is conceptually symmetric to yielding a `tool-update` chunk, and the forwarding machinery already exists. If it takes more than a morning, escalate and split into a `@rudderjs/ai` sub-plan.

- **R2: Continuation prefix validation.** `mixed-tool-continuation-plan.md`'s prefix check assumes the parent message history is linear. Nesting injects sub-agent messages that don't belong in the parent history at all. **Mitigation:** do NOT include sub-agent messages in the parent conversation store. The parent history skips directly from the `run_agent` tool call to the eventual tool result (once the sub-agent completes). Sub-agent messages live only in `SubRunState.subMessages` while suspended.

- **R3: Runaway state on browser abandonment.** If the user closes the tab mid-pause, the SubRunState lingers until the 5-minute TTL. No worse than the existing standalone runStore — same cleanup path.

- **R4: Steps/tokens accounting.** The sub-agent's `response.steps` and `usage` need to accumulate across pauses. `@rudderjs/ai`'s stream response resets per `.stream()` call. **Mitigation:** accumulate `stepsSoFar` and `tokensSoFar` in `SubRunState`, add to each resume, report the sum in the final `run_agent` tool result. Add a unit test asserting totals match a non-paused single-call baseline.

- **R5: Selection mode + sub-agents.** Selection mode (`feedback_chat_selection_mode_prompt.md`) is chat-only today. A sub-agent doesn't inherit the selection context — out of scope here, but document it in Phase 5 so nobody is surprised.

- **R6: PanelAgentContext snapshot is stale on resume.** The `record` in `agentCtx` is a snapshot taken at initial dispatch time; by the time the browser returns from executing client tools, the record could have been mutated. **Mitigation:** on resume, re-load the record from the model + overlay Yjs (same logic as `ResourceChatContext.create`) and rebuild `agentCtx` from fresh data. Do NOT reuse the stored snapshot for the record field — store only the slug/id and rehydrate.

- **R7: "run_agent inside sub-agent" (double nesting).** PanelAgent's default toolkit doesn't include `run_agent`, so this can't happen via the fluent API. But if a future `.tools([runAgentTool])` customization adds it, two levels of nesting will break. Add a guard: if `SubRunState.kind === 'subagent'` on the runStore store path and the sub-agent itself tries to pause on another sub-agent, throw a descriptive error.

- **R8: Approval gates in sub-agents.** `pending-approval` chunks from sub-agents are out of scope (non-goal). Log a `console.warn` + drop the chunk for now, with a `TODO(subagent-approvals)` comment.

---

## Verification

End-to-end: the exact scenario from `bug_subagent_client_tools.md`.

1. Playground, `articles` resource, open a record in edit mode.
2. Chat: "improve this article".
3. Chat agent calls `run_agent(improve-content)`.
4. Sub-agent reads form state, emits `update_form_state` for `title` and `content`.
5. Browser actually updates both fields — title input visibly changes.
6. Sub-agent resumes, emits `agent_complete`.
7. Parent chat streams final summary text.
8. Refresh the browser — saved values persist (assuming user hit Save, or the form state changes trigger autosave).

Unit tests:
- runStore SubRunState round-trip (Phase 1).
- runAgentTool suspension emits pending-client-tools chunk (Phase 2).
- continuation.ts dispatches to sub-run when subRunId present (Phase 3).
- Totals accounting across one pause + resume (R4).
- Double-nesting rejection (R7).

Regression tests:
- The existing `slow-search-test` smoke agent still works (no client tools, no suspension).
- The existing `seo` resource agent (`metaTitle`/`metaDescription`, both non-collab) works end-to-end via the chat — today this breaks silently; plan fixes it.
- Standalone field actions (`rewrite`, `shorten`, etc. from the ✦ dropdown) still work — they don't go through `run_agent`, so this plan should not touch them.
- Single-level chat client tools still work.

Manual:
- Cancel the browser mid-pause. Expect SubRunState to expire cleanly after TTL; no zombie runs.
- Sub-agent that pauses twice (two separate client-tool rounds in one sub-run). Expect two /continue calls with different `subRunId`s both dispatched through the sub-run path.

---

## Resolved — `@rudderjs/ai` surface area needed

Researched against `packages/ai/src/` on 2026-04-09. Concrete answers below; no blocking unknowns remain.

### R-OQ1 — Capturing sub-agent messages at pause time

**Answer: already possible via `response.steps`, no new API needed.**

- `AgentResponse.messages` does NOT exist as a field (`types.ts:376-394`). The response exposes `text`, `steps`, `usage`, `finishReason`, `pendingClientToolCalls`, etc.
- However, each `AgentStep` in `response.steps` carries a `message: AiMessage` field (`types.ts:359-365`). The full sub-agent history at pause time can be reconstructed as `response.steps.map(s => s.message)`.
- `runAgentLoopStreaming` resolves the `response` Promise at pause time: it breaks the loop on `stopForClientTools` (`agent.ts:926`), yields `pending-client-tools` (`agent.ts:949`), then calls `resolveResponse!(result)` (`agent.ts:965`) with `finishReason: 'client_tool_calls'` and the accumulated `steps` array.
- **Implication for Phase 2:** `runAgentTool` can `await agentResponse` immediately after the stream ends — the Promise is already settled at that moment — and snapshot messages via `response.steps.map(s => s.message)`. No `@rudderjs/ai` changes required for this concern.

### R-OQ2 — Threading `parentToolCallId` into the sub-agent execute

**Answer: requires a small `@rudderjs/ai` API addition — optional `ToolCallContext` second arg to `ToolExecuteFn`.**

- Current signature (`types.ts:224-228`): `(input: TInput) => TOutput | Promise<TOutput> | AsyncGenerator<TUpdate, TOutput, void>`.
- The loop calls `execute(args)` with no second argument (`agent.ts:1107` inside `executeMaybeStreaming`). No existing context object is passed.
- The call site *does* know the current `toolCall.id` — it's threaded from `runAgentLoop` (`agent.ts:548`) and `runAgentLoopStreaming` (`agent.ts:868`) into `executeMaybeStreaming`.
- **Change needed:**
  1. Extend `ToolExecuteFn` to accept an optional second arg: `(input: TInput, ctx?: ToolCallContext) => ...`
  2. Define `ToolCallContext = { toolCallId: string }` in `types.ts` (start minimal; add fields later as needed).
  3. Pass `{ toolCallId: toolCall.id }` from `executeMaybeStreaming` into the execute call.
  4. Optional context — existing tools with single-arg signatures continue to work (TypeScript variance on contravariant params allows this).
- This is ~15-20 LOC in `@rudderjs/ai`, non-breaking. Worth doing cleanly as a reusable API rather than hacking around it.

### R-OQ3 — Is `AgentResponse` resolved at pause time?

**Answer: yes, fully resolved.**

- Same citation chain as R-OQ1: `resolveResponse!(result)` fires at `agent.ts:965`, immediately after the pause-inducing break at `:926` and the final `pending-client-tools` yield at `:949`.
- `finishReason === 'client_tool_calls'` at that point; `steps` contains all `AgentStep` entries up to the pause; `pendingClientToolCalls` lists the calls the browser needs to execute.
- **Implication for Phase 2:** `runAgentTool`'s pause-detection code just does `const res = await agentResponse; if (res.finishReason === 'client_tool_calls') { ... snapshot & store ... }` — no polling, no interim-state plumbing. The stream ending *is* the signal; awaiting the response gives us everything we need.

### Net impact on the plan

- **Phase 2 simplified:** no need for a new `StreamChunk` variant. The pause detection is just `response.finishReason === 'client_tool_calls'` after the sub-agent's stream ends. Sub-agent messages come from `response.steps`.
- **New mini-phase 0:** add `ToolCallContext` to `@rudderjs/ai`'s `ToolExecuteFn` signature + pass it from the loop. Ship this as its own small PR ahead of Phase 1 so it's independently reviewable.
- **Risk R1 downgraded:** originally "may need invasive `@rudderjs/ai` changes." Actually ~20 LOC in one file. No longer a serious risk.

### Revised phase order

- **Phase 0 (new):** `@rudderjs/ai` — add optional `ToolCallContext` second arg to `ToolExecuteFn`, wire it from `executeMaybeStreaming` call sites. Unit test: a tool that records its toolCallId via the context arg and asserts it matches the call site's id.
- **Phase 1:** `runStore` schema extension (unchanged).
- **Phase 2:** `runAgentTool` suspension path — now straightforward:
  - Pass `toolCallStreamingMode: 'stop-on-client-tool'` to `subAgent.stream(...)`.
  - Consume the stream as before for progress chunks.
  - After the loop: `const res = await agentResponse`. If `res.finishReason === 'client_tool_calls'`:
    - `const subMessages = res.steps.map(s => s.message)`
    - `const pendingToolCalls = res.pendingClientToolCalls ?? []`
    - `const parentToolCallId = ctx.toolCallId` (from the new `ToolCallContext`)
    - Store `SubRunState` in runStore with a fresh `subRunId`.
    - Return a sentinel result `{ __subAgentPaused: true, subRunId, pendingToolCalls }`.
  - The parent loop receives this sentinel. We still need to intercept it somewhere before `.modelOutput()` stringifies it for the next model step.
- **Phase 2b (new, small):** sentinel interception. Two sub-options:
  - **(i)** Check for `__subAgentPaused` in `runAgentTool`'s `.modelOutput()` and throw a typed error; the parent loop's tool-execute wrapper catches typed errors → re-emits `pending-client-tools` on the parent stream → resolves its own `response` with `finishReason: 'client_tool_calls'`.
  - **(ii)** Add a first-class "propagate pause" mechanism to `@rudderjs/ai`: when a server tool returns a value carrying `__subAgentPaused: true`, the loop treats it as synthetic client-tool calls on the parent level.
  - **Decision:** ship (i) first — it's panels-local, no `@rudderjs/ai` changes beyond Phase 0. Revisit (ii) if a second nesting site appears.
- **Phases 3, 4, 5:** unchanged.
