# Sub-agent approval suspend/resume in `Agent.asTool`

> **Filed by:** pilotiq side, 2026-05-10. Cross-repo blocker for `@pilotiq-pro/ai` Phase 2.5.

## Problem

`@rudderjs/ai@1.4.0` extended `Agent.asTool({ streaming, suspendable })` so a sub-agent that pauses on a **client tool** (`finishReason === 'client_tool_calls'`) can persist a `SubAgentRunSnapshot` and propagate `pauseForClientTools` upward through the parent loop. The parent halts, the host emits `pending_client_tools` via SSE, the browser executes them and POSTs `/continue`, the host calls `Agent.resumeAsTool(subRunId, results, { runStore, agent })`, the inner loop continues.

**Approval-gated tools have no equivalent path.** When the inner agent's loop pauses with `finishReason === 'tool_approval_required'`, today:

- The inner stream emits a `pending-approval` chunk. The default `streaming` projection ignores it, so the parent stream surfaces nothing — the renderer can't show "approval needed."
- The `suspendable` branch only checks `finishReason === 'client_tool_calls'`, so no snapshot is persisted.
- The async-generator `.server()` falls through, yields `agent_done`, and returns the partial `AgentResponse`. The parent model sees the inner agent "completed" with empty/partial text and continues — usually with hallucinated downstream behaviour.

Net effect: any sub-agent that uses `.requireApproval(true)` (the consumer-side knob shipped in `@pilotiq-pro/ai` Phase 3) is broken end-to-end. Approval-pause is silently lost; approve/reject from the UI doesn't reach the inner loop because there's no snapshot to resume.

## Why this can't be solved consumer-side

- The parent agent loop only halts on a `pauseForClientTools` chunk. Without an analog `pauseForApproval` (or generalisation), there's no way for an `asTool` server fn to stop the parent for an inner approval.
- Abusing `pauseForClientTools` with the inner approval-call as a "fake client tool" forces the browser's `pending_client_tools` handler to try `executeClientTool` on a tool that isn't registered — produces an error path rather than an approval card. Wire-shape collision.
- Snapshot reconstruction via the inner steps + `approvedToolCallIds` injection on resume is generic plumbing — every host running approval-gated sub-agents will reproduce it. Belongs upstream alongside the existing client-tool suspend.

## Proposed fix

Extend `Agent.asTool({ streaming, suspendable })` and `Agent.resumeAsTool(...)` to handle `tool_approval_required` symmetrically with `client_tool_calls`. Three pieces:

### 1. Inner-stream projection: emit `agent_pending_approval`

Add a new `SubAgentUpdate` kind:

```ts
type SubAgentUpdate =
  | …
  | { kind: 'agent_pending_approval'; toolCall: ToolCall; isClientTool: boolean }
```

The default streaming projection translates the inner stream's `pending-approval` chunk to this update, so renderers can surface the approval-needed state immediately (analogous to how `tool_call` chunks become `tool_call` updates).

### 2. Suspend on approval-pause

When the inner loop ends with `finishReason === 'tool_approval_required'` AND `suspendable.runStore` is set:

```ts
if (result.finishReason === 'tool_approval_required' && result.pendingApprovalToolCall) {
  const subRunId = generateSubRunId()
  const snapshot: SubAgentRunSnapshot = {
    messages:           buildSubAgentSnapshotMessages(userPrompt, result),
    pendingToolCallIds: [result.pendingApprovalToolCall.id],   // single id, the gated call
    stepsSoFar:         result.steps.length,
    tokensSoFar:        result.usage?.totalTokens ?? 0,
    pauseKind:          'approval',                            // NEW — discriminator
  }
  await suspendable.runStore.store(subRunId, snapshot)

  yield { kind: 'subagent_paused_approval', subRunId, toolCall: result.pendingApprovalToolCall, isClientTool: result.pendingApprovalIsClientTool }
  yield pauseForApproval(result.pendingApprovalToolCall, subRunId)   // NEW chunk type
  return undefined as never
}
```

The `pauseForApproval` chunk is analogous to `pauseForClientTools`: the parent loop's chunk iterator recognizes it (`isPauseForApprovalChunk`), records `loopFinishReason = 'tool_approval_required'` with the inner call payload, and halts iteration. The host's chat handler then emits a `tool_approval_required` SSE event keyed to the inner toolCall + the parent's `run_agent` toolCallId so the renderer can claim it.

### 3. Resume with approval

`Agent.resumeAsTool(subRunId, [], { runStore, agent, approvedToolCallIds: ['<inner-id>'] })`:

```ts
static async resumeAsTool(
  subRunId, clientToolResults,
  options: { runStore, agent, approvedToolCallIds?: string[] }
) {
  const snap = await runStore.consume(subRunId)
  if (!snap) throw …

  // Existing forgery guard for clientToolResults …

  const messages = appendToolResults(snap.messages, clientToolResults)
  const result = await options.agent.prompt('', {
    messages,
    toolCallStreamingMode: 'stop-on-client-tool',
    approvedToolCallIds: options.approvedToolCallIds,
  })
  …
}
```

The host wires `body.approvedToolCallIds` (already accepted at the parent level today) through to the resume call. The browser's continuation request shape grows naturally: `{ subRuns: [{ subRunId, toolResults: [], approvedToolCallIds: ['inner-id'] }] }`.

If the user **rejects** the approval, the host calls `resumeAsTool` with `rejectedToolCallIds: [...]` instead, and the inner loop terminates the gated tool with the standard rejection result.

## Snapshot shape extension

```ts
export interface SubAgentRunSnapshot {
  messages:           AiMessage[]
  pendingToolCallIds: string[]                  // existing — for client-tool pause
  stepsSoFar:         number
  tokensSoFar:        number
  meta?:              unknown
  pauseKind?:         'client_tool' | 'approval'  // NEW
}
```

`pauseKind` defaults to `'client_tool'` for back-compat. Resume uses it to decide whether to expect tool-result messages or to inject `approvedToolCallIds`.

## Tests to add

- `asTool-approval-suspend.test.ts` — sub-agent's approval-gated tool pauses; host gets `pauseForApproval` chunk; snapshot round-trips with `pauseKind: 'approval'`.
- `asTool-approval-resume.test.ts` — `resumeAsTool` with `approvedToolCallIds` runs the gated tool to completion; pause-again on a second approval gate works; rejection terminates cleanly.

## Pilotiq-pro consumer migration after this lands

Phase 2.5 of `@pilotiq-pro/ai` is parked waiting on this. Migration shape:

1. Bump `@rudderjs/ai` peer-dep to the version that ships `pauseForApproval` + `pauseKind`.
2. `runAgentTool.ts`: handle `pending-approval` chunks during the initial run (yield the new `agent_pending_approval` update kind); on `result.finishReason === 'tool_approval_required'`, snapshot via `runStore.store` with `pauseKind: 'approval'` + yield `pauseForApproval`.
3. `subAgentResume.ts`: detect `snapshot.pauseKind === 'approval'` and pass `approvedToolCallIds` from the resume body into the resume call.
4. `chatHandler.ts`: extend `body.subRuns[i]` shape to include optional `approvedToolCallIds`.
5. `agentRunRenderer.tsx`: render an inline approval card when `agent_pending_approval` updates land. Approve/reject buttons use existing `useAiChat().approvePending/rejectPending`.

Net consumer-side change: ~+50 LOC of plumbing; no new persistence, no new wire shapes outside the snapshot's `pauseKind` discriminator.

## Open questions

1. Should `pauseForApproval` carry multiple toolCalls (parallel approval batching) like `pauseForClientTools` does, or always single? The inner loop's `pending-approval` chunk currently surfaces one tool at a time; batching would require the loop to defer until all parallel approval gates fire, which conflicts with the streaming projection's "yield as you go" cadence. **Suggest single-call.**
2. Does `runStore.consume` need a "peek" variant for approval-pause cases where we want to compute the resume body without consuming the entry? Probably not — the resume request is the consume trigger, same as client-tool flow.
3. Naming: `agent_pending_approval` vs `subagent_paused_approval` for the pause-emit. The first is "look, an approval is pending"; the second is "I am paused, here's the resume handle." Suggest **both** — `agent_pending_approval` during stream iteration (informational), `subagent_paused_approval` at the suspend boundary (carries `subRunId`). Mirrors the `tool_call` / `subagent_paused` split that already works for client tools.
