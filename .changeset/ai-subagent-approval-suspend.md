---
'@rudderjs/ai': minor
---

`Agent.asTool({ suspendable })` — symmetric pause/resume for approval-gated tools inside sub-agents:

`@rudderjs/ai@1.4.0` shipped suspend/resume for sub-agents that pause on a **client tool** (`finishReason === 'client_tool_calls'`). Approval-gated tools (`needsApproval: true`) inside sub-agents had no equivalent path — when the inner loop paused with `finishReason === 'tool_approval_required'`, no snapshot was persisted, the parent loop saw the inner agent "complete" with empty/partial text, and approve/reject from the UI had nowhere to land. This release makes the approval pause first-class.

**New control chunk** — `pauseForApproval(toolCall, isClientTool, resumeHandle?)`:

```ts
import { pauseForApproval } from '@rudderjs/ai'
// inside a server tool's async generator:
yield pauseForApproval(innerToolCall, isClientTool, subRunId)
```

The parent loop recognizes the chunk via `isPauseForApprovalChunk()`, sets `loopFinishReason = 'tool_approval_required'`, and halts iteration the same way it does for `pauseForClientTools`.

**Snapshot extension** — `SubAgentRunSnapshot.pauseKind?: 'client_tool' | 'approval'` discriminates the resume contract. Older v1.4 snapshots (no field) default to `'client_tool'`. Approval snapshots also carry `pendingApprovalToolCall: { toolCall, isClientTool }` so renderers can show "approve `delete_user(id=42)`?" without a round-trip.

**`Agent.asTool({ suspendable })` suspend branch** — when the inner loop ends with `finishReason === 'tool_approval_required'`, the wrapper persists a snapshot with `pauseKind: 'approval'`, yields `subagent_paused_approval` (with `subRunId`, `toolCall`, `isClientTool`), then yields `pauseForApproval(...)` to halt the parent.

**`Agent.resumeAsTool` accepts approval decisions:**

```ts
const r = await Agent.resumeAsTool(subRunId, [], {
  runStore, agent: subAgent,
  approvedToolCallIds: ['inner-call-id'],   // or rejectedToolCallIds
})
```

The function dispatches on `snapshot.pauseKind`: `'client_tool'` keeps the existing tool-result-append path; `'approval'` injects `approvedToolCallIds`/`rejectedToolCallIds` into the inner `agent.prompt()` options. The resume can pause again on either kind — the returned `'paused'` variant now carries `pauseKind` and (for approval) `toolCall` + `isClientTool` so the host can route correctly.

**Streaming projection** — the default sub-agent projector now translates inner `pending-approval` stream chunks into `agent_pending_approval` updates, so renderers can surface "approval needed" mid-stream (analogous to how `tool-call` chunks become `tool_call` updates). `subagent_paused_approval` fires once at the suspend boundary with the `subRunId` the host needs to drive resume.

**New `SubAgentUpdate` kinds:**

```ts
| { kind: 'agent_pending_approval';   toolCall: ToolCall; isClientTool: boolean }
| { kind: 'subagent_paused_approval'; subRunId: string; toolCall: ToolCall; isClientTool: boolean }
```

**Back-compat:** the existing `pauseForClientTools` path is unchanged; new snapshots from that path now carry `pauseKind: 'client_tool'` explicitly. Older snapshots in flight (no `pauseKind` field) resume as client-tool pauses by default. The previous `resumeAsTool` `'paused'` return shape gains optional fields (`pauseKind`, `toolCall`, `isClientTool`) — existing call sites that destructure `pendingToolCallIds` continue to work without changes.

**New exports:**

- `pauseForApproval`, `isPauseForApprovalChunk`, `PauseForApprovalChunk` (from `@rudderjs/ai`)
- `SubAgentPauseKind` (from `@rudderjs/ai`)

Tests: `astool-approval-suspend.test.ts` and `astool-approval-resume.test.ts` cover the suspend, approve, reject, pause-again, and cross-kind-transition (approval → client-tool) flows.
