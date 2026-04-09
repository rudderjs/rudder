/**
 * Tool renderer for the `run_agent` tool.
 *
 * The first canonical consumer of the {@link ./toolRenderers.ts} registry,
 * shipped together with the Phase 4 rewrite of `runAgentTool` in
 * `@rudderjs/panels/handlers/chat/tools/runAgentTool.ts`.
 *
 * The server-side tool is now an `async function*` that yields three kinds
 * of update payloads while a sub-agent runs:
 *
 *   { kind: 'agent_start';    agentSlug, agentLabel }
 *   { kind: 'tool_call';      tool, input? }      // one per sub-agent tool call
 *   { kind: 'agent_complete'; steps, tokens }
 *
 * The chat context aggregates these into the `updates` prop on the matching
 * `tool_call` part. This component reads from `updates` to drive a small
 * collapsible inline card with a header (label + spinner while running),
 * a per-step list of observed tool calls, and a footer with the final
 * step/token count once `agent_complete` arrives or `status === 'complete'`.
 *
 * The full sub-agent transcript is intentionally NOT rendered here — it
 * never reaches the parent model thanks to `.modelOutput(...)` (Phase 2),
 * and it stays out of the chat bubble too.
 */

import { SparklesIcon, CheckIcon, XIcon, Loader2Icon } from 'lucide-react'
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

interface AgentCompleteUpdate {
  kind:   'agent_complete'
  steps:  number
  tokens: number
}

type RunAgentUpdate = AgentStartUpdate | ToolCallUpdate | AgentCompleteUpdate

function isAgentStart(u: unknown): u is AgentStartUpdate {
  return typeof u === 'object' && u !== null && (u as { kind?: unknown }).kind === 'agent_start'
}
function isToolCall(u: unknown): u is ToolCallUpdate {
  return typeof u === 'object' && u !== null && (u as { kind?: unknown }).kind === 'tool_call'
}
function isAgentComplete(u: unknown): u is AgentCompleteUpdate {
  return typeof u === 'object' && u !== null && (u as { kind?: unknown }).kind === 'agent_complete'
}

export function AgentRunRenderer({ args, updates, status }: ToolRendererProps) {
  const typedUpdates = updates as RunAgentUpdate[]
  const startUpdate    = typedUpdates.find(isAgentStart)
  const toolCalls      = typedUpdates.filter(isToolCall)
  const completeUpdate = typedUpdates.find(isAgentComplete)

  // Fall back to args.agentSlug for the label if no agent_start has arrived
  // yet (e.g. the very first render between tool_call and the first yield).
  const argSlug = (args && typeof args === 'object'
    ? (args as { agentSlug?: string }).agentSlug
    : undefined) ?? '?'
  const label = startUpdate?.agentLabel ?? argSlug

  return (
    <div className="my-1 rounded-lg border border-border bg-muted/40 p-2.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
        {status === 'running' && <Loader2Icon className="h-3 w-3 shrink-0 animate-spin text-primary" />}
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

      {completeUpdate && (
        <div className="mt-1.5 text-[10px] text-muted-foreground">
          {completeUpdate.steps} step{completeUpdate.steps === 1 ? '' : 's'}
          {completeUpdate.tokens > 0 ? `, ${completeUpdate.tokens} tokens` : ''}
        </div>
      )}
    </div>
  )
}
