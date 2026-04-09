import type { PanelAgent, PanelAgentContext } from '../../../agents/PanelAgent.js'
import { loadAi } from '../lazyImports.js'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Update payloads streamed while a sub-agent runs. Each `yield` from the
 * generator below surfaces as a `tool-update` chunk in `@rudderjs/ai`'s
 * stream, then as a `tool_update` SSE event, then as one entry in the
 * `updates` array passed to the registered `agentRunRenderer`. The
 * renderer keys off `kind` to drive its inline visualization.
 */
export type RunAgentUpdate =
  | { kind: 'agent_start';    agentSlug: string; agentLabel: string }
  | { kind: 'tool_call';      tool: string; input?: Record<string, unknown> | undefined }
  | { kind: 'agent_complete'; steps: number; tokens: number }

/**
 * Final structured value the tool returns. The full object is what
 * `step.toolResults` and the `tool-result` SSE chunk both carry; the parent
 * model only sees the string produced by `.modelOutput(...)` below.
 */
export interface RunAgentResult {
  agentSlug: string
  label:     string
  text:      string
  steps:     number
  tokens:    number
}

/**
 * Build the `run_agent` tool for the chat dispatcher.
 *
 * Authored as an `async function*` (Phase 1 of `ai-loop-parity-plan`) so
 * preliminary progress flows through the agent stream — middleware sees it,
 * the SSE forwarder picks it up automatically, and the panels chat UI
 * renders it inline via the `agentRunRenderer` registered in
 * `AiChatPanel.tsx`. There is no `send` callback anymore: this used to take
 * an `SSESend` so it could call `send('agent_start' | 'tool_call' |
 * 'agent_complete', ...)` directly, bypassing the loop. That bypass is gone.
 *
 * `.modelOutput(...)` (Phase 2) narrows what the parent model sees on its
 * next step to a one-line summary plus the sub-agent's final text — it does
 * NOT include the per-step transcript, which is what kept eating parent
 * context windows.
 */
export async function buildRunAgentTool(
  agents:   PanelAgent[],
  agentCtx: PanelAgentContext,
  message:  string,
) {
  const slugs = agents.map(a => a.getSlug())
  if (slugs.length === 0) return null

  const { toolDefinition, z } = await loadAi()

  return toolDefinition({
    name: 'run_agent',
    description: 'Run a resource agent. Available agents: ' + slugs.join(', '),
    inputSchema: z.object({
      agentSlug: z.enum(slugs as [string, ...string[]]),
    }),
  })
    .server(async function* (
      input: { agentSlug: string },
    ): AsyncGenerator<RunAgentUpdate, RunAgentResult, void> {
      const targetAgent = agents.find(a => a.getSlug() === input.agentSlug)
      const label = ((targetAgent as any)?._label as string | undefined) ?? input.agentSlug

      if (!targetAgent) {
        return {
          agentSlug: input.agentSlug,
          label,
          text:      'Agent not found.',
          steps:     0,
          tokens:    0,
        }
      }

      yield {
        kind:       'agent_start',
        agentSlug:  targetAgent.getSlug(),
        agentLabel: label,
      }

      const { stream: agentStream, response: agentResponse } =
        await targetAgent.stream(agentCtx, message)

      for await (const chunk of agentStream) {
        if (chunk.type === 'tool-call' && chunk.toolCall?.name) {
          yield {
            kind:  'tool_call',
            tool:  chunk.toolCall.name,
            input: chunk.toolCall.arguments,
          }
        }
      }

      const result = await agentResponse
      const steps  = result.steps.length
      const tokens = result.usage?.totalTokens ?? 0

      yield { kind: 'agent_complete', steps, tokens }

      return {
        agentSlug: targetAgent.getSlug(),
        label,
        text:      result.text,
        steps,
        tokens,
      }
    })
    // Explicit annotation: `loadAi()` returns `toolDefinition: any` to keep
    // `@rudderjs/ai` from being a hard type dependency, so the whole
    // .server().modelOutput() chain is untyped at this call site. The
    // explicit `RunAgentResult` annotation restores the contract.
    .modelOutput((r: RunAgentResult) =>
      `Agent "${r.label}" finished (${r.steps} step${r.steps === 1 ? '' : 's'}, ${r.tokens} tokens). Result: ${r.text}`,
    )
}

/* eslint-enable @typescript-eslint/no-explicit-any */
