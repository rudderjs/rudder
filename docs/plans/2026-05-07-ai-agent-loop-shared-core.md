# Plan: Extract shared agent loop core (`@rudderjs/ai`)

## Overview

`packages/ai/src/agent.ts` is 1456 lines, dominated by `runAgentLoop` (≈345 lines) and `runAgentLoopStreaming` (≈460 lines) which duplicate ~80% of their structure. The only structural difference is `adapter.generate()` (one shot) vs `adapter.stream()` (chunked) — every other phase (setup, middleware, prepareStep, failover, tool exec, approval, step recording, observer emit, finalization) is the same logic written twice.

This is item 1 from the 2026-05-07 Copilot review backlog (memory: `project_ai_copilot_followups.md`). Highest leverage / highest risk item — the loop is exercised by every `prompt()` and `stream()` call, all 8 provider adapters, and the entire approval/client-tool/middleware feature surface.

**Goal:** one shared loop core. Both `prompt()` and `stream()` become thin wrappers that differ only in how they obtain a step's content and how they surface chunks. **Zero behavior change** — preserve byte-for-byte the existing observer events, message ordering, abort semantics, and stream chunk sequence.

---

## Current duplication map

| Phase | Non-streaming lines | Streaming lines | Identical? |
|---|---|---|---|
| Entry abort check | 398 | 753-756 | yes (different shape: throwIfAborted vs reject+throw) |
| Setup (model/tools/middleware/messages) | 399-414 | 757-772 | identical |
| Resume pending tool calls | 421-438 | 779-795 | identical |
| Middleware ctx + onConfig init + onStart | 441-450 | 797-807 | identical |
| Iteration prelude (abort/iter/prepareStep/onConfig beforeModel) | 456-489 | 813-844 | identical except streaming resets `chunkIndex` |
| Failover model loop (provider call) | 491-518 | 846-873 | structural — `generate()` vs `stream()` |
| Stream chunk processing | — | 875-922 | streaming only |
| Tool exec phase | 527-650 | 931-1083 | logic identical, streaming yields chunks |
| Step recording + stop check | 655-672 | 1088-1107 | identical |
| Catch + observer.failed emit | 674-701 | 1109-1136 | identical except `streaming: true/false` |
| onFinish + observer.completed + result build | 703-738 | 1138-1181 | identical except streaming yields pending chunks first |
| Outer wrapper | (none — just returns) | 1184-1200 | streaming-only abort propagation |

Rough net: ~600 lines of true duplication. The streaming-only deltas are: chunk processing between provider call and tool phase; tool-call/update/result chunk yields in tool phase; pending-* chunks in finalization; outer wrapper for abort rejection.

---

## Strategy — Option B: shared helpers, two thin outer functions

Considered three options:

- **(A) Unify by always streaming internally** — make `prompt()` drain a streaming run. Rejected: changes provider call shape (some adapters' streaming paths differ from generate; cost/latency profile changes; harder to debug). Behavior-change risk is unacceptable for a refactor.
- **(B) Extract pure helpers + a shared async-generator tool-phase** — both loops share initialization, iteration prelude, tool execution (as a generator), step recording, observer emission, and result building. The two outer functions remain because the streaming one *must* be an async generator. **Selected.**
- **(C) State-machine + drivers** — over-engineering for two paths.

### Shared `LoopContext` (mutable state container)

```ts
interface LoopContext {
  // immutable per call
  agent:         Agent
  input:         string
  options:       AgentPromptOptions | undefined
  modelString:   string
  providerName: string
  tools:         AnyTool[]
  toolMap:       Map<string, AnyTool>
  toolSchemas:   ReturnType<typeof toolToSchema>[]
  middlewares:   AiMiddleware[]
  loopStart:     number
  ctx:           MiddlewareContext & { readonly _aborted: boolean; readonly _abortReason: string }

  // mutable
  messages:                 AiMessage[]
  steps:                    AgentStep[]
  totalUsage:               TokenUsage
  pendingClientToolCalls:   ToolCall[]
  pendingApprovalToolCall?: { toolCall: ToolCall; isClientTool: boolean }
  loopFinishReason?:        FinishReason
  stopForClientTools:       boolean
  stopForApproval:          boolean
  resumedToolMessages:      AiMessage[]
  failoverAttempts:         number
}
```

### Shared functions

1. `initializeLoop(a, input, options): Promise<LoopContext>` — setup, resume, middleware ctx, onConfig init, onStart.
2. `runIterationPrelude(loopCtx, iteration): Promise<{ currentModel, currentToolSchemas } | { abort: true } | null>` — abort check, onIteration, prepareStep, onConfig beforeModel. Returns `null` when middleware aborted (caller breaks).
3. `executeToolPhase(loopCtx, toolCalls, assistantMessage): AsyncGenerator<StreamChunk, ToolResult[], void>` — the tool-call loop, expressed once as a generator. Yields the same chunks streaming would yield (tool-call, tool-update, tool-result). Non-streaming caller drains and discards yields; streaming caller forwards them. Uses `gen.next()` loop pattern (not `for await`) so the caller can read the final `return` value (`ToolResult[]`).
4. `recordStep(loopCtx, step, response): boolean` — push step, check stop conditions, return `true` if outer loop should break.
5. `emitObserverFailed(loopCtx, err, streaming: boolean)` and `emitObserverCompleted(loopCtx, result, streaming: boolean)` — single source of truth for the two observer event shapes.
6. `buildAgentResponse(loopCtx): AgentResponse` — finalization (text + steps + usage + finish reason + pending arrays).
7. `runFailover(loopCtx, currentModel, kind: 'generate' | 'stream'): Promise<ProviderResponse | AsyncIterable<StreamChunk>>` — collapses the failover try-loop. Discriminator `kind` selects `generate` or `stream`. Throws on caller-abort, accumulates `failoverAttempts`.

### Outer functions become thin

- `runAgentLoop` (~80 lines): `initializeLoop` → for-loop {`runIterationPrelude` → `runFailover('generate')` → if toolCalls iterate `executeToolPhase` (drain) → `recordStep`} → catch+observer.failed → onFinish → observer.completed → `buildAgentResponse`.
- `runAgentLoopStreaming` (~120 lines): same skeleton, plus chunk processing between failover and tool phase (text/toolCall accumulation), forwards `executeToolPhase` yields, yields pending-* chunks at the end. Outer `withRejectOnError` wrapper preserved as-is.

The streaming chunk-processing block (text accumulation, partial-toolcall reassembly, finish reason capture) has no equivalent in non-streaming, so it stays inline in `runAgentLoopStreaming`.

---

## Invariants to preserve (verified via existing tests)

1. **Message ordering identical** — order of pushes to `messages` (assistant, tool, error) is byte-for-byte the same.
2. **Stream chunk ordering identical** — `tool-call` → `tool-update*` → `tool-result` per call, and `pending-client-tools` / `pending-approval` at the very end after all steps.
3. **Observer event payloads identical** — same agentName/model/provider/input/output/steps/tokens/duration/finishReason/streaming/conversationId/failoverAttempts. Same fields on both `agent.completed` and `agent.failed`.
4. **Abort semantics identical** — caller `AbortSignal` short-circuits before any work, between iterations, and inside failover loop (re-throws `signal.reason`, doesn't try next failover model).
5. **Approval/client-tool resume** — same `pendingApprovalToolCall` / `pendingClientToolCalls` / `resumedToolMessages` propagation, same `loopFinishReason` values.
6. **Middleware hook order** — onConfig(init) → onStart → [onIteration → onConfig(beforeModel) → onUsage → onBeforeToolCall → onAfterToolCall → onToolPhaseComplete]* → onError? → onFinish. Same on both paths.
7. **Tool args validation** — same parsed value reaches `execute`; same `InvalidToolArgumentsError` shape on failure; same emission of `tool-call` chunk before validation-fail `tool-result` in streaming.
8. **toModelOutput error handling** — R6 invariant (errors swallowed, routed through onError) preserved.

These are all already covered by `index.test.ts` (1500+ assertions, 30+ describe blocks). The refactor is "passes if the existing test suite passes unchanged."

---

## Phases

### Phase 1 — extract pure helpers (no orchestration change)

Pull these out as standalone functions, called from both loops in their existing positions. Behavior-only verification: existing tests pass.

- `emitObserverFailed` / `emitObserverCompleted` (replaces both inline emit blocks).
- `buildAgentResponse` (replaces both inline result-building blocks).
- `runFailover('generate' | 'stream')` (replaces both inline failover try-loops).

After Phase 1: ~150 lines deduplicated, both loops still structurally distinct but call the same emit/build/failover helpers. Lowest-risk slice.

### Phase 2 — extract `executeToolPhase` as shared async generator

The hairier extraction. Tool-phase is ~125 lines on each side. Express once as `async function* executeToolPhase(loopCtx, toolCalls, assistantMessage): AsyncGenerator<StreamChunk, ToolResult[], void>`.

- Non-streaming caller iterates with `gen.next()`, discards yielded chunks, captures `step.value` when `step.done`.
- Streaming caller iterates with `gen.next()`, forwards each yielded chunk via `yield`, captures the final `ToolResult[]`.

The `pause_for_client_tools` mid-tool case (sets `stopForClientTools = true` on `loopCtx`, propagates pendingClientToolCalls) needs the generator to communicate "broke out of the tool-call iteration" back to the caller. Two options:

- **2a** — return shape `{ toolResults: ToolResult[]; broke: boolean }` (tool-phase signals "outer loop should break").
- **2b** — write directly to `loopCtx.stopForClientTools` / `loopCtx.stopForApproval`; caller checks loopCtx after generator resolves.

Prefer **2b** — matches the existing pattern (loopCtx is the shared state bag) and avoids a new return type.

After Phase 2: tool-phase logic exists once. Largest dedup win (~120 lines).

### Phase 3 — extract `initializeLoop` and `runIterationPrelude`

Pull the setup block and per-iteration prelude into functions taking/returning `LoopContext`. After this, the two outer functions are thin: skeletons over shared helpers.

After Phase 3: agent.ts shrinks from 1456 → ~900 lines. `runAgentLoop` ≈ 80 lines, `runAgentLoopStreaming` ≈ 120 lines.

### Phase 4 — final cleanup

- Move shared helpers to `agent-loop.ts` (new file) if `agent.ts` still exceeds ~600 lines.
- Add a `// behavior-preservation barrier` comment to executeToolPhase explaining the chunk-yield contract for the non-streaming drain.
- Run isomorphic-check.test.ts to confirm no `node:` imports leaked in.

Skip Phase 4's file split if agent.ts ends up reasonably small.

---

## Verification gates between phases

After each phase, before moving to the next:

1. `pnpm --filter @rudderjs/ai test` — full test suite green.
2. `pnpm --filter @rudderjs/ai typecheck` — no TS errors.
3. `pnpm --filter @rudderjs/ai lint` — per `feedback_eslint_function_type.md`.
4. Spot-check `pnpm --filter @rudderjs/ai build` produces dist matching the new source (per `feedback_turbo_cache_dist_stale.md`, dirty `dist/` if Turbo cache misbehaves).
5. Manual playground smoke: `cd playground && pnpm dev`, run /demos AI page, confirm both prompt() and stream() work end-to-end with a real provider.

If any gate fails, the phase rolls back to the prior commit. Each phase is a separate commit/PR for bisectability.

---

## Risk register

| Risk | Mitigation |
|---|---|
| Behavior change leaks through to provider observer events | Phase 1 isolates emit fns first; tests assert exact event shape |
| Tool-phase generator changes ordering of stream chunks | Phase 2 uses `gen.next()` loop on both sides; chunk yields flow in source order |
| Abort semantics regressions | Existing tests cover entry abort, mid-iteration abort, failover-during-abort; gate 1 catches any drift |
| Middleware hook ordering drift | Existing tests already cover full hook order; gate 1 catches |
| `loopCtx` mutation collisions if refactor goes wrong | Single-threaded async; only one caller mutates at a time. Phase 2's `stopForClientTools` write is the only cross-function mutation, mirrors existing inline state |
| `agent-loop.ts` split bloats imports / breaks isomorphic-check | Phase 4 only happens if agent.ts is still large; isomorphic-check runs as gate 1 anyway |

---

## Out of scope

- Item 6 (parallel tool execution). Different change, separate PR. Should land after this refactor so its diff is local to one place.
- Item 20 (`agent.step.completed` observer event). Once the shared `recordStep` exists, item 20 becomes a one-line addition.
- Any provider adapter changes.
- Any test changes (other than incidental — if a test was asserting on a stable inline structure that moves, update the test).

---

## Estimated effort

- Phase 1: ~1 hour (mechanical extraction).
- Phase 2: ~2-3 hours (the generator iteration pattern needs care).
- Phase 3: ~1 hour.
- Phase 4: ~30 min (or skip).

Total: ~4-5 hours of focused work. Three PRs (one per phase 1/2/3, phase 4 folded into 3 if small).
