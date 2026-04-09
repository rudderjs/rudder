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

export type FinishReason =
  | 'stop'
  | 'tool_calls'
  | 'length'
  | 'content_filter'
  /** Loop stopped because client-side tool calls are pending execution. */
  | 'client_tool_calls'
  /** Loop stopped because a tool call requires user approval. */
  | 'tool_approval_required'

/** A single streamed chunk */
export interface StreamChunk {
  type:
    | 'text-delta'
    | 'tool-call-delta'
    | 'tool-call'
    | 'tool-result'
    | 'tool-update'
    | 'usage'
    | 'finish'
    | 'pending-client-tools'
    | 'pending-approval'
  /** Text content delta (when type === 'text-delta') */
  text?: string
  /** Tool call info (when type === 'tool-call', 'tool-call-delta', 'tool-result', 'tool-update', or 'pending-approval') */
  toolCall?: Partial<ToolCall>
  /** Tool execution result (when type === 'tool-result') */
  result?: unknown
  /**
   * Preliminary tool progress payload (when type === 'tool-update').
   * Emitted by async-generator tool executes for each `yield`.
   * Ephemeral: not persisted, not seen by the model on the next step.
   */
  update?: unknown
  /** Pending client tool calls (when type === 'pending-client-tools') */
  toolCalls?: ToolCall[]
  /** Approval-pending metadata (when type === 'pending-approval') */
  isClientTool?: boolean
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

// ─── Image Generation ────────────────────────────────────

export interface ImageGenerationOptions {
  prompt: string
  model?: string | undefined
  size?: 'square' | 'landscape' | 'portrait' | string | undefined
  quality?: 'standard' | 'hd' | undefined
  style?: 'natural' | 'vivid' | undefined
  n?: number | undefined
}

export interface ImageGenerationResult {
  images: Array<{
    url?: string | undefined
    base64?: string | undefined
    revisedPrompt?: string | undefined
  }>
  model: string
}

export interface ImageGenerationAdapter {
  generate(options: ImageGenerationOptions): Promise<ImageGenerationResult>
}

/** Provider factory — creates a ProviderAdapter from a model string */
export interface ProviderFactory {
  readonly name: string
  create(model: string): ProviderAdapter
  /** Create an embedding adapter (optional — not all providers support embeddings) */
  createEmbedding?(model: string): EmbeddingAdapter
  /** Create an image generation adapter (optional — not all providers support image generation) */
  createImage?(model: string): ImageGenerationAdapter
  /** Create a text-to-speech adapter (optional) */
  createTts?(model: string): TextToSpeechAdapter
  /** Create a speech-to-text adapter (optional) */
  createStt?(model: string): SpeechToTextAdapter
}

// ─── Audio (TTS & STT) ──────────────────────────────────

export interface TextToSpeechOptions {
  text: string
  model?: string | undefined
  voice?: string | undefined
  speed?: number | undefined
  format?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | undefined
}

export interface TextToSpeechResult {
  audio: Buffer
  format: string
  model: string
}

export interface SpeechToTextOptions {
  audio: Buffer | string
  model?: string | undefined
  language?: string | undefined
  prompt?: string | undefined
}

export interface SpeechToTextResult {
  text: string
  language?: string | undefined
  duration?: number | undefined
  model: string
}

export interface TextToSpeechAdapter {
  generate(options: TextToSpeechOptions): Promise<TextToSpeechResult>
}

export interface SpeechToTextAdapter {
  transcribe(options: SpeechToTextOptions): Promise<SpeechToTextResult>
}

// ─── Tool ─────────────────────────────────────────────────

/**
 * Per-call context passed to a tool's `execute` as an optional second
 * argument. Carries loop-level identity that the tool would otherwise have
 * no way to observe.
 *
 * Today it contains only `toolCallId` — the id the model assigned to this
 * particular invocation. Tools that need to correlate their side-effects
 * with the surrounding loop (e.g. a sub-agent runner that pauses on a
 * client tool and needs to record which parent tool-call id its suspension
 * belongs to) read this id.
 *
 * Additional fields may be added over time; tools should destructure only
 * what they need. The whole parameter is optional on the call signature so
 * existing single-arg executes keep working.
 */
export interface ToolCallContext {
  /** The id the model assigned to this particular tool call. */
  readonly toolCallId: string
}

/**
 * Tool execute function.
 *
 * Returns either a value (sync), a promise (async), or an async generator.
 * Generator-style executes can `yield` preliminary progress payloads —
 * each yield is emitted as a `tool-update` stream chunk while the tool runs.
 * The generator's `return` value is the final tool result (the value the
 * model and the persisted store both see).
 *
 * The optional second `ctx` parameter carries loop-level metadata such as
 * `toolCallId`. Tools that don't care can omit it and keep a one-arg
 * signature — TypeScript's contravariant function parameter rules mean
 * `(input) => ...` still satisfies `(input, ctx?) => ...`.
 *
 * `TUpdate` defaults to `never` so non-generator call sites infer cleanly
 * without a third type parameter on every existing tool definition.
 */
export type ToolExecuteFn<TInput = unknown, TOutput = unknown, TUpdate = never> =
  (input: TInput, ctx?: ToolCallContext) =>
    | TOutput
    | Promise<TOutput>
    | AsyncGenerator<TUpdate, TOutput, void>

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
  /** Arbitrary metadata — used by provider-native tools to signal special handling */
  meta?: Record<string, unknown> | undefined
}

/**
 * A tool the model can call.
 *
 * `execute` is optional — its presence/absence is the only discriminator
 * between server tools (have an executor) and client tools (run in the
 * browser via the `clientTools` registry on the panels side).
 *
 * This shape mirrors Vercel AI SDK v4+ and TanStack AI.
 */
export interface Tool<TInput = unknown, TOutput = unknown> {
  readonly definition: ToolDefinitionOptions
  readonly execute?: ToolExecuteFn<TInput, TOutput, unknown> | undefined
  /**
   * Optional transform from the tool's structured `result` to the string the
   * **model** sees on its next step. The UI (`tool-result` chunk and
   * `step.toolResults`) still receives the original `result`.
   *
   * Use this to summarize, redact, or shrink large/binary tool outputs so
   * the parent model doesn't get the full payload stuffed into its context
   * (e.g. subagent transcripts, base64 blobs). Default — when this is
   * absent — is the same `JSON.stringify`-or-pass-through behavior as before.
   */
  readonly toModelOutput?: ((result: TOutput) => string | Promise<string>) | undefined
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = Tool<any, any>

/**
 * @deprecated Use {@link Tool}. A "server tool" is just a `Tool` whose
 * `execute` is defined.
 */
export interface ServerTool<TInput = unknown, TOutput = unknown> extends Tool<TInput, TOutput> {
  readonly execute: ToolExecuteFn<TInput, TOutput, unknown>
}

/**
 * @deprecated Use {@link Tool}. A "client tool" is just a `Tool` whose
 * `execute` is omitted; the browser handles execution via the
 * `clientTools` registry in `@rudderjs/panels`.
 */
export type ClientTool<TInput = unknown, TOutput = unknown> = Tool<TInput, TOutput>

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
  /** When the loop stopped early, why. */
  finishReason?: FinishReason
  /** Client tool calls awaiting browser-side execution. */
  pendingClientToolCalls?: ToolCall[]
  /** A tool call awaiting user approval. */
  pendingApprovalToolCall?: { toolCall: ToolCall; isClientTool: boolean }
  /**
   * Tool result messages that were injected at the start of a continuation
   * to fulfill an `assistant{toolCalls}` carried over from the previous turn
   * (e.g. an approval round-trip). The panels dispatcher persists these so
   * the conversation store never holds an unfulfilled `tool_use` block.
   */
  resumedToolMessages?: AiMessage[]
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
  /** Conversation store for persisting agent conversations */
  conversations?: ConversationStore
}

// ─── Agent Options ─────────────���──────────────────────────

export interface AgentPromptOptions {
  /** Prior conversation messages to prepend (after system prompt, before current user message) */
  history?: AiMessage[]
  /**
   * Full message list to send instead of `[system, ...history, user(input)]`.
   * When set, the loop runs with `[system, ...messages]` directly — `input`
   * is ignored. Used for continuations after a client-tool round-trip or
   * approval round-trip, where the conversation ends with a tool result
   * message and there is no fresh user input.
   */
  messages?: AiMessage[]
  /** File/image attachments to include with the prompt */
  attachments?: Attachment[]
  /**
   * How to handle tool calls for tools without a server-side handler.
   *
   * - `'placeholder'` (default): write a placeholder tool result and continue the loop.
   *   Preserves the historical behavior.
   * - `'stop-on-client-tool'`: stop the loop, expose pending tool calls on the
   *   `AgentResponse`, and let the caller (typically the panels chat handler)
   *   re-submit with tool results once the browser has executed them.
   */
  toolCallStreamingMode?: 'placeholder' | 'stop-on-client-tool'
  /** Tool call ids the user has approved. */
  approvedToolCallIds?: string[]
  /** Tool call ids the user has rejected. */
  rejectedToolCallIds?: string[]
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
