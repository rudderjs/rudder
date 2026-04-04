import { AiRegistry } from './registry.js'
import { toolToSchema } from './tool.js'
import type {
  AiMessage,
  AiMiddleware,
  AgentResponse,
  AgentStep,
  AgentStreamResponse,
  AnyTool,
  HasMiddleware,
  HasTools,
  PrepareStepResult,
  ProviderRequestOptions,
  StopCondition,
  StreamChunk,
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
  async prompt(input: string): Promise<AgentResponse> {
    return runAgentLoop(this, input)
  }

  /** Run the agent with a prompt (streaming) */
  stream(input: string): AgentStreamResponse {
    return runAgentLoopStreaming(this, input)
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

function getTools(a: Agent): AnyTool[] {
  return 'tools' in a && typeof (a as any).tools === 'function'
    ? (a as unknown as HasTools).tools()
    : []
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

// ─── Agent Loop (non-streaming) ──────────────────────────

async function runAgentLoop(a: Agent, input: string): Promise<AgentResponse> {
  const modelString = a.model() ?? AiRegistry.getDefault()
  const tools = getTools(a)
  const toolSchemas = buildToolSchemas(tools)
  const toolMap = buildToolMap(tools)

  const messages: AiMessage[] = [
    { role: 'system', content: a.instructions() },
    { role: 'user', content: input },
  ]

  const steps: AgentStep[] = []
  const stopConditions = normalizeStopConditions(a.stopWhen())
  const totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

  for (let iteration = 0; iteration < a.maxSteps(); iteration++) {
    let currentModel = modelString
    let currentToolSchemas = toolSchemas

    // prepareStep hook
    if (a.prepareStep) {
      const prep = await a.prepareStep({ stepNumber: iteration, steps, messages })
      if (prep.model) currentModel = prep.model
      if (prep.messages) messages.splice(0, messages.length, ...prep.messages)
      if (prep.system) messages[0] = { role: 'system', content: prep.system }
    }

    const adapter = AiRegistry.resolve(currentModel)
    const [, modelId] = AiRegistry.parseModelString(currentModel)

    const options: ProviderRequestOptions = {
      model: modelId,
      messages,
      tools: currentToolSchemas.length > 0 ? currentToolSchemas : undefined,
      temperature: a.temperature(),
      maxTokens: a.maxTokens(),
    }

    const response = await adapter.generate(options)
    addUsage(totalUsage, response.usage)

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
        if (tool.type === 'client') {
          toolResults.push({ toolCallId: tc.id, result: '[client tool — execute on client]' })
          messages.push({ role: 'tool', content: '[client tool — execute on client]', toolCallId: tc.id })
          continue
        }

        try {
          const result = await tool.execute(tc.arguments)
          const resultStr = typeof result === 'string' ? result : JSON.stringify(result)
          toolResults.push({ toolCallId: tc.id, result })
          messages.push({ role: 'tool', content: resultStr, toolCallId: tc.id })
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          toolResults.push({ toolCallId: tc.id, result: `Error: ${msg}` })
          messages.push({ role: 'tool', content: `Error: ${msg}`, toolCallId: tc.id })
        }
      }
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

    const shouldStop = stopConditions.some(cond =>
      cond({ steps, iteration, lastMessage: response.message }),
    )
    if (shouldStop || response.finishReason !== 'tool_calls') {
      break
    }
  }

  const lastStep = steps[steps.length - 1]
  return {
    text: lastStep?.message.content ?? '',
    steps,
    usage: totalUsage,
  }
}

// ─── Agent Loop (streaming) ──────────────────────────────

function runAgentLoopStreaming(a: Agent, input: string): AgentStreamResponse {
  let resolveResponse: (r: AgentResponse) => void
  const responsePromise = new Promise<AgentResponse>((resolve) => { resolveResponse = resolve })

  async function* generateStream(): AsyncIterable<StreamChunk> {
    const modelString = a.model() ?? AiRegistry.getDefault()
    const tools = getTools(a)
    const toolSchemas = buildToolSchemas(tools)
    const toolMap = buildToolMap(tools)

    const messages: AiMessage[] = [
      { role: 'system', content: a.instructions() },
      { role: 'user', content: input },
    ]

    const steps: AgentStep[] = []
    const stopConditions = normalizeStopConditions(a.stopWhen())
    const totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

    for (let iteration = 0; iteration < a.maxSteps(); iteration++) {
      let currentModel = modelString

      if (a.prepareStep) {
        const prep = await a.prepareStep({ stepNumber: iteration, steps, messages })
        if (prep.model) currentModel = prep.model
        if (prep.messages) messages.splice(0, messages.length, ...prep.messages)
        if (prep.system) messages[0] = { role: 'system', content: prep.system }
      }

      const adapter = AiRegistry.resolve(currentModel)
      const [, modelId] = AiRegistry.parseModelString(currentModel)

      const options: ProviderRequestOptions = {
        model: modelId,
        messages,
        tools: toolSchemas.length > 0 ? toolSchemas : undefined,
        temperature: a.temperature(),
        maxTokens: a.maxTokens(),
      }

      let text = ''
      let currentToolCalls: ToolCall[] = []
      let stepUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
      let finishReason: AgentStep['finishReason'] = 'stop'
      const partialToolCalls = new Map<string, { id: string; name: string; argChunks: string[] }>()

      for await (const chunk of adapter.stream(options)) {
        yield chunk

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

      const toolResults: ToolResult[] = []

      if (currentToolCalls.length > 0) {
        const assistantMsg: AiMessage = { role: 'assistant', content: text, toolCalls: currentToolCalls }
        messages.push(assistantMsg)

        for (const tc of currentToolCalls) {
          const tool = toolMap.get(tc.name)
          if (!tool) {
            toolResults.push({ toolCallId: tc.id, result: `Error: Unknown tool "${tc.name}"` })
            messages.push({ role: 'tool', content: `Error: Unknown tool "${tc.name}"`, toolCallId: tc.id })
            continue
          }
          if (tool.type === 'client') {
            toolResults.push({ toolCallId: tc.id, result: '[client tool — execute on client]' })
            messages.push({ role: 'tool', content: '[client tool — execute on client]', toolCallId: tc.id })
            // Yield so SSE consumers can forward the call to the client
            yield { type: 'tool-call' as const, toolCall: tc }
            continue
          }

          try {
            const result = await tool.execute(tc.arguments)
            const resultStr = typeof result === 'string' ? result : JSON.stringify(result)
            toolResults.push({ toolCallId: tc.id, result })
            messages.push({ role: 'tool', content: resultStr, toolCallId: tc.id })
            // Yield the finalized tool call so SSE consumers can react to it
            yield { type: 'tool-call' as const, toolCall: tc }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err)
            toolResults.push({ toolCallId: tc.id, result: `Error: ${msg}` })
            messages.push({ role: 'tool', content: `Error: ${msg}`, toolCallId: tc.id })
          }
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

      const shouldStop = stopConditions.some(cond =>
        cond({ steps, iteration, lastMessage: step.message }),
      )
      if (shouldStop || finishReason !== 'tool_calls') break

      // Reset for next iteration
      text = ''
      currentToolCalls = []
    }

    const lastStep = steps[steps.length - 1]
    resolveResponse!({
      text: lastStep?.message.content ?? '',
      steps,
      usage: totalUsage,
    })
  }

  return {
    stream: generateStream(),
    response: responsePromise,
  }
}

function normalizeStopConditions(cond: StopCondition | StopCondition[]): StopCondition[] {
  return Array.isArray(cond) ? cond : [cond]
}
