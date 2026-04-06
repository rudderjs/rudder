import type { z } from 'zod'

// ─── Provider ─────────────────────────────────────────────

/** A single content part (text, image, or document) */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'document'; data: string; mimeType: string; name?: string }

/** A message in the conversation */
export interface AiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | ContentPart[]
  /** Present when role === 'tool' */
  toolCallId?: string
  /** Present when role === 'assistant' and model wants to call tools */
  toolCalls?: ToolCall[]
}

/** A tool call from the model */
export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

/** A tool result to feed back to the model */
export interface ToolResult {
  toolCallId: string
  result: unknown
}

/** Token usage stats */
export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/** Non-streaming response from a provider */
export interface ProviderResponse {
  message: AiMessage
  usage: TokenUsage
  finishReason: FinishReason
}

export type FinishReason = 'stop' | 'tool_calls' | 'length' | 'content_filter'

/** A single streamed chunk */
export interface StreamChunk {
  type: 'text-delta' | 'tool-call-delta' | 'tool-call' | 'usage' | 'finish'
  /** Text content delta (when type === 'text-delta') */
  text?: string
  /** Tool call info (when type === 'tool-call' or 'tool-call-delta') */
  toolCall?: Partial<ToolCall>
  /** Usage stats (when type === 'finish' or 'usage') */
  usage?: TokenUsage | undefined
  /** Finish reason (when type === 'finish') */
  finishReason?: FinishReason
}

/** Options passed to the provider for each request */
export interface ProviderRequestOptions {
  model: string
  messages: AiMessage[]
  tools?: ToolDefinitionSchema[] | undefined
  toolChoice?: ToolChoice | undefined
  temperature?: number | undefined
  maxTokens?: number | undefined
  topP?: number | undefined
  stop?: string[] | undefined
  /** Provider-specific options */
  providerOptions?: Record<string, unknown> | undefined
}

export type ToolChoice = 'auto' | 'required' | 'none' | { name: string }

/** Tool definition as sent to the provider (JSON Schema) */
export interface ToolDefinitionSchema {
  name: string
  description: string
  parameters: Record<string, unknown>
}

/** Provider adapter — thin wrapper around a provider SDK */
export interface ProviderAdapter {
  /** Generate a complete response */
  generate(options: ProviderRequestOptions): Promise<ProviderResponse>
  /** Stream a response */
  stream(options: ProviderRequestOptions): AsyncIterable<StreamChunk>
}

/** Embedding response */
export interface EmbeddingResult {
  embeddings: number[][]
  usage: { promptTokens: number; totalTokens: number }
}

/** Provider adapter that supports embeddings */
export interface EmbeddingAdapter {
  embed(input: string | string[], model: string): Promise<EmbeddingResult>
}

/** Provider factory — creates a ProviderAdapter from a model string */
export interface ProviderFactory {
  readonly name: string
  create(model: string): ProviderAdapter
  /** Create an embedding adapter (optional — not all providers support embeddings) */
  createEmbedding?(model: string): EmbeddingAdapter
}

// ─── Tool ─────────────────────────────────────────────────

export type ToolExecuteFn<TInput = unknown, TOutput = unknown> =
  (input: TInput) => TOutput | Promise<TOutput>

export type ToolNeedsApproval<TInput = unknown> =
  boolean | ((input: TInput) => boolean | Promise<boolean>)

export interface ToolDefinitionOptions<
  TInput extends z.ZodType = z.ZodType,
  TOutput extends z.ZodType = z.ZodType,
> {
  name: string
  description: string
  inputSchema: TInput
  outputSchema?: TOutput | undefined
  needsApproval?: ToolNeedsApproval<z.infer<TInput>> | undefined
  lazy?: boolean | undefined
}

export interface ServerTool<TInput = unknown, TOutput = unknown> {
  readonly definition: ToolDefinitionOptions
  readonly type: 'server'
  execute: ToolExecuteFn<TInput, TOutput>
}

export interface ClientTool<TInput = unknown, TOutput = unknown> {
  readonly definition: ToolDefinitionOptions
  readonly type: 'client'
  execute: ToolExecuteFn<TInput, TOutput>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = ServerTool<any, any> | ClientTool<any, any>

// ─── Middleware ────────────────────────────────────────────

export interface MiddlewareContext {
  requestId: string
  iteration: number
  chunkIndex: number
  messages: AiMessage[]
  model: string
  provider: string
  toolNames: string[]
  context?: unknown
  abort(reason?: string): void
}

export interface MiddlewareConfigResult {
  messages?: AiMessage[]
  systemPrompts?: string[]
  tools?: AnyTool[]
  temperature?: number
  maxTokens?: number
  providerOptions?: Record<string, unknown>
}

export type BeforeToolCallResult =
  | void
  | { type: 'transformArgs'; args: Record<string, unknown> }
  | { type: 'skip'; result: unknown }
  | { type: 'abort'; reason: string }

export interface AiMiddleware {
  name: string
  onConfig?(ctx: MiddlewareContext, config: MiddlewareConfigResult, phase: 'init' | 'beforeModel'): MiddlewareConfigResult | void
  onStart?(ctx: MiddlewareContext): void | Promise<void>
  onIteration?(ctx: MiddlewareContext): void | Promise<void>
  onChunk?(ctx: MiddlewareContext, chunk: StreamChunk): StreamChunk | null
  onBeforeToolCall?(ctx: MiddlewareContext, toolName: string, args: Record<string, unknown>): BeforeToolCallResult | Promise<BeforeToolCallResult>
  onAfterToolCall?(ctx: MiddlewareContext, toolName: string, args: Record<string, unknown>, result: unknown): void | Promise<void>
  onToolPhaseComplete?(ctx: MiddlewareContext): void | Promise<void>
  onUsage?(ctx: MiddlewareContext, usage: TokenUsage): void | Promise<void>
  onFinish?(ctx: MiddlewareContext): void | Promise<void>
  onAbort?(ctx: MiddlewareContext, reason: string): void | Promise<void>
  onError?(ctx: MiddlewareContext, error: unknown): void | Promise<void>
}

// ─── Agent ────────────────────────────────────────────────

export interface HasTools {
  tools(): AnyTool[]
}

export interface HasMemory {
  conversationId?: string
  messages(): AiMessage[] | Promise<AiMessage[]>
}

export interface HasStructuredOutput {
  outputSchema(): z.ZodType
}

export interface HasMiddleware {
  middleware(): AiMiddleware[]
}

export type StopCondition = (ctx: {
  steps: AgentStep[]
  iteration: number
  lastMessage: AiMessage
}) => boolean

export interface AgentStep {
  message: AiMessage
  toolCalls: ToolCall[]
  toolResults: ToolResult[]
  usage: TokenUsage
  finishReason: FinishReason
}

export interface PrepareStepResult {
  model?: string
  tools?: AnyTool[]
  toolChoice?: ToolChoice
  messages?: AiMessage[]
  system?: string
  providerOptions?: Record<string, unknown>
}

export interface AgentResponse {
  text: string
  steps: AgentStep[]
  usage: TokenUsage
  conversationId?: string
}

export interface AgentStreamResponse {
  stream: AsyncIterable<StreamChunk>
  response: Promise<AgentResponse>
}

// ─── Config ───────────────────────────────────────────────

export interface AiProviderConfig {
  driver: string
  apiKey?: string
  baseUrl?: string
  [key: string]: unknown
}

export interface AiModelConfig {
  id: string
  label: string
}

export interface AiConfig {
  default: string
  providers: Record<string, AiProviderConfig>
  failover?: string[]
  models?: AiModelConfig[]
}

// ─── Agent Options ─────────────���──────────────────────────

export interface AgentPromptOptions {
  /** Prior conversation messages to prepend (after system prompt, before current user message) */
  history?: AiMessage[]
  /** File/image attachments to include with the prompt */
  attachments?: Attachment[]
}

/** An attachment (file or image) to include with a prompt */
export interface Attachment {
  type: 'image' | 'document'
  data: string
  mimeType: string
  name?: string
}

// ─── Conversation ─────────────────��───────────────────────

export interface ConversationStoreMeta {
  userId?: string
  resourceSlug?: string
  recordId?: string
}

export interface ConversationStore {
  create(title?: string, meta?: ConversationStoreMeta): Promise<string>
  load(conversationId: string): Promise<AiMessage[]>
  append(conversationId: string, messages: AiMessage[]): Promise<void>
  setTitle(conversationId: string, title: string): Promise<void>
  list(userId?: string): Promise<{ id: string; title: string; createdAt: Date; updatedAt?: Date }[]>
  delete?(conversationId: string): Promise<void>
}
