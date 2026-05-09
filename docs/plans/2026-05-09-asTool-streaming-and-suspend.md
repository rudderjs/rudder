# `Agent.asTool()` — streaming + sub-agent suspend/resume

> **READY FOR IMPLEMENTATION** — 2026-05-09. Plan complete, reviewed against existing upstream primitives, reference impl exists in pilotiq-pro and can be ported almost line-for-line. No open design questions block kickoff (the four listed below are tactical and answerable mid-implementation). Pilotiq-pro side is parked waiting on `@rudderjs/ai@1.4.0`.

**Status:** ready
**Date:** 2026-05-09
**Filed by:** pilotiq side (cross-repo blocker for `@pilotiq-pro/ai` Phase 1)
**Companion:** `2026-05-09-ai-roadmap.md` (Track A; sits next to A2 Handoffs as A2.5)
**Companion (consumer):** `~/Projects/pilotiq-pro/docs/plans/admin-ai-ux-polish.md` Phase 1
**Target version:** `@rudderjs/ai@1.4.0`
**Reference impl (consumer side, will be deleted on migration):**
- `~/Projects/pilotiq-pro/packages/ai/src/handlers/chat/tools/runAgentTool.ts` — the streaming + suspend behaviour to absorb
- `~/Projects/pilotiq-pro/packages/ai/src/handlers/chat/subAgentResume.ts` — the resume path → `Agent.resumeAsTool()`
- `~/Projects/pilotiq-pro/packages/ai/src/handlers/agentStream/runStore.ts` — `SubRunState` + `storeSubRun` / `loadSubRun` / `consumeSubRun` → `SubAgentRunStore` interface + `CachedSubAgentRunStore`
- `~/Projects/pilotiq-pro/packages/ai/src/__tests__/subagent-runStore.test.ts` — test fixtures to mirror upstream

---

## TL;DR

`Agent.asTool()` shipped in 1.2.0 wraps `agent.prompt(input.prompt)` in a `toolDefinition`. It is the *zero-config* sub-agent shape. It does **not** support:

1. Streaming inner-agent progress to the parent (no `tool-update` chunks).
2. Inner-agent pausing on client tools (no `stop-on-client-tool` propagation).
3. Suspend/resume of the inner agent across HTTP round-trips.

`@pilotiq-pro/ai` ships its own `run_agent` tool today (~150 LOC + ~250 LOC of resume plumbing in `runStore.ts` + `subAgentResume.ts`) that does all three. The upstream loop already understands the `pause_for_client_tools` control chunk (`tool.ts:868`), so the propagation primitive is in place — only the `asTool` builder and a small persistence interface are missing.

This plan adds a streaming, suspend-capable `asTool` variant + a pluggable `SubAgentRunStore` interface, so consumers can drop their bespoke plumbing.

---

## Problem

`Agent.asTool()` (1.2.0) is currently:

```ts
asTool(options) {
  return toolDefinition({
    name:        options.name,
    description: options.description,
    inputSchema: options.inputSchema ?? z.object({ prompt: z.string() }),
  })
    .server((input): Promise<AgentResponse> => this.prompt(promptOf(input)))
    .modelOutput(options.modelOutput ?? (r => r.text))
}
```

Three concrete user-visible gaps when this shape is used as a sub-agent in a chat orchestrator:

### Gap 1 — No inner progress visibility

The parent loop's stream surfaces a single `tool-call` chunk for the sub-agent invocation, then nothing for the duration of the sub-agent's run, then a single `tool-result` chunk at the end. A UI rendering the orchestrator's stream cannot show "SEO assistant is calling `read_record`…" while the sub-agent works — only the final string.

The upstream loop *does* turn an async-generator tool execute's yields into `tool-update` chunks (`tool.ts:877`), so the primitive exists. `asTool` just doesn't use it because `prompt()` is non-streaming.

### Gap 2 — Client tools inside the sub-agent

If the sub-agent's model emits a client tool call (e.g. `update_form_state`), the current behaviour depends on `toolCallStreamingMode`:

- Default mode: the loop substitutes a `'[client tool — execute on client]'` placeholder result, lies to the model, and continues. The sub-agent's final text reflects a hallucinated success.
- `stop-on-client-tool` mode: the *inner* agent loop halts with `finishReason: 'client_tool_calls'`. But `asTool` calls `agent.prompt()` which doesn't accept this option, so the sub-agent has no way to surface the pending calls outward.

A consumer using `asTool` today gets the lie-to-the-model behaviour by default. There is no first-class way to say "stop and ask the host to round-trip these client tools."

### Gap 3 — Suspend / resume across HTTP

When (Gap 2) is fixed at the inner level, the parent loop also needs to halt with `loopFinishReason = 'client_tool_calls'` and surface the *inner agent's* pending calls upward. The chat handler then emits an SSE `pending_client_tools` event with the inner agent's call ids; the browser executes them; the resulting `/continue` request must resume **the sub-agent** with those tool results, then thread the eventual final text back into the parent's `run_agent` tool-result so the parent can keep going.

Pilotiq-pro implements this by (1) snapshotting the sub-agent's full message history at suspend, (2) writing it under a fresh `subRunId` in `@rudderjs/cache`, (3) yielding `pauseForClientTools(pending, subRunId)` to halt the parent, then (4) on `/continue`, loading the snapshot, re-running the inner agent with the appended tool-result messages until completion or another pause, and (5) injecting the inner agent's final text into the parent's tool-result. ~250 LOC of bookkeeping.

The bookkeeping is generic — it has nothing to do with admin panels. Any host running multi-step sub-agents that need browser-side tool calls will reproduce it. It belongs upstream.

---

## Design

Three additions to `@rudderjs/ai`:

1. **`Agent.asTool()` gains `streaming` + `suspendable` options** (additive — existing 1.2.0 callers unaffected).
2. **`Agent.resumeAsTool(subRunId, clientToolResults)`** — new static-side helper for the host's continuation handler.
3. **`SubAgentRunStore` interface** + default in-memory impl + lazy `@rudderjs/cache` adapter.

### 1. Extended `asTool()` API

```ts
agent.asTool({
  name:        'seo',
  description: 'SEO specialist sub-agent.',

  // NEW — emits one tool-update per inner stream chunk that matches the predicate.
  // `true` is shorthand for the default predicate (tool-call + tool-update only).
  streaming?: boolean | ((chunk: StreamChunk) => SubAgentUpdate | null)

  // NEW — when the inner agent emits a client tool, propagate it upward
  // through the parent loop instead of placeholder-substituting. Requires
  // `runStore` to be set, otherwise throws on invocation (loud failure —
  // suspend without persistence is a footgun).
  suspendable?: { runStore: SubAgentRunStore }

  // 1.2.0 options unchanged
  inputSchema?: z.ZodType
  prompt?:      (input) => string
  modelOutput?: (response: AgentResponse) => string | Promise<string>
})
```

Behaviour matrix:

| `streaming` | `suspendable` | What the server fn does |
|---|---|---|
| absent | absent | **1.2.0 behaviour** — `agent.prompt(input.prompt)` once, returns `AgentResponse` |
| `true` | absent | `agent.stream(input.prompt)`; iterate; yield default updates; resolve `AgentResponse` |
| `true` | set | `agent.stream(input.prompt, { toolCallStreamingMode: 'stop-on-client-tool' })`; on `client_tool_calls` finish: snapshot via `runStore`, yield `pauseForClientTools(pending, subRunId)`; otherwise resolve normally |
| `(fn)` | … | same as above, but inner chunks pass through `fn` for projection / filtering |
| absent | set | invalid — throw at builder time. Suspend implies streaming. |

The default streaming projection emits one `SubAgentUpdate` per relevant chunk:

```ts
type SubAgentUpdate =
  | { kind: 'agent_start'; agentName: string }
  | { kind: 'tool_call';   tool: string; args?: Record<string, unknown> }
  | { kind: 'agent_step';  step: number; tokens: number }
  | { kind: 'agent_done';  steps: number; tokens: number }
  | { kind: 'subagent_paused'; subRunId: string; pendingToolCallIds: string[] }
```

Hosts wanting a different shape pass `streaming: chunk => …` and own the discriminator. The shape above is the *recommended* default — pilotiq-pro will adopt it directly so its `agentRunRenderer` can stay almost identical.

### 2. `Agent.resumeAsTool()`

The host's continuation endpoint resumes a paused sub-agent run by id. Returns once the inner agent either fully completes or pauses again.

```ts
class Agent {
  /**
   * Resume a sub-agent run that previously paused with `pauseForClientTools`.
   *
   * - Loads + atomically deletes the run from `runStore` (re-storing a fresh
   *   id if the inner agent pauses again).
   * - Validates that every incoming tool-result id is in the pending set
   *   (forgery guard).
   * - Re-runs the inner loop with the appended tool results in `messages` mode.
   * - Returns the final `AgentResponse` on completion, OR a paused sentinel
   *   if the inner agent stopped on another client-tool call.
   */
  static async resumeAsTool(
    subRunId:          string,
    clientToolResults: Array<{ toolCallId: string; result: unknown }>,
    options?: {
      runStore: SubAgentRunStore   // required — same store the suspend used
      onUpdate?: (update: SubAgentUpdate) => void
    },
  ): Promise<
    | { kind: 'completed'; response: AgentResponse }
    | { kind: 'paused';    subRunId: string; pendingToolCallIds: string[] }
  >
}
```

The host's chat continuation:

1. Receives `/continue` with the browser's tool-result messages.
2. Calls `Agent.resumeAsTool(subRunId, results, { runStore })`.
3. On `'completed'`: feeds `response.text` (or `modelOutput(response)`) back into the parent's `run_agent` tool-result message and resumes the parent loop.
4. On `'paused'`: emits another `pending_client_tools` SSE event with the new sub-run's pending ids and waits for the next `/continue`.

This collapses ~150 LOC of `subAgentResume.ts` into one upstream call.

### 3. `SubAgentRunStore` interface

```ts
export interface SubAgentRunSnapshot {
  /** Sub-agent message history at suspend time (already includes the user prompt + every interleaved tool result). */
  messages:           AiMessage[]
  /** Client-tool call ids the sub-agent is waiting on. Resume must carry a result for each. */
  pendingToolCallIds: string[]
  /** Steps + tokens accumulated so far across all suspends — for accurate final reporting. */
  stepsSoFar:         number
  tokensSoFar:        number
  /**
   * Opaque metadata the host passes through. Pilotiq stores
   * `{ resourceSlug, recordId, fieldScope, userId }` here so its continuation
   * can rehydrate context. The framework treats this as JSON and never reads it.
   */
  meta?: unknown
}

export interface SubAgentRunStore {
  store(subRunId: string, snapshot: SubAgentRunSnapshot): Promise<void>
  /** Atomic read+delete. Returns null on miss / expired. */
  consume(subRunId: string): Promise<SubAgentRunSnapshot | null>
}
```

Two reference implementations ship with `@rudderjs/ai`:

- **`InMemorySubAgentRunStore`** — `Map<string, SubAgentRunSnapshot>`. Default if no store is passed but `suspendable` is omitted; throws if used with `suspendable` (single-process only — multi-process needs a shared backend).
- **`CachedSubAgentRunStore`** — lazy `@rudderjs/cache` adapter. Mirrors pilotiq-pro's current `panels:subagent-run:${id}` shape with a 5-minute TTL. Loads the cache module via `await import('@rudderjs/cache')` so `@rudderjs/ai` keeps its zero-required-peer surface.

Hosts may implement their own (Redis directly, Prisma, etc.) by satisfying the interface.

### Why these specific shapes

- **`streaming: true | predicate`** — simpler than two separate options (`streaming` + `streamingPredicate`). The 80% case is the default predicate; the predicate function is the escape hatch.
- **`suspendable: { runStore }` instead of `runStore` at the top level** — keeps the suspend feature gated. Setting `runStore` without committing to suspend behaviour would be ambiguous. The nested object reads as "I want suspend, here is how to persist it."
- **`SubAgentUpdate` shape uses `kind`** — discriminated union, matches the rest of `@rudderjs/ai`'s chunk shapes. Renderers exhaustively switch on `kind` and let the type-checker catch missed cases.
- **`resumeAsTool` is a static** — the host has the `subRunId` but not the original `Agent` instance (it was constructed inside the parent's tool list). Static lookup via the snapshot's metadata is the only shape that works.

---

## Implementation sketch

### Files touched in `@rudderjs/ai`

| File | Change |
|---|---|
| `agent.ts` | Extend `asTool()` overloads + impl; add static `Agent.resumeAsTool()` |
| `sub-agent-run-store.ts` (new) | `SubAgentRunStore` interface + `InMemorySubAgentRunStore` + `CachedSubAgentRunStore` lazy loader |
| `index.ts` | Export new types + classes |
| `tool.ts` | No change — `pauseForClientTools` + `isPauseForClientToolsChunk` already exist |

### Pseudocode for the streaming + suspendable branch

```ts
// inside the extended asTool():
.server(async function* (input, ctx) {
  if (!options.streaming && !options.suspendable) {
    // 1.2.0 path — call prompt() and return
    return await self.prompt(promptOf(input))
  }

  yield project({ type: 'agent_start' as const, agentName: options.name })

  const streamOpts = options.suspendable
    ? { toolCallStreamingMode: 'stop-on-client-tool' as const }
    : {}
  const { stream, response } = await self.stream(promptOf(input), streamOpts)

  for await (const chunk of stream) {
    const update = projectChunk(chunk, options.streaming)
    if (update) yield update
  }

  const result = await response

  if (result.finishReason === 'client_tool_calls' && options.suspendable) {
    if (!ctx?.toolCallId) throw new Error('[asTool] suspend requires ToolCallContext')

    const subRunId = randomUUID()
    const snapshot = buildSnapshot(result, input)  // see SubAgentRunSnapshot fields
    await options.suspendable.runStore.store(subRunId, snapshot)

    yield { kind: 'subagent_paused', subRunId, pendingToolCallIds: snapshot.pendingToolCallIds }
    yield pauseForClientTools(result.pendingClientToolCalls!, subRunId)
    // unreachable — parent loop halts iteration on the pause chunk
    return undefined as never
  }

  yield project({ kind: 'agent_done', steps: result.steps.length, tokens: result.usage?.totalTokens ?? 0 })
  return result   // AgentResponse — flows into parent's modelOutput()
})
```

`buildSnapshot()` reconstructs the full sub-agent message history by interleaving each step's `message` with its server-side `toolResults` — this is exactly the loop pilotiq-pro's `runAgentTool.ts:164–174` runs today, and the comment there explains why naive `steps.map(s => s.message)` corrupts the history. Move that logic upstream and the consumer drops it.

### Pseudocode for `Agent.resumeAsTool()`

```ts
static async resumeAsTool(subRunId, clientToolResults, options) {
  const snap = await options.runStore.consume(subRunId)
  if (!snap) throw new Error(`[asTool] subRunId ${subRunId} expired or never existed`)

  // Forgery guard — every incoming tool result id must be in pending
  const pending = new Set(snap.pendingToolCallIds)
  for (const r of clientToolResults) {
    if (!pending.has(r.toolCallId)) throw new Error(`[asTool] toolCallId ${r.toolCallId} not in pending set`)
  }

  // Append tool-result messages in pending order
  const messages = [...snap.messages]
  for (const r of clientToolResults) {
    messages.push({
      role:       'tool',
      content:    typeof r.result === 'string' ? r.result : JSON.stringify(r.result),
      toolCallId: r.toolCallId,
    })
  }

  // Resume — we don't have the original Agent here, but we don't need it:
  // the model + tools + system prompt are baked into `messages` for resume.
  // We use the host's caller-supplied agent OR a static helper that runs the
  // loop directly given `messages` + a model. (See open question Q1.)
  const result = await runAgentLoopFromMessages(messages, /* agent context */, {
    toolCallStreamingMode: 'stop-on-client-tool',
  })

  if (result.finishReason === 'client_tool_calls') {
    const newSubRunId = randomUUID()
    await options.runStore.store(newSubRunId, buildSnapshot(result, ...))
    return { kind: 'paused', subRunId: newSubRunId, pendingToolCallIds: ... }
  }

  return { kind: 'completed', response: result }
}
```

---

## Migration — what `@pilotiq-pro/ai` deletes

After 1.4.0 lands and pilotiq-pro bumps:

| File / Symbol | Action |
|---|---|
| `packages/ai/src/handlers/chat/tools/runAgentTool.ts` (~240 LOC) | **Delete.** Replace with a 30-line loop over `Resource.agents()` calling `agent.asTool({ streaming: true, suspendable: { runStore } })` |
| `packages/ai/src/handlers/agentStream/runStore.ts` — `SubRunState`, `storeSubRun`, `loadSubRun`, `consumeSubRun` (~90 LOC) | **Delete.** Replace with `new CachedSubAgentRunStore({ keyPrefix: 'panels:subagent-run:' })` |
| `packages/ai/src/handlers/chat/subAgentResume.ts` (~600 LOC) | **Shrink.** Most of it becomes `await Agent.resumeAsTool(subRunId, results, { runStore })`. Pilotiq-specific bits (parent toolCallId lookup, sub-agent slug → label rehydration for the parent's tool-result message) stay. Estimate: ~600 → ~150 LOC. |
| `packages/ai/src/handlers/chat/subRunsNormalize.ts` | **Delete or shrink** — the normalization currently exists because the resume path can't tell paused-once from paused-twice; with `Agent.resumeAsTool`'s discriminated return type, the normalization is unnecessary. |
| `packages/ai/src/handlers/chat/types.ts` — `RunAgentUpdate` type | **Re-export** `SubAgentUpdate` from `@rudderjs/ai`. Or alias it. |

Net consumer-side change: ~−700 LOC. The framework absorbs the generic part; pilotiq-pro keeps only the renderer + context-shape glue.

---

## Tests

Mirror the consumer's existing tests upstream (good signal that the migration drops them):

- `asTool-streaming.test.ts` — sub-agent emits `tool-call` chunks; parent stream surfaces `tool-update` chunks with `kind: 'tool_call'`.
- `asTool-suspend.test.ts` — sub-agent's loop pauses on a client tool; parent loop's `pendingClientToolCalls` includes the inner agent's call; `runStore.store` is called once with a snapshot whose `messages` round-trips through `consume`.
- `asTool-resume.test.ts` — `Agent.resumeAsTool` happy-path completion; pause-again path returns `{ kind: 'paused', subRunId: <new>, ... }`; forgery guard throws on unknown toolCallId.
- `sub-agent-run-store-cache.test.ts` — `CachedSubAgentRunStore` round-trips through `@rudderjs/cache`'s in-memory driver.
- Existing `Agent.asTool()` 1.2.0 tests pass unchanged (zero-config path is preserved).

The consumer's `subagent-runStore.test.ts` and `subRunsNormalize.test.ts` get deleted as part of the pilotiq-pro migration PR.

---

## Open questions

1. **Resume without the original `Agent` instance.** ✅ **Resolved 2026-05-09** — Option (a). Caller passes `{ agent }` at resume time. Final API:
   ```ts
   Agent.resumeAsTool(subRunId, clientToolResults, {
     runStore: SubAgentRunStore,
     agent:    Agent,             // required — the rehydrated sub-agent
     onUpdate?: (u: SubAgentUpdate) => void,
   })
   ```
   Pilotiq's host already rebuilds the sub-agent on every resume (looks up `Resource.agents()` by `subAgentSlug`, builds a fresh `PanelAgentContext` from `{ resourceSlug, recordId, fieldScope }` in `SubRunState`, validates `userId`). Passing the reference is free. Option (b) was rejected because pilotiq agents carry closure-captured context (resource model, record id, scope) on every tool — serializing would lose those captures — and pilotiq's toolkit is scope-derived, so the "right" tool list at resume is a fresh derivation, not a snapshot of start-time tools.
2. **`streaming: false` with `suspendable: true`.** ✅ **Resolved 2026-05-09** — throw at builder time. Suspend implies the inner agent's progress matters; silent suspend is a UX trap. Setting `suspendable` without `streaming` (or with `streaming: false`) raises a clear error from `asTool()` itself, before the parent loop ever calls in.
3. **Multi-pause within one run.** ⏳ **Deferred** — resume's return type carries a fresh `subRunId` so the host re-emits `pending_client_tools` on every pause. No depth cap in v1; revisit if it bites.
4. **Approval gates inside sub-agents.** ⏳ **Out of scope** — orthogonal to client tools but reuses the `pause_for_*` propagation pattern. Revisit alongside upstream `requireApproval` policy work; pilotiq's consumer-side equivalent is on its Phase 3 backlog.

---

## Sequence

1. Land `SubAgentRunStore` interface + impls in isolation. ~½ d.
2. Extend `Agent.asTool()` with `streaming` branch (no suspend yet). ~½ d.
3. Add `suspendable` branch + `Agent.resumeAsTool()`. ~1 d.
4. Tests. ~½ d.
5. Changeset, ship as 1.4.0 minor.

Total: ~2.5 days. Pilotiq-pro consumer migration is a separate ~2-hour PR after the bump.

---

## Roadmap placement

Roadmap doc (`2026-05-09-ai-roadmap.md`) Track A row **A2.5** added 2026-05-09. Sits next to A2 (Handoffs): handoffs is "control transfer," `asTool` streaming/suspend is "richer call-and-return." Same family, different shape. Ship before A4 (memory) — sub-agent UX is a more immediate customer ask than personalization.

---

## Cross-repo coordination

**On 1.4.0 publish:**
1. Update `~/Projects/pilotiq-pro/packages/ai/package.json` peer-dep range `@rudderjs/ai`: `^1.1.0` → `^1.4.0`.
2. Strike the BLOCKED notice in `~/Projects/pilotiq-pro/docs/plans/admin-ai-ux-polish.md` Phase 1.
3. Update memory `project_pilotiq_pro_ai_phase_1_blocked.md` → flip to "Phase 1 ready, see resume checklist" (the body already lists the deletion plan).
4. The next pilotiq-pro session executes the consumer-side migration per Phase 1 of `admin-ai-ux-polish.md`.

**If the rudder agent has a question that needs pilotiq-side context:** drop it in this doc under a new `## Questions for pilotiq side` section. Pilotiq sessions read this file; answers land back in the open questions list above.
