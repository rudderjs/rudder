/**
 * Shared agent-streaming helpers used by both the chat dispatcher
 * (`handlers/chat/chatHandler.ts`) and the standalone agent runner
 * (`handlers/agentRun.ts`).
 *
 * Phase 1 of `docs/plans/standalone-client-tools-plan.md` extracted the
 * inner SSE chunk-forwarding loop from `chatHandler.runChat` into this file
 * so the standalone path can reuse the same wire format. Phase 2 will add
 * client-tool round-trip + continuation helpers on top.
 *
 * **Scope of this module:**
 * - Forwarding `StreamChunk` events from `agent.stream()` onto an SSE wire
 * - Mapping `@rudderjs/ai` chunk types onto panels-side event names
 *
 * **Out of scope (kept in callers):**
 * - Constructing the agent (system prompt, tools, model)
 * - Persistence (chat-specific)
 * - The final `complete` SSE event (callers branch on awaiting state)
 * - Continuation prefix-checking / runStore (Phase 2)
 */

import type { AgentResponse, StreamChunk } from '@rudderjs/ai'
import type { SSESend } from '../chat/types.js'

export interface StreamAgentToSSEOptions {
  /** The stream returned by `agent.stream()` (chat) or `panelAgent.stream()` (standalone). */
  stream:   AsyncIterable<StreamChunk>
  /** The response promise from the same `.stream()` call. */
  response: Promise<AgentResponse>
  /** Callback for forwarding chunks to the wire. */
  send:     SSESend
}

/**
 * Run an agent's streaming loop and forward each chunk to the SSE wire.
 *
 * Maps `@rudderjs/ai` `StreamChunk` types onto the panels-side SSE event
 * names that the browser chat context (`AiChatContext.tsx`) and the
 * standalone agent runner (`AgentOutput.tsx` `useAgentRun`) consume:
 *
 *   text-delta            → event: text
 *   tool-call             → event: tool_call
 *   tool-update           → event: tool_update         (preliminary progress
 *                                                       from async-generator
 *                                                       tool executes — see
 *                                                       ai-loop-parity-plan)
 *   tool-result           → event: tool_result        (server-tool results,
 *                                                       see mixed-tool-continuation-plan.md)
 *   pending-client-tools  → event: pending_client_tools
 *   pending-approval      → event: tool_approval_required
 *
 * Returns the resolved `AgentResponse` so the caller can persist it and
 * emit its own final `complete` event with whatever metadata is
 * surface-appropriate (chat needs awaiting-state branching; standalone is
 * simpler).
 *
 * **Critical invariant:** the `tool_result` event's `content` string MUST
 * match what `persistence.ts` writes (string passthrough, otherwise
 * `JSON.stringify`) so the chat continuation prefix check passes. See
 * `docs/plans/mixed-tool-continuation-plan.md`.
 */
export async function streamAgentToSSE(opts: StreamAgentToSSEOptions): Promise<AgentResponse> {
  const { stream, response, send } = opts

  for await (const chunk of stream) {
    switch (chunk.type) {
      case 'text-delta':
        if (chunk.text) send('text', { text: chunk.text })
        break
      case 'tool-call':
        send('tool_call', {
          id:    chunk.toolCall?.id,
          tool:  chunk.toolCall?.name,
          input: chunk.toolCall?.arguments,
        })
        break
      case 'tool-update':
        // Preliminary progress payload from an async-generator tool. Pure UI
        // signal — NOT persisted (persistence.ts ignores it), NOT included in
        // the continuation prefix check (continuation.ts ignores it). The
        // browser-side chat context aggregates these per tool-call id.
        send('tool_update', {
          id:     chunk.toolCall?.id,
          tool:   chunk.toolCall?.name,
          update: chunk.update,
        })
        break
      case 'tool-result':
        send('tool_result', {
          id:         chunk.toolCall?.id,
          tool:       chunk.toolCall?.name,
          toolCallId: chunk.toolCall?.id,
          content:    typeof chunk.result === 'string' ? chunk.result : JSON.stringify(chunk.result),
        })
        break
      case 'pending-client-tools':
        send('pending_client_tools', { toolCalls: chunk.toolCalls ?? [] })
        break
      case 'pending-approval':
        send('tool_approval_required', {
          toolCall:     chunk.toolCall,
          isClientTool: chunk.isClientTool ?? false,
        })
        break
    }
  }

  return await response
}
