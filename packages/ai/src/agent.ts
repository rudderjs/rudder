import { z } from 'zod'
import { AiRegistry } from './registry.js'
import { isPauseForClientToolsChunk, pauseForClientTools, toolDefinition, toolToSchema } from './tool.js'
import type { PauseForClientToolsChunk, ServerToolBuilder } from './tool.js'
import { isHandoffTool } from './handoff.js'
import type { HandoffSpec } from './handoff.js'
import { attachmentsToContentParts, getMessageText } from './attachment.js'
import { QueuedPromptBuilder } from './queue-job.js'
import {
  resolveAutoPersistSpec,
  runWithPersistence,
  runWithPersistenceStreaming,
} from './conversation-persistence.js'
import type { SubAgentRunSnapshot, SubAgentRunStore } from './sub-agent-run-store.js'
import {
  runOnConfig,
  runOnChunk,
  runOnBeforeToolCall,
  runOnAfterToolCall,
  runSequential,
  runOnUsage,
  runOnAbort,
  runOnError,
} from './middleware.js'
import type { AiObserverRegistry, AiEvent, AiObserverStep } from './observers.js'
import type {
  AgentPromptOptions,
  AiMessage,
  AiMiddleware,
  Attachment,
  AgentResponse,
  AgentStep,
  AgentStreamResponse,
  AnyTool,
  CacheableConfig,
  CacheableMarkers,
  ContentPart,
  ConversationalOverride,
  ConversationalSpec,
  ConversationStore,
  SubAgentUpdate,
  FinishReason,
  HasMiddleware,
  HasTools,
  MiddlewareContext,
  PrepareStepResult,
  ProviderRequestOptions,
  StopCondition,
  StreamChunk,
  Tool,
  ToolCall,
  ToolCallContext,
  ToolResult,
  TokenUsage,
  ToolChoice,
} from './types.js'

// ─── AI Observer (lazy accessor) ─────────────────────────

function _getAiObservers(): AiObserverRegistry | null {
  return ((globalThis as Record<string, unknown>)['__rudderjs_ai_observers__'] as AiObserverRegistry | undefined) ?? null
}

function _buildObserverSteps(steps: AgentStep[], modelString: string): AiObserverStep[] {
  return steps.map((step, i) => ({
    iteration:    i + 1,
    model:        modelString,
    tokens:       { prompt: step.usage.promptTokens, completion: step.usage.completionTokens, total: step.usage.totalTokens },
    finishReason: step.finishReason,
    toolCalls:    step.toolCalls.map(tc => {
      const tr = step.toolResults.find(r => r.toolCallId === tc.id)
      return {
        id:            tc.id,
        name:          tc.name,
        args:          tc.arguments,
        result:        tr?.result,
        duration:      tr?.duration ?? 0,
        needsApproval: false,
      }
    }),
  }))
}

// ─── Stop Condition Combinators ──────────────────────────

/** Stop after N steps */
export function stepCountIs(n: number): StopCondition {
  return ({ steps }) => steps.length >= n
}

/** Stop when a specific tool is called in the latest step */
export function hasToolCall(toolName: string): StopCondition {
  return ({ steps }) => {
    const last = steps[steps.length - 1]
    return last?.toolCalls.some(tc => tc.name === toolName) ?? false
  }
}

// ─── Agent Base Class ────────────────────────────────────

export abstract class Agent {
  /** System instructions for this agent */
  abstract instructions(): string

  /** Model string (e.g. 'anthropic/claude-sonnet-4-5'). Defaults to registry default. */
  model(): string | undefined { return undefined }

  /** Failover provider/model strings */
  failover(): string[] { return [] }

  /** Maximum iterations for the tool loop (default: 20) */
  maxSteps(): number { return 20 }

  /** Per-step control — override model, tools, messages per iteration */
  prepareStep?(_ctx: { stepNumber: number; steps: AgentStep[]; messages: AiMessage[] }): PrepareStepResult | Promise<PrepareStepResult>

  /** Stop conditions — combine with array (OR logic) */
  stopWhen(): StopCondition | StopCondition[] {
    return stepCountIs(this.maxSteps())
  }

  /** Temperature (0-1) */
  temperature(): number | undefined { return undefined }

  /** Max tokens for response */
  maxTokens(): number | undefined { return undefined }

  /**
   * Declarative prompt-cache configuration.
   *
   * Override on a subclass to mark stable parts of the prompt as cacheable
   * — provider adapters translate to native primitives (Anthropic
   * `cache_control`, OpenAI `prompt_cache_key`, Google `cachedContent`)
   * so cache hits can save 50–90% on input tokens for long system prompts,
   * tool definitions, or stable conversation context.
   *
   * Returning `undefined` (the default) means no caching. Per-call override
   * via `agent.prompt(input, { cache: false })` disables caching for that
   * call; passing a {@link CacheableConfig} for `cache` replaces the agent
   * default for that call.
   *
   * @example
   * class SupportAgent extends Agent {
   *   instructions() { return LONG_SYSTEM_PROMPT }
   *   tools()        { return [tool1, tool2, tool3] }
   *   cacheable() {
   *     return { instructions: true, tools: true }
   *   }
   * }
   */
  cacheable(): CacheableConfig | undefined { return undefined }

  /**
   * Opt into auto-persisted conversation behavior. Override on a subclass
   * to declare *which* user owns the thread and (optionally) which
   * specific thread, and the framework will load history before each
   * `prompt()`/`stream()` call and append the new turn after it — without
   * any caller having to remember `forUser()` / `continue()`.
   *
   * Returning `false` (the default) disables auto-persist; the agent runs
   * stateless. Returning a {@link ConversationalSpec} opts in:
   *
   * @example
   * class ChatAgent extends Agent {
   *   conversational() {
   *     return { user: Auth.user()?.id }   // null user → falsy → opt-out
   *   }
   * }
   *
   * await new ChatAgent().prompt('Hi')          // auto-loads + auto-saves
   *
   * **Precedence (high → low):**
   * 1. Explicit `agent.forUser(id).prompt()` / `agent.continue(id).prompt()`
   * 2. Per-call `prompt(input, { conversation: false | {...} })`
   * 3. This method's return value
   *
   * Async returns are supported — useful when the user identity is fetched
   * from an async DI binding.
   */
  conversational(): false | ConversationalSpec | Promise<false | ConversationalSpec> {
    return false
  }

  /**
   * Default for `AgentPromptOptions.parallelTools`. When `true` (default),
   * multiple tool calls within a single step run their `execute()` functions
   * concurrently. Override on a subclass to flip the default for an agent
   * whose tools share non-idempotent state. Per-call options still win.
   */
  parallelTools(): boolean { return true }

  /** Run the agent with a prompt (non-streaming) */
  async prompt(input: string, options?: AgentPromptOptions): Promise<AgentResponse> {
    const spec = await resolveAutoPersistSpec(() => this.conversational(), options?.conversation)
    if (spec) {
      return runWithPersistence(
        spec,
        this.constructor.name,
        resolveConversationStore,
        input,
        options,
        (effOptions) => runAgentLoop(this, input, effOptions),
      )
    }
    return runAgentLoop(this, input, options)
  }

  /** Run the agent with a prompt (streaming) */
  stream(input: string, options?: AgentPromptOptions): AgentStreamResponse {
    return runStreamWithMaybeAutoPersist(this, input, options)
  }

  /** Queue the prompt for background execution */
  queue(input: string, options?: AgentPromptOptions): QueuedPromptBuilder {
    return new QueuedPromptBuilder(this, input, options)
  }

  /** Set the user scope for conversation persistence */
  forUser(userId: string): ConversableAgent {
    return new ConversableAgent(this).forUser(userId)
  }

  /** Continue an existing conversation */
  continue(conversationId: string): ConversableAgent {
    return new ConversableAgent(this).continue(conversationId)
  }

  /**
   * Wrap this agent as a tool another agent can call (the "subagents"
   * pattern). The returned tool is fully-formed — pass it directly into the
   * parent agent's `tools()` array. When the parent calls it, this agent
   * runs its own loop end-to-end (its own model, tools, middleware) and
   * returns a single result.
   *
   * Defaults are tuned for the zero-config case:
   * - `inputSchema` defaults to `{ prompt: string }` and the agent is
   *   invoked with `input.prompt`.
   * - The parent model only sees `response.text` on its next step
   *   (override with `modelOutput`); the UI still receives the full
   *   `AgentResponse` via the `tool-result` chunk.
   *
   * @example  Zero-config
   * const research = researchAgent.asTool({
   *   name: 'research',
   *   description: 'Research a topic in depth.',
   * })
   *
   * @example  Custom schema + prompt mapper
   * const research = researchAgent.asTool({
   *   name: 'research',
   *   description: 'Research a topic in depth.',
   *   inputSchema: z.object({ topic: z.string(), depth: z.enum(['quick', 'deep']) }),
   *   prompt:      ({ topic, depth }) => `Research ${topic} (${depth}).`,
   * })
   */
  asTool<TInput extends z.ZodType>(options: {
    name:         string
    description:  string
    inputSchema:  TInput
    prompt:       (input: z.infer<TInput>) => string
    modelOutput?: (response: AgentResponse) => string | Promise<string>
    streaming?:   AsToolStreamingOption
    suspendable?: AsToolSuspendableOption
  }): ServerToolBuilder<z.infer<TInput>, AgentResponse>
  asTool(options: {
    name:         string
    description:  string
    modelOutput?: (response: AgentResponse) => string | Promise<string>
    streaming?:   AsToolStreamingOption
    suspendable?: AsToolSuspendableOption
  }): ServerToolBuilder<{ prompt: string }, AgentResponse>
  asTool(options: {
    name:         string
    description:  string
    inputSchema?: z.ZodType
    prompt?:      (input: unknown) => string
    modelOutput?: (response: AgentResponse) => string | Promise<string>
    streaming?:   AsToolStreamingOption
    suspendable?: AsToolSuspendableOption
  }): ServerToolBuilder<unknown, AgentResponse> {
    if (options.suspendable && !options.streaming) {
      throw new Error('[RudderJS AI] asTool: `suspendable` requires `streaming: true` (or a projector). Silent suspend would leave the parent UI with no progress signal between sub-agent invocations.')
    }

    const schema      = options.inputSchema ?? z.object({ prompt: z.string() })
    const promptOf    = options.prompt      ?? ((input: unknown) => (input as { prompt: string }).prompt)
    const modelOutput = options.modelOutput ?? ((response: AgentResponse) => response.text)

    if (!options.streaming) {
      // 1.2.0 zero-config path — single prompt() call, single AgentResponse out.
      return toolDefinition({
        name:        options.name,
        description: options.description,
        inputSchema: schema,
      })
        .server((input: unknown): Promise<AgentResponse> => this.prompt(promptOf(input)))
        .modelOutput(modelOutput)
    }

    const project: ChunkProjector = options.streaming === true ? defaultSubAgentProjector : options.streaming
    const innerAgent = this // eslint-disable-line @typescript-eslint/no-this-alias
    const agentName  = options.name
    const suspendable = options.suspendable

    const generatorExecute = async function* (
      input: unknown,
    ): AsyncGenerator<SubAgentUpdate | PauseForClientToolsChunk, AgentResponse, void> {
      const userPrompt = promptOf(input)

      yield { kind: 'agent_start', agentName }

      const streamOpts = suspendable
        ? { toolCallStreamingMode: 'stop-on-client-tool' as const }
        : undefined
      const { stream, response } = innerAgent.stream(userPrompt, streamOpts)

      for await (const chunk of stream) {
        const update = project(chunk)
        if (update) yield update
      }

      const result = await response

      if (
        suspendable &&
        result.finishReason === 'client_tool_calls' &&
        result.pendingClientToolCalls?.length
      ) {
        const subRunId = generateSubRunId()
        const snapshot: SubAgentRunSnapshot = {
          messages:           buildSubAgentSnapshotMessages(userPrompt, result),
          pendingToolCallIds: result.pendingClientToolCalls.map((tc) => tc.id),
          stepsSoFar:         result.steps.length,
          tokensSoFar:        result.usage?.totalTokens ?? 0,
        }
        await suspendable.runStore.store(subRunId, snapshot)

        yield { kind: 'subagent_paused', subRunId, pendingToolCallIds: snapshot.pendingToolCallIds }
        yield pauseForClientTools(result.pendingClientToolCalls, subRunId)
        // Unreachable — the parent loop halts iteration after the pause chunk.
        return undefined as never
      }

      yield {
        kind:   'agent_done',
        steps:  result.steps.length,
        tokens: result.usage?.totalTokens ?? 0,
      }
      return result
    }

    return toolDefinition({
      name:        options.name,
      description: options.description,
      inputSchema: schema,
    })
      .server(generatorExecute)
      .modelOutput(modelOutput) as unknown as ServerToolBuilder<unknown, AgentResponse>
  }

  /**
   * Resume a sub-agent run that previously paused with
   * `pauseForClientTools` (typically from {@link Agent.asTool} with
   * `suspendable: { runStore }` set). Loads the snapshot, validates the
   * incoming tool-result ids against the pending set, and re-runs the
   * inner loop with those results appended.
   *
   * Returns either a `'completed'` result (the inner agent finished) or
   * a `'paused'` continuation pointing at a fresh `subRunId` for the
   * next round-trip.
   *
   * @example
   * const r = await Agent.resumeAsTool(subRunId, browserResults, { runStore, agent: subAgent })
   * if (r.kind === 'completed') {
   *   feedToolResultBackToParent(r.response.text)
   * } else {
   *   emitPendingClientToolsSse(r.subRunId, r.pendingToolCallIds)
   * }
   */
  static async resumeAsTool(
    subRunId:          string,
    clientToolResults: ReadonlyArray<{ toolCallId: string; result: unknown }>,
    options: {
      runStore: SubAgentRunStore
      agent:    Agent
    },
  ): Promise<
    | { kind: 'completed'; response: AgentResponse }
    | { kind: 'paused';    subRunId: string; pendingToolCallIds: string[] }
  > {
    const snapshot = await options.runStore.consume(subRunId)
    if (!snapshot) {
      throw new Error(`[RudderJS AI] resumeAsTool: subRunId "${subRunId}" expired or never existed.`)
    }

    // Forgery guard — every incoming tool-result id must be in the pending set.
    const pending = new Set(snapshot.pendingToolCallIds)
    const seen    = new Set<string>()
    for (const r of clientToolResults) {
      if (!pending.has(r.toolCallId)) {
        throw new Error(`[RudderJS AI] resumeAsTool: toolCallId "${r.toolCallId}" was not in the pending set.`)
      }
      if (seen.has(r.toolCallId)) {
        throw new Error(`[RudderJS AI] resumeAsTool: duplicate result for toolCallId "${r.toolCallId}".`)
      }
      seen.add(r.toolCallId)
    }

    // Append client tool-result messages to the snapshot, in incoming order.
    const messages: AiMessage[] = [...snapshot.messages]
    for (const r of clientToolResults) {
      messages.push({
        role:       'tool',
        content:    typeof r.result === 'string' ? r.result : JSON.stringify(r.result),
        toolCallId: r.toolCallId,
      })
    }

    const result = await options.agent.prompt('', {
      messages,
      toolCallStreamingMode: 'stop-on-client-tool',
    })

    if (
      result.finishReason === 'client_tool_calls' &&
      result.pendingClientToolCalls?.length
    ) {
      const newSubRunId = generateSubRunId()
      const newSnapshot: SubAgentRunSnapshot = {
        messages:           buildResumeSnapshotMessages(messages, result),
        pendingToolCallIds: result.pendingClientToolCalls.map((tc) => tc.id),
        stepsSoFar:         snapshot.stepsSoFar + result.steps.length,
        tokensSoFar:        snapshot.tokensSoFar + (result.usage?.totalTokens ?? 0),
        ...(snapshot.meta !== undefined ? { meta: snapshot.meta } : {}),
      }
      await options.runStore.store(newSubRunId, newSnapshot)
      return {
        kind:               'paused',
        subRunId:           newSubRunId,
        pendingToolCallIds: newSnapshot.pendingToolCallIds,
      }
    }

    return { kind: 'completed', response: result }
  }
}

// ─── asTool helpers ──────────────────────────────────────

type ChunkProjector = (chunk: StreamChunk) => SubAgentUpdate | null

/**
 * Default projection from inner-agent stream chunks to {@link SubAgentUpdate}
 * events. Emits one `tool_call` per inner `tool-call` chunk; everything
 * else is suppressed (the wrapping execute emits the `agent_start` /
 * `agent_done` bookends and the suspend path emits `subagent_paused`).
 *
 * Hosts wanting different cadence (e.g. surfacing `text-delta` previews
 * or per-step usage) pass `streaming: chunk => …` and own the discriminator.
 */
function defaultSubAgentProjector(chunk: StreamChunk): SubAgentUpdate | null {
  if (chunk.type === 'tool-call' && chunk.toolCall?.name) {
    return {
      kind: 'tool_call',
      tool: chunk.toolCall.name,
      ...(chunk.toolCall.arguments ? { args: chunk.toolCall.arguments as Record<string, unknown> } : {}),
    }
  }
  return null
}

type AsToolStreamingOption  = boolean | ChunkProjector
type AsToolSuspendableOption = { runStore: SubAgentRunStore }

/**
 * Reconstruct the inner-agent message history at the point the loop
 * paused, so a subsequent {@link Agent.resumeAsTool} can rerun the loop
 * with the appended client tool results. The shape is `[user, …(message
 * + serverToolResults)*]` — system messages are omitted because the
 * `messages` mode of the agent loop prepends `system` itself.
 *
 * Each step's `message` includes ALL `toolCalls` (server + client).
 * Server-side `toolResults` are interleaved; client-side calls remain
 * unfulfilled until resume appends their results.
 */
function buildSubAgentSnapshotMessages(userPrompt: string, response: AgentResponse): AiMessage[] {
  const out: AiMessage[] = [{ role: 'user', content: userPrompt }]
  for (const step of response.steps) {
    out.push(step.message)
    for (const tr of step.toolResults) {
      const resultStr = typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result)
      out.push({ role: 'tool', content: resultStr, toolCallId: tr.toolCallId })
    }
  }
  return out
}

/**
 * Snapshot reconstruction for a resume-time pause. The `priorMessages`
 * already include the original user prompt + every step prior to the
 * resume call. Append the freshly-completed steps' messages and any
 * server-side tool results so the next resume sees the full history.
 */
function buildResumeSnapshotMessages(priorMessages: AiMessage[], response: AgentResponse): AiMessage[] {
  const out: AiMessage[] = [...priorMessages]
  for (const step of response.steps) {
    out.push(step.message)
    for (const tr of step.toolResults) {
      const resultStr = typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result)
      out.push({ role: 'tool', content: resultStr, toolCallId: tr.toolCallId })
    }
  }
  return out
}

function generateSubRunId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  return `sub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

// ─── Conversable Agent (conversation persistence) ───────

/**
 * Wraps an Agent to add conversation memory.
 * Created via `agent.forUser(id)` or `agent.continue(id)`.
 */
export class ConversableAgent {
  private _userId: string | undefined
  private _conversationId: string | undefined

  constructor(private readonly agent: Agent) {}

  forUser(userId: string): this {
    this._userId = userId
    return this
  }

  continue(conversationId: string): this {
    this._conversationId = conversationId
    return this
  }

  async prompt(input: string, options?: AgentPromptOptions): Promise<AgentResponse> {
    const spec = this.toSpec()
    return runWithPersistence(
      spec,
      this.agent.constructor.name,
      resolveConversationStore,
      input,
      options,
      (effOptions) => runAgentLoop(this.agent, input, effOptions),
    ).then((r) => {
      // Track the resolved id back on the wrapper so a subsequent
      // `wrapper.prompt()` call resumes the same thread.
      if (r.conversationId) this._conversationId = r.conversationId
      return r
    })
  }

  stream(input: string, options?: AgentPromptOptions): AgentStreamResponse {
    const spec = this.toSpec()
    const persisted = runWithPersistenceStreaming(
      spec,
      this.agent.constructor.name,
      resolveConversationStore,
      input,
      options,
      (effOptions) => runAgentLoopStreaming(this.agent, input, effOptions),
    )
    // Update the wrapper's id once the run completes.
    persisted.response.then(
      (r) => { if (r.conversationId) this._conversationId = r.conversationId },
      () => {},
    )
    return persisted
  }

  /**
   * Translate the wrapper's explicit-form state (`forUser` / `continue`)
   * into a {@link ConversationalSpec}. The explicit chain bypasses the
   * agent's `conversational()` declaration entirely — `forUser` always
   * wins over class defaults.
   */
  private toSpec(): ConversationalSpec {
    if (this._conversationId) return { user: this._userId ?? '', id: this._conversationId }
    if (this._userId)         return { user: this._userId }
    throw new Error('[RudderJS AI] ConversableAgent requires forUser() or continue() to be called before prompt().')
  }
}

// ─── Anonymous Agent ─────────────────────────────────────

class AnonymousAgent extends Agent {
  private readonly _instructions: string
  private readonly _tools: AnyTool[]
  private readonly _model: string | undefined
  private readonly _middleware: AiMiddleware[]

  constructor(options: {
    instructions: string
    tools?: AnyTool[] | undefined
    model?: string | undefined
    middleware?: AiMiddleware[] | undefined
  }) {
    super()
    this._instructions = options.instructions
    this._tools = options.tools ?? []
    this._model = options.model
    this._middleware = options.middleware ?? []
  }

  instructions(): string { return this._instructions }
  model(): string | undefined { return this._model }
  tools(): AnyTool[] { return this._tools }
  middleware(): AiMiddleware[] { return this._middleware }
}

/**
 * Create an anonymous agent inline.
 *
 * @example
 * const response = await agent('You are helpful.').prompt('Hello')
 *
 * @example
 * const response = await agent({
 *   instructions: 'You are a search assistant.',
 *   tools: [searchTool],
 *   model: 'anthropic/claude-sonnet-4-5',
 * }).prompt('Find users named John')
 */
export function agent(
  instructionsOrOptions: string | {
    instructions: string
    tools?: AnyTool[] | undefined
    model?: string | undefined
    middleware?: AiMiddleware[] | undefined
  },
): Agent & HasTools & HasMiddleware {
  const options = typeof instructionsOrOptions === 'string'
    ? { instructions: instructionsOrOptions }
    : instructionsOrOptions
  return new AnonymousAgent(options) as Agent & HasTools & HasMiddleware
}

// ─── Helpers ─────────────────────────────────────────────

// ─── Conversation Store Registry ────────────────────────

let _conversationStore: ConversationStore | undefined

/** Set the global conversation store (called by service provider or manually) */
export function setConversationStore(store: ConversationStore): void {
  _conversationStore = store
}

function resolveConversationStore(): ConversationStore | undefined {
  return _conversationStore
}

/**
 * Streaming counterpart of `Agent.prompt`'s auto-persist branch. The spec
 * resolution is async (since `conversational()` may return a Promise), so
 * we defer the decision into the outer wrapper that handles the inner
 * stream's setup the same way `runWithPersistenceStreaming` does for the
 * persisted path.
 */
function runStreamWithMaybeAutoPersist(
  a:       Agent,
  input:   string,
  options: AgentPromptOptions | undefined,
): AgentStreamResponse {
  // Synchronous fast path — most agents don't override `conversational()`,
  // so we'd pay an extra microtask boundary on every streaming call. Bail
  // out cheaply when we can prove the call is stateless.
  const declared = a.conversational()
  const isFast = (
    options?.conversation === false ||
    (declared === false && (options?.conversation === undefined))
  )
  if (isFast) {
    return runAgentLoopStreaming(a, input, options)
  }

  // Async path — resolve the spec, then dispatch to the persisted or plain stream.
  let resolveResp: (r: AgentResponse) => void
  let rejectResp:  (e: unknown) => void
  const responsePromise = new Promise<AgentResponse>((res, rej) => { resolveResp = res; rejectResp = rej })

  async function* outer(): AsyncIterable<StreamChunk> {
    let spec: ConversationalSpec | null
    try {
      spec = await resolveAutoPersistSpec(() => a.conversational(), options?.conversation)
    } catch (err) {
      rejectResp!(err)
      throw err
    }

    if (!spec) {
      const inner = runAgentLoopStreaming(a, input, options)
      try {
        for await (const chunk of inner.stream) yield chunk
      } catch (err) {
        rejectResp!(err)
        throw err
      }
      try {
        const r = await inner.response
        resolveResp!(r)
      } catch (err) {
        rejectResp!(err)
        throw err
      }
      return
    }

    const persisted = runWithPersistenceStreaming(
      spec,
      a.constructor.name,
      resolveConversationStore,
      input,
      options,
      (effOptions) => runAgentLoopStreaming(a, input, effOptions),
    )

    try {
      for await (const chunk of persisted.stream) yield chunk
    } catch (err) {
      rejectResp!(err)
      throw err
    }
    try {
      const r = await persisted.response
      resolveResp!(r)
    } catch (err) {
      rejectResp!(err)
      throw err
    }
  }

  return { stream: outer(), response: responsePromise }
}

// ─── Helpers ─────────────────────────────────────────────

function getTools(a: Agent): AnyTool[] {
  return 'tools' in a && typeof (a as any).tools === 'function'
    ? (a as unknown as HasTools).tools()
    : []
}

function getMiddleware(a: Agent): AiMiddleware[] {
  return 'middleware' in a && typeof (a as any).middleware === 'function'
    ? (a as unknown as HasMiddleware).middleware()
    : []
}

function createMiddlewareContext(
  messages: AiMessage[],
  model: string,
  tools: AnyTool[],
  iteration: number,
): MiddlewareContext {
  const [provider] = AiRegistry.parseModelString(model)
  let aborted = false
  let abortReason = ''
  return {
    requestId: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}`,
    iteration,
    chunkIndex: 0,
    messages,
    model,
    provider,
    toolNames: tools.map(t => t.definition.name),
    abort(reason?: string) {
      aborted = true
      abortReason = reason ?? 'Aborted by middleware'
    },
    get _aborted() { return aborted },
    get _abortReason() { return abortReason },
  } as MiddlewareContext & { readonly _aborted: boolean; readonly _abortReason: string }
}

function buildUserMessage(input: string, attachments?: Attachment[]): AiMessage {
  if (!attachments?.length) return { role: 'user', content: input }
  const parts: ContentPart[] = [
    { type: 'text', text: input },
    ...attachmentsToContentParts(attachments),
  ]
  return { role: 'user', content: parts }
}

function buildToolSchemas(tools: AnyTool[]): ReturnType<typeof toolToSchema>[] {
  return tools.filter(t => !t.definition.lazy).map(toolToSchema)
}

function buildToolMap(tools: AnyTool[]): Map<string, AnyTool> {
  const map = new Map<string, AnyTool>()
  for (const t of tools) map.set(t.definition.name, t)
  return map
}

function addUsage(total: TokenUsage, step: TokenUsage): void {
  total.promptTokens += step.promptTokens
  total.completionTokens += step.completionTokens
  total.totalTokens += step.totalTokens
}

function buildMiddlewareConfig(messages: AiMessage[], a: Agent): import('./types.js').MiddlewareConfigResult {
  const config: import('./types.js').MiddlewareConfigResult = { messages }
  const temp = a.temperature()
  const maxTok = a.maxTokens()
  if (temp !== undefined) config.temperature = temp
  if (maxTok !== undefined) config.maxTokens = maxTok
  return config
}

// ─── Shared loop state ───────────────────────────────────

/**
 * Mutable state shared between the non-streaming and streaming agent loops.
 * Helpers (`runFailover`, `emitObserverFailed`, `emitObserverCompleted`,
 * `buildAgentResponse`) read and write this struct so the same orchestration
 * logic serves both `prompt()` and `stream()` callers.
 */
interface LoopContext {
  // immutable per call
  readonly agent:        Agent
  readonly input:        string
  readonly options:      AgentPromptOptions | undefined
  readonly modelString:  string
  readonly providerName: string
  readonly tools:        AnyTool[]
  readonly toolMap:      Map<string, AnyTool>
  readonly toolSchemas:  ReturnType<typeof toolToSchema>[]
  readonly middlewares:  AiMiddleware[]
  readonly loopStart:    number
  readonly ctx:          MiddlewareContext & { readonly _aborted: boolean; readonly _abortReason: string }

  // mutable
  readonly messages:                 AiMessage[]
  readonly steps:                    AgentStep[]
  readonly totalUsage:               TokenUsage
  readonly pendingClientToolCalls:   ToolCall[]
  pendingApprovalToolCall:           { toolCall: ToolCall; isClientTool: boolean } | undefined
  loopFinishReason:                  FinishReason | undefined
  stopForClientTools:                boolean
  stopForApproval:                   boolean
  resumedToolMessages:               AiMessage[]
  failoverAttempts:                  number
  /**
   * Set by the tool phase when the model called a {@link handoff} tool.
   * Triggers the parent loop to break and the handoff wrapper to construct
   * the child agent and continue with the carried message history.
   */
  pendingHandoff?:                   PendingHandoff
  stopForHandoff:                    boolean
}

/**
 * Internal record of a pending handoff carried from the loop to the
 * handoff-aware wrapper. Not part of the public surface.
 */
interface PendingHandoff {
  spec:              HandoffSpec
  transitionMessage: string
  parentToolCallId:  string
}

/**
 * Iterate the failover model list and invoke `call` against each provider
 * adapter until one succeeds. Mutates `loopCtx.failoverAttempts` so the
 * observer event reflects the real number of attempts. A caller-supplied
 * `AbortSignal` short-circuits — abort errors propagate immediately rather
 * than triggering the next failover model.
 */
async function runFailover<T>(
  loopCtx: LoopContext,
  currentModel: string,
  call: (adapter: import('./types.js').ProviderAdapter, modelId: string, opts: ProviderRequestOptions) => T | Promise<T>,
): Promise<T> {
  const failoverModels = [currentModel, ...loopCtx.agent.failover().filter(m => m !== currentModel)]
  let lastError: Error | undefined
  for (const tryModel of failoverModels) {
    try {
      const adapter = AiRegistry.resolve(tryModel)
      const [, modelId] = AiRegistry.parseModelString(tryModel)
      const reqOptions: ProviderRequestOptions = {
        model:       modelId,
        messages:    loopCtx.messages,
        tools:       loopCtx.toolSchemas.length > 0 ? loopCtx.toolSchemas : undefined,
        temperature: loopCtx.agent.temperature(),
        maxTokens:   loopCtx.agent.maxTokens(),
        signal:      loopCtx.options?.signal,
        cache:       resolveCacheMarkers(loopCtx.agent, loopCtx.options),
      }
      return await call(adapter, modelId, reqOptions)
    } catch (err) {
      // If the abort came from the caller, don't try the next failover
      // model — re-throw so `prompt()` / the stream rejects immediately.
      if (loopCtx.options?.signal?.aborted) throw loopCtx.options.signal.reason
      lastError = err instanceof Error ? err : new Error(String(err))
      loopCtx.failoverAttempts++
      if (tryModel === failoverModels[failoverModels.length - 1]) throw lastError
    }
  }
  throw lastError ?? new Error('No provider available')
}

/**
 * Merge agent-level `cacheable()` declaration with per-call override.
 *
 * - Per-call `cache: false` → returns `undefined` (caching disabled).
 * - Per-call `cache: { ... }` → replaces the agent default.
 * - Per-call omitted → uses `agent.cacheable()` unchanged.
 *
 * Returns `undefined` when no markers are set so the provider request
 * carries no `cache` field at all.
 */
function resolveCacheMarkers(
  agent: Agent,
  options: AgentPromptOptions | undefined,
): CacheableMarkers | undefined {
  if (options && options.cache === false) return undefined
  const perCall = options?.cache === false ? undefined : options?.cache
  const config: CacheableConfig | undefined = perCall ?? agent.cacheable()
  if (!config) return undefined
  const markers: CacheableMarkers = {}
  if (config.instructions) markers.instructions = true
  if (config.tools)        markers.tools        = true
  if (config.messages !== undefined && config.messages > 0) {
    markers.messages = Math.floor(config.messages)
  }
  if (config.ttl) markers.ttl = config.ttl
  // ttl alone with no region markers is meaningless — drop it.
  const hasRegion = markers.instructions || markers.tools || (markers.messages && markers.messages > 0)
  if (!hasRegion) return undefined
  return markers
}

/** Emit the `agent.failed` observer event from the shared loop state. */
function emitObserverFailed(loopCtx: LoopContext, err: unknown, streaming: boolean): void {
  const obs = _getAiObservers()
  if (!obs) return
  const inputText = loopCtx.options?.messages ? '' : loopCtx.input
  obs.emit({
    kind:             'agent.failed',
    agentName:        loopCtx.agent.constructor.name,
    model:            loopCtx.modelString,
    provider:         loopCtx.providerName,
    input:            inputText,
    output:           '',
    steps:            _buildObserverSteps(loopCtx.steps, loopCtx.modelString),
    tokens:           {
      prompt:     loopCtx.totalUsage.promptTokens,
      completion: loopCtx.totalUsage.completionTokens,
      total:      loopCtx.totalUsage.totalTokens,
    },
    duration:         Math.round(performance.now() - loopCtx.loopStart),
    finishReason:     'error',
    streaming,
    conversationId:   null,
    failoverAttempts: loopCtx.failoverAttempts,
    error:            err instanceof Error ? err.message : String(err),
  })
}

/**
 * Emit the per-step `agent.step.completed` observer event after each
 * iteration. Built from the SAME `_buildObserverSteps` mapping used by
 * the terminal events so consumers see consistent shapes — they just see
 * the latest step rather than the full array.
 */
function emitObserverStepCompleted(
  loopCtx:   LoopContext,
  iteration: number,
  streaming: boolean,
): void {
  const obs = _getAiObservers()
  if (!obs) return
  const justPushed = loopCtx.steps[loopCtx.steps.length - 1]
  if (!justPushed) return
  // Re-use _buildObserverSteps so the per-step shape matches the steps[]
  // entries on the terminal events. Pass a single-element slice since we
  // only need the latest step's mapping.
  const built = _buildObserverSteps([justPushed], loopCtx.modelString)
  const stepEvent = built[0]
  if (!stepEvent) return
  // Override iteration with the loop's iteration counter — _buildObserverSteps
  // numbers from 1 within the array it sees, but we want the global step
  // number across the whole run.
  stepEvent.iteration = iteration + 1
  obs.emit({
    kind:           'agent.step.completed',
    agentName:      loopCtx.agent.constructor.name,
    model:          loopCtx.modelString,
    provider:       loopCtx.providerName,
    iteration:      iteration + 1,
    step:           stepEvent,
    tokens:         {
      prompt:     loopCtx.totalUsage.promptTokens,
      completion: loopCtx.totalUsage.completionTokens,
      total:      loopCtx.totalUsage.totalTokens,
    },
    duration:       Math.round(performance.now() - loopCtx.loopStart),
    streaming,
    conversationId: null,
  })
}

/** Emit the `agent.completed` observer event from the shared loop state. */
function emitObserverCompleted(loopCtx: LoopContext, result: AgentResponse, streaming: boolean): void {
  const obs = _getAiObservers()
  if (!obs) return
  const inputText = loopCtx.options?.messages ? '' : loopCtx.input
  const lastStep = loopCtx.steps[loopCtx.steps.length - 1]
  obs.emit({
    kind:             'agent.completed',
    agentName:        loopCtx.agent.constructor.name,
    model:            loopCtx.modelString,
    provider:         loopCtx.providerName,
    input:            inputText,
    output:           result.text,
    steps:            _buildObserverSteps(loopCtx.steps, loopCtx.modelString),
    tokens:           {
      prompt:     loopCtx.totalUsage.promptTokens,
      completion: loopCtx.totalUsage.completionTokens,
      total:      loopCtx.totalUsage.totalTokens,
    },
    duration:         Math.round(performance.now() - loopCtx.loopStart),
    finishReason:     result.finishReason ?? lastStep?.finishReason ?? 'stop',
    streaming,
    conversationId:   null,
    failoverAttempts: loopCtx.failoverAttempts,
  })
}

/** Build the final `AgentResponse` from accumulated loop state. */
function buildAgentResponse(loopCtx: LoopContext): AgentResponse & { _pendingHandoff?: PendingHandoff; _carriedMessages?: AiMessage[] } {
  const lastStep = loopCtx.steps[loopCtx.steps.length - 1]
  const result: AgentResponse & { _pendingHandoff?: PendingHandoff; _carriedMessages?: AiMessage[] } = {
    text:  lastStep ? getMessageText(lastStep.message.content) : '',
    steps: loopCtx.steps,
    usage: loopCtx.totalUsage,
  }
  if (loopCtx.loopFinishReason) result.finishReason = loopCtx.loopFinishReason
  if (loopCtx.pendingClientToolCalls.length > 0) result.pendingClientToolCalls = loopCtx.pendingClientToolCalls
  if (loopCtx.pendingApprovalToolCall) result.pendingApprovalToolCall = loopCtx.pendingApprovalToolCall
  if (loopCtx.resumedToolMessages.length > 0) result.resumedToolMessages = loopCtx.resumedToolMessages
  // Internal — consumed by the handoff-aware wrapper, then stripped before
  // surfacing to public callers.
  if (loopCtx.pendingHandoff) {
    result._pendingHandoff = loopCtx.pendingHandoff
    result._carriedMessages = loopCtx.messages
  }
  return result
}

/**
 * Execute the tool phase for a single agent step. Yields the same
 * `StreamChunk` sequence (`tool-call` → `tool-update*` → `tool-result`) that
 * the streaming caller surfaces to consumers. Non-streaming callers iterate
 * via `.next()` and discard yields — the side effects (message pushes,
 * pending-state mutations on `loopCtx`) are identical regardless of whether
 * the chunks reach a consumer.
 *
 * Returns the step's `ToolResult[]`. The caller passes the assistant message
 * to push before iteration so the AgentStep shape (response.message) and the
 * final `messages` array stay in sync with the loop variant.
 */
async function* executeToolPhase(
  loopCtx:          LoopContext,
  toolCalls:        ToolCall[],
  assistantMessage: AiMessage,
): AsyncGenerator<StreamChunk, ToolResult[], void> {
  const { messages, middlewares, options, ctx } = loopCtx
  const toolResults: ToolResult[] = []

  messages.push(assistantMessage)

  // Resolve parallelism setting. Per-call option wins; falls back to the
  // agent-level override which defaults to `true`. Single-tool batches
  // route through the serial path either way (no parallelism to gain, and
  // serial preserves live `tool-update` streaming for that one tool).
  //
  // Handoffs always force serial dispatch — the parent loop has to halt
  // immediately on the first handoff and synthesize "skipped" results for
  // any sibling calls. Handling that across the parallel classify/replay
  // phases is doable but adds complexity for negligible benefit (the model
  // rarely emits parallel siblings alongside a handoff, and even then,
  // running them while the agent is being torn down is wasted work).
  const hasHandoff = toolCalls.some(tc => isHandoffTool(loopCtx.toolMap.get(tc.name)))
  const parallel = (options?.parallelTools ?? loopCtx.agent.parallelTools()) && toolCalls.length > 1 && !hasHandoff

  if (parallel) {
    yield* runToolPhaseParallel(loopCtx, toolCalls, toolResults)
  } else {
    yield* runToolPhaseSerial(loopCtx, toolCalls, toolResults)
  }

  // onToolPhaseComplete
  if (middlewares.length > 0) await runSequential(middlewares, 'onToolPhaseComplete', ctx)

  return toolResults
}

/**
 * Serial tool execution — the original behavior. Runs each tool call's
 * prelude (approval, before-middleware, validation) and `execute()`
 * one-after-another, streaming `tool-update` chunks live as the tool
 * emits them.
 */
async function* runToolPhaseSerial(
  loopCtx:     LoopContext,
  toolCalls:   ToolCall[],
  toolResults: ToolResult[],
): AsyncGenerator<StreamChunk, void, void> {
  const { messages, middlewares, toolMap, options, ctx } = loopCtx

  for (const tc of toolCalls) {
    const tool = toolMap.get(tc.name)
    if (!tool) {
      const unknownResult = `Error: Unknown tool "${tc.name}"`
      toolResults.push({ toolCallId: tc.id, result: unknownResult })
      messages.push({ role: 'tool', content: unknownResult, toolCallId: tc.id })
      yield { type: 'tool-result' as const, toolCall: tc, result: unknownResult }
      continue
    }

    // Handoff — detected before the no-execute (client tool) branch because
    // a handoff tool also has no `execute`, but it has wholly different
    // semantics: pivot control to a new agent instead of pausing for the
    // browser. The first handoff in a step wins; any subsequent tool calls
    // in the same step are skipped with a synthetic "skipped: handed off"
    // tool result so the message log stays well-formed for replay.
    if (loopCtx.stopForHandoff) {
      const skippedResult = 'Skipped: parent agent handed off to another agent.'
      toolResults.push({ toolCallId: tc.id, result: skippedResult })
      messages.push({ role: 'tool', content: skippedResult, toolCallId: tc.id })
      yield { type: 'tool-call' as const, toolCall: tc }
      yield { type: 'tool-result' as const, toolCall: tc, result: skippedResult }
      continue
    }
    if (isHandoffTool(tool)) {
      const spec = tool.__handoffSpec
      const validation = validateToolArgs(tool, tc.arguments)
      // Handoff payload defaults to `{ message: string }`; custom schemas
      // are accepted but the loop only uses `args.message` (string) as the
      // transition prompt. Anything else surfaces in the conversation as
      // the args of the synthetic tool-call.
      const args = validation.ok ? (validation.value as Record<string, unknown>) : (tc.arguments as Record<string, unknown>)
      const transitionMessage = typeof args['message'] === 'string' ? (args['message'] as string) : ''
      const handoffResult = `Handed off to ${spec.AgentClass.name}.`

      toolResults.push({ toolCallId: tc.id, result: handoffResult })
      messages.push({ role: 'tool', content: handoffResult, toolCallId: tc.id })
      yield { type: 'tool-call' as const, toolCall: tc }
      yield { type: 'tool-result' as const, toolCall: tc, result: handoffResult }
      yield {
        type: 'handoff' as const,
        handoff: {
          from: loopCtx.agent.constructor.name,
          to:   spec.AgentClass.name,
          ...(transitionMessage ? { message: transitionMessage } : {}),
        },
      }

      loopCtx.pendingHandoff = { spec, transitionMessage, parentToolCallId: tc.id }
      loopCtx.stopForHandoff = true
      // Do NOT break — keep iterating so any sibling tool calls in this
      // step get their synthetic "skipped" tool results before the loop
      // exits. This preserves message-log invariants for downstream
      // persistence.
      continue
    }

    if (!tool.execute) {
      // Client tool — no server-side handler.
      if (options?.toolCallStreamingMode === 'stop-on-client-tool') {
        loopCtx.pendingClientToolCalls.push(tc)
        loopCtx.loopFinishReason = 'client_tool_calls'
        loopCtx.stopForClientTools = true
        yield { type: 'tool-call' as const, toolCall: tc }
        continue
      }
      const placeholder = '[client tool — execute on client]'
      toolResults.push({ toolCallId: tc.id, result: placeholder })
      messages.push({ role: 'tool', content: placeholder, toolCallId: tc.id })
      yield { type: 'tool-call' as const, toolCall: tc }
      yield { type: 'tool-result' as const, toolCall: tc, result: placeholder }
      continue
    }

    // needsApproval enforcement
    const approvalDecision = await evaluateApproval(tool, tc, options)
    if (approvalDecision === 'rejected') {
      const rejectionResult = { rejected: true, reason: 'User rejected this tool call' }
      toolResults.push({ toolCallId: tc.id, result: rejectionResult })
      messages.push({ role: 'tool', content: JSON.stringify(rejectionResult), toolCallId: tc.id })
      yield { type: 'tool-result' as const, toolCall: tc, result: rejectionResult }
      continue
    }
    if (approvalDecision === 'pending') {
      loopCtx.pendingApprovalToolCall = { toolCall: tc, isClientTool: false }
      loopCtx.loopFinishReason = 'tool_approval_required'
      loopCtx.stopForApproval = true
      yield { type: 'tool-call' as const, toolCall: tc }
      break
    }

    // onBeforeToolCall
    let toolArgs = tc.arguments
    if (middlewares.length > 0) {
      const beforeResult = await runOnBeforeToolCall(middlewares, ctx, tc.name, toolArgs)
      if (beforeResult) {
        if (beforeResult.type === 'skip') {
          const resultStr = typeof beforeResult.result === 'string' ? beforeResult.result : JSON.stringify(beforeResult.result)
          toolResults.push({ toolCallId: tc.id, result: beforeResult.result })
          messages.push({ role: 'tool', content: resultStr, toolCallId: tc.id })
          yield { type: 'tool-result' as const, toolCall: tc, result: beforeResult.result }
          await runOnAfterToolCall(middlewares, ctx, tc.name, toolArgs, beforeResult.result)
          continue
        }
        if (beforeResult.type === 'abort') {
          await runOnAbort(middlewares, ctx, beforeResult.reason)
          break
        }
        if (beforeResult.type === 'transformArgs') {
          toolArgs = beforeResult.args
        }
      }
    }

    // Validate args against the tool's inputSchema. Runs after middleware
    // transforms so transforms can reshape malformed model output before
    // it is judged. The tool-call chunk is emitted even on validation
    // failure so streaming UIs see a paired tool-call → tool-result(error)
    // sequence; non-streaming callers discard the chunk.
    const validation = validateToolArgs(tool, toolArgs)
    if (!validation.ok) {
      yield { type: 'tool-call' as const, toolCall: tc }
      toolResults.push({ toolCallId: tc.id, result: validation.error })
      messages.push({ role: 'tool', content: JSON.stringify(validation.error), toolCallId: tc.id })
      yield { type: 'tool-result' as const, toolCall: tc, result: validation.error }
      if (middlewares.length > 0) await runOnAfterToolCall(middlewares, ctx, tc.name, toolArgs, validation.error)
      continue
    }
    const validatedArgs = validation.value

    const toolStart = performance.now()
    try {
      // Emit the tool-call marker before execution so streaming UIs see
      // tool-call → tool-update* → tool-result in order. Async-generator
      // executes stream their yields as tool-update chunks live; plain
      // executes yield nothing here.
      //
      // Pause detection: a yielded `pause_for_client_tools` control chunk
      // halts iteration, propagates the nested calls to the parent's
      // pending list, and SKIPS the tool_result emission — the yielding
      // tool's own call stays orphaned in the parent message history
      // until the caller resolves it on resume.
      yield { type: 'tool-call' as const, toolCall: tc }
      const execGen = executeMaybeStreaming(tool, validatedArgs, { toolCallId: tc.id })
      let result: unknown
      let paused = false
      while (true) {
        const step = await execGen.next()
        if (step.done) {
          result = step.value
          break
        }
        if (isPauseForClientToolsChunk(step.value)) {
          for (const pending of step.value.toolCalls) {
            loopCtx.pendingClientToolCalls.push(pending)
          }
          loopCtx.loopFinishReason = 'client_tool_calls'
          loopCtx.stopForClientTools = true
          paused = true
          break
        }
        const updateChunk: StreamChunk = { type: 'tool-update', toolCall: tc, update: step.value }
        if (middlewares.length > 0) {
          const transformed = runOnChunk(middlewares, ctx, updateChunk)
          if (transformed) yield transformed
        } else {
          yield updateChunk
        }
      }
      if (paused) continue   // skip tool_result emission + message push for this tc
      const duration = performance.now() - toolStart
      // toolResults preserves the ORIGINAL value; only the message content
      // pushed onto `messages` (next-step model input) is narrowed by
      // toModelOutput. The streamed `tool-result` chunk also carries the
      // ORIGINAL value.
      toolResults.push({ toolCallId: tc.id, result, duration })
      const resultStr = await applyToModelOutput(
        tool,
        result,
        middlewares.length > 0 ? (e) => runOnError(middlewares, ctx, e) : undefined,
      )
      messages.push({ role: 'tool', content: resultStr, toolCallId: tc.id })
      yield { type: 'tool-result' as const, toolCall: tc, result }

      // onAfterToolCall
      if (middlewares.length > 0) await runOnAfterToolCall(middlewares, ctx, tc.name, toolArgs, result)
    } catch (err: unknown) {
      const duration = performance.now() - toolStart
      const msg = err instanceof Error ? err.message : String(err)
      const errResult = `Error: ${msg}`
      toolResults.push({ toolCallId: tc.id, result: errResult, duration })
      messages.push({ role: 'tool', content: errResult, toolCallId: tc.id })
      yield { type: 'tool-result' as const, toolCall: tc, result: errResult }

      // onAfterToolCall (error case)
      if (middlewares.length > 0) await runOnAfterToolCall(middlewares, ctx, tc.name, toolArgs, errResult)
    }
  }
}

/**
 * Parallel tool execution — three phases:
 *
 * 1. **Prelude (serial, in tool-call order):** classify each call. Approval
 *    decisions, `onBeforeToolCall` middleware, and arg validation all
 *    resolve here; the next phase only sees calls that cleared every
 *    gate. `pending-approval` and `mw-abort` short-circuit the prelude
 *    exactly as they do in serial mode — later calls are never dispatched.
 *
 * 2. **Execution (parallel):** for every `ready` outcome, drive
 *    `executeMaybeStreaming` to completion concurrently. `tool-update`
 *    chunks (and any pause-for-client-tools mutations to `loopCtx`) are
 *    captured per-call into a buffer.
 *
 * 3. **Replay (serial, in tool-call order):** for each outcome, emit its
 *    chunks (including buffered `tool-update`s for ready calls), push
 *    tool messages, and run `onAfterToolCall`. This is the only phase
 *    that yields chunks to consumers, so streamed output stays
 *    deterministic regardless of which `execute()` finished first.
 */
async function* runToolPhaseParallel(
  loopCtx:     LoopContext,
  toolCalls:   ToolCall[],
  toolResults: ToolResult[],
): AsyncGenerator<StreamChunk, void, void> {
  const { messages, middlewares, ctx } = loopCtx

  // ─── Phase 1: prelude ──────────────────────────────────
  const outcomes = await classifyToolCalls(loopCtx, toolCalls)

  // ─── Phase 2: dispatch ready executions concurrently ──
  const ready = outcomes.filter((o): o is ReadyOutcome => o.kind === 'ready')
  const executions = await Promise.all(ready.map(o => runToolExecution(loopCtx, o)))
  const executionByCallId = new Map<string, ToolExecutionResult>()
  for (let i = 0; i < ready.length; i++) {
    executionByCallId.set(ready[i]!.tc.id, executions[i]!)
  }

  // ─── Phase 3: replay chunks + side-effects in order ───
  for (const outcome of outcomes) {
    if (outcome.kind === 'unknown-tool') {
      toolResults.push({ toolCallId: outcome.tc.id, result: outcome.result })
      messages.push({ role: 'tool', content: outcome.result, toolCallId: outcome.tc.id })
      yield { type: 'tool-result' as const, toolCall: outcome.tc, result: outcome.result }
      continue
    }
    if (outcome.kind === 'client-tool-stop') {
      // loopCtx mutations already applied during the prelude.
      yield { type: 'tool-call' as const, toolCall: outcome.tc }
      continue
    }
    if (outcome.kind === 'client-tool-placeholder') {
      toolResults.push({ toolCallId: outcome.tc.id, result: outcome.result })
      messages.push({ role: 'tool', content: outcome.result, toolCallId: outcome.tc.id })
      yield { type: 'tool-call' as const, toolCall: outcome.tc }
      yield { type: 'tool-result' as const, toolCall: outcome.tc, result: outcome.result }
      continue
    }
    if (outcome.kind === 'rejected') {
      toolResults.push({ toolCallId: outcome.tc.id, result: outcome.result })
      messages.push({ role: 'tool', content: JSON.stringify(outcome.result), toolCallId: outcome.tc.id })
      yield { type: 'tool-result' as const, toolCall: outcome.tc, result: outcome.result }
      continue
    }
    if (outcome.kind === 'pending-approval') {
      // loopCtx mutations already applied during the prelude.
      yield { type: 'tool-call' as const, toolCall: outcome.tc }
      // Phase 1 stops classifying after pending-approval, so this is the
      // last outcome — but `break` keeps the intent explicit.
      break
    }
    if (outcome.kind === 'mw-skip') {
      const resultStr = typeof outcome.result === 'string' ? outcome.result : JSON.stringify(outcome.result)
      toolResults.push({ toolCallId: outcome.tc.id, result: outcome.result })
      messages.push({ role: 'tool', content: resultStr, toolCallId: outcome.tc.id })
      yield { type: 'tool-result' as const, toolCall: outcome.tc, result: outcome.result }
      if (middlewares.length > 0) await runOnAfterToolCall(middlewares, ctx, outcome.tc.name, outcome.toolArgs, outcome.result)
      continue
    }
    if (outcome.kind === 'validation-error') {
      yield { type: 'tool-call' as const, toolCall: outcome.tc }
      toolResults.push({ toolCallId: outcome.tc.id, result: outcome.error })
      messages.push({ role: 'tool', content: JSON.stringify(outcome.error), toolCallId: outcome.tc.id })
      yield { type: 'tool-result' as const, toolCall: outcome.tc, result: outcome.error }
      if (middlewares.length > 0) await runOnAfterToolCall(middlewares, ctx, outcome.tc.name, outcome.toolArgs, outcome.error)
      continue
    }
    // outcome.kind === 'ready'
    const exec = executionByCallId.get(outcome.tc.id)!
    yield { type: 'tool-call' as const, toolCall: outcome.tc }
    for (const chunk of exec.updates) yield chunk
    if (exec.kind === 'paused') {
      // Pause-for-client-tools propagated its calls onto `loopCtx` during
      // execution. Skip tool_result emission + message push — the call
      // stays orphaned until resume.
      continue
    }
    if (exec.kind === 'error') {
      const errResult = `Error: ${exec.error.message}`
      toolResults.push({ toolCallId: outcome.tc.id, result: errResult, duration: exec.duration })
      messages.push({ role: 'tool', content: errResult, toolCallId: outcome.tc.id })
      yield { type: 'tool-result' as const, toolCall: outcome.tc, result: errResult }
      if (middlewares.length > 0) await runOnAfterToolCall(middlewares, ctx, outcome.tc.name, outcome.toolArgs, errResult)
      continue
    }
    // exec.kind === 'ok'
    toolResults.push({ toolCallId: outcome.tc.id, result: exec.result, duration: exec.duration })
    const resultStr = await applyToModelOutput(
      outcome.tool,
      exec.result,
      middlewares.length > 0 ? (e) => runOnError(middlewares, ctx, e) : undefined,
    )
    messages.push({ role: 'tool', content: resultStr, toolCallId: outcome.tc.id })
    yield { type: 'tool-result' as const, toolCall: outcome.tc, result: exec.result }
    if (middlewares.length > 0) await runOnAfterToolCall(middlewares, ctx, outcome.tc.name, outcome.toolArgs, exec.result)
  }
}

// ─── Parallel-mode helpers ───────────────────────────────

type ReadyOutcome = {
  kind:          'ready'
  tc:            ToolCall
  tool:          AnyTool
  toolArgs:      Record<string, unknown>
  validatedArgs: Record<string, unknown>
}

type PreludeOutcome =
  | { kind: 'unknown-tool';             tc: ToolCall; result: string }
  | { kind: 'client-tool-placeholder';  tc: ToolCall; result: string }
  | { kind: 'client-tool-stop';         tc: ToolCall }
  | { kind: 'rejected';                 tc: ToolCall; result: { rejected: true; reason: string } }
  | { kind: 'pending-approval';         tc: ToolCall }
  | { kind: 'mw-skip';                  tc: ToolCall; toolArgs: Record<string, unknown>; result: unknown }
  | { kind: 'validation-error';         tc: ToolCall; toolArgs: Record<string, unknown>; error: InvalidToolArgumentsError }
  | ReadyOutcome

/**
 * Walk `toolCalls` in order and decide each call's fate. Mutations to
 * `loopCtx` for client-tool-stop, pending-approval, and middleware-abort
 * happen here so the rest of the parallel flow sees the same state the
 * serial path would. `pending-approval` and `mw-abort` stop the walk —
 * later calls are not classified and are silently dropped.
 */
async function classifyToolCalls(loopCtx: LoopContext, toolCalls: ToolCall[]): Promise<PreludeOutcome[]> {
  const { middlewares, toolMap, options, ctx } = loopCtx
  const outcomes: PreludeOutcome[] = []

  for (const tc of toolCalls) {
    const tool = toolMap.get(tc.name)
    if (!tool) {
      outcomes.push({ kind: 'unknown-tool', tc, result: `Error: Unknown tool "${tc.name}"` })
      continue
    }
    if (!tool.execute) {
      if (options?.toolCallStreamingMode === 'stop-on-client-tool') {
        loopCtx.pendingClientToolCalls.push(tc)
        loopCtx.loopFinishReason = 'client_tool_calls'
        loopCtx.stopForClientTools = true
        outcomes.push({ kind: 'client-tool-stop', tc })
        continue
      }
      outcomes.push({ kind: 'client-tool-placeholder', tc, result: '[client tool — execute on client]' })
      continue
    }

    const approvalDecision = await evaluateApproval(tool, tc, options)
    if (approvalDecision === 'rejected') {
      outcomes.push({ kind: 'rejected', tc, result: { rejected: true, reason: 'User rejected this tool call' } })
      continue
    }
    if (approvalDecision === 'pending') {
      loopCtx.pendingApprovalToolCall = { toolCall: tc, isClientTool: false }
      loopCtx.loopFinishReason = 'tool_approval_required'
      loopCtx.stopForApproval = true
      outcomes.push({ kind: 'pending-approval', tc })
      break
    }

    let toolArgs = tc.arguments
    if (middlewares.length > 0) {
      const beforeResult = await runOnBeforeToolCall(middlewares, ctx, tc.name, toolArgs)
      if (beforeResult) {
        if (beforeResult.type === 'skip') {
          outcomes.push({ kind: 'mw-skip', tc, toolArgs, result: beforeResult.result })
          continue
        }
        if (beforeResult.type === 'abort') {
          await runOnAbort(middlewares, ctx, beforeResult.reason)
          // Drop any prior outcomes too? No — serial mode emits prior
          // outcomes' chunks before hitting abort, so we keep them in the
          // outcomes list and Phase 3 emits them up to (but not including)
          // this call. Stop classifying further.
          break
        }
        if (beforeResult.type === 'transformArgs') {
          toolArgs = beforeResult.args
        }
      }
    }

    const validation = validateToolArgs(tool, toolArgs)
    if (!validation.ok) {
      outcomes.push({ kind: 'validation-error', tc, toolArgs, error: validation.error })
      continue
    }

    outcomes.push({ kind: 'ready', tc, tool, toolArgs, validatedArgs: validation.value })
  }

  return outcomes
}

type ToolExecutionResult =
  | { kind: 'ok';     result: unknown; updates: StreamChunk[]; duration: number }
  | { kind: 'paused';                   updates: StreamChunk[]; duration: number }
  | { kind: 'error';  error: Error;     updates: StreamChunk[]; duration: number }

/**
 * Drive a single tool's `executeMaybeStreaming` to completion. Buffers
 * `tool-update` chunks for replay in tool-call order; pause-for-client-tools
 * mutations to `loopCtx` apply immediately and the call returns `paused`.
 *
 * `ctx` is shared across concurrent invocations. Middleware that writes
 * through `ctx` during `runOnChunk` (uncommon — most use it read-only for
 * telemetry) may observe interleaved updates from sibling tool calls;
 * apps with such middleware should opt out via `parallelTools: false`.
 */
async function runToolExecution(loopCtx: LoopContext, outcome: ReadyOutcome): Promise<ToolExecutionResult> {
  const { middlewares, ctx } = loopCtx
  const updates: StreamChunk[] = []
  const toolStart = performance.now()
  try {
    const execGen = executeMaybeStreaming(outcome.tool, outcome.validatedArgs, { toolCallId: outcome.tc.id })
    let result: unknown
    let paused = false
    while (true) {
      const step = await execGen.next()
      if (step.done) {
        result = step.value
        break
      }
      if (isPauseForClientToolsChunk(step.value)) {
        for (const pending of step.value.toolCalls) {
          loopCtx.pendingClientToolCalls.push(pending)
        }
        loopCtx.loopFinishReason = 'client_tool_calls'
        loopCtx.stopForClientTools = true
        paused = true
        break
      }
      const updateChunk: StreamChunk = { type: 'tool-update', toolCall: outcome.tc, update: step.value }
      if (middlewares.length > 0) {
        const transformed = runOnChunk(middlewares, ctx, updateChunk)
        if (transformed) updates.push(transformed)
      } else {
        updates.push(updateChunk)
      }
    }
    const duration = performance.now() - toolStart
    if (paused) return { kind: 'paused', updates, duration }
    return { kind: 'ok', result, updates, duration }
  } catch (err) {
    const duration = performance.now() - toolStart
    return { kind: 'error', error: err instanceof Error ? err : new Error(String(err)), updates, duration }
  }
}

/**
 * Build the shared `LoopContext` for a `prompt()` / `stream()` call, run
 * approval-resume, and fire `onConfig(init)` + `onStart`. After this returns,
 * the iteration loop can run with the same setup regardless of streaming
 * mode.
 */
async function initializeLoop(
  a: Agent,
  input: string,
  options: AgentPromptOptions | undefined,
): Promise<{ loopCtx: LoopContext; stopConditions: StopCondition[] }> {
  // Honor caller-supplied AbortSignal as early as possible — if the signal
  // is already aborted on entry, do no work at all.
  options?.signal?.throwIfAborted()

  const loopStart = performance.now()
  const modelString = a.model() ?? AiRegistry.getDefault()
  const [providerName] = AiRegistry.parseModelString(modelString)
  const tools = getTools(a)
  const middlewares = getMiddleware(a)
  const toolSchemas = buildToolSchemas(tools)
  const toolMap = buildToolMap(tools)

  const messages: AiMessage[] = options?.messages
    ? [{ role: 'system', content: a.instructions() }, ...options.messages]
    : [
      { role: 'system', content: a.instructions() },
      ...(options?.history ?? []),
      buildUserMessage(input, options?.attachments),
    ]

  const steps: AgentStep[] = []
  const stopConditions = normalizeStopConditions(a.stopWhen())
  const totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

  // Create middleware context (resume below mutates `messages`, captured by
  // reference here, so order is safe).
  const ctx = createMiddlewareContext(messages, modelString, tools, 0) as MiddlewareContext & { readonly _aborted: boolean; readonly _abortReason: string }

  const loopCtx: LoopContext = {
    agent:                   a,
    input,
    options,
    modelString,
    providerName,
    tools,
    toolMap,
    toolSchemas,
    middlewares,
    loopStart,
    ctx,
    messages,
    steps,
    totalUsage,
    pendingClientToolCalls:  [],
    pendingApprovalToolCall: undefined,
    loopFinishReason:        undefined,
    stopForClientTools:      false,
    stopForApproval:         false,
    resumedToolMessages:     [],
    failoverAttempts:        0,
    stopForHandoff:          false,
  }

  // Resume server tools left pending by a previous approval round-trip.
  {
    const resume = await resumePendingToolCalls({ messages, toolMap, options })
    loopCtx.resumedToolMessages = resume.resumed
    if (resume.approvalStillRequired) {
      loopCtx.pendingApprovalToolCall = resume.approvalStillRequired
      loopCtx.loopFinishReason = 'tool_approval_required'
      loopCtx.stopForApproval = true
    }
  }

  // onConfig — init phase
  if (middlewares.length > 0) {
    const configResult = runOnConfig(middlewares, ctx, buildMiddlewareConfig(messages, a), 'init')
    if (configResult.messages) messages.splice(0, messages.length, ...configResult.messages)
  }

  // onStart
  if (middlewares.length > 0) await runSequential(middlewares, 'onStart', ctx)

  return { loopCtx, stopConditions }
}

/**
 * Run the per-iteration prelude — caller-abort check, middleware-abort
 * check, `onIteration`, `prepareStep`, `onConfig(beforeModel)`. Returns the
 * resolved model for this step or `{ aborted: true }` if middleware
 * cancelled the run (caller should `break`). Throws the abort reason if a
 * caller-supplied AbortSignal fired between iterations.
 */
async function runIterationPrelude(
  loopCtx: LoopContext,
  iteration: number,
): Promise<{ currentModel: string } | { aborted: true }> {
  const { agent, options, ctx, middlewares, messages, modelString, steps } = loopCtx
  ctx.iteration = iteration
  // Reset the streaming chunk index for middlewares that key off it. Harmless
  // in non-streaming mode where no chunks flow through `onChunk`.
  ctx.chunkIndex = 0

  // Honor caller-supplied AbortSignal between iterations.
  options?.signal?.throwIfAborted()

  if (ctx._aborted) {
    await runOnAbort(middlewares, ctx, ctx._abortReason)
    return { aborted: true }
  }

  if (middlewares.length > 0) await runSequential(middlewares, 'onIteration', ctx)

  let currentModel = modelString

  if (agent.prepareStep) {
    const prep = await agent.prepareStep({ stepNumber: iteration, steps, messages })
    if (prep.model) currentModel = prep.model
    if (prep.messages) messages.splice(0, messages.length, ...prep.messages)
    if (prep.system) messages[0] = { role: 'system', content: prep.system }
  }

  if (middlewares.length > 0) {
    const configResult = runOnConfig(middlewares, ctx, buildMiddlewareConfig(messages, agent), 'beforeModel')
    if (configResult.messages) messages.splice(0, messages.length, ...configResult.messages)
  }

  return { currentModel }
}

// ─── Agent Loop (non-streaming) ──────────────────────────

/**
 * Hard ceiling for the number of agent-to-agent handoffs in a single
 * `prompt()` / `stream()` call. Most workflows hop once or twice (triage →
 * specialist). Anything beyond this almost certainly means the agents are
 * cycling — surfacing a clear error beats silently looping until token
 * budgets explode.
 */
const MAX_HANDOFFS = 5

/**
 * Public entry point for the non-streaming agent loop. Drives
 * {@link runAgentLoopOnce} once, then — if the model called a {@link handoff}
 * tool — constructs the target agent, carries the conversation forward, and
 * recurses. Steps and usage from each hop are merged; the final `text` and
 * `finishReason` come from the agent that produced the terminal answer.
 * `handoffPath` records the chain of class names traversed.
 */
async function runAgentLoop(a: Agent, input: string, options?: AgentPromptOptions): Promise<AgentResponse> {
  const onceResult = await runAgentLoopOnce(a, input, options) as AgentResponse & {
    _pendingHandoff?: PendingHandoff
    _carriedMessages?: AiMessage[]
  }
  if (!onceResult._pendingHandoff) {
    return stripInternal(onceResult)
  }
  const merged = await driveHandoffs(a.constructor.name, onceResult, onceResult._pendingHandoff, onceResult._carriedMessages ?? [], options, 0)
  return merged
}

/**
 * Streaming counterpart to {@link runAgentLoop}. Iterates handoffs and
 * pivots the stream to the next agent each time the parent ends with a
 * pending handoff. Chunks from every hop flow through the same returned
 * `AsyncIterable`; the resolved `response` carries the merged final state.
 */
function runAgentLoopStreaming(a: Agent, input: string, options?: AgentPromptOptions): AgentStreamResponse {
  let resolveResponse: (r: AgentResponse) => void
  let rejectResponse: (e: unknown) => void
  const responsePromise = new Promise<AgentResponse>((resolve, reject) => {
    resolveResponse = resolve
    rejectResponse = reject
  })

  async function* generateStream(): AsyncIterable<StreamChunk> {
    let currentAgent = a
    let currentInput = input
    let currentOpts: AgentPromptOptions | undefined = options
    const mergedSteps: AgentStep[] = []
    const mergedUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    const handoffPath: string[] = []
    let finalResponse: AgentResponse | undefined

    for (let hop = 0; hop <= MAX_HANDOFFS; hop++) {
      const onceStream = runAgentLoopStreamingOnce(currentAgent, currentInput, currentOpts)
      // Attach a no-op handler so a rejection from the inner response
      // promise (e.g. caller-supplied AbortSignal firing mid-stream) is
      // already observed by the time the `for await` re-throws — without
      // this, Node logs an unhandledRejection between the stream's throw
      // and our outer `withRejectOnError`'s catch.
      onceStream.response.catch(() => {})
      for await (const chunk of onceStream.stream) yield chunk
      const r = await onceStream.response as AgentResponse & {
        _pendingHandoff?: PendingHandoff
        _carriedMessages?: AiMessage[]
      }

      mergedSteps.push(...r.steps)
      addUsage(mergedUsage, r.usage)

      if (r._pendingHandoff && hop < MAX_HANDOFFS) {
        handoffPath.push(currentAgent.constructor.name)
        const ChildClass = r._pendingHandoff.spec.AgentClass
        currentAgent = new (ChildClass as new () => Agent)()
        currentInput = r._pendingHandoff.transitionMessage
        currentOpts = buildHandoffChildOptions(options, r._carriedMessages ?? [])
        continue
      }

      if (r._pendingHandoff) {
        throw new Error(`[RudderJS AI] Exceeded max handoffs (${MAX_HANDOFFS}). Likely a cycle between agents.`)
      }

      finalResponse = handoffPath.length === 0
        ? stripInternal(r)
        : mergeFinalHandoff(stripInternal(r), mergedSteps, mergedUsage, handoffPath, currentAgent.constructor.name)
      break
    }

    if (!finalResponse) {
      throw new Error(`[RudderJS AI] Exceeded max handoffs (${MAX_HANDOFFS}). Likely a cycle between agents.`)
    }
    resolveResponse(finalResponse)
  }

  async function* withRejectOnError(): AsyncIterable<StreamChunk> {
    try {
      yield* generateStream()
    } catch (err) {
      rejectResponse(err)
      throw err
    }
  }

  return {
    stream: withRejectOnError(),
    response: responsePromise,
  }
}

/**
 * Iteratively drive pending handoffs, carrying steps + usage forward.
 * Used by the non-streaming path. (Streaming has its own iterative driver
 * inline in {@link runAgentLoopStreaming} so chunks can flow as each hop's
 * loop runs.)
 */
async function driveHandoffs(
  rootName: string,
  rootResult: AgentResponse & { _pendingHandoff?: PendingHandoff; _carriedMessages?: AiMessage[] },
  pending: PendingHandoff,
  carriedMessages: AiMessage[],
  origOptions: AgentPromptOptions | undefined,
  startHopCount: number,
): Promise<AgentResponse> {
  const mergedSteps: AgentStep[] = [...rootResult.steps]
  const mergedUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  addUsage(mergedUsage, rootResult.usage)

  const handoffPath: string[] = [rootName]
  let currentPending = pending
  let currentCarried = carriedMessages
  let hopCount = startHopCount

  for (;;) {
    if (hopCount >= MAX_HANDOFFS) {
      throw new Error(`[RudderJS AI] Exceeded max handoffs (${MAX_HANDOFFS}). Likely a cycle between agents.`)
    }
    const ChildClass = currentPending.spec.AgentClass
    handoffPath.push(ChildClass.name)
    const child = new (ChildClass as new () => Agent)()
    const childOpts = buildHandoffChildOptions(origOptions, currentCarried)
    const childOnce = await runAgentLoopOnce(child, currentPending.transitionMessage, childOpts) as AgentResponse & {
      _pendingHandoff?: PendingHandoff
      _carriedMessages?: AiMessage[]
    }

    mergedSteps.push(...childOnce.steps)
    addUsage(mergedUsage, childOnce.usage)

    if (childOnce._pendingHandoff) {
      currentPending = childOnce._pendingHandoff
      currentCarried = childOnce._carriedMessages ?? []
      hopCount++
      continue
    }

    return {
      ...stripInternal(childOnce),
      steps: mergedSteps,
      usage: mergedUsage,
      handoffPath,
    }
  }
}

/** Merge the terminal hop's response with carried steps / usage / path. */
function mergeFinalHandoff(
  terminal: AgentResponse,
  mergedSteps: AgentStep[],
  mergedUsage: TokenUsage,
  pathPrefix: string[],
  terminalName: string,
): AgentResponse {
  return {
    ...terminal,
    steps: mergedSteps,
    usage: mergedUsage,
    handoffPath: [...pathPrefix, terminalName],
  }
}

/**
 * Build the {@link AgentPromptOptions} for a child agent invoked via
 * handoff. The parent's carried message log replaces the child's input
 * (so the child sees the full conversation up to the handoff point) but
 * the child still prepends its own `instructions()` as the system message
 * during {@link initializeLoop}, so we drop the parent's leading system
 * message to avoid double-prefixing.
 *
 * Per-call options that make sense to carry across (signal, attachments,
 * tool/middleware overrides) are preserved; `messages` and `history` are
 * deliberately overridden.
 */
function buildHandoffChildOptions(
  parentOptions: AgentPromptOptions | undefined,
  carriedMessages: AiMessage[],
): AgentPromptOptions {
  const stripped = carriedMessages.length > 0 && carriedMessages[0]?.role === 'system'
    ? carriedMessages.slice(1)
    : carriedMessages
  // We append the model's transition message as the next user message so
  // the child has something concrete to respond to (it's also passed as
  // `currentInput` below — but feeding it via `messages` mode keeps the
  // history coherent and prevents `initializeLoop` from also prepending
  // an `input` user message).
  return {
    ...(parentOptions ?? {}),
    messages: stripped,
  }
}

/** Strip the internal `_pendingHandoff` / `_carriedMessages` fields before surfacing the response to public callers. */
function stripInternal(r: AgentResponse & { _pendingHandoff?: PendingHandoff; _carriedMessages?: AiMessage[] }): AgentResponse {
  const out: AgentResponse = {
    text:  r.text,
    steps: r.steps,
    usage: r.usage,
  }
  if (r.conversationId !== undefined) out.conversationId = r.conversationId
  if (r.finishReason !== undefined) out.finishReason = r.finishReason
  if (r.pendingClientToolCalls !== undefined) out.pendingClientToolCalls = r.pendingClientToolCalls
  if (r.pendingApprovalToolCall !== undefined) out.pendingApprovalToolCall = r.pendingApprovalToolCall
  if (r.resumedToolMessages !== undefined) out.resumedToolMessages = r.resumedToolMessages
  if (r.handoffPath !== undefined) out.handoffPath = r.handoffPath
  return out
}

async function runAgentLoopOnce(a: Agent, input: string, options?: AgentPromptOptions): Promise<AgentResponse> {
  const { loopCtx, stopConditions } = await initializeLoop(a, input, options)
  const { ctx, middlewares, messages, steps, totalUsage } = loopCtx

  try {
    if (loopCtx.stopForApproval) {
      // Approval is still required from the resume — skip the model loop.
    } else {
    for (let iteration = 0; iteration < a.maxSteps(); iteration++) {
      const prelude = await runIterationPrelude(loopCtx, iteration)
      if ('aborted' in prelude) break
      const { currentModel } = prelude

      const response = await runFailover(loopCtx, currentModel, (adapter, _, opts) => adapter.generate(opts))
      addUsage(totalUsage, response.usage)

      // onUsage
      if (middlewares.length > 0) await runOnUsage(middlewares, ctx, response.usage)

      const toolCalls = response.message.toolCalls ?? []
      let toolResults: ToolResult[] = []

      if (toolCalls.length > 0) {
        // Drain `executeToolPhase` to completion, discarding the streamed
        // chunks — non-streaming callers don't surface them.
        const phaseGen = executeToolPhase(loopCtx, toolCalls, response.message)
        while (true) {
          const next = await phaseGen.next()
          if (next.done) {
            toolResults = next.value
            break
          }
        }
      } else {
        messages.push(response.message)
      }

      const step: AgentStep = {
        message:      response.message,
        toolCalls,
        toolResults,
        usage:        response.usage,
        finishReason: response.finishReason,
      }
      steps.push(step)
      emitObserverStepCompleted(loopCtx, iteration, false)

      if (loopCtx.stopForClientTools || loopCtx.stopForApproval || loopCtx.stopForHandoff) break

      const shouldStop = stopConditions.some(cond =>
        cond({ steps, iteration, lastMessage: response.message }),
      )
      if (shouldStop || response.finishReason !== 'tool_calls') {
        break
      }
    }
    } // close `else` (skip-loop-when-resume-needs-approval)
  } catch (err) {
    // onError
    if (middlewares.length > 0) await runOnError(middlewares, ctx, err)
    emitObserverFailed(loopCtx, err, false)
    throw err
  }

  // onFinish
  if (middlewares.length > 0) await runSequential(middlewares, 'onFinish', ctx)

  const result = buildAgentResponse(loopCtx)
  emitObserverCompleted(loopCtx, result, false)
  return result
}

// ─── Agent Loop (streaming) ──────────────────────────────

function runAgentLoopStreamingOnce(a: Agent, input: string, options?: AgentPromptOptions): AgentStreamResponse {
  let resolveResponse: (r: AgentResponse) => void
  let rejectResponse: (e: unknown) => void
  const responsePromise = new Promise<AgentResponse>((resolve, reject) => {
    resolveResponse = resolve
    rejectResponse = reject
  })

  async function* generateStream(): AsyncIterable<StreamChunk> {
    const { loopCtx, stopConditions } = await initializeLoop(a, input, options)
    const { ctx, middlewares, messages, steps, totalUsage } = loopCtx

    try {
      if (loopCtx.stopForApproval) {
        // Resume detected unfulfilled approval — skip the model loop entirely.
      } else {
      for (let iteration = 0; iteration < a.maxSteps(); iteration++) {
        const prelude = await runIterationPrelude(loopCtx, iteration)
        if ('aborted' in prelude) break
        const { currentModel } = prelude

        const streamSource = await runFailover(loopCtx, currentModel, (adapter, _, opts) => adapter.stream(opts))

        let text = ''
        let currentToolCalls: ToolCall[] = []
        let stepUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
        let finishReason: AgentStep['finishReason'] = 'stop'
        const partialToolCalls = new Map<string, { id: string; name: string; argChunks: string[] }>()

        for await (const chunk of streamSource) {
          // onChunk — middleware can transform or drop chunks
          let processedChunk: StreamChunk | null = chunk
          if (middlewares.length > 0) {
            processedChunk = runOnChunk(middlewares, ctx, chunk)
            ctx.chunkIndex++
          }
          if (processedChunk) yield processedChunk

          // Always process the original chunk for state tracking
          if (chunk.type === 'text-delta' && chunk.text) {
            text += chunk.text
          } else if (chunk.type === 'tool-call-delta' && chunk.toolCall?.id) {
            partialToolCalls.set(chunk.toolCall.id, {
              id: chunk.toolCall.id,
              name: chunk.toolCall.name ?? '',
              argChunks: [],
            })
          } else if (chunk.type === 'tool-call-delta' && chunk.text) {
            // Accumulate argument JSON chunks to the last partial tool call
            const last = Array.from(partialToolCalls.values()).pop()
            if (last) last.argChunks.push(chunk.text)
          } else if (chunk.type === 'tool-call' && chunk.toolCall) {
            const tc = chunk.toolCall as ToolCall
            currentToolCalls.push(tc)
          } else if (chunk.type === 'usage' && chunk.usage) {
            stepUsage = chunk.usage
          } else if (chunk.type === 'finish') {
            if (chunk.usage) stepUsage = chunk.usage
            finishReason = chunk.finishReason ?? 'stop'
          }
        }

        // Finalize partial tool calls
        for (const [, partial] of partialToolCalls) {
          try {
            const args = JSON.parse(partial.argChunks.join(''))
            currentToolCalls.push({ id: partial.id, name: partial.name, arguments: args })
          } catch {
            currentToolCalls.push({ id: partial.id, name: partial.name, arguments: {} })
          }
        }

        addUsage(totalUsage, stepUsage)

        // onUsage
        if (middlewares.length > 0) await runOnUsage(middlewares, ctx, stepUsage)

        let toolResults: ToolResult[] = []

        if (currentToolCalls.length > 0) {
          const assistantMsg: AiMessage = { role: 'assistant', content: text, toolCalls: currentToolCalls }
          // Forward chunks from the shared tool-phase generator straight
          // through to the stream consumer.
          const phaseGen = executeToolPhase(loopCtx, currentToolCalls, assistantMsg)
          while (true) {
            const next = await phaseGen.next()
            if (next.done) {
              toolResults = next.value
              break
            }
            yield next.value
          }
        } else {
          messages.push({ role: 'assistant', content: text })
        }

        const step: AgentStep = {
          message: { role: 'assistant', content: text, ...(currentToolCalls.length > 0 ? { toolCalls: currentToolCalls } : {}) },
          toolCalls: currentToolCalls,
          toolResults,
          usage: stepUsage,
          finishReason,
        }
        steps.push(step)
        emitObserverStepCompleted(loopCtx, iteration, true)

        if (loopCtx.stopForClientTools || loopCtx.stopForApproval || loopCtx.stopForHandoff) break

        const shouldStop = stopConditions.some(cond =>
          cond({ steps, iteration, lastMessage: step.message }),
        )
        if (shouldStop || finishReason !== 'tool_calls') break

        // Reset for next iteration
        text = ''
        currentToolCalls = []
      }
      } // close `else` (skip-loop-when-resume-needs-approval)
    } catch (err) {
      // onError
      if (middlewares.length > 0) await runOnError(middlewares, ctx, err)
      emitObserverFailed(loopCtx, err, true)
      throw err
    }

    // onFinish
    if (middlewares.length > 0) await runSequential(middlewares, 'onFinish', ctx)

    // Emit pending state to consumers via dedicated chunk types
    if (loopCtx.pendingClientToolCalls.length > 0) {
      yield { type: 'pending-client-tools' as const, toolCalls: loopCtx.pendingClientToolCalls } as unknown as StreamChunk
    }
    if (loopCtx.pendingApprovalToolCall) {
      yield { type: 'pending-approval' as const, toolCall: loopCtx.pendingApprovalToolCall.toolCall, isClientTool: loopCtx.pendingApprovalToolCall.isClientTool } as unknown as StreamChunk
    }

    const result = buildAgentResponse(loopCtx)
    emitObserverCompleted(loopCtx, result, true)

    resolveResponse!(result)
  }

  // Outer wrapper: if `generateStream` throws (e.g. the caller's
  // AbortSignal fired), reject the `response` promise with the same
  // reason BEFORE re-throwing into the for-await consumer. Without this,
  // `await response` would hang forever after a mid-stream abort.
  async function* withRejectOnError(): AsyncIterable<StreamChunk> {
    try {
      yield* generateStream()
    } catch (err) {
      rejectResponse!(err)
      throw err
    }
  }

  return {
    stream: withRejectOnError(),
    response: responsePromise,
  }
}

function normalizeStopConditions(cond: StopCondition | StopCondition[]): StopCondition[] {
  return Array.isArray(cond) ? cond : [cond]
}

/**
 * When continuing a chat after a stop-on-approval round-trip, the supplied
 * `messages` array ends with an `assistant` message whose `toolCalls` were
 * never fulfilled (the loop paused before executing them). Most providers
 * (Anthropic in particular) reject such conversations because every
 * `tool_use` block must be followed by a matching `tool_result`.
 *
 * This helper detects that case, executes the pending **server** tool calls
 * (honoring `approvedToolCallIds` / `rejectedToolCallIds`), appends the
 * resulting tool messages to `messages` in place, and returns them. The
 * caller can attach the returned list to `AgentResponse.resumedToolMessages`
 * so that the panels dispatcher persists them in the conversation store.
 *
 * Client tools (no `execute`) must come back from the browser with their
 * tool result already in the conversation, so the trailing assistant message
 * will not have unmatched `toolCalls` for them — they're handled outside.
 */
async function resumePendingToolCalls(deps: {
  messages: AiMessage[]
  toolMap:  Map<string, AnyTool>
  options:  AgentPromptOptions | undefined
}): Promise<{
  resumed:               AiMessage[]
  approvalStillRequired: { toolCall: ToolCall; isClientTool: boolean } | undefined
}> {
  const { messages, toolMap, options } = deps
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'assistant' || !last.toolCalls || last.toolCalls.length === 0) {
    return { resumed: [], approvalStillRequired: undefined }
  }

  const resumed: AiMessage[] = []
  let approvalStillRequired: { toolCall: ToolCall; isClientTool: boolean } | undefined

  for (const tc of last.toolCalls) {
    const tool = toolMap.get(tc.name)
    if (!tool) {
      const err = `Error: Unknown tool "${tc.name}"`
      const m: AiMessage = { role: 'tool', content: err, toolCallId: tc.id }
      messages.push(m)
      resumed.push(m)
      continue
    }
    if (!tool.execute) {
      // Client tool whose result is missing from the supplied messages.
      // Surface an error so the model can recover instead of hanging.
      const err = `Error: client tool "${tc.name}" was not executed by the browser`
      const m: AiMessage = { role: 'tool', content: err, toolCallId: tc.id }
      messages.push(m)
      resumed.push(m)
      continue
    }

    const decision = await evaluateApproval(tool, tc, options)
    if (decision === 'rejected') {
      const rej = { rejected: true, reason: 'User rejected this tool call' }
      const m: AiMessage = { role: 'tool', content: JSON.stringify(rej), toolCallId: tc.id }
      messages.push(m)
      resumed.push(m)
      continue
    }
    if (decision === 'pending') {
      // Still pending — the user has not yet approved this call. Re-emit
      // the pending state and stop processing further tools.
      approvalStillRequired = { toolCall: tc, isClientTool: false }
      break
    }

    // Validate args before executing on resume. Approval-resume bypasses
    // middleware so we use the raw tc.arguments. On failure, feed the
    // structured error to the model so it can correct itself.
    const validation = validateToolArgs(tool, tc.arguments)
    if (!validation.ok) {
      const m: AiMessage = { role: 'tool', content: JSON.stringify(validation.error), toolCallId: tc.id }
      messages.push(m)
      resumed.push(m)
      continue
    }

    try {
      // Drain generator yields silently — approval-resume runs outside the
      // stream, so any preliminary updates are discarded; only the final
      // return value is captured.
      const execGen = executeMaybeStreaming(tool, validation.value, { toolCallId: tc.id })
      let result: unknown
      while (true) {
        const step = await execGen.next()
        if (step.done) { result = step.value; break }
      }
      // Approval-resume has no middleware context here, so toModelOutput
      // errors fall back silently to default stringification (R6).
      const content = await applyToModelOutput(tool, result)
      const m: AiMessage = { role: 'tool', content, toolCallId: tc.id }
      messages.push(m)
      resumed.push(m)
    } catch (err) {
      const errMsg = `Error: ${err instanceof Error ? err.message : String(err)}`
      const m: AiMessage = { role: 'tool', content: errMsg, toolCallId: tc.id }
      messages.push(m)
      resumed.push(m)
    }
  }

  return { resumed, approvalStillRequired }
}

/**
 * Detect an async generator (the value returned by `async function*` or any
 * object implementing the AsyncGenerator protocol). We use a structural check
 * because the executor may not be authored as a literal `async function*`
 * (e.g. wrapped or returned from a factory).
 */
function isAsyncGenerator(value: unknown): value is AsyncGenerator<unknown, unknown, void> {
  if (value === null || typeof value !== 'object') return false
  const v = value as { next?: unknown; return?: unknown; [Symbol.asyncIterator]?: unknown }
  return typeof v.next === 'function'
    && typeof v.return === 'function'
    && typeof v[Symbol.asyncIterator] === 'function'
}

/**
 * Uniformly iterate a tool's `execute`, whether it returns a value, a
 * promise, or an async generator.
 *
 * The helper is itself an async generator: each `yield` is a preliminary
 * tool-update payload (only generator-style executes produce these), and the
 * generator's `return` value is the final tool result.
 *
 * Streaming callers iterate and emit `tool-update` chunks live as updates
 * arrive. Non-streaming callers iterate and discard yields, capturing only
 * the final return value — same tool definition works in both modes.
 */
async function* executeMaybeStreaming(
  tool: Tool,
  args: Record<string, unknown>,
  ctx: ToolCallContext,
): AsyncGenerator<unknown, unknown, void> {
  const execute = tool.execute as
    | ((input: unknown, ctx?: ToolCallContext) => unknown)
    | undefined
  if (!execute) {
    throw new Error('Tool has no execute function')
  }
  const ret = execute(args, ctx)
  if (isAsyncGenerator(ret)) {
    while (true) {
      const step = await ret.next()
      if (step.done) return step.value
      yield step.value
    }
  }
  return await ret
}

/**
 * Structured error returned to the model when a tool call's arguments fail
 * the tool's `inputSchema`. Surfaced both as the `result` on `AgentStep`
 * and as the JSON-encoded `tool` message the next provider step receives,
 * so the model can correct itself on the next turn.
 */
export interface InvalidToolArgumentsError {
  error: 'invalid_arguments'
  message: string
  issues: Array<{ path: string; message: string }>
}

/**
 * Validate a tool call's arguments against the tool's `inputSchema`. On
 * success, the parsed value is returned — zod transforms (`.transform`,
 * `.default`, type coercion) are applied, so `execute` receives the
 * canonical shape the schema describes. On failure, a structured error
 * suitable for feeding back to the model is returned.
 */
function validateToolArgs(
  tool: Tool,
  args: Record<string, unknown>,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: InvalidToolArgumentsError } {
  const parsed = tool.definition.inputSchema.safeParse(args)
  if (parsed.success) {
    return { ok: true, value: parsed.data as Record<string, unknown> }
  }
  return {
    ok: false,
    error: {
      error: 'invalid_arguments',
      message: `Tool "${tool.definition.name}" received arguments that did not match its inputSchema.`,
      issues: parsed.error.issues.map(i => ({
        path: i.path.map(seg => String(seg)).join('.'),
        message: i.message,
      })),
    },
  }
}

/**
 * Default stringification used for the `tool` role message content when a
 * tool has no `toModelOutput` transform: pass through strings, JSON-encode
 * everything else.
 */
function defaultStringify(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/**
 * Convert a tool's structured `result` into the string the **model** will
 * see on its next step. Honors `tool.toModelOutput` when present, falling
 * back to {@link defaultStringify}.
 *
 * Per R6 in the ai-loop-parity plan: a throwing `toModelOutput` MUST NOT
 * crash the loop. We swallow the error, route it through `onError`
 * middleware so it stays observable, and use the default stringification
 * as a safety net.
 */
async function applyToModelOutput(
  tool: Tool,
  result: unknown,
  onError?: (err: unknown) => void | Promise<void>,
): Promise<string> {
  if (tool.toModelOutput) {
    try {
      return await (tool.toModelOutput as (r: unknown) => string | Promise<string>)(result)
    } catch (err) {
      if (onError) await onError(err)
    }
  }
  return defaultStringify(result)
}

/**
 * Resolve `needsApproval` for a tool call, taking into account the
 * client-supplied `approvedToolCallIds` / `rejectedToolCallIds` lists.
 *
 * Returns:
 * - `'allow'`     — execute the tool normally (default; also when approved)
 * - `'pending'`   — needsApproval is truthy and the call has not been approved
 * - `'rejected'`  — the call appears in `rejectedToolCallIds`
 */
async function evaluateApproval(
  tool: Tool,
  tc: ToolCall,
  options: AgentPromptOptions | undefined,
): Promise<'allow' | 'pending' | 'rejected'> {
  const needs = tool.definition.needsApproval
  const requires = typeof needs === 'function' ? await needs(tc.arguments) : !!needs
  if (!requires) return 'allow'

  if (options?.rejectedToolCallIds?.includes(tc.id)) return 'rejected'
  if (options?.approvedToolCallIds?.includes(tc.id)) return 'allow'
  return 'pending'
}
