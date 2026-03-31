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

export interface GoogleConfig {
  apiKey: string
}

export class GoogleProvider implements ProviderFactory {
  readonly name = 'google'
  private readonly config: GoogleConfig

  constructor(config: GoogleConfig) {
    this.config = config
  }

  create(model: string): ProviderAdapter {
    return new GoogleAdapter(this.config, model)
  }
}

// ─── Adapter ──────────────────────────────────────────────

class GoogleAdapter implements ProviderAdapter {
  private client: any = null

  constructor(
    private readonly config: GoogleConfig,
    private readonly model: string,
  ) {}

  private async getClient(): Promise<any> {
    if (this.client) return this.client
    const sdk = await resolveOptionalPeer<any>('@google/genai')
    const GoogleGenAI = sdk.GoogleGenAI ?? sdk.default
    this.client = new GoogleGenAI({ apiKey: this.config.apiKey })
    return this.client
  }

  async generate(options: ProviderRequestOptions): Promise<ProviderResponse> {
    const client = await this.getClient()
    const { system, contents } = toGeminiContents(options.messages)

    const config: Record<string, unknown> = {}
    if (options.maxTokens) config['maxOutputTokens'] = options.maxTokens
    if (options.temperature !== undefined) config['temperature'] = options.temperature
    if (options.topP !== undefined) config['topP'] = options.topP
    if (options.stop) config['stopSequences'] = options.stop
    if (options.tools?.length) config['tools'] = [{ functionDeclarations: toGeminiTools(options.tools) }]
    if (options.toolChoice) config['toolConfig'] = toGeminiToolConfig(options.toolChoice)

    const response = await client.models.generateContent({
      model: this.model,
      contents,
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      config,
    })

    return fromGeminiResponse(response)
  }

  async *stream(options: ProviderRequestOptions): AsyncIterable<StreamChunk> {
    const client = await this.getClient()
    const { system, contents } = toGeminiContents(options.messages)

    const config: Record<string, unknown> = {}
    if (options.maxTokens) config['maxOutputTokens'] = options.maxTokens
    if (options.temperature !== undefined) config['temperature'] = options.temperature
    if (options.topP !== undefined) config['topP'] = options.topP
    if (options.stop) config['stopSequences'] = options.stop
    if (options.tools?.length) config['tools'] = [{ functionDeclarations: toGeminiTools(options.tools) }]
    if (options.toolChoice) config['toolConfig'] = toGeminiToolConfig(options.toolChoice)

    const response = await client.models.generateContentStream({
      model: this.model,
      contents,
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      config,
    })

    for await (const chunk of response) {
      const candidate = chunk.candidates?.[0]
      if (!candidate) continue

      for (const part of candidate.content?.parts ?? []) {
        if (part.text) {
          yield { type: 'text-delta', text: part.text }
        }
        if (part.functionCall) {
          yield {
            type: 'tool-call',
            toolCall: {
              id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              name: part.functionCall.name,
              arguments: part.functionCall.args ?? {},
            },
          }
        }
      }

      if (candidate.finishReason) {
        yield {
          type: 'finish',
          finishReason: candidate.finishReason === 'STOP' ? 'stop' : 'tool_calls',
          usage: chunk.usageMetadata ? {
            promptTokens: chunk.usageMetadata.promptTokenCount ?? 0,
            completionTokens: chunk.usageMetadata.candidatesTokenCount ?? 0,
            totalTokens: chunk.usageMetadata.totalTokenCount ?? 0,
          } : undefined,
        }
      }
    }
  }
}

// ─── Conversion Helpers ──────────────────────────────────

function toGeminiContents(messages: AiMessage[]): { system: string | undefined; contents: unknown[] } {
  const systemMsgs = messages.filter(m => m.role === 'system')
  const rest = messages.filter(m => m.role !== 'system')
  const system = systemMsgs.length > 0
    ? systemMsgs.map(m => m.content).join('\n\n')
    : undefined

  const contents = rest.map(m => {
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'model',
        parts: [
          ...(m.content ? [{ text: m.content }] : []),
          ...m.toolCalls.map(tc => ({
            functionCall: { name: tc.name, args: tc.arguments },
          })),
        ],
      }
    }
    if (m.role === 'tool') {
      return {
        role: 'user',
        parts: [{
          functionResponse: {
            name: m.toolCallId ?? 'unknown',
            response: typeof m.content === 'string' ? { result: m.content } : m.content,
          },
        }],
      }
    }
    return {
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }
  })

  return { system, contents }
}

function toGeminiTools(tools: ToolDefinitionSchema[]): unknown[] {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }))
}

function toGeminiToolConfig(choice: ToolChoice): unknown {
  if (choice === 'auto') return { functionCallingConfig: { mode: 'AUTO' } }
  if (choice === 'required') return { functionCallingConfig: { mode: 'ANY' } }
  if (choice === 'none') return { functionCallingConfig: { mode: 'NONE' } }
  if (typeof choice === 'object' && 'name' in choice) {
    return { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [choice.name] } }
  }
  return { functionCallingConfig: { mode: 'AUTO' } }
}

function fromGeminiResponse(response: any): ProviderResponse {
  const candidate = response.candidates?.[0]
  const toolCalls: ToolCall[] = []
  let text = ''

  for (const part of candidate?.content?.parts ?? []) {
    if (part.text) text += part.text
    if (part.functionCall) {
      toolCalls.push({
        id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: part.functionCall.name,
        arguments: part.functionCall.args ?? {},
      })
    }
  }

  return {
    message: {
      role: 'assistant',
      content: text,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    },
    usage: {
      promptTokens: response.usageMetadata?.promptTokenCount ?? 0,
      completionTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      totalTokens: response.usageMetadata?.totalTokenCount ?? 0,
    },
    finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
  }
}
