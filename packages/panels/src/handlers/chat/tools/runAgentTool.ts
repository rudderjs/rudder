import type { PanelAgent, PanelAgentContext } from '../../../agents/PanelAgent.js'
import { loadAi } from '../lazyImports.js'
import { storeSubRun, type SubRunState } from '../../agentStream/runStore.js'

/**
 * Lazy `node:crypto` loader. Top-level `import { randomUUID } from 'node:crypto'`
 * gets externalized by Vite during client bundling (panels' pages import
 * from the same package entry), crashing the browser at module load. The
 * lazy import is only reached server-side when the tool actually executes.
 * See `feedback_production_build.md` in memory for the pattern.
 */
async function loadRandomUUID(): Promise<() => string> {
  const mod = await import(/* @vite-ignore */ 'node:crypto') as { randomUUID: () => string }
  return mod.randomUUID
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Update payloads streamed while a sub-agent runs. Each `yield` from the
 * generator below surfaces as a `tool-update` chunk in `@rudderjs/ai`'s
 * stream, then as a `tool_update` SSE event, then as one entry in the
 * `updates` array passed to the registered `agentRunRenderer`. The
 * renderer keys off `kind` to drive its inline visualization.
 */
export type RunAgentUpdate =
  | { kind: 'agent_start';      agentSlug: string; agentLabel: string }
  | { kind: 'tool_call';        tool: string; input?: Record<string, unknown> | undefined }
  | { kind: 'agent_complete';   steps: number; tokens: number }
  | { kind: 'subagent_paused';  subRunId: string; pendingToolCallIds: string[] }

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
 * Authored as an `async function*` so preliminary progress flows through
 * the agent stream — middleware sees it, the SSE forwarder picks it up
 * automatically, and the panels chat UI renders it inline via the
 * `agentRunRenderer` registered in `AiChatPanel.tsx`.
 *
 * **Sub-agent client-tool suspension (subagent-client-tools-plan Phase 2):**
 * When the sub-agent's model calls a client tool like `update_form_state`,
 * its loop pauses with `finishReason === 'client_tool_calls'`. This tool
 * then:
 *
 *   1. Snapshots the sub-agent's messages from `response.steps`.
 *   2. Stores a `SubRunState` under a fresh `subRunId` so the chat
 *      continuation dispatcher can resume the same sub-agent later.
 *   3. Throws `PauseLoopForClientTools` — which the `@rudderjs/ai` loop
 *      catches, adds to its own `pendingClientToolCalls`, and breaks out
 *      of. The parent chat SSE stream then emits `pending_client_tools`
 *      with the SUB-AGENT's call ids, the browser executes them, and
 *      on `/continue` the chat handler resolves the subRunId, resumes
 *      the sub-agent with the results, and eventually feeds the final
 *      text back into the parent's `run_agent` tool result.
 *
 * `.modelOutput(...)` narrows what the parent model sees on its next step
 * to a one-line summary plus the sub-agent's final text.
 */
export async function buildRunAgentTool(
  agents:   PanelAgent[],
  agentCtx: PanelAgentContext,
  message:  string,
  ownerInfo: { userId: string | undefined; resourceSlug: string; recordId: string },
) {
  const slugs = agents.map(a => a.getSlug())
  if (slugs.length === 0) return null

  const { toolDefinition, z, pauseForClientTools } = await loadAi()

  return toolDefinition({
    name: 'run_agent',
    description: 'Run a resource agent. Available agents: ' + slugs.join(', '),
    inputSchema: z.object({
      agentSlug: z.enum(slugs as [string, ...string[]]),
    }),
  })
    .server(async function* (
      input: { agentSlug: string },
      ctx?: { toolCallId: string },
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

      // `stop-on-client-tool` is what makes the sub-agent pause when its
      // model emits a client-tool call instead of trying to "execute" the
      // client tool server-side (which would no-op and lie to the model).
      const { stream: agentStream, response: agentResponse } =
        await targetAgent.stream(agentCtx, message, {
          toolCallStreamingMode: 'stop-on-client-tool',
        })

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

      // Sub-agent paused on a client tool. Persist its state + pending
      // calls + propagate the pause upward to the parent chat loop.
      if (result.finishReason === 'client_tool_calls') {
        const pending = result.pendingClientToolCalls ?? []

        if (!ctx?.toolCallId) {
          // Defensive: the parent loop should always pass ToolCallContext
          // (Phase 0 landed that). If it's missing we can't persist the
          // parent-side pointer to resume later, so fail loudly instead
          // of silently dropping the sub-agent's pending calls.
          throw new Error(
            '[run_agent] missing ToolCallContext; cannot suspend sub-agent without parent toolCallId',
          )
        }

        const randomUUID = await loadRandomUUID()
        const subRunId = randomUUID()
        // Reconstruct the full sub-agent message history from the
        // response steps. CANNOT just do `steps.map(s => s.message)` —
        // that produces ONLY the assistant messages and loses every
        // server-side tool result between them, which the provider then
        // rejects on resume with "tool_calls must be followed by tool
        // messages." We need to interleave each step's tool results
        // inline with its assistant message, matching what the loop
        // pushes internally via `applyToModelOutput`'s default stringify.
        // Also prepend the original user prompt — the sub-agent sees
        // it when `subAgent.stream(ctx, message)` is called for the
        // initial run, but `messages`-mode resume requires it to live
        // in the messages array explicitly.
        const subMessages: any[] = [{ role: 'user', content: message }]
        for (const step of result.steps) {
          subMessages.push(step.message)
          for (const tr of step.toolResults as Array<{ toolCallId: string; result: unknown }>) {
            subMessages.push({
              role:       'tool',
              content:    typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result),
              toolCallId: tr.toolCallId,
            })
          }
        }
        const subRunState: SubRunState = {
          kind:             'subagent',
          subAgentSlug:     targetAgent.getSlug(),
          parentToolCallId: ctx.toolCallId,
          resourceSlug:     ownerInfo.resourceSlug,
          recordId:         ownerInfo.recordId,
          fieldScope:       agentCtx.fieldScope ?? undefined,
          subMessages,
          pendingToolCallIds: pending.map((c: any) => c.id),
          stepsSoFar:       steps,
          tokensSoFar:      tokens,
          userId:           ownerInfo.userId,
        }
        await storeSubRun(subRunId, subRunState)

        // Tool-update yield so the UI's agentRunRenderer can show a
        // "paused, waiting on browser" state inside the same run card,
        // rather than flipping to a separate `update_form_state` card.
        yield {
          kind:              'subagent_paused',
          subRunId,
          pendingToolCallIds: subRunState.pendingToolCallIds,
        }

        // Propagate the sub-agent's pending calls to the parent loop as
        // if the parent model itself had emitted them. The agent loop's
        // generator iterator recognizes this control chunk (see tool.ts
        // `isPauseForClientToolsChunk`), appends the toolCalls to
        // pendingClientToolCalls, sets stop-for-client-tools, and halts
        // iteration. The run_agent tool call stays orphaned in parent
        // messages until the chat continuation dispatcher resolves it
        // (Phase 3).
        yield pauseForClientTools(pending, subRunId)
        // Unreachable: the parent loop halts consumption of this
        // generator after the pause chunk, so no further yields or
        // returns are observed. The return is here only to satisfy the
        // AsyncGenerator<..., RunAgentResult, void> contract.
        return {
          agentSlug: targetAgent.getSlug(),
          label,
          text:      '',
          steps,
          tokens,
        }
      }

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
