/**
 * Per-run state store for standalone agent runs that pause for client-tool
 * round-trips or approval.
 *
 * Backed by `@rudderjs/cache` so the storage driver (memory/redis/etc.) is
 * picked by the app's `config/cache.ts` — panels has no preference. App devs
 * deploying multi-process / HA can swap to redis without touching panels code.
 *
 * The chat dispatcher does NOT use this — chat continuations use the
 * persisted-conversation prefix-check in `chat/continuation.ts`. This store
 * exists exclusively for the standalone agent runner (`agentRun.ts`), where
 * runs are single-session and short-lived (no persisted conversation to
 * compare against).
 *
 * See `docs/plans/standalone-client-tools-plan.md` decisions D2 + D3.
 *
 * **Optional peer dep:** `@rudderjs/cache` is loaded lazily. If it isn't
 * installed (or no cache adapter is registered), `storeRun()` throws with a
 * clear message — but runs that never hit a pending state never call into
 * this module, so panels still works without cache configured.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { AiMessage } from '@rudderjs/ai'

const KEY_PREFIX            = 'panels:agent-run:'
const SUBAGENT_KEY_PREFIX   = 'panels:subagent-run:'
const TTL_SECONDS = 300  // 5 minutes — runs that pause for user input expire

/**
 * State persisted between an initial standalone run and its continuation.
 * Stored under `panels:agent-run:${runId}`. The runId itself is a
 * cryptographically random UUID generated server-side and never seen by
 * other users — guessing one is infeasible.
 */
export interface AgentRunState {
  /** Slug of the `PanelAgent` that started the run. Continuation must match. */
  agentSlug:    string
  /** Resource slug — used to validate the continuation hits the same record. */
  resourceSlug: string
  /** Record id — same. */
  recordId:     string
  /** Optional field-scope — for per-field actions, the single field the agent is allowed to touch. */
  fieldScope:   string | undefined
  /**
   * Optional active text selection — for selection-mode runs initiated by the
   * floating selection toolbar's `✦` button. Persisted so the continuation
   * pass restores selection mode (toolkit filter + prompt block) on the
   * resumed agent context. Without this, a continuation would silently fall
   * out of selection mode and the model would lose its constraints.
   */
  selection:    { field: string; text: string } | undefined
  /**
   * Tool call ids that were pending CLIENT-side when the run paused. The
   * continuation request MUST contain a tool result message for each of
   * these ids (otherwise the loop has nothing to resume with).
   */
  pendingToolCallIds: string[]
  /**
   * Tool call ids whose results were already produced server-side during
   * the initial run (`read_record`, `update_field`, `edit_text`, etc.). The
   * continuation request MAY include tool result messages for these ids,
   * because the browser mirrors the full SSE wire log into its
   * continuation body — see mixed-tool-continuation-plan.md. Any tool
   * result id that's NOT in `pendingToolCallIds ∪ serverToolCallIds` is a
   * forgery attempt and gets rejected.
   */
  serverToolCallIds:  string[]
  /** User id captured at run start — continuation must come from the same user. */
  userId: string | undefined
}

async function loadCache(): Promise<{
  set:    (key: string, value: unknown, ttl?: number) => Promise<void>
  get:    <T = unknown>(key: string) => Promise<T | null>
  forget: (key: string) => Promise<void>
}> {
  try {
    const mod = await import(/* @vite-ignore */ '@rudderjs/cache') as any
    return mod.Cache
  } catch {
    throw new Error(
      '[panels/agentStream/runStore] @rudderjs/cache is required for standalone ' +
      'agent runs that use client tools or approval gates. Install @rudderjs/cache ' +
      'and register the cache() service provider in your bootstrap/providers.ts.',
    )
  }
}

/** Store run state under a fresh runId. The caller emits the runId to the browser. */
export async function storeRun(runId: string, state: AgentRunState): Promise<void> {
  const Cache = await loadCache()
  await Cache.set(`${KEY_PREFIX}${runId}`, state, TTL_SECONDS)
}

/** Look up run state by id. Returns null if missing or expired. */
export async function loadRun(runId: string): Promise<AgentRunState | null> {
  const Cache = await loadCache()
  return Cache.get<AgentRunState>(`${KEY_PREFIX}${runId}`)
}

/**
 * Atomic read + delete (Cache.pull). Use this on successful continuation
 * completion so the runId can't be reused.
 */
export async function consumeRun(runId: string): Promise<AgentRunState | null> {
  const Cache = await loadCache()
  // Cache.pull is read-and-delete in one call
  const state = await Cache.get<AgentRunState>(`${KEY_PREFIX}${runId}`)
  if (state !== null) await Cache.forget(`${KEY_PREFIX}${runId}`)
  return state
}

// ─── Sub-agent run state (subagent-client-tools-plan Phase 1) ──────────────

/**
 * State persisted between an initial chat-level `run_agent` call that
 * invoked a sub-agent, and its continuation after the browser executes the
 * client tools the sub-agent paused on.
 *
 * Stored under `panels:subagent-run:${subRunId}`. Structurally distinct
 * from `AgentRunState` because the lifecycle is different: sub-runs are
 * owned by the parent chat loop, resumed by feeding tool results back into
 * the sub-agent, and on completion their final result is injected into the
 * parent's `run_agent` tool call result — the parent chat loop then
 * continues. Sub-runs are NOT reachable via the standalone `/agents/<slug>`
 * endpoints; they only live inside the chat `/continue` dispatch.
 *
 * See `docs/plans/subagent-client-tools-plan.md` Phase 1.
 *
 * **Important:** the `record` is NOT stored here. Per R6 in the plan,
 * the record is rehydrated from the model + Yjs on every continuation so
 * stale snapshots can't overwrite fresher state.
 */
export interface SubRunState {
  /** Kind discriminator — future-proofs the store if we add more run kinds. */
  kind:             'subagent'
  /** Slug of the `PanelAgent` the parent chat dispatched via `run_agent`. */
  subAgentSlug:     string
  /** The id of the `run_agent` tool call in the PARENT message history. */
  parentToolCallId: string
  /** Resource slug — used to rehydrate the sub-agent's context on resume. */
  resourceSlug:     string
  /** Record id — same. */
  recordId:         string
  /**
   * Optional field-scope passed into the sub-agent's `PanelAgentContext`
   * (e.g. when a built-in action like `rewrite` dispatches a scoped sub
   * run). Persisted so continuation rebuilds the same toolkit allowlist.
   */
  fieldScope:       string[] | undefined
  /**
   * Sub-agent message history up to the pause point, captured from
   * `response.steps.map(s => s.message)` at suspend time. On resume, the
   * incoming tool-result messages are appended to this and passed into
   * `subAgent.stream('', { messages: ... })` so the loop continues exactly
   * where it left off.
   */
  subMessages:      AiMessage[]
  /**
   * Client tool call ids the sub-agent is waiting on. The continuation
   * request must carry a tool-result message for each of these ids; any id
   * not in this list is rejected (same forgery-guard shape as
   * `AgentRunState.pendingToolCallIds`).
   */
  pendingToolCallIds: string[]
  /**
   * Accumulated steps across all pauses so far. Per R4 in the plan, the
   * final `run_agent` result reported to the parent must sum all
   * sub-resumes — a single suspend+resume must not show as "2 steps total"
   * when it actually ran 5. Incremented on every resume.
   */
  stepsSoFar:       number
  /** Accumulated token usage across all pauses. Paired with `stepsSoFar`. */
  tokensSoFar:      number
  /** User id captured at parent dispatch — continuation must come from the same user. */
  userId:           string | undefined
}

/** Store sub-run state under a fresh subRunId. */
export async function storeSubRun(subRunId: string, state: SubRunState): Promise<void> {
  const Cache = await loadCache()
  await Cache.set(`${SUBAGENT_KEY_PREFIX}${subRunId}`, state, TTL_SECONDS)
}

/** Look up sub-run state by id. Returns null if missing or expired. */
export async function loadSubRun(subRunId: string): Promise<SubRunState | null> {
  const Cache = await loadCache()
  return Cache.get<SubRunState>(`${SUBAGENT_KEY_PREFIX}${subRunId}`)
}

/**
 * Atomic read + delete. Use on successful sub-run completion so the
 * subRunId can't be reused. On a subsequent pause (sub-agent pauses again
 * mid-resume), the resume handler must `consumeSubRun` + `storeSubRun`
 * with a fresh id — same pattern the standalone runner uses.
 */
export async function consumeSubRun(subRunId: string): Promise<SubRunState | null> {
  const Cache = await loadCache()
  const state = await Cache.get<SubRunState>(`${SUBAGENT_KEY_PREFIX}${subRunId}`)
  if (state !== null) await Cache.forget(`${SUBAGENT_KEY_PREFIX}${subRunId}`)
  return state
}

/* eslint-enable @typescript-eslint/no-explicit-any */
