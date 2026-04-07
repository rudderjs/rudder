import type { AiMessage, AnyTool, ConversationStoreMeta } from '@rudderjs/ai'

/**
 * A pluggable chat context — encapsulates the system prompt, tool set, and
 * conversation metadata for one kind of chat (resource edit, page chat, global).
 *
 * The dispatcher in `chatHandler.ts` is the only place that loads/persists
 * messages and wires the SSE stream. Each context is constructed asynchronously
 * via a static `create()` factory because constructors can't be async and
 * contexts often need to load records, run policy checks, or overlay live state.
 */
export interface ChatContext {
  readonly kind: 'resource' | 'page' | 'global'

  /** Build the system prompt the model sees */
  buildSystemPrompt(): string

  /**
   * Build the tool set available to this chat. Tools close over deps that were
   * captured at construction time (in `create()`).
   */
  buildTools(): AnyTool[]

  /** Conversation metadata for `store.create()` — varies by context kind */
  getConversationMeta(): ConversationStoreMeta

  /**
   * Whether to load prior conversation history. ResourceChatContext returns
   * `false` in selection mode (one-shot edits). Default `true`.
   */
  shouldLoadHistory(): boolean

  /**
   * Transform the user's input before passing to the agent.
   * ResourceChatContext re-injects record state on multi-turn chats so long
   * conversations don't drift. Default identity.
   */
  transformUserInput(input: string, history: AiMessage[]): string
}

/**
 * Thrown by a `ChatContext.create()` factory to signal a 4xx response.
 * The dispatcher catches this and returns JSON before opening the SSE stream.
 */
export class ChatContextError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'ChatContextError'
  }
}
