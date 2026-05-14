# `agent.ts` extractions — split into purpose-named siblings

> **Status:** shipped 2026-05-13 — extraction in #410, cast-tightening follow-up in #411.
> **Date:** 2026-05-13
> **Scope:** internal refactor of `@rudderjs/ai`. No public API change. No changeset.
> **Companion finding:** `check our ai package code quality` review on 2026-05-13.

---

## TL;DR

`packages/ai/src/agent.ts` is 2690 lines / 53 top-level constructs and holds three self-contained blocks behind the Agent class + loop drivers. Extract them in four narrow phases to drop the file to ~2100 lines, keep `LoopContext` as the single import seam, and unblock future loop work without further inflating the hub.

```
Phase 0 → tool-helpers.ts          (~120 LOC out, 6 small helpers)
Phase 1 → tool-execution.ts        (~380 LOC out, parallel/serial dispatch)
Phase 2 → handoffs-driver.ts       (~110 LOC out, multi-hop driver)
Phase 3 → resume-approval.ts       (~100 LOC out, approval-resume reconciliation)
```

Run after each phase: `pnpm --filter @rudderjs/ai typecheck && pnpm --filter @rudderjs/ai test`. **All 813 tests must stay green at every checkpoint.**

---

## Goals / Non-goals

**Goals**
- Shrink `agent.ts` by ~700 LOC by moving genuinely self-contained chunks behind clean import seams.
- Make `LoopContext` an explicit exported internal type so siblings can typecheck against it.
- Eliminate the `evaluateApproval` triple-inline (used in serial path, parallel prelude, resume) by routing through the new `tool-helpers.ts`.

**Non-goals (this plan)**
- Unifying `runAgentLoopOnce` / `runAgentLoopStreamingOnce` (deferred — would require restructuring chunk handling; orthogonal to the file split).
- Collapsing `runToolPhaseSerial` + `runToolPhaseParallel` (genuinely distinct contracts; the review flagged this as **not** worth unifying).
- Tightening `StreamChunk` to remove `as unknown as` at agent.ts:2406/2409, the duck-typed `(a as any).tools` narrowing at 931/950, or the `apiKey!` pattern in `server/provider.ts`. Each is a small hygiene PR; bundle separately or after this lands.

---

## Pre-flight

From `packages/ai/`:

```bash
pnpm typecheck   # expect clean
pnpm test        # expect 813/813 pass
```

Baseline must be green before starting. If anything fails on `main`, stop and investigate.

---

## Phase 0 — Extract `src/tool-helpers.ts`

Six small primitives that have no Agent-class coupling and are about to be needed from two new sibling files. Pulling them out first prevents Phase 1 + Phase 3 from each importing them through `agent.js` (which would re-create the cycle the extraction is trying to break).

**Symbols to move (agent.ts → tool-helpers.ts):**

| Symbol | Lines in agent.ts | Notes |
|---|---|---|
| `interface InvalidToolArgumentsError` | 2601–2612 | Already `export interface`. Re-export from agent.ts for back-compat. |
| `validateToolArgs` | 2614–2638 | |
| `defaultStringify` | 2640–2652 | |
| `applyToModelOutput` | 2654–2676 | |
| `evaluateApproval` | 2678–2690 | |
| `isAsyncGenerator` | 2553–2558 | |
| `executeMaybeStreaming` | 2573–2599 | Depends on `isAsyncGenerator`. |

**New file shape:**

```ts
// src/tool-helpers.ts
import type { AgentPromptOptions, AnyTool, ToolCall, ToolCallContext } from './types.js'

export interface InvalidToolArgumentsError { /* ... */ }
export function validateToolArgs(/* ... */) { /* ... */ }
export function defaultStringify(/* ... */) { /* ... */ }
export async function applyToModelOutput(/* ... */) { /* ... */ }
export async function evaluateApproval(/* ... */) { /* ... */ }
export function isAsyncGenerator(/* ... */) { /* ... */ }
export async function* executeMaybeStreaming(/* ... */) { /* ... */ }
```

**Seam in agent.ts:** replace each function with `import { ... } from './tool-helpers.js'` at the top, plus a `export type { InvalidToolArgumentsError } from './tool-helpers.js'` line to preserve the public type re-export.

**Verify:** `pnpm typecheck && pnpm test` — green.

---

## Phase 1 — Extract `src/tool-execution.ts`

The tool-phase dispatch and its parallel-prelude machinery. The biggest extraction.

**Symbols to move:**

| Symbol | Lines in agent.ts |
|---|---|
| `executeToolPhase` | 1305–1339 |
| `runToolPhaseSerial` | 1347–1582 |
| `runToolPhaseParallel` | 1584–1707 |
| `type ToolExecutionResult` (search the file) | local helper |
| `type ReadyOutcome` | 1684–1690 |
| `type PreludeOutcome` | 1692–1700 |
| `classifyToolCalls` | 1709–1791 |
| `runToolExecution` | 1793–1847 |

**Required pre-step — export `LoopContext`:**

```diff
-interface LoopContext {
+export interface LoopContext {
```

at agent.ts:1060. Also export `PendingHandoff` (interface at 1098). Both stay defined in `agent.ts` since the loop functions that own them remain there. Phase 2 needs `PendingHandoff` too — declaring once.

**New file shape:**

```ts
// src/tool-execution.ts
import type { LoopContext } from './agent.js'
import type { AiMessage, StreamChunk, ToolCall, ToolResult } from './types.js'
import { isHandoffTool } from './handoff.js'
import { runSequential, runOnBeforeToolCall, runOnAfterToolCall } from './middleware.js'
import { evaluateApproval, validateToolArgs, applyToModelOutput, executeMaybeStreaming, defaultStringify } from './tool-helpers.js'

export async function* executeToolPhase(
  loopCtx: LoopContext,
  toolCalls: ToolCall[],
  assistantMessage: AiMessage,
): AsyncGenerator<StreamChunk, ToolResult[], void> { /* ... */ }

// runToolPhaseSerial, runToolPhaseParallel, classifyToolCalls, runToolExecution
// — all internal, NOT exported. Only executeToolPhase is the public-to-agent.ts surface.
```

**Seam in agent.ts:** replace the 8 moved symbols with `import { executeToolPhase } from './tool-execution.js'`. Confirm via grep that only `executeToolPhase` is referenced outside the extracted block (the four others are private to the moved code).

**Risk to watch:** `runToolPhaseSerial` mutates `loopCtx.stopForHandoff`, `loopCtx.pendingHandoff`, `loopCtx.stopForClientTools`, `loopCtx.stopForApproval`, `loopCtx.pendingApprovalToolCall`, `loopCtx.pendingClientToolCalls`. Crossing module boundaries doesn't break this (objects are passed by reference) but it does mean the `LoopContext` interface stays the source of truth for which fields are mutable. Don't tighten the `readonly` modifiers during the extraction — the existing parallel-prelude code mutates `pendingApprovalToolCall` and `loopFinishReason`.

**Verify:** `pnpm typecheck && pnpm test` — green. The `evaluateApproval` calls inside serial path and parallel prelude both now flow through the import from `tool-helpers.ts`, eliminating one of the three inline copies.

---

## Phase 2 — Extract `src/handoffs-driver.ts`

The multi-hop handoff driver used by the non-streaming path. The streaming variant has its own inline iterative driver (see agent.ts:2028–2062, the comment at 2087–2090 explains the duplication) — leave that in place; this plan does **not** unify them.

**Symbols to move:**

| Symbol | Lines in agent.ts |
|---|---|
| `const MAX_HANDOFFS = 5` | 1983 |
| `driveHandoffs` | 2091–2138 |
| `mergeFinalHandoff` | 2141–2154 |
| `buildHandoffChildOptions` | 2168–2184 |
| `stripInternal` | 2187–2200 |

**Cycle break:** `driveHandoffs` currently calls `runAgentLoopOnce(child, ...)`. Moving it out creates a circular import (driver → agent → driver). Two options, **pick option B**:

- **A.** Make `runAgentLoopOnce` exported and import it. Cycle is structural but ESM handles it as long as the runtime call happens after both modules finish loading. Brittle — relies on import order.
- **B. (recommended)** Pass `runAgentLoopOnce` as a callback parameter. `driveHandoffs(rootName, rootResult, pending, carriedMessages, origOptions, startHopCount, runOnce)`. Removes the cycle entirely. Caller at agent.ts:2001 passes `runAgentLoopOnce` by reference.

**New file shape:**

```ts
// src/handoffs-driver.ts
import type { Agent } from './agent.js'  // type-only; no runtime cycle
import type { AgentPromptOptions, AgentResponse, AgentStep, AiMessage, TokenUsage } from './types.js'
import type { HandoffSpec } from './handoff.js'

export const MAX_HANDOFFS = 5

export interface PendingHandoff {
  spec: HandoffSpec
  transitionMessage: string
  parentToolCallId: string
}

type RunOnce = (a: Agent, input: string, options?: AgentPromptOptions) =>
  Promise<AgentResponse & { _pendingHandoff?: PendingHandoff; _carriedMessages?: AiMessage[] }>

export async function driveHandoffs(/* ..., runOnce: RunOnce */): Promise<AgentResponse> { /* ... */ }
export function stripInternal(/* ... */): AgentResponse { /* ... */ }
// mergeFinalHandoff + buildHandoffChildOptions — internal, not exported
```

Move the `PendingHandoff` interface definition here (it currently lives at agent.ts:1098). `LoopContext.pendingHandoff?:` still references it via `import type { PendingHandoff } from './handoffs-driver.js'`.

**Seam in agent.ts:**

```diff
-async function driveHandoffs(/* ... */) { /* ... */ }
-function mergeFinalHandoff(/* ... */) { /* ... */ }
-function buildHandoffChildOptions(/* ... */) { /* ... */ }
-function stripInternal(/* ... */) { /* ... */ }
+import { driveHandoffs, stripInternal, MAX_HANDOFFS, type PendingHandoff } from './handoffs-driver.js'
```

Update the call site at agent.ts:2001 to pass `runAgentLoopOnce`:

```diff
-  return driveHandoffs(a.constructor.name, root, root._pendingHandoff, root._carriedMessages ?? [], options, 0)
+  return driveHandoffs(a.constructor.name, root, root._pendingHandoff, root._carriedMessages ?? [], options, 0, runAgentLoopOnce)
```

Also update the streaming driver's call to `stripInternal(...)` (agent.ts:2057 or thereabouts — find via grep) and `MAX_HANDOFFS` to use the import.

**Verify:** `pnpm typecheck && pnpm test` — green. Pay attention to `handoff.test.ts` — it's the canonical multi-hop fixture.

---

## Phase 3 — Extract `src/resume-approval.ts`

The approval-resume reconciliation — already a single self-contained function.

**Symbols to move:**

| Symbol | Lines in agent.ts |
|---|---|
| `resumePendingToolCalls` | 2458–2545 |

**New file shape:**

```ts
// src/resume-approval.ts
import type { AgentPromptOptions, AiMessage, AnyTool, ToolCall } from './types.js'
import { evaluateApproval, validateToolArgs, applyToModelOutput, executeMaybeStreaming } from './tool-helpers.js'

export async function resumePendingToolCalls(deps: {
  messages: AiMessage[]
  toolMap: Map<string, AnyTool>
  options: AgentPromptOptions | undefined
}): Promise<{
  resumed: AiMessage[]
  approvalStillRequired: { toolCall: ToolCall; isClientTool: boolean } | undefined
}> { /* ... */ }
```

**Seam in agent.ts:** replace the function block with `import { resumePendingToolCalls } from './resume-approval.js'`.

This is the third (and final) inline site of `evaluateApproval`, now routed through `tool-helpers.ts`. Mission of "evaluate once, reuse everywhere" is complete.

**Verify:** `pnpm typecheck && pnpm test` — green. Approval-resume coverage lives in `astool-approval-resume.test.ts` and `astool-approval-suspend.test.ts`.

---

## Wrap-up

After all four phases:

```bash
pnpm --filter @rudderjs/ai typecheck
pnpm --filter @rudderjs/ai test         # 813/813
pnpm --filter @rudderjs/ai build        # clean dist/
```

**Sanity greps** — confirm no stragglers:

```bash
# These should be empty (all moved out)
grep -n 'function evaluateApproval\|function validateToolArgs\|function applyToModelOutput' packages/ai/src/agent.ts
grep -n 'function executeToolPhase\|function runToolPhaseSerial\|function runToolPhaseParallel' packages/ai/src/agent.ts
grep -n 'function driveHandoffs\|function mergeFinalHandoff\|function stripInternal' packages/ai/src/agent.ts
grep -n 'function resumePendingToolCalls' packages/ai/src/agent.ts

# These should each have exactly one definition site
grep -rn 'function evaluateApproval' packages/ai/src/
grep -rn 'function driveHandoffs' packages/ai/src/
grep -rn 'function executeToolPhase' packages/ai/src/
grep -rn 'function resumePendingToolCalls' packages/ai/src/
```

**Expected new line counts** (approximate):
- `agent.ts`: 2690 → ~2000 (–25%)
- `tool-helpers.ts`: ~120 LOC (new)
- `tool-execution.ts`: ~390 LOC (new)
- `handoffs-driver.ts`: ~120 LOC (new)
- `resume-approval.ts`: ~100 LOC (new)

**PR title:** `refactor(ai): split agent.ts into tool-helpers / tool-execution / handoffs-driver / resume-approval`

**Changeset:** none. Pure internal refactor — public exports unchanged, no behavioral change. Confirm via `git diff main -- packages/ai/src/index.ts` (should be empty).

**Recommended PR strategy:** single PR with the four phases as four commits. Per memory, default to one PR for cohesive multi-piece work; the only reason to split would be risk isolation, and the test suite (813 cases at every checkpoint) makes that unnecessary.

---

## Risk notes

- **Streaming-driver `stripInternal` callsite.** The non-streaming path at agent.ts:2001 is the obvious one; the streaming inline driver also uses `stripInternal`. Grep before deleting from agent.ts to confirm both callers are wired to the new import.
- **`PendingHandoff` field on `LoopContext`.** Moving the interface to `handoffs-driver.ts` while keeping the field on `LoopContext` in `agent.ts` creates a `LoopContext → handoffs-driver` type import that is fine at the type level (no runtime edge). Confirm via `pnpm typecheck`.
- **Test scripts are explicit per-file.** Per memory `feedback_orm_test_script_explicit_files.md` — orm/queue/router test scripts enumerate `dist-test/*.test.js`. Check `packages/ai/package.json`: `"test": "tsc -p tsconfig.test.json && node --test dist-test/*.test.js"` uses a glob, so new test files would auto-pick up. **No new tests are added by this plan** — the existing 813 cases cover all moved code. If a regression surfaces during execution, add the test in the same PR; the glob handles it.
