/**
 * Tool renderer for the `run_agent` tool.
 *
 * The first canonical consumer of the {@link ./toolRenderers.ts} registry,
 * shipped together with the Phase 4 rewrite of `runAgentTool` in
 * `@rudderjs/panels/handlers/chat/tools/runAgentTool.ts`.
 *
 * The server-side tool is an `async function*` that yields update
 * payloads while a sub-agent runs. Kinds recognized by this card:
 *
 *   { kind: 'agent_start';     agentSlug, agentLabel }
 *   { kind: 'tool_call';       tool, input? }              // per sub-agent tool call
 *   { kind: 'subagent_paused'; subRunId, pendingToolCallIds } // sub-agent waiting on browser
 *   { kind: 'subagent_event';  subEvent, data }            // resume-phase wrapped events
 *   { kind: 'agent_complete';  steps, tokens }             // final totals (accumulated across resumes)
 *
 * `subagent_event` is emitted during Phase 3's sub-run resume path
 * (see `subAgentResume.ts`). Each wrapped event preserves its
 * original SSE event name in `subEvent` — specifically we pull
 * `tool_call` events out of those to keep the observed-tools list
 * growing as the sub-agent resumes.
 *
 * The full sub-agent transcript is intentionally NOT rendered here —
 * `.modelOutput(...)` hides it from the parent model (Phase 2) and we
 * keep it out of the chat bubble too. The card is a compact summary,
 * not a transcript viewer.
 */

import { SparklesIcon, CheckIcon, XIcon, Loader2Icon, HourglassIcon } from 'lucide-react'
import type { ToolRendererProps } from './toolRenderers.js'

interface AgentStartUpdate {
  kind:       'agent_start'
  agentSlug:  string
  agentLabel: string
}

interface ToolCallUpdate {
  kind:  'tool_call'
  tool:  string
  input?: Record<string, unknown> | undefined
}

interface SubAgentPausedUpdate {
  kind:               'subagent_paused'
  subRunId:           string
  pendingToolCallIds: string[]
}

interface SubAgentEventUpdate {
  kind:     'subagent_event'
  subEvent: string
  data:     unknown
}

interface AgentCompleteUpdate {
  kind:   'agent_complete'
  steps:  number
  tokens: number
}

type RunAgentUpdate =
  | AgentStartUpdate
  | ToolCallUpdate
  | SubAgentPausedUpdate
  | SubAgentEventUpdate
  | AgentCompleteUpdate

function isAgentStart(u: unknown): u is AgentStartUpdate {
  return typeof u === 'object' && u !== null && (u as { kind?: unknown }).kind === 'agent_start'
}
function isToolCall(u: unknown): u is ToolCallUpdate {
  return typeof u === 'object' && u !== null && (u as { kind?: unknown }).kind === 'tool_call'
}
function isSubAgentPaused(u: unknown): u is SubAgentPausedUpdate {
  return typeof u === 'object' && u !== null && (u as { kind?: unknown }).kind === 'subagent_paused'
}
function isSubAgentEvent(u: unknown): u is SubAgentEventUpdate {
  return typeof u === 'object' && u !== null && (u as { kind?: unknown }).kind === 'subagent_event'
}
function isAgentComplete(u: unknown): u is AgentCompleteUpdate {
  return typeof u === 'object' && u !== null && (u as { kind?: unknown }).kind === 'agent_complete'
}

/**
 * Extract a `ToolCallUpdate`-shaped row from either a direct
 * `tool_call` update (initial run) or a nested `subagent_event` with
 * `subEvent === 'tool_call'` (resume path). The wrapped shape carries
 * the original SSE event's `data: { id, tool, input }`.
 */
function toolCallFromUpdate(u: RunAgentUpdate): ToolCallUpdate | null {
  if (isToolCall(u)) return u
  if (isSubAgentEvent(u) && u.subEvent === 'tool_call') {
    const d = u.data as { tool?: string; input?: Record<string, unknown> } | null
    if (d && typeof d.tool === 'string') {
      const out: ToolCallUpdate = { kind: 'tool_call', tool: d.tool }
      if (d.input !== undefined) out.input = d.input
      return out
    }
  }
  return null
}

export function AgentRunRenderer({ args, updates, status }: ToolRendererProps) {
  const typedUpdates = updates as RunAgentUpdate[]
  const startUpdate    = typedUpdates.find(isAgentStart)
  const completeUpdate = typedUpdates.find(isAgentComplete)

  // Observed tool calls across the initial run + any sub-run resumes.
  const toolCalls: ToolCallUpdate[] = []
  for (const u of typedUpdates) {
    const tc = toolCallFromUpdate(u)
    if (tc) toolCalls.push(tc)
  }

  // Latest pause state: we care about the last `subagent_paused` event
  // because later ones supersede earlier ones across resume cycles.
  // When the sub-agent has resumed past a pause, the next observed
  // tool_call invalidates the "awaiting" state visually — we detect
  // that by comparing positions.
  let lastPauseIdx = -1
  let lastToolCallIdx = -1
  for (let i = 0; i < typedUpdates.length; i++) {
    const u = typedUpdates[i]!
    if (isSubAgentPaused(u)) lastPauseIdx = i
    if (toolCallFromUpdate(u) !== null) lastToolCallIdx = i
  }
  const pauseUpdate = lastPauseIdx >= 0 ? (typedUpdates[lastPauseIdx] as SubAgentPausedUpdate) : null
  const isAwaitingBrowser = pauseUpdate !== null
    && status === 'running'
    && lastPauseIdx > lastToolCallIdx

  // Fall back to args.agentSlug for the label if no agent_start has arrived
  // yet (e.g. the very first render between tool_call and the first yield).
  const argSlug = (args && typeof args === 'object'
    ? (args as { agentSlug?: string }).agentSlug
    : undefined) ?? '?'
  const label = startUpdate?.agentLabel ?? argSlug

  return (
    <div className="my-1 rounded-lg border border-border bg-muted/40 p-2.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
        {status === 'running' && !isAwaitingBrowser && (
          <Loader2Icon className="h-3 w-3 shrink-0 animate-spin text-primary" />
        )}
        {status === 'running' && isAwaitingBrowser && (
          <HourglassIcon className="h-3 w-3 shrink-0 text-amber-600 dark:text-amber-400" />
        )}
        {status === 'complete' && <CheckIcon className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />}
        {status === 'error' && <XIcon className="h-3 w-3 shrink-0 text-red-600 dark:text-red-400" />}
        <SparklesIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span>
          Sub-agent: <span className="font-mono">{label}</span>
        </span>
      </div>

      {toolCalls.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
          {toolCalls.map((tc, i) => (
            <li key={i} className="flex items-baseline gap-1.5">
              <span className="opacity-50">↳</span>
              <span className="font-mono">{tc.tool}</span>
              {tc.input && Object.keys(tc.input).length > 0 && (
                <span className="opacity-60 truncate">
                  {JSON.stringify(tc.input)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {isAwaitingBrowser && pauseUpdate && (
        <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-amber-700 dark:text-amber-300">
          <span className="opacity-60">⋯</span>
          <span>
            Awaiting browser — {pauseUpdate.pendingToolCallIds.length}{' '}
            pending client tool{pauseUpdate.pendingToolCallIds.length === 1 ? '' : 's'}
          </span>
        </div>
      )}

      {completeUpdate && (
        <div className="mt-1.5 text-[10px] text-muted-foreground">
          {completeUpdate.steps} step{completeUpdate.steps === 1 ? '' : 's'}
          {completeUpdate.tokens > 0 ? `, ${completeUpdate.tokens} tokens` : ''}
        </div>
      )}
    </div>
  )
}
