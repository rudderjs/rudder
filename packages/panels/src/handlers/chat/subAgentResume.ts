/**
 * Sub-agent resume dispatcher — Phase 3 of subagent-client-tools-plan.
 *
 * When a chat turn pauses because a sub-agent (dispatched via the
 * `run_agent` tool) yielded a `pause_for_client_tools` control chunk,
 * the browser executes those client tool calls and POSTs the results
 * back to `/chat` with `body.subRunId` set. That routes here.
 *
 * Responsibilities:
 *   1. Load `SubRunState` from the runStore (410 on miss).
 *   2. Validate userId + resource context match stored values (forgery
 *      guard — a different user can't hijack a pending sub-run).
 *   3. Extract tool-result messages from `body.messages` matching
 *      `SubRunState.pendingToolCallIds`. Any id not in the stored set
 *      is rejected.
 *   4. Rebuild the sub-agent with a fresh `PanelAgentContext` (per R6:
 *      record rehydrated from the model + Yjs, NOT loaded from the
 *      stored snapshot — which could be stale).
 *   5. Run `subAgent.stream('', { messages: subMessages ∪ toolResults })`
 *      with `stop-on-client-tool` mode again. Forward chunks to SSE.
 *   6. Branch on outcome:
 *      a. Paused again → store a fresh `SubRunState` with accumulated
 *         steps/tokens, emit `pending_client_tools`, done.
 *      b. Completed → build `run_agent` tool result, load parent
 *         conversation history from the store, append a synthetic
 *         tool-result message for the ORPHAN `run_agent` call, rebuild
 *         the parent chat agent, run it to completion (or the next
 *         pause), forward its chunks, persist.
 *
 * Crucially: the parent conversation store is NEVER updated with the
 * sub-agent's own tool-result messages — those are internal to the sub
 * run. Only the final `run_agent` tool result (a single tool message)
 * ever lands in the parent history. This keeps the parent message graph
 * clean and avoids schema pollution: the parent's
 * `assistant: <tool_call run_agent>` gets exactly one matching
 * `tool: <result>`, same as any other server tool.
 */

import type { AppRequest } from '@rudderjs/core'
import type { AiMessage, AgentResponse } from '@rudderjs/ai'
import type { Panel } from '../../Panel.js'
import type { ChatRequestBody, ConversationStoreLike, SSESend } from './types.js'
import type { ChatContext } from './contexts/types.js'
import { ResourceChatContext } from './contexts/ResourceChatContext.js'
import { ChatContextError } from './contexts/types.js'
import { extractUserId } from './types.js'
import { loadAi } from './lazyImports.js'
import { streamAgentToSSE } from '../agentStream/index.js'
import { consumeSubRun, storeSubRun, type SubRunState } from '../agentStream/runStore.js'
import type { PanelAgent } from '../../agents/PanelAgent.js'

/**
 * Lazy `node:crypto` loader — same rationale as in `runAgentTool.ts`.
 * Top-level `node:crypto` imports get externalized by Vite during client
 * bundling even if this file is only server-reachable, because panels
 * pages import from the same package entry. The lazy import is only
 * reached server-side inside the sub-run resume path.
 */
async function loadRandomUUID(): Promise<() => string> {
  const mod = await import(/* @vite-ignore */ 'node:crypto') as { randomUUID: () => string }
  return mod.randomUUID
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export class SubRunError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'SubRunError'
  }
}

export interface SubAgentResumeDeps {
  req:             AppRequest
  body:            ChatRequestBody
  panel:           Panel
  send:            SSESend
  close:           () => void
  store:           ConversationStoreLike | null
  conversationId:  string | undefined
}

/**
 * Entry point for a sub-run continuation request. Called from
 * `chatHandler` when `body.subRunId` is set. Returns nothing — all
 * output goes through `send` / `close`.
 */
export async function handleSubAgentResume(deps: SubAgentResumeDeps): Promise<void> {
  const { req, body, panel, send, close, store, conversationId } = deps
  const subRunId = body.subRunId!

  try {
    // 1. Consume sub-run state (atomic read + delete). If the sub-run
    //    pauses AGAIN during resume, a fresh id is stored below.
    const state = await consumeSubRun(subRunId)
    if (!state) {
      throw new SubRunError(410, `Sub-run "${subRunId}" not found or expired.`)
    }

    // 2. Forgery guards — the browser is trusted to SEND the subRunId,
    //    but not trusted to own it. Cross-check ownership signals.
    const currentUserId = extractUserId(req)
    if (state.userId && state.userId !== currentUserId) {
      throw new SubRunError(403, 'Sub-run belongs to a different user.')
    }
    if (body.resourceContext) {
      if (body.resourceContext.resourceSlug !== state.resourceSlug ||
          body.resourceContext.recordId     !== state.recordId) {
        throw new SubRunError(400, 'Sub-run resource context does not match request.')
      }
    }

    // 3. Synthesize resourceContext in the body so resolveContext can
    //    build a ResourceChatContext — we need the rehydrated record +
    //    fieldMeta + agents list anyway, and going through the public
    //    context resolver keeps policy checks consistent with the
    //    fresh-prompt path.
    const synthBody: ChatRequestBody = {
      ...body,
      resourceContext: {
        resourceSlug: state.resourceSlug,
        recordId:     state.recordId,
      },
    }

    // Per R6: the ResourceChatContext.create path re-loads the record
    // from the model + overlays Yjs fields, so `context.record` is
    // fresh — NOT the stale snapshot from SubRunState.
    const context = await ResourceChatContext.create({ body: synthBody, panel, req })

    // 4. Look up the sub-agent by slug on the rebuilt context.
    const agents = (context as any).state.agents as PanelAgent[]
    const subAgent = agents.find(a => a.getSlug() === state.subAgentSlug)
    if (!subAgent) {
      throw new SubRunError(
        410,
        `Sub-agent "${state.subAgentSlug}" no longer exists on resource "${state.resourceSlug}".`,
      )
    }

    // 5. Extract tool-result messages from the dedicated
    //    `body.subAgentToolResults` field. The browser keeps these out
    //    of its parent-level wire log (`body.messages`) so the parent
    //    conversation never sees sub-agent internals. We require every
    //    id in `pendingToolCallIds` to have a matching entry; extras
    //    (ids not in the stored set) are silently dropped as forgery-
    //    resistance.
    const allowed = new Set(state.pendingToolCallIds)
    const incomingResults: AiMessage[] = (body.subAgentToolResults ?? []).filter(
      m => m.role === 'tool' && m.toolCallId != null && allowed.has(m.toolCallId),
    )
    const seen = new Set(incomingResults.map(m => m.toolCallId!))
    const missing = state.pendingToolCallIds.filter(id => !seen.has(id))
    if (missing.length > 0) {
      throw new SubRunError(
        400,
        `Sub-run continuation missing tool results for: ${missing.join(', ')}`,
      )
    }

    // 6. Rebuild the PanelAgentContext via the same internals Phase 2's
    //    runAgentTool used. The context carries `record`, `fieldMeta`,
    //    `builderCatalog` (so the resumed sub-agent still knows which
    //    block types it can insert/update), and optional `fieldScope`.
    const fieldMeta       = (context as any).state.agentCtx.fieldMeta
    const builderCatalog  = (context as any).state.agentCtx.builderCatalog
    const agentCtx = {
      record:       (context as any).state.record,
      resourceSlug: state.resourceSlug,
      recordId:     state.recordId,
      panelSlug:    panel.getName(),
      fieldMeta,
      builderCatalog,
      ...(state.fieldScope ? { fieldScope: state.fieldScope } : {}),
    } as any

    // 7. Merge stored sub-messages with incoming tool-results and resume
    //    the sub-agent. The stream mode stays `stop-on-client-tool` so
    //    another pause inside this resume is handled identically.
    const subMessages: AiMessage[] = [...state.subMessages, ...incomingResults]

    const subStreamOpts: any = {
      toolCallStreamingMode: 'stop-on-client-tool',
      messages: subMessages,
    }
    if (body.approvedToolCallIds && body.approvedToolCallIds.length > 0) {
      subStreamOpts.approvedToolCallIds = body.approvedToolCallIds
    }
    if (body.rejectedToolCallIds && body.rejectedToolCallIds.length > 0) {
      subStreamOpts.rejectedToolCallIds = body.rejectedToolCallIds
    }

    const { stream: subStream, response: subResponse } =
      await subAgent.stream(agentCtx, '', subStreamOpts)

    // CRITICAL: the sub-agent's text / tool_call / tool_result events
    // must NOT become top-level chat-bubble events on the wire, because
    // (a) they're internal to the sub-run and shouldn't pollute the
    // parent conversation's persisted history, and (b) the browser
    // assembles a single assistant message from `text` events, so
    // concatenating sub-agent text with parent text would misorder the
    // wire log and break subsequent continuation prefix checks.
    //
    // Solution: during the sub-agent phase, translate each wire event
    // into a `tool_update` on the PARENT's `run_agent` tool-call id.
    // The browser already aggregates tool_update payloads under each
    // tool-call part via `toolRenderers`, so the run_agent inline card
    // visibly updates mid-resume while the parent wire log stays clean.
    // The `pending_client_tools` case still gets forwarded as a
    // top-level event — it IS a control signal the browser must act
    // on, and we re-route it through the caller's own block below.
    const subSend: SSESend = (event, data) => {
      if (event === 'pending_client_tools') {
        // Let the outer caller's 9a branch handle it — don't double-send.
        // (Sub-agent pauses end the stream; this path is only reached if
        // streamAgentToSSE's internals emit pending-client-tools before
        // resolving the response.)
        return
      }
      send('tool_update', {
        id:    state.parentToolCallId,
        tool:  'run_agent',
        update: {
          kind:     'subagent_event',
          subEvent: event,
          data,
        },
      })
    }
    const subResult = await streamAgentToSSE({ stream: subStream, response: subResponse, send: subSend })

    // 8. Accumulate totals across all pauses so far.
    const totalSteps  = state.stepsSoFar  + subResult.steps.length
    const totalTokens = state.tokensSoFar + (subResult.usage?.totalTokens ?? 0)

    // 9a. Sub-agent paused AGAIN. Store a fresh SubRunState (new id),
    //     emit pending_client_tools, done for this turn.
    if (subResult.finishReason === 'client_tool_calls') {
      const newPending = subResult.pendingClientToolCalls ?? []
      const randomUUID = await loadRandomUUID()
      const newSubRunId = randomUUID()
      // Same reconstruction pattern as runAgentTool's initial pause:
      // interleave each step's assistant message with its tool-result
      // messages so the next resume's provider call sees a valid
      // `assistant{tool_calls} → tool` pairing for every id. The
      // pre-existing `subMessages` already contains the user prompt +
      // all prior rounds, so we only append this resume's new deltas.
      const newSubMessages: AiMessage[] = [...subMessages]
      for (const step of subResult.steps) {
        newSubMessages.push(step.message)
        for (const tr of step.toolResults) {
          newSubMessages.push({
            role:       'tool',
            content:    typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result),
            toolCallId: tr.toolCallId,
          })
        }
      }
      const newState: SubRunState = {
        kind:             'subagent',
        subAgentSlug:     state.subAgentSlug,
        parentToolCallId: state.parentToolCallId,
        resourceSlug:     state.resourceSlug,
        recordId:         state.recordId,
        fieldScope:       state.fieldScope ?? undefined,
        subMessages:      newSubMessages,
        pendingToolCallIds: newPending.map(c => c.id),
        stepsSoFar:       totalSteps,
        tokensSoFar:      totalTokens,
        userId:           state.userId,
      }
      await storeSubRun(newSubRunId, newState)

      // Piggyback a tool_update on the run_agent tool-call id in the
      // parent UI so the same agentRunRenderer card shows the new
      // paused state with the new subRunId the browser should send on
      // its next continuation.
      send('tool_update', {
        id:    state.parentToolCallId,
        tool:  'run_agent',
        update: {
          kind:              'subagent_paused',
          subRunId:          newSubRunId,
          pendingToolCallIds: newState.pendingToolCallIds,
        },
      })
      send('pending_client_tools', { toolCalls: newPending })
      // Browser wire-log sync: the PARENT conversation has not changed
      // during a sub-run pause-to-pause-again turn — the parent's last
      // assistant message is still the same orphan `run_agent` tool
      // call. Emit the current persisted parent history so the browser
      // can ignore any ghost messages its default stream-close assembly
      // would otherwise append (e.g. an empty `assistant` from a turn
      // that produced no parent-level text).
      if (store && conversationId) {
        const parentHistory = await store.load(conversationId)
        send('wire_log_sync', { messages: parentHistory })
      }
      send('complete', {
        done:     false,
        awaiting: 'client_tools',
        usage:    subResult.usage,
        steps:    subResult.steps.length,
      })
      return
    }

    // 9b. Sub-agent COMPLETED. Build the run_agent tool result, inject
    //     into the parent conversation, and drive the parent loop.
    const runAgentResult = {
      agentSlug: subAgent.getSlug(),
      label:     (subAgent as any)._label as string,
      text:      subResult.text,
      steps:     totalSteps,
      tokens:    totalTokens,
    }
    const runAgentResultStr =
      `Agent "${runAgentResult.label}" finished (${runAgentResult.steps} step${runAgentResult.steps === 1 ? '' : 's'}, ${runAgentResult.tokens} tokens). Result: ${runAgentResult.text}`

    // Tell the agentRunRenderer card to display the final totals in
    // its footer. Accumulated across every pause so the step count
    // matches what the sub-agent actually ran, not just this last
    // resume's delta. (Phase 4 of subagent-client-tools-plan.)
    send('tool_update', {
      id:   state.parentToolCallId,
      tool: 'run_agent',
      update: {
        kind:   'agent_complete',
        steps:  totalSteps,
        tokens: totalTokens,
      },
    })

    // Emit the delayed tool_result SSE for the ORPHAN run_agent call so
    // the browser's assistant bubble completes the run_agent tool card.
    send('tool_result', {
      id:         state.parentToolCallId,
      tool:       'run_agent',
      toolCallId: state.parentToolCallId,
      content:    runAgentResultStr,
    })

    // Resume the PARENT chat agent. Load its history from the store so
    // the sub-agent's internal tool-result messages don't leak in.
    if (!store || !conversationId) {
      // No conversation store → nothing to resume against. Unusual but
      // possible in stateless mode. Emit a final complete and return.
      send('complete', { done: true, usage: subResult.usage, steps: subResult.steps.length })
      return
    }

    const parentHistory = await store.load(conversationId)
    const parentMessagesWithResult: AiMessage[] = [
      ...parentHistory,
      { role: 'tool', content: runAgentResultStr, toolCallId: state.parentToolCallId },
    ]

    await resumeParent({
      context,
      body,
      parentMessages: parentMessagesWithResult,
      runAgentToolMessage: { role: 'tool', content: runAgentResultStr, toolCallId: state.parentToolCallId },
      send,
      store,
      conversationId,
    })
  } catch (err) {
    if (err instanceof SubRunError) {
      send('error', { message: err.message, status: err.status })
    } else if (err instanceof ChatContextError) {
      send('error', { message: err.message, status: err.status })
    } else {
      send('error', { message: err instanceof Error ? err.message : 'Sub-run resume failed.' })
    }
  } finally {
    close()
  }
}

interface ResumeParentDeps {
  context:             ChatContext
  body:                ChatRequestBody
  parentMessages:      AiMessage[]
  runAgentToolMessage: AiMessage
  send:                SSESend
  store:               ConversationStoreLike
  conversationId:      string
}

/**
 * Drive the parent chat agent forward after the sub-agent completed.
 * The parent history is loaded fresh from the store and then extended
 * with the synthetic run_agent tool-result message.
 *
 * Persistence: we append both the tool-result message and every new
 * step from the parent's continuation to the store, mirroring what
 * `persistContinuation` does for normal continuations. The sub-agent's
 * internal tool-result messages are NEVER persisted to the parent
 * conversation.
 */
async function resumeParent(deps: ResumeParentDeps): Promise<void> {
  const { context, body, parentMessages, runAgentToolMessage, send, store, conversationId } = deps

  const { agent: agentFn } = await loadAi()
  const systemPrompt = context.buildSystemPrompt()
  const tools = context.buildTools()

  const a = agentFn({
    instructions: systemPrompt,
    tools:        tools.length > 0 ? tools : undefined,
    model:        body.model,
  })

  const promptOpts: any = {
    toolCallStreamingMode: 'stop-on-client-tool',
    messages: parentMessages,
  }
  if (body.approvedToolCallIds && body.approvedToolCallIds.length > 0) {
    promptOpts.approvedToolCallIds = body.approvedToolCallIds
  }
  if (body.rejectedToolCallIds && body.rejectedToolCallIds.length > 0) {
    promptOpts.rejectedToolCallIds = body.rejectedToolCallIds
  }

  const { stream, response } = a.stream('', promptOpts)
  const result = await streamAgentToSSE({ stream, response, send })

  // Persist: always append the synthetic run_agent tool-result message
  // first (it wasn't in the store before this turn), then the parent's
  // new steps. Mirror the shape persistContinuation would produce if it
  // had been given these as clientAppended + result.
  const messagesToAppend: AiMessage[] = [runAgentToolMessage]
  for (const step of result.steps) {
    messagesToAppend.push(step.message)
    for (const tr of step.toolResults) {
      messagesToAppend.push({
        role:       'tool',
        content:    typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result),
        toolCallId: tr.toolCallId,
      })
    }
  }
  if (messagesToAppend.length > 0) {
    await store.append(conversationId, messagesToAppend)
  }

  // Browser wire-log sync: after a sub-run completion + parent resume,
  // the persisted parent history is:
  //   [... prior turns ..., assistant+tc_runAgent, tool(runAgentResult),
  //    parent_final_assistant, ... any parent tool results ...]
  // The browser's default stream-close assembly would interleave these
  // in the wrong order (it buckets `serverToolResults` AFTER
  // `assistantMsg`, which inverts tool(runAgentResult) vs
  // parent_final_assistant). Authoritative fix: hand the browser the
  // exact persisted messages so it can replace its wire log verbatim.
  const freshParentHistory = await store.load(conversationId)
  send('wire_log_sync', { messages: freshParentHistory })

  // Final terminal event for this turn — same branching as runChat.
  if (result.finishReason === 'client_tool_calls') {
    send('complete', { done: false, awaiting: 'client_tools', usage: result.usage, steps: result.steps.length })
  } else if (result.finishReason === 'tool_approval_required') {
    send('complete', { done: false, awaiting: 'approval', usage: result.usage, steps: result.steps.length })
  } else {
    send('complete', { done: true, usage: result.usage, steps: result.steps.length })
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */
