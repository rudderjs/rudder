import { resolveOptionalPeer } from '@boostkit/core'
import type {
  ProviderFactory,
  ProviderAdapter,
  ProviderRequestOptions,
  ProviderResponse,
  StreamChunk,
  ToolDefinitionSchema,
  AiMessage,
  ToolCall,
  ToolChoice,
} from '../types.js'

export interface AnthropicConfig {
  apiKey: string
  baseUrl?: string | undefined
}

export class AnthropicProvider implements ProviderFactory {
  readonly name = 'anthropic'
  private readonly config: AnthropicConfig

  constructor(config: AnthropicConfig) {
    this.config = config
  }

  create(model: string): ProviderAdapter {
    return new AnthropicAdapter(this.config, model)
  }
}

// ─── Adapter ──────────────────────────────────────────────

class AnthropicAdapter implements ProviderAdapter {
  private client: any = null

  constructor(
    private readonly config: AnthropicConfig,
    private readonly model: string,
  ) {}

  private async getClient(): Promise<any> {
    if (this.client) return this.client
    const sdk = await resolveOptionalPeer<any>('@anthropic-ai/sdk')
    const Anthropic = sdk.default ?? sdk.Anthropic
    this.client = new Anthropic({
      apiKey: this.config.apiKey,
      ...(this.config.baseUrl ? { baseURL: this.config.baseUrl } : {}),
    })
    return this.client
  }

  async generate(options: ProviderRequestOptions): Promise<ProviderResponse> {
    const client = await this.getClient()
    const { system, messages } = splitSystemMessages(options.messages)

    const params: Record<string, unknown> = {
      model: this.model,
      messages: toAnthropicMessages(messages),
      max_tokens: options.maxTokens ?? 4096,
    }
    if (system) params['system'] = system
    if (options.temperature !== undefined) params['temperature'] = options.temperature
    if (options.topP !== undefined) params['top_p'] = options.topP
    if (options.stop) params['stop_sequences'] = options.stop
    if (options.tools?.length) params['tools'] = toAnthropicTools(options.tools)
    if (options.toolChoice) params['tool_choice'] = toAnthropicToolChoice(options.toolChoice)

    const response = await client.messages.create(params)
    return fromAnthropicResponse(response)
  }

  async *stream(options: ProviderRequestOptions): AsyncIterable<StreamChunk> {
    const client = await this.getClient()
    const { system, messages } = splitSystemMessages(options.messages)

    const params: Record<string, unknown> = {
      model: this.model,
      messages: toAnthropicMessages(messages),
      max_tokens: options.maxTokens ?? 4096,
      stream: true,
    }
    if (system) params['system'] = system
    if (options.temperature !== undefined) params['temperature'] = options.temperature
    if (options.topP !== undefined) params['top_p'] = options.topP
    if (options.stop) params['stop_sequences'] = options.stop
    if (options.tools?.length) params['tools'] = toAnthropicTools(options.tools)
    if (options.toolChoice) params['tool_choice'] = toAnthropicToolChoice(options.toolChoice)

    const stream = await client.messages.stream(params)

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          yield { type: 'text-delta', text: event.delta.text }
        } else if (event.delta.type === 'input_json_delta') {
          yield { type: 'tool-call-delta', text: event.delta.partial_json }
        }
      } else if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
        yield {
          type: 'tool-call-delta',
          toolCall: { id: event.content_block.id, name: event.content_block.name },
        }
      } else if (event.type === 'message_delta') {
        yield {
          type: 'finish',
          finishReason: event.delta.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
          usage: {
            promptTokens: 0,
            completionTokens: event.usage?.output_tokens ?? 0,
            totalTokens: event.usage?.output_tokens ?? 0,
          },
        }
      } else if (event.type === 'message_start' && event.message?.usage) {
        yield {
          type: 'usage',
          usage: {
            promptTokens: event.message.usage.input_tokens ?? 0,
            completionTokens: event.message.usage.output_tokens ?? 0,
            totalTokens: (event.message.usage.input_tokens ?? 0) + (event.message.usage.output_tokens ?? 0),
          },
        }
      }
    }
  }
}

// ─── Conversion Helpers ──────────────────────────────────

function splitSystemMessages(messages: AiMessage[]): { system: string | undefined; messages: AiMessage[] } {
  const systemMsgs = messages.filter(m => m.role === 'system')
  const rest = messages.filter(m => m.role !== 'system')
  const system = systemMsgs.length > 0
    ? systemMsgs.map(m => m.content).join('\n\n')
    : undefined
  return { system, messages: rest }
}

function toAnthropicMessages(messages: AiMessage[]): unknown[] {
  return messages.map(m => {
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: [
          ...(m.content ? [{ type: 'text', text: m.content }] : []),
          ...m.toolCalls.map(tc => ({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          })),
        ],
      }
    }
    if (m.role === 'tool') {
      return {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: m.toolCallId,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        }],
      }
    }
    return { role: m.role, content: m.content }
  })
}

function toAnthropicTools(tools: ToolDefinitionSchema[]): unknown[] {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }))
}

function toAnthropicToolChoice(choice: ToolChoice): unknown {
  if (choice === 'auto') return { type: 'auto' }
  if (choice === 'required') return { type: 'any' }
  if (choice === 'none') return undefined
  if (typeof choice === 'object' && 'name' in choice) return { type: 'tool', name: choice.name }
  return { type: 'auto' }
}

function fromAnthropicResponse(response: any): ProviderResponse {
  const toolCalls: ToolCall[] = []
  let text = ''

  for (const block of response.content ?? []) {
    if (block.type === 'text') text += block.text
    if (block.type === 'tool_use') {
      toolCalls.push({ id: block.id, name: block.name, arguments: block.input })
    }
  }

  return {
    message: {
      role: 'assistant',
      content: text,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    },
    usage: {
      promptTokens: response.usage?.input_tokens ?? 0,
      completionTokens: response.usage?.output_tokens ?? 0,
      totalTokens: (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0),
    },
    finishReason: response.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
  }
}
