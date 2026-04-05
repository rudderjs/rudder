import type {
  ProviderFactory,
  ProviderAdapter,
  EmbeddingAdapter,
  EmbeddingResult,
  ProviderRequestOptions,
  ProviderResponse,
  StreamChunk,
  ToolDefinitionSchema,
  AiMessage,
  ToolCall,
  ToolChoice,
} from '../types.js'

export interface OpenAIConfig {
  apiKey: string
  baseUrl?: string | undefined
  organization?: string | undefined
}

export class OpenAIProvider implements ProviderFactory {
  readonly name = 'openai'
  private readonly config: OpenAIConfig

  constructor(config: OpenAIConfig) {
    this.config = config
  }

  create(model: string): ProviderAdapter {
    return new OpenAIAdapter(this.config, model)
  }

  createEmbedding(model: string): EmbeddingAdapter {
    return new OpenAIEmbeddingAdapter(this.config, model)
  }
}

// ─── Adapter (also reused by Ollama) ─────────────────────

export class OpenAIAdapter implements ProviderAdapter {
  private client: any = null

  constructor(
    private readonly config: OpenAIConfig,
    private readonly model: string,
  ) {}

  private async getClient(): Promise<any> {
    if (this.client) return this.client
    const sdk = await import(/* @vite-ignore */ 'openai')
    const OpenAI = sdk.default ?? sdk.OpenAI
    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      ...(this.config.baseUrl ? { baseURL: this.config.baseUrl } : {}),
      ...(this.config.organization ? { organization: this.config.organization } : {}),
    })
    return this.client
  }

  async generate(options: ProviderRequestOptions): Promise<ProviderResponse> {
    const client = await this.getClient()

    const params: Record<string, unknown> = {
      model: this.model,
      messages: toOpenAIMessages(options.messages),
    }
    if (options.maxTokens) params['max_tokens'] = options.maxTokens
    if (options.temperature !== undefined) params['temperature'] = options.temperature
    if (options.topP !== undefined) params['top_p'] = options.topP
    if (options.stop) params['stop'] = options.stop
    if (options.tools?.length) params['tools'] = toOpenAITools(options.tools)
    if (options.toolChoice) params['tool_choice'] = toOpenAIToolChoice(options.toolChoice)

    const response = await client.chat.completions.create(params)
    return fromOpenAIResponse(response)
  }

  async *stream(options: ProviderRequestOptions): AsyncIterable<StreamChunk> {
    const client = await this.getClient()

    const params: Record<string, unknown> = {
      model: this.model,
      messages: toOpenAIMessages(options.messages),
      stream: true,
    }
    if (options.maxTokens) params['max_tokens'] = options.maxTokens
    if (options.temperature !== undefined) params['temperature'] = options.temperature
    if (options.topP !== undefined) params['top_p'] = options.topP
    if (options.stop) params['stop'] = options.stop
    if (options.tools?.length) params['tools'] = toOpenAITools(options.tools)
    if (options.toolChoice) params['tool_choice'] = toOpenAIToolChoice(options.toolChoice)

    const stream = await client.chat.completions.create(params)

    for await (const chunk of stream) {
      const choice = chunk.choices?.[0]
      if (!choice) continue
      const delta = choice.delta

      if (delta?.content) {
        yield { type: 'text-delta', text: delta.content }
      }

      if (delta?.tool_calls?.length) {
        for (const tc of delta.tool_calls) {
          if (tc.id) {
            yield { type: 'tool-call-delta', toolCall: { id: tc.id, name: tc.function?.name } }
          }
          if (tc.function?.arguments) {
            yield { type: 'tool-call-delta', text: tc.function.arguments }
          }
        }
      }

      if (choice.finish_reason) {
        yield {
          type: 'finish',
          finishReason: choice.finish_reason === 'tool_calls' ? 'tool_calls' : 'stop',
          usage: chunk.usage ? {
            promptTokens: chunk.usage.prompt_tokens ?? 0,
            completionTokens: chunk.usage.completion_tokens ?? 0,
            totalTokens: chunk.usage.total_tokens ?? 0,
          } : undefined,
        }
      }
    }
  }
}

// ─── Conversion Helpers ──────────────────────────────────

function toOpenAIMessages(messages: AiMessage[]): unknown[] {
  return messages.map(m => {
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      }
    }
    if (m.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: m.toolCallId,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      }
    }
    return { role: m.role, content: m.content }
  })
}

function toOpenAITools(tools: ToolDefinitionSchema[]): unknown[] {
  return tools.map(t => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }))
}

function toOpenAIToolChoice(choice: ToolChoice): unknown {
  if (choice === 'auto') return 'auto'
  if (choice === 'required') return 'required'
  if (choice === 'none') return 'none'
  if (typeof choice === 'object' && 'name' in choice) return { type: 'function', function: { name: choice.name } }
  return 'auto'
}

function fromOpenAIResponse(response: any): ProviderResponse {
  const choice = response.choices?.[0]
  const message = choice?.message
  const toolCalls: ToolCall[] = (message?.tool_calls ?? []).map((tc: any) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: JSON.parse(tc.function.arguments),
  }))

  return {
    message: {
      role: 'assistant',
      content: message?.content ?? '',
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    },
    usage: {
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
    },
    finishReason: choice?.finish_reason === 'tool_calls' ? 'tool_calls' : 'stop',
  }
}

// ─── Embedding Adapter ────────────────────────────────────

class OpenAIEmbeddingAdapter implements EmbeddingAdapter {
  constructor(private readonly config: OpenAIConfig, private readonly model: string) {}

  async embed(input: string | string[]): Promise<EmbeddingResult> {
    const baseUrl = this.config.baseUrl ?? 'https://api.openai.com/v1'
    const inputs = Array.isArray(input) ? input : [input]

    const res = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
        ...(this.config.organization ? { 'OpenAI-Organization': this.config.organization } : {}),
      },
      body: JSON.stringify({ model: this.model, input: inputs }),
    })

    if (!res.ok) throw new Error(`[RudderJS AI] OpenAI embeddings error: ${res.status} ${await res.text()}`)

    const data = await res.json() as {
      data: { embedding: number[] }[]
      usage: { prompt_tokens: number; total_tokens: number }
    }

    return {
      embeddings: data.data.map(d => d.embedding),
      usage: { promptTokens: data.usage.prompt_tokens, totalTokens: data.usage.total_tokens },
    }
  }
}
