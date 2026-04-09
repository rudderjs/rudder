import { AiRegistry } from './registry.js'
import { toolToSchema } from './tool.js'
import { attachmentsToContentParts, getMessageText } from './attachment.js'
import { QueuedPromptBuilder } from './queue-job.js'
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
import type {
  AgentPromptOptions,
  AiMessage,
  AiMiddleware,
  Attachment,
  AgentResponse,
  AgentStep,
  AgentStreamResponse,
  AnyTool,
  ContentPart,
  ConversationStore,
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
  ToolResult,
  TokenUsage,
  ToolChoice,
} from './types.js'

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

  /** Run the agent with a prompt (non-streaming) */
  async prompt(input: string, options?: AgentPromptOptions): Promise<AgentResponse> {
    return runAgentLoop(this, input, options)
  }

  /** Run the agent with a prompt (streaming) */
  stream(input: string, options?: AgentPromptOptions): AgentStreamResponse {
    return runAgentLoopStreaming(this, input, options)
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
    const store = resolveConversationStore()
    if (!store) throw new Error('[RudderJS AI] No ConversationStore registered. Register one via the DI container with key "ai.conversations".')

    // Load or create conversation
    let history: AiMessage[] = options?.history ?? []
    if (this._conversationId) {
      history = [...(await store.load(this._conversationId)), ...history]
    } else {
      const meta = this._userId ? { userId: this._userId } : undefined
      this._conversationId = await store.create(undefined, meta)
    }

    const response = await runAgentLoop(this.agent, input, { ...options, history })

    // Persist messages
    const newMessages: AiMessage[] = [
      { role: 'user', content: input },
      ...response.steps.flatMap(s => {
        const msgs: AiMessage[] = [s.message]
        for (const tr of s.toolResults) {
          const resultStr = typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result)
          msgs.push({ role: 'tool', content: resultStr, toolCallId: tr.toolCallId })
        }
        return msgs
      }),
    ]
    await store.append(this._conversationId, newMessages)

    return { text: response.text, steps: response.steps, usage: response.usage, conversationId: this._conversationId! }
  }

  stream(input: string, options?: AgentPromptOptions): AgentStreamResponse {
    const store = resolveConversationStore()
    if (!store) throw new Error('[RudderJS AI] No ConversationStore registered. Register one via the DI container with key "ai.conversations".')

    // We need to handle async setup, so wrap the streaming
    let resolveReady: () => void
    const ready = new Promise<void>(r => { resolveReady = r })
    let loadedHistory: AiMessage[] = []
    let convId = this._conversationId

    // Kick off async setup
    const setupPromise = (async () => {
      if (convId) {
        loadedHistory = await store.load(convId)
      } else {
        const meta = this._userId ? { userId: this._userId } : undefined
        convId = await store.create(undefined, meta)
        this._conversationId = convId
      }
      resolveReady!()
    })()

    let resolveResponse: (r: AgentResponse) => void
    const responsePromise = new Promise<AgentResponse>(r => { resolveResponse = r })

    const self = this
    const storeRef = store
    async function* generateStream(): AsyncIterable<StreamChunk> {
      await setupPromise
      const history = [...loadedHistory, ...(options?.history ?? [])]
      const inner = runAgentLoopStreaming(self.agent, input, { ...options, history })

      for await (const chunk of inner.stream) {
        yield chunk
      }

      const response = await inner.response

      // Persist messages
      const newMessages: AiMessage[] = [
        { role: 'user', content: input },
        ...response.steps.flatMap(s => {
          const msgs: AiMessage[] = [s.message]
          for (const tr of s.toolResults) {
            const resultStr = typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result)
            msgs.push({ role: 'tool', content: resultStr, toolCallId: tr.toolCallId })
          }
          return msgs
        }),
      ]
      await storeRef.append(convId!, newMessages)

      const result: AgentResponse = { text: response.text, steps: response.steps, usage: response.usage, conversationId: convId! }
      resolveResponse!(result)
    }

    return { stream: generateStream(), response: responsePromise }
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

// ─── Agent Loop (non-streaming) ──────────────────────────

async function runAgentLoop(a: Agent, input: string, options?: AgentPromptOptions): Promise<AgentResponse> {
  const modelString = a.model() ?? AiRegistry.getDefault()
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

  // State for client-tool-stopping and approval-stopping
  const pendingClientToolCalls: ToolCall[] = []
  let pendingApprovalToolCall: { toolCall: ToolCall; isClientTool: boolean } | undefined
  let loopFinishReason: FinishReason | undefined
  let stopForClientTools = false
  let stopForApproval = false
  let resumedToolMessages: AiMessage[] = []

  // Resume server tools left pending by a previous approval round-trip.
  // (Must run before middleware context creation since `messages` may grow.)
  {
    const resume = await resumePendingToolCalls({ messages, toolMap, options })
    resumedToolMessages = resume.resumed
    if (resume.approvalStillRequired) {
      pendingApprovalToolCall = resume.approvalStillRequired
      loopFinishReason = 'tool_approval_required'
      stopForApproval = true
    }
  }

  // Create middleware context
  const ctx = createMiddlewareContext(messages, modelString, tools, 0) as MiddlewareContext & { readonly _aborted: boolean; readonly _abortReason: string }

  // onConfig — init phase
  if (middlewares.length > 0) {
    const configResult = runOnConfig(middlewares, ctx, buildMiddlewareConfig(messages, a), 'init')
    if (configResult.messages) messages.splice(0, messages.length, ...configResult.messages)
  }

  // onStart
  if (middlewares.length > 0) await runSequential(middlewares, 'onStart', ctx)

  try {
    if (stopForApproval) {
      // Approval is still required from the resume — skip the model loop.
    } else {
    for (let iteration = 0; iteration < a.maxSteps(); iteration++) {
      ctx.iteration = iteration

      // Check if middleware aborted
      if (ctx._aborted) {
        await runOnAbort(middlewares, ctx, ctx._abortReason)
        break
      }

      // onIteration
      if (middlewares.length > 0) await runSequential(middlewares, 'onIteration', ctx)

      let currentModel = modelString
      let currentToolSchemas = toolSchemas

      // prepareStep hook
      if (a.prepareStep) {
        const prep = await a.prepareStep({ stepNumber: iteration, steps, messages })
        if (prep.model) currentModel = prep.model
        if (prep.messages) messages.splice(0, messages.length, ...prep.messages)
        if (prep.system) messages[0] = { role: 'system', content: prep.system }
      }

      // onConfig — beforeModel phase
      if (middlewares.length > 0) {
        const configResult = runOnConfig(middlewares, ctx, buildMiddlewareConfig(messages, a), 'beforeModel')
        if (configResult.messages) messages.splice(0, messages.length, ...configResult.messages)
      }

      const failoverModels = [currentModel, ...a.failover().filter(m => m !== currentModel)]
      let response: import('./types.js').ProviderResponse | undefined
      let lastError: Error | undefined

      for (const tryModel of failoverModels) {
        try {
          const adapter = AiRegistry.resolve(tryModel)
          const [, modelId] = AiRegistry.parseModelString(tryModel)
          const reqOptions: ProviderRequestOptions = {
            model: modelId,
            messages,
            tools: currentToolSchemas.length > 0 ? currentToolSchemas : undefined,
            temperature: a.temperature(),
            maxTokens: a.maxTokens(),
          }
          response = await adapter.generate(reqOptions)
          break
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err))
          if (tryModel === failoverModels[failoverModels.length - 1]) throw lastError
        }
      }
      if (!response) throw lastError ?? new Error('No provider available')
      addUsage(totalUsage, response.usage)

      // onUsage
      if (middlewares.length > 0) await runOnUsage(middlewares, ctx, response.usage)

      const toolCalls = response.message.toolCalls ?? []
      const toolResults: ToolResult[] = []

      if (toolCalls.length > 0) {
        messages.push(response.message)

        for (const tc of toolCalls) {
          const tool = toolMap.get(tc.name)
          if (!tool) {
            toolResults.push({ toolCallId: tc.id, result: `Error: Unknown tool "${tc.name}"` })
            messages.push({ role: 'tool', content: `Error: Unknown tool "${tc.name}"`, toolCallId: tc.id })
            continue
          }
          if (!tool.execute) {
            // Client tool — no server-side handler.
            if (options?.toolCallStreamingMode === 'stop-on-client-tool') {
              pendingClientToolCalls.push(tc)
              loopFinishReason = 'client_tool_calls'
              stopForClientTools = true
              continue
            }
            toolResults.push({ toolCallId: tc.id, result: '[client tool — execute on client]' })
            messages.push({ role: 'tool', content: '[client tool — execute on client]', toolCallId: tc.id })
            continue
          }

          // needsApproval enforcement
          const approvalDecision = await evaluateApproval(tool, tc, options)
          if (approvalDecision === 'rejected') {
            const rejectionResult = { rejected: true, reason: 'User rejected this tool call' }
            toolResults.push({ toolCallId: tc.id, result: rejectionResult })
            messages.push({ role: 'tool', content: JSON.stringify(rejectionResult), toolCallId: tc.id })
            continue
          }
          if (approvalDecision === 'pending') {
            pendingApprovalToolCall = { toolCall: tc, isClientTool: false }
            loopFinishReason = 'tool_approval_required'
            stopForApproval = true
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

          try {
            // Drain generator yields silently in the non-streaming loop —
            // the same tool definition must work in both prompt() and stream().
            const execGen = executeMaybeStreaming(tool, toolArgs)
            let result: unknown
            while (true) {
              const step = await execGen.next()
              if (step.done) { result = step.value; break }
            }
            const resultStr = typeof result === 'string' ? result : JSON.stringify(result)
            toolResults.push({ toolCallId: tc.id, result })
            messages.push({ role: 'tool', content: resultStr, toolCallId: tc.id })

            // onAfterToolCall
            if (middlewares.length > 0) await runOnAfterToolCall(middlewares, ctx, tc.name, toolArgs, result)
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err)
            toolResults.push({ toolCallId: tc.id, result: `Error: ${msg}` })
            messages.push({ role: 'tool', content: `Error: ${msg}`, toolCallId: tc.id })

            // onAfterToolCall (error case)
            if (middlewares.length > 0) await runOnAfterToolCall(middlewares, ctx, tc.name, toolArgs, `Error: ${msg}`)
          }
        }

        // onToolPhaseComplete
        if (middlewares.length > 0) await runSequential(middlewares, 'onToolPhaseComplete', ctx)
      } else {
        messages.push(response.message)
      }

      const step: AgentStep = {
        message: response.message,
        toolCalls,
        toolResults,
        usage: response.usage,
        finishReason: response.finishReason,
      }
      steps.push(step)

      if (stopForClientTools || stopForApproval) break

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
    throw err
  }

  // onFinish
  if (middlewares.length > 0) await runSequential(middlewares, 'onFinish', ctx)

  const lastStep = steps[steps.length - 1]
  const result: AgentResponse = {
    text: lastStep ? getMessageText(lastStep.message.content) : '',
    steps,
    usage: totalUsage,
  }
  if (loopFinishReason) result.finishReason = loopFinishReason
  if (pendingClientToolCalls.length > 0) result.pendingClientToolCalls = pendingClientToolCalls
  if (pendingApprovalToolCall) result.pendingApprovalToolCall = pendingApprovalToolCall
  if (resumedToolMessages.length > 0) result.resumedToolMessages = resumedToolMessages
  return result
}

// ─── Agent Loop (streaming) ──────────────────────────────

function runAgentLoopStreaming(a: Agent, input: string, options?: AgentPromptOptions): AgentStreamResponse {
  let resolveResponse: (r: AgentResponse) => void
  const responsePromise = new Promise<AgentResponse>((resolve) => { resolveResponse = resolve })

  async function* generateStream(): AsyncIterable<StreamChunk> {
    const modelString = a.model() ?? AiRegistry.getDefault()
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

    // State for client-tool-stopping and approval-stopping
    const pendingClientToolCalls: ToolCall[] = []
    let pendingApprovalToolCall: { toolCall: ToolCall; isClientTool: boolean } | undefined
    let loopFinishReason: FinishReason | undefined
    let stopForClientTools = false
    let stopForApproval = false
    let resumedToolMessages: AiMessage[] = []

    // Resume server tools left pending by a previous approval round-trip.
    {
      const resume = await resumePendingToolCalls({ messages, toolMap, options })
      resumedToolMessages = resume.resumed
      if (resume.approvalStillRequired) {
        pendingApprovalToolCall = resume.approvalStillRequired
        loopFinishReason = 'tool_approval_required'
        stopForApproval = true
      }
    }

    // Create middleware context
    const ctx = createMiddlewareContext(messages, modelString, tools, 0) as MiddlewareContext & { readonly _aborted: boolean; readonly _abortReason: string }

    // onConfig — init phase
    if (middlewares.length > 0) {
      const configResult = runOnConfig(middlewares, ctx, buildMiddlewareConfig(messages, a), 'init')
      if (configResult.messages) messages.splice(0, messages.length, ...configResult.messages)
    }

    // onStart
    if (middlewares.length > 0) await runSequential(middlewares, 'onStart', ctx)

    try {
      if (stopForApproval) {
        // Resume detected unfulfilled approval — skip the model loop entirely.
      } else {
      for (let iteration = 0; iteration < a.maxSteps(); iteration++) {
        ctx.iteration = iteration
        ctx.chunkIndex = 0

        // Check if middleware aborted
        if (ctx._aborted) {
          await runOnAbort(middlewares, ctx, ctx._abortReason)
          break
        }

        // onIteration
        if (middlewares.length > 0) await runSequential(middlewares, 'onIteration', ctx)

        let currentModel = modelString

        if (a.prepareStep) {
          const prep = await a.prepareStep({ stepNumber: iteration, steps, messages })
          if (prep.model) currentModel = prep.model
          if (prep.messages) messages.splice(0, messages.length, ...prep.messages)
          if (prep.system) messages[0] = { role: 'system', content: prep.system }
        }

        // onConfig — beforeModel phase
        if (middlewares.length > 0) {
          const configResult = runOnConfig(middlewares, ctx, buildMiddlewareConfig(messages, a), 'beforeModel')
          if (configResult.messages) messages.splice(0, messages.length, ...configResult.messages)
        }

        const failoverModels = [currentModel, ...a.failover().filter(m => m !== currentModel)]
        let streamSource: AsyncIterable<StreamChunk> | undefined
        let lastError: Error | undefined

        for (const tryModel of failoverModels) {
          try {
            const adapter = AiRegistry.resolve(tryModel)
            const [, modelId] = AiRegistry.parseModelString(tryModel)
            const opts: ProviderRequestOptions = {
              model: modelId,
              messages,
              tools: toolSchemas.length > 0 ? toolSchemas : undefined,
              temperature: a.temperature(),
              maxTokens: a.maxTokens(),
            }
            streamSource = adapter.stream(opts)
            break
          } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err))
            if (tryModel === failoverModels[failoverModels.length - 1]) throw lastError
          }
        }
        if (!streamSource) throw lastError ?? new Error('No provider available')

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

        const toolResults: ToolResult[] = []

        if (currentToolCalls.length > 0) {
          const assistantMsg: AiMessage = { role: 'assistant', content: text, toolCalls: currentToolCalls }
          messages.push(assistantMsg)

          for (const tc of currentToolCalls) {
            const tool = toolMap.get(tc.name)
            if (!tool) {
              const unknownResult = `Error: Unknown tool "${tc.name}"`
              toolResults.push({ toolCallId: tc.id, result: unknownResult })
              messages.push({ role: 'tool', content: unknownResult, toolCallId: tc.id })
              yield { type: 'tool-result' as const, toolCall: tc, result: unknownResult }
              continue
            }
            if (!tool.execute) {
              // Client tool — no server-side handler.
              if (options?.toolCallStreamingMode === 'stop-on-client-tool') {
                pendingClientToolCalls.push(tc)
                loopFinishReason = 'client_tool_calls'
                stopForClientTools = true
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
              pendingApprovalToolCall = { toolCall: tc, isClientTool: false }
              loopFinishReason = 'tool_approval_required'
              stopForApproval = true
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

            try {
              // Emit the tool-call marker before execution so the UI sees
              // tool-call → tool-update* → tool-result in order. Async-
              // generator executes stream their yields as tool-update chunks
              // live; plain executes yield nothing here.
              yield { type: 'tool-call' as const, toolCall: tc }
              const execGen = executeMaybeStreaming(tool, toolArgs)
              let result: unknown
              while (true) {
                const step = await execGen.next()
                if (step.done) {
                  result = step.value
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
              const resultStr = typeof result === 'string' ? result : JSON.stringify(result)
              toolResults.push({ toolCallId: tc.id, result })
              messages.push({ role: 'tool', content: resultStr, toolCallId: tc.id })
              yield { type: 'tool-result' as const, toolCall: tc, result }

              // onAfterToolCall
              if (middlewares.length > 0) await runOnAfterToolCall(middlewares, ctx, tc.name, toolArgs, result)
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err)
              const errResult = `Error: ${msg}`
              toolResults.push({ toolCallId: tc.id, result: errResult })
              messages.push({ role: 'tool', content: errResult, toolCallId: tc.id })
              yield { type: 'tool-result' as const, toolCall: tc, result: errResult }

              // onAfterToolCall (error case)
              if (middlewares.length > 0) await runOnAfterToolCall(middlewares, ctx, tc.name, toolArgs, errResult)
            }
          }

          // onToolPhaseComplete
          if (middlewares.length > 0) await runSequential(middlewares, 'onToolPhaseComplete', ctx)
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

        if (stopForClientTools || stopForApproval) break

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
      throw err
    }

    // onFinish
    if (middlewares.length > 0) await runSequential(middlewares, 'onFinish', ctx)

    // Emit pending state to consumers via dedicated chunk types
    if (pendingClientToolCalls.length > 0) {
      yield { type: 'pending-client-tools' as const, toolCalls: pendingClientToolCalls } as unknown as StreamChunk
    }
    if (pendingApprovalToolCall) {
      yield { type: 'pending-approval' as const, toolCall: pendingApprovalToolCall.toolCall, isClientTool: pendingApprovalToolCall.isClientTool } as unknown as StreamChunk
    }

    const lastStep = steps[steps.length - 1]
    const result: AgentResponse = {
      text: lastStep ? getMessageText(lastStep.message.content) : '',
      steps,
      usage: totalUsage,
    }
    if (loopFinishReason) result.finishReason = loopFinishReason
    if (pendingClientToolCalls.length > 0) result.pendingClientToolCalls = pendingClientToolCalls
    if (pendingApprovalToolCall) result.pendingApprovalToolCall = pendingApprovalToolCall
    if (resumedToolMessages.length > 0) result.resumedToolMessages = resumedToolMessages
    resolveResponse!(result)
  }

  return {
    stream: generateStream(),
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

    try {
      // Drain generator yields silently — approval-resume runs outside the
      // stream, so any preliminary updates are discarded; only the final
      // return value is captured.
      const execGen = executeMaybeStreaming(tool, tc.arguments)
      let result: unknown
      while (true) {
        const step = await execGen.next()
        if (step.done) { result = step.value; break }
      }
      const content = typeof result === 'string' ? result : JSON.stringify(result)
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
): AsyncGenerator<unknown, unknown, void> {
  const execute = tool.execute as ((input: unknown) => unknown) | undefined
  if (!execute) {
    throw new Error('Tool has no execute function')
  }
  const ret = execute(args)
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
