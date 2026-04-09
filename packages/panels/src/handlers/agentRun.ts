import type { AppRequest, AppResponse } from '@rudderjs/core'
import type { Resource } from '../Resource.js'
import type { PanelAgent, PanelAgentContext } from '../agents/PanelAgent.js'
import type { ModelClass, RecordRow } from '../types.js'
import type { AiMessage, AgentResponse } from '@rudderjs/ai'
import { buildContext } from './shared/context.js'
import { streamAgentToSSE } from './agentStream/index.js'
import { storeRun, consumeRun, type AgentRunState } from './agentStream/runStore.js'
import { extractUserId } from './chat/types.js'
import { BuiltInAiActionRegistry } from '../ai-actions/registry.js'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * SSE streaming handler for running a `PanelAgent` against a record.
 *
 * `POST /{panel}/api/{resource}/:id/_agents/:agentSlug`
 *
 * Body (all optional):
 * - `input?:  string` — user instruction passed to the agent as the prompt
 * - `field?:  string` — field-scope override (per-field action button click)
 *
 * The response is `text/event-stream`. Events:
 *
 *   text                     → text-delta
 *   tool_call                → tool-call (model invoked a tool)
 *   tool_result              → tool-result (server tool finished, content forwarded)
 *   pending_client_tools     → loop paused, browser must execute and POST /continue
 *   tool_approval_required   → loop paused, user must approve and POST /continue
 *   run_started              → emitted ONCE per pause, carries `runId` for continuation
 *   complete                 → loop finished (or paused — `awaiting` carries the reason)
 *   error                    → fatal error
 *
 * Phase 2 of `docs/plans/standalone-client-tools-plan.md` upgraded this
 * handler to support client tools via the same round-trip protocol the chat
 * dispatcher uses, but using `@rudderjs/cache`-backed runStore for state
 * (no persisted conversation; standalone runs are single-session).
 */
export async function handleAgentRun(
  req: AppRequest,
  res: AppResponse,
  ResourceClass: typeof Resource,
  panelSlug: string,
): Promise<unknown> {
  const id        = (req.params as Record<string, string>)['id'] ?? ''
  const agentSlug = (req.params as Record<string, string>)['agentSlug'] ?? ''

  // ── Auth + record load + agent lookup ────────────────
  const setup = await loadAgentRunContext(req, res, ResourceClass, id, agentSlug, panelSlug)
  if ('errorResponse' in setup) return setup.errorResponse
  const { agentDef, agentCtx, fieldScope, selection, userId } = setup

  // ── Parse optional user input ──────────────────────────
  let input: string | undefined
  try {
    const body = req.body as Record<string, unknown> | undefined
    if (body && typeof body['input'] === 'string') input = body['input']
  } catch { /* no body */ }

  // ── Stream the agent loop ───────────────────────────────
  return streamAgentRunResponse(res, async (send) => {
    const { stream, response } = await agentDef.stream(agentCtx, input ?? 'Run your task on this record.', {
      toolCallStreamingMode: 'stop-on-client-tool',
    })

    const result = await streamAgentToSSE({ stream, response, send })
    await emitTerminalState(send, result, {
      agentSlug,
      resourceSlug: agentCtx.resourceSlug,
      recordId:     agentCtx.recordId,
      fieldScope,
      selection,
      userId,
    })
  })
}

/**
 * SSE continuation handler. Called by the browser after it executes a client
 * tool (or the user approves a tool call) and needs the agent loop to resume
 * with the tool result attached.
 *
 * `POST /{panel}/api/{resource}/:id/_agents/:agentSlug/continue`
 *
 * Body (required):
 * - `runId:  string`            — the id from the initial `run_started` event
 * - `messages: AiMessage[]`     — full conversation including the new tool result(s)
 *
 * Body (optional):
 * - `approvedToolCallIds?: string[]`
 * - `rejectedToolCallIds?: string[]`
 *
 * Validation (per `standalone-client-tools-plan.md` D2):
 * - The `runId` must exist in the cache (`runStore`) and not be expired
 * - The url params (`resourceSlug` + `agentSlug` + `recordId`) must match the
 *   stored state — blocks an attacker from re-routing a leaked runId to a
 *   different record
 * - The user must match the user who started the run
 * - The supplied `messages` must contain tool result entries for exactly the
 *   tool call ids the run paused on — no more, no less. This blocks bogus
 *   tool results for tool calls the model never made.
 */
export async function handleAgentRunContinuation(
  req: AppRequest,
  res: AppResponse,
  ResourceClass: typeof Resource,
  panelSlug: string,
): Promise<unknown> {
  const id        = (req.params as Record<string, string>)['id'] ?? ''
  const agentSlug = (req.params as Record<string, string>)['agentSlug'] ?? ''

  // ── Parse + validate body ───────────────────────────────
  const body = req.body as Record<string, unknown> | undefined
  const runId               = typeof body?.['runId']    === 'string' ? body['runId']  as string : undefined
  const messages            = Array.isArray(body?.['messages']) ? body['messages'] as AiMessage[] : undefined
  const approvedToolCallIds = Array.isArray(body?.['approvedToolCallIds']) ? body['approvedToolCallIds'] as string[] : undefined
  const rejectedToolCallIds = Array.isArray(body?.['rejectedToolCallIds']) ? body['rejectedToolCallIds'] as string[] : undefined

  if (!runId) {
    return res.status(400).json({ message: 'Continuation requires "runId".' })
  }
  if (!messages || messages.length === 0) {
    return res.status(400).json({ message: 'Continuation requires "messages".' })
  }

  // ── Auth + record load + agent lookup ────────────────
  const setup = await loadAgentRunContext(req, res, ResourceClass, id, agentSlug, panelSlug)
  if ('errorResponse' in setup) return setup.errorResponse
  const { agentDef, agentCtx, userId } = setup

  // ── Load + validate run state ───────────────────────────
  const runState = await consumeRun(runId)
  if (!runState) {
    return res.status(410).json({ message: 'Run expired or unknown. Start a new run.' })
  }
  if (runState.agentSlug    !== agentSlug ||
      runState.resourceSlug !== agentCtx.resourceSlug ||
      runState.recordId     !== agentCtx.recordId) {
    return res.status(403).json({ message: 'Run scope does not match request.' })
  }
  if (runState.userId !== userId) {
    return res.status(403).json({ message: 'Run started by a different user.' })
  }

  // Restore per-run scope state from runStore onto the agent context. The
  // browser only sends `field` / `selection` on the INITIAL POST, not on
  // continuations (see useAgentRun.ts), so without this restore the resumed
  // pass would lose its scope: built-in actions would lose their fieldScope
  // (empty `_fields` → empty tool enum → broken tools), and selection mode
  // would lose its toolkit filter and prompt block. Persisting these on the
  // run state and re-applying them on continuation is the load-bearing fix.
  if (runState.fieldScope) {
    agentCtx.fieldScope = [runState.fieldScope]
  }
  if (runState.selection) {
    agentCtx.selection = runState.selection
  }
  const fieldScope = runState.fieldScope
  const selection  = runState.selection

  // Tool result coverage check (mixed-tool aware):
  //
  //   1. Every pending CLIENT tool call id MUST appear as a tool result —
  //      otherwise the loop has nothing to resume with.
  //   2. Every submitted tool result id MUST appear in the union of pending
  //      client ids + server ids that ran during the initial pass —
  //      anything else is a forgery attempt.
  //
  // The reason we have to allow server tool result ids in the body at all
  // is that the browser mirrors the full SSE wire log into its continuation
  // (server tool results were emitted as `tool_result` SSE events and the
  // browser captured them into wireMessages). Without this allowance,
  // mixed-tool turns 400 — see mixed-tool-continuation-plan.md for the
  // chat-side equivalent of this fix.
  const submittedToolResultIds = messages
    .filter(m => m.role === 'tool' && typeof m.toolCallId === 'string')
    .map(m => m.toolCallId as string)
  const requiredClientIds = new Set(runState.pendingToolCallIds)
  const allowedAllIds     = new Set([...runState.pendingToolCallIds, ...runState.serverToolCallIds])
  const submittedSet      = new Set(submittedToolResultIds)

  // Every required client tool call must have a result.
  for (const id of requiredClientIds) {
    if (!submittedSet.has(id)) {
      return res.status(400).json({
        message: `Continuation missing tool result for pending client tool call ${id}.`,
      })
    }
  }
  // Every submitted result must reference a tool call that actually happened.
  for (const id of submittedSet) {
    if (!allowedAllIds.has(id)) {
      return res.status(400).json({
        message: `Continuation contains tool result ${id} that does not match any tool call from the original run.`,
      })
    }
  }

  // ── Stream the resumed loop ─────────────────────────────
  //
  // Capture the prior allowed tool call ids (from the run state we just
  // consumed) so that if THIS pass also pauses for another client tool, the
  // new run state we store inherits the prior pause's allowlist. Without
  // this, multi-pause logical runs (e.g. read_form_state → resume →
  // update_form_state → resume) 400 on the second continuation: the
  // browser's wireMessages contains tool results from BOTH pauses, but the
  // second pause's run state only knows about its own tool calls — the
  // first pause's read_form_state result looks like a forgery. This is
  // the third variation of `feedback_mixed_tool_continuation_validation.md`;
  // the first two were intra-pause mixed tools, this one is inter-pause.
  const priorAllowedToolCallIds = [
    ...runState.pendingToolCallIds,
    ...runState.serverToolCallIds,
  ]

  return streamAgentRunResponse(res, async (send) => {
    const { stream, response } = await agentDef.stream(agentCtx, '', {
      toolCallStreamingMode: 'stop-on-client-tool',
      messages,
      ...(approvedToolCallIds ? { approvedToolCallIds } : {}),
      ...(rejectedToolCallIds ? { rejectedToolCallIds } : {}),
    })

    const result = await streamAgentToSSE({ stream, response, send })
    await emitTerminalState(send, result, {
      agentSlug,
      resourceSlug: agentCtx.resourceSlug,
      recordId:     agentCtx.recordId,
      fieldScope,
      selection,
      userId,
      priorAllowedToolCallIds,
    })
  })
}

// ─── Internal helpers ────────────────────────────────────────

interface AgentRunSetup {
  agentDef:   PanelAgent
  agentCtx:   PanelAgentContext
  fieldScope: string | undefined
  selection:  { field: string; text: string } | undefined
  userId:     string | undefined
}

interface AgentRunSetupError {
  errorResponse: unknown
}

/**
 * Shared auth + record-load + agent-lookup logic. Returns either a
 * successful setup or an `errorResponse` to forward back from the route.
 */
async function loadAgentRunContext(
  req: AppRequest,
  res: AppResponse,
  ResourceClass: typeof Resource,
  id: string,
  agentSlug: string,
  panelSlug: string,
): Promise<AgentRunSetup | AgentRunSetupError> {
  const resource = new ResourceClass()
  const ctx      = buildContext(req)
  if (!await resource.policy('update', ctx)) {
    return { errorResponse: res.status(403).json({ message: 'Forbidden.' }) }
  }

  const Model = ResourceClass.model as ModelClass<RecordRow> | undefined
  if (!Model) {
    return { errorResponse: res.status(500).json({ message: `Resource "${ResourceClass.getSlug()}" has no model.` }) }
  }

  // Resolve the agent in two layers:
  //   1. User-defined resource agents (from `Resource.agents()`) — these are
  //      the resource-level "AI Agents" dropdown items like `seo` / `editor`.
  //   2. Built-in field actions registered globally via
  //      `BuiltInAiActionRegistry` — `rewrite` / `shorten` / etc., used from
  //      the per-field `✦` dropdown. These have empty `_fields`; the route
  //      handler scopes them to the request body's `field` param below.
  // Resource agents take precedence so an app can override a built-in slug
  // with a record-aware version if needed.
  const resourceAgents = resource.agents()
  const agentDef =
    resourceAgents.find(a => a.getSlug() === agentSlug) ??
    BuiltInAiActionRegistry.get(agentSlug)
  if (!agentDef) {
    return { errorResponse: res.status(404).json({ message: `Agent "${agentSlug}" not found.` }) }
  }

  const record = await Model.find(id)
  if (!record) {
    return { errorResponse: res.status(404).json({ message: 'Record not found.' }) }
  }

  // Optional `field` param narrows the scope to a single field. Set on
  // `agentCtx.fieldScope` so `PanelAgent.buildTools()` builds the write
  // tools' enums against the single field instead of the agent's `_fields`
  // (which is empty for built-in actions like `rewrite`).
  //
  // Optional `selection` param activates selection mode — see
  // `PanelAgentContext.selection` and `feedback_chat_selection_mode_prompt.md`.
  let fieldScope: string | undefined
  let selection:  { field: string; text: string } | undefined
  try {
    const body = req.body as Record<string, unknown> | undefined
    if (body && typeof body['field'] === 'string') fieldScope = body['field']
    if (body && typeof body['selection'] === 'object' && body['selection'] !== null) {
      const sel = body['selection'] as Record<string, unknown>
      if (typeof sel['field'] === 'string' && typeof sel['text'] === 'string') {
        selection = { field: sel['field'], text: sel['text'] }
      }
    }
  } catch { /* no body */ }

  const agentCtx: PanelAgentContext = {
    record:       typeof (record as any).toJSON === 'function' ? (record as any).toJSON() : record as Record<string, unknown>,
    resourceSlug: ResourceClass.getSlug(),
    recordId:     id,
    panelSlug,
    fieldMeta:    resource.getFieldMeta(),
    ...(fieldScope ? { fieldScope: [fieldScope] } : {}),
    ...(selection ? { selection } : {}),
  }

  return {
    agentDef,
    agentCtx,
    fieldScope,
    selection,
    userId: extractUserId(req),
  }
}

/**
 * Wraps an SSE-producing async callback into a Hono streaming response. The
 * callback receives a `send(event, data)` function and is expected to drive
 * the stream to completion (including emitting the final `complete` event).
 */
function streamAgentRunResponse(
  res: AppResponse,
  run: (send: (event: string, data: unknown) => void) => Promise<void>,
): unknown {
  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }
      try {
        await run(send)
      } catch (err) {
        send('error', { message: err instanceof Error ? err.message : 'Agent run failed.' })
      } finally {
        controller.close()
      }
    },
  })

  const c = res.raw as { header(key: string, value: string): void; res: unknown }
  c.res = new Response(readable, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    },
  })
  return c.res
}

/**
 * Inspect the final `AgentResponse` and emit either a `complete` event (run
 * finished cleanly) or a `run_started` + `complete{awaiting}` pair (run
 * paused for client tools or approval). The `run_started` event carries the
 * `runId` the browser will use for the continuation POST.
 */
async function emitTerminalState(
  send: (event: string, data: unknown) => void,
  result: AgentResponse,
  meta: {
    agentSlug:    string
    resourceSlug: string
    recordId:     string
    fieldScope:   string | undefined
    selection:    { field: string; text: string } | undefined
    userId:       string | undefined
    /**
     * Tool call ids that were "allowed" in the PRIOR pause's run state
     * (i.e. its `pendingToolCallIds ∪ serverToolCallIds`). When set, they
     * are merged into THIS pause's `serverToolCallIds` so subsequent
     * continuations don't reject the browser's accumulated wireMessages.
     * Set by `handleAgentRunContinuation` when chaining; undefined for the
     * initial `handleAgentRun` call. See the comment at the call site.
     */
    priorAllowedToolCallIds?: string[]
  },
): Promise<void> {
  const isPending =
    result.finishReason === 'client_tool_calls' ||
    result.finishReason === 'tool_approval_required'

  if (isPending) {
    // Collect pending CLIENT tool call ids — the continuation MUST cover
    // each of these (the loop is waiting on them).
    const pendingIds: string[] = []
    if (result.pendingClientToolCalls) {
      for (const tc of result.pendingClientToolCalls) pendingIds.push(tc.id)
    }
    if (result.pendingApprovalToolCall) {
      pendingIds.push(result.pendingApprovalToolCall.toolCall.id)
    }

    // Collect SERVER tool call ids that already produced results during the
    // initial pass. The browser mirrors their results into the continuation
    // body (it captured them from `tool_result` SSE events), so they're
    // ALLOWED to appear in the continuation — but anything outside this set
    // is a forgery attempt. See the validation block in
    // `handleAgentRunContinuation` and mixed-tool-continuation-plan.md.
    const serverIds: string[] = []
    for (const step of result.steps) {
      for (const tr of step.toolResults) {
        serverIds.push(tr.toolCallId)
      }
    }

    // Merge the prior pause's allowed ids (if any) into THIS pause's
    // serverToolCallIds. The browser carries forward all tool results across
    // pauses in `wireMessages`, so each new pause's allowlist must include
    // every id that was already allowed in any prior pause of the same
    // logical run. De-dupe via Set in case the same id somehow appears in
    // both lists.
    const mergedServerIds = meta.priorAllowedToolCallIds
      ? [...new Set([...meta.priorAllowedToolCallIds, ...serverIds])]
      : serverIds

    const runId = generateRunId()
    const state: AgentRunState = {
      agentSlug:          meta.agentSlug,
      resourceSlug:       meta.resourceSlug,
      recordId:           meta.recordId,
      fieldScope:         meta.fieldScope,
      selection:          meta.selection,
      pendingToolCallIds: pendingIds,
      serverToolCallIds:  mergedServerIds,
      userId:             meta.userId,
    }
    await storeRun(runId, state)

    send('run_started', { runId })
    send('complete', {
      done: false,
      awaiting: result.finishReason === 'client_tool_calls' ? 'client_tools' : 'approval',
      usage: result.usage,
      steps: result.steps.length,
    })
    return
  }

  send('complete', {
    done: true,
    text: result.text,
    usage: result.usage,
    steps: result.steps.length,
  })
}

/** Cryptographically random run id. UUIDv4 via WebCrypto where available. */
function generateRunId(): string {
  // Node 19+ has globalThis.crypto.randomUUID. Fall back to a manual UUIDv4
  // build for older runtimes.
  const c = (globalThis as any).crypto as { randomUUID?: () => string; getRandomValues?: (arr: Uint8Array) => Uint8Array } | undefined
  if (c?.randomUUID) return c.randomUUID()
  // Manual fallback (RFC4122 v4): 16 random bytes with version + variant bits
  const bytes = new Uint8Array(16)
  if (c?.getRandomValues) c.getRandomValues(bytes)
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/* eslint-enable @typescript-eslint/no-explicit-any */
