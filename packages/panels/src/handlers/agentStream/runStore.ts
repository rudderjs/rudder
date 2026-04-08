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

const KEY_PREFIX  = 'panels:agent-run:'
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

/* eslint-enable @typescript-eslint/no-explicit-any */
