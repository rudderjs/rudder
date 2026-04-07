import type { AiMessage, AnyTool, ConversationStoreMeta } from '@rudderjs/ai'
import type { ChatContext } from './types.js'
import type { ResolveContextDeps } from './resolveContext.js'
import { extractUserId } from '../types.js'

/**
 * Chat with no specific scope — the user is talking to the panel as a whole.
 * Replaces the inline no-resource branch in the old chatHandler.
 */
export class GlobalChatContext implements ChatContext {
  readonly kind = 'global' as const

  private constructor(private readonly userId: string | undefined) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  static async create(deps: ResolveContextDeps): Promise<GlobalChatContext> {
    return new GlobalChatContext(extractUserId(deps.req))
  }

  buildSystemPrompt(): string {
    return 'You are a helpful assistant for an admin panel. Be concise.'
  }

  buildTools(): AnyTool[] {
    // Placeholder for future global tools (navigate_to, search_resources, ...)
    return []
  }

  getConversationMeta(): ConversationStoreMeta {
    return this.userId ? { userId: this.userId } : {}
  }

  shouldLoadHistory(): boolean {
    return true
  }

  transformUserInput(input: string, _history: AiMessage[]): string {
    return input
  }
}
