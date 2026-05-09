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
  /**
   * Wall-clock milliseconds spent inside the tool's `execute` for this
   * call. Captured by the agent loop with `performance.now()` around the
   * execute generator. Absent (or 0) for paths where no `execute` ran —
   * unknown-tool, rejected, middleware-skipped, validation-failure,
   * client-tool-placeholder.
   */
  duration?: number
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
    | 'handoff'
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
  /**
   * Handoff metadata (when type === 'handoff'). Emitted right before the
   * parent agent's loop ends and control transfers to a new agent. UIs
   * typically render a "transferred to X" indicator before the next
   * agent's chunks start streaming.
   */
  handoff?: {
    /** Class name of the agent that just yielded control. */
    from: string
    /** Class name of the agent now in control. */
    to: string
    /** Transition message the parent's model wrote — if any. */
    message?: string
  }
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
  /**
   * Optional AbortSignal forwarded by the agent loop. Provider adapters
   * SHOULD pass this through to their underlying SDK / fetch call so a
   * caller-side `.abort()` cancels the in-flight network request.
   */
  signal?: AbortSignal | undefined
  /** Provider-specific options */
  providerOptions?: Record<string, unknown> | undefined
  /**
   * Resolved prompt-caching markers — populated by the agent loop from
   * `Agent.cacheable()` (and the per-call `cache` override). Provider
   * adapters translate these to native cache primitives:
   *
   * - **Anthropic** — adds `cache_control: { type: 'ephemeral' }` to the
   *   last content block of each marked region (system, tools, messages[N]).
   * - **OpenAI** — caching is automatic above 1024 tokens; the adapter sets
   *   `prompt_cache_key` from a stable hash of the cached regions for routing
   *   affinity (so repeat requests hit the same backend's cached prefix).
   * - **Google (Gemini)** — translates to `cachedContent` resources via a
   *   pluggable registry that uses `@rudderjs/cache` when installed. TTL is
   *   configurable via {@link CacheableConfig.ttl} (default `'1h'`).
   *
   * Adapters that don't support caching ignore this field — the request
   * still runs uncached.
   */
  cache?: CacheableMarkers | undefined
}

/**
 * Declarative cache configuration on the {@link Agent} class. Each marked
 * region is a hint that the *content there is stable across requests* and
 * worth caching. The agent loop resolves this into {@link CacheableMarkers}
 * for the provider.
 *
 * Example:
 * ```ts
 * class SupportAgent extends Agent {
 *   cacheable() {
 *     return { instructions: true, tools: true, messages: 2 }
 *     //                                         ^ cache the first 2 messages
 *   }
 * }
 * ```
 */
export interface CacheableConfig {
  /** Cache the system instructions. */
  instructions?: boolean
  /** Cache the tool definitions. */
  tools?:        boolean
  /**
   * Cache the first N messages (oldest). The cache breakpoint goes
   * immediately after the Nth message. Useful for multi-turn conversations
   * where the early context (history, examples) doesn't change.
   */
  messages?:     number
  /**
   * How long the cache entry should live. Duration string accepted by
   * `@rudderjs/support`'s parser — `'30m'`, `'2h'`, `'1d'`, etc. Default
   * `'1h'` when omitted.
   *
   * **Google-only for now.** Anthropic's ephemeral cache and OpenAI's
   * automatic prefix cache have no per-call TTL knob; their adapters ignore
   * this field. Google's `cachedContent` is a stateful resource with a
   * configurable TTL (max ~24h, model-dependent), and this controls it.
   */
  ttl?:          string
}

/**
 * Resolved cache markers — the post-merge shape the agent loop hands to
 * provider adapters. `messages` is normalized to a positive integer (the
 * count of leading messages to cache); `0` or absent means "don't cache".
 */
export interface CacheableMarkers {
  instructions?: boolean
  tools?:        boolean
  messages?:     number
  /** See {@link CacheableConfig.ttl}. */
  ttl?:          string
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
  /** Create a reranking adapter (optional) */
  createReranking?(model: string): RerankingAdapter
  /** Create a file management adapter (optional) */
  createFiles?(): FileAdapter
}

// ─── File Management ─────────────────────────────────────

export interface FileUploadOptions {
  filePath: string
  purpose?: string | undefined
}

export interface FileUploadResult {
  id: string
  filename: string
  bytes: number
  purpose?: string | undefined
}

export interface FileListResult {
  files: FileUploadResult[]
}

export interface FileContent {
  data: Buffer
  mimeType: string
}

export interface FileAdapter {
  upload(options: FileUploadOptions): Promise<FileUploadResult>
  list(): Promise<FileListResult>
  delete(fileId: string): Promise<void>
  retrieve?(fileId: string): Promise<FileContent>
}

// ─── Reranking ───────────────────────────────────────────

export interface RerankingOptions {
  query: string
  documents: string[]
  model?: string | undefined
  topK?: number | undefined
}

export interface RerankingResult {
  results: Array<{
    index: number
    relevanceScore: number
    document: string
  }>
  usage?: { tokens?: number | undefined } | undefined
}

export interface RerankingAdapter {
  rerank(options: RerankingOptions): Promise<RerankingResult>
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
  audio: Uint8Array
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
  /**
   * Chain of agent class names traversed when one or more handoffs occurred
   * during the run, in the order each took control. The first entry is the
   * agent originally invoked; the last is the agent that produced `text`.
   * Absent when no handoff happened.
   *
   * @example ['TriageAgent', 'SalesAgent']
   */
  handoffPath?: string[]
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
  /**
   * Optional AbortSignal that cancels the in-flight agent run. Honored at
   * iteration boundaries (between provider calls and between failover
   * attempts) and forwarded to provider adapters so the underlying network
   * request is also cancelled. When the signal aborts, `prompt()` rejects
   * (and the streaming variant's `response` promise rejects) with the
   * signal's reason — typically `DOMException: This operation was aborted`,
   * or `TimeoutError` for `AbortSignal.timeout()`.
   */
  signal?: AbortSignal
  /**
   * When the model emits multiple tool calls in a single step, run their
   * `execute()` functions concurrently (`true`, default) instead of one
   * after another (`false`). Parallelism applies only to `execute()`; the
   * streamed chunk order is preserved as `tool-call A → updates A →
   * tool-result A → tool-call B → ...` so consumers see deterministic
   * sequences regardless of which tool finishes first.
   *
   * Approval gates, client-tool pauses, and `onBeforeToolCall` middleware
   * decisions still resolve serially in tool-call order *before* any
   * `execute()` runs — if a tool needs approval, the loop breaks at that
   * point exactly as in serial mode and no later tools are dispatched.
   *
   * Set to `false` for tools with non-idempotent shared state (counters,
   * file writes against the same path, sequential DB transactions).
   * Per-call value wins over the agent-wide `Agent.parallelTools()`
   * override.
   */
  parallelTools?: boolean
  /**
   * Per-call override for the agent's `cacheable()` declaration.
   *
   * - `false` — disable caching for this call (overrides any agent default).
   * - {@link CacheableConfig} — replace the agent's declaration for this call.
   * - omitted — use the agent's declaration unchanged.
   */
  cache?: false | CacheableConfig
  /**
   * Per-call override for the agent's `conversational()` declaration.
   *
   * - `false` — disable auto-persist for this call (overrides any agent default).
   * - {@link ConversationalSpec} — replace the agent's declaration for this call.
   * - omitted — use the agent's declaration unchanged.
   *
   * Explicit `agent.forUser(id)` / `agent.continue(id)` chains shadow this
   * override (and the class declaration) — see the docs for the precedence
   * chain.
   */
  conversation?: ConversationalOverride
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
  /**
   * Optional thread-segregation key — set by the auto-persist machinery so
   * one user can talk to multiple agent classes without their threads
   * cross-contaminating. Defaults to the agent class's name; overridable
   * via the `agent` field returned by `Agent.conversational()`.
   */
  agent?: string
}

export interface ConversationStoreListEntry {
  id: string
  title: string
  createdAt: Date
  updatedAt?: Date
  /** Mirrors {@link ConversationStoreMeta.agent} on the source row. */
  agent?: string
}

export interface ConversationStore {
  create(title?: string, meta?: ConversationStoreMeta): Promise<string>
  load(conversationId: string): Promise<AiMessage[]>
  append(conversationId: string, messages: AiMessage[]): Promise<void>
  setTitle(conversationId: string, title: string): Promise<void>
  list(userId?: string): Promise<ConversationStoreListEntry[]>
  delete?(conversationId: string): Promise<void>
}

// ─── Conversational (auto-persist) ────────────────────────

/**
 * Return shape of {@link Agent.conversational} when an agent opts into the
 * auto-persist behavior. Inspired by Laravel's `RemembersConversations` —
 * declare once on the class, then `agent.prompt(input)` auto-loads the user's
 * thread, runs, and appends without each caller threading a userId through.
 */
export interface ConversationalSpec {
  /** Identity of the user owning the conversation thread. */
  user: string
  /**
   * Specific thread id to resume. When omitted, the auto-persist machinery
   * resumes the user's most-recent thread for this `agent` key, or creates
   * a new one if none exists.
   */
  id?: string
  /**
   * Override the thread-segregation key. Defaults to the agent class's
   * name. Set this when you rename the class but want existing threads to
   * keep flowing into the same agent (`agent: 'chat-v2'`), or when two
   * different classes should share threads (rare).
   */
  agent?: string
  /**
   * Cap loaded history to the last N messages. Default unbounded. Use this
   * for chat agents whose threads can grow long; for token-aware trimming,
   * write a middleware instead.
   */
  historyLimit?: number
}

/**
 * Per-call override for `AgentPromptOptions.conversation`. `false` disables
 * auto-persist for this call; a partial spec replaces the agent's
 * declaration; omitted falls through to `Agent.conversational()`.
 */
export type ConversationalOverride = false | ConversationalSpec

// ─── Sub-agent updates (asTool streaming projection) ──────

/**
 * Higher-level progress event surfaced by a streaming
 * {@link Agent.asTool} wrapper to the parent agent's stream. Emitted as
 * `tool-update` chunks with this payload as the chunk's `update` field —
 * the parent's UI can switch on `kind` to render sub-agent progress
 * (agent name, tool calls in progress, step boundaries, completion,
 * suspend pauses).
 *
 * The default projection emits `agent_start` once at the beginning,
 * `tool_call` per inner `tool-call` chunk, `agent_done` once at the end,
 * and `subagent_paused` when the inner loop pauses on a client tool.
 * For approval-gated tools, the inner loop's `pending-approval` chunk
 * surfaces as `agent_pending_approval` (informational, during streaming)
 * and the suspend boundary emits `subagent_paused_approval` (carrying
 * the `subRunId` the host needs to drive resume). The split mirrors the
 * `tool_call` / `subagent_paused` cadence for client tools.
 *
 * Hosts wanting a different shape pass `streaming: chunk => …` to
 * {@link Agent.asTool} and own the discriminator.
 */
export type SubAgentUpdate =
  | { kind: 'agent_start';             agentName: string }
  | { kind: 'tool_call';               tool: string; args?: Record<string, unknown> }
  | { kind: 'agent_step';              step: number; tokens: number }
  | { kind: 'agent_done';              steps: number; tokens: number }
  | { kind: 'subagent_paused';         subRunId: string; pendingToolCallIds: string[] }
  | { kind: 'agent_pending_approval';  toolCall: ToolCall; isClientTool: boolean }
  | { kind: 'subagent_paused_approval'; subRunId: string; toolCall: ToolCall; isClientTool: boolean }
