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
  EmbeddingAdapter,
  EmbeddingResult,
  ImageGenerationAdapter,
  ImageGenerationOptions,
  ImageGenerationResult,
  FileAdapter,
  FileUploadOptions,
  FileUploadResult,
  FileListResult,
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

  createEmbedding(model: string): EmbeddingAdapter {
    return new GoogleEmbeddingAdapter(this.config, model)
  }

  createImage(model: string): ImageGenerationAdapter {
    return new GoogleImageAdapter(this.config, model)
  }

  createFiles(): FileAdapter {
    return new GoogleFileAdapter(this.config)
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
    const sdk: any = await import(/* @vite-ignore */ '@google/genai')
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

function contentToString(content: string | import('../types.js').ContentPart[]): string {
  if (typeof content === 'string') return content
  return content.filter(p => p.type === 'text').map(p => (p as { text: string }).text).join('')
}

function contentToGeminiParts(content: string | import('../types.js').ContentPart[]): unknown[] {
  if (typeof content === 'string') return [{ text: content }]
  return content.map(p => {
    if (p.type === 'text') return { text: p.text }
    if (p.type === 'image') return { inlineData: { mimeType: p.mimeType, data: p.data } }
    // document — inline data for PDFs, text for text-based
    if (p.mimeType === 'application/pdf') {
      return { inlineData: { mimeType: p.mimeType, data: p.data } }
    }
    return { text: Buffer.from(p.data, 'base64').toString('utf-8') }
  })
}

function toGeminiContents(messages: AiMessage[]): { system: string | undefined; contents: unknown[] } {
  const systemMsgs = messages.filter(m => m.role === 'system')
  const rest = messages.filter(m => m.role !== 'system')
  const system = systemMsgs.length > 0
    ? systemMsgs.map(m => contentToString(m.content)).join('\n\n')
    : undefined

  const contents = rest.map(m => {
    if (m.role === 'assistant' && m.toolCalls?.length) {
      const text = contentToString(m.content)
      return {
        role: 'model',
        parts: [
          ...(text ? [{ text }] : []),
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
      parts: contentToGeminiParts(m.content),
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

// ─── Embedding Adapter ──────────────────────────────────

class GoogleEmbeddingAdapter implements EmbeddingAdapter {
  private client: any = null

  constructor(
    private readonly config: GoogleConfig,
    private readonly model: string,
  ) {}

  private async getClient(): Promise<any> {
    if (this.client) return this.client
    const sdk: any = await import(/* @vite-ignore */ '@google/genai')
    const GoogleGenAI = sdk.GoogleGenAI ?? sdk.default
    this.client = new GoogleGenAI({ apiKey: this.config.apiKey })
    return this.client
  }

  async embed(input: string | string[]): Promise<EmbeddingResult> {
    const client = await this.getClient()
    const inputs = Array.isArray(input) ? input : [input]

    const results = await Promise.all(
      inputs.map(text =>
        client.models.embedContent({
          model: this.model,
          content: { parts: [{ text }] },
        }),
      ),
    )

    const embeddings = results.map((r: any) => r.embedding?.values ?? [])

    return {
      embeddings,
      usage: { promptTokens: 0, totalTokens: 0 },
    }
  }
}

// ─── Image Generation Adapter (Imagen) ──────────────────

const GOOGLE_IMAGE_SIZE_MAP: Record<string, string> = {
  square: '1024x1024',
  landscape: '1792x1024',
  portrait: '1024x1792',
}

class GoogleImageAdapter implements ImageGenerationAdapter {
  constructor(
    private readonly config: GoogleConfig,
    private readonly model: string,
  ) {}

  async generate(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
    const size = options.size
      ? (GOOGLE_IMAGE_SIZE_MAP[options.size] ?? options.size)
      : '1024x1024'

    const [width, height] = size.split('x').map(Number)

    const body: Record<string, unknown> = {
      instances: [{ prompt: options.prompt }],
      parameters: {
        sampleCount: options.n ?? 1,
        ...(width && height ? { aspectRatio: `${width}:${height}` } : {}),
      },
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:predict?key=${this.config.apiKey}`

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      throw new Error(`[RudderJS AI] Google image generation error: ${res.status} ${await res.text()}`)
    }

    const data = await res.json() as {
      predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>
    }

    return {
      images: (data.predictions ?? []).map((p: any) => ({
        ...(p.bytesBase64Encoded ? { base64: p.bytesBase64Encoded as string } : {}),
      })),
      model: this.model,
    }
  }
}

// ─── Files ──────────────────────────────────────────────

class GoogleFileAdapter implements FileAdapter {
  private client: any = null

  constructor(private readonly config: GoogleConfig) {}

  private async getClient(): Promise<any> {
    if (this.client) return this.client
    const sdk: any = await import(/* @vite-ignore */ '@google/genai')
    const GoogleGenAI = sdk.GoogleGenAI ?? sdk.default
    this.client = new GoogleGenAI({ apiKey: this.config.apiKey })
    return this.client
  }

  async upload(options: FileUploadOptions): Promise<FileUploadResult> {
    const client = await this.getClient()
    const { readFile, stat } = await import(/* @vite-ignore */ 'node:fs/promises' as string)
    const { basename } = await import(/* @vite-ignore */ 'node:path' as string)
    const data = await readFile(options.filePath)
    const stats = await stat(options.filePath)
    const filename = basename(options.filePath)

    const response = await client.files.upload({
      file: new Blob([data]),
      config: { displayName: filename },
    })

    return {
      id: response.name ?? response.uri,
      filename,
      bytes: stats.size,
    }
  }

  async list(): Promise<FileListResult> {
    const client = await this.getClient()
    const response = await client.files.list()
    const files: FileUploadResult[] = []
    for (const f of response.files ?? response ?? []) {
      files.push({
        id: f.name ?? f.uri,
        filename: f.displayName ?? f.name ?? '',
        bytes: Number(f.sizeBytes ?? 0),
      })
    }
    return { files }
  }

  async delete(fileId: string): Promise<void> {
    const client = await this.getClient()
    await client.files.delete({ name: fileId })
  }
}
