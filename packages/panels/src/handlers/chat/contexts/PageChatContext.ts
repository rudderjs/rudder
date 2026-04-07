import type { AiMessage, AnyTool, ConversationStoreMeta } from '@rudderjs/ai'
import type { ChatContext } from './types.js'
import type { ResolveContextDeps } from './resolveContext.js'
import { extractUserId } from '../types.js'

/**
 * Stub context for future page-level chat. Not wired into any UI yet —
 * exists so the resolver branch is meaningful and the future page-chat plan
 * has a clean drop-in point.
 *
 * The next plan will fill in:
 *  - per-page tool registry (panels can register tools for their pages)
 *  - page-aware system prompt
 *  - `pageSlug` storage (requires a Prisma migration; deferred until needed)
 */
export class PageChatContext implements ChatContext {
  readonly kind = 'page' as const

  private constructor(
    private readonly pageSlug: string,
    private readonly userId: string | undefined,
  ) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  static async create(deps: ResolveContextDeps): Promise<PageChatContext> {
    const slug = deps.body.pageContext?.pageSlug ?? 'unknown'
    return new PageChatContext(slug, extractUserId(deps.req))
  }

  buildSystemPrompt(): string {
    return `You are a helpful assistant for the "${this.pageSlug}" page. Be concise.`
  }

  buildTools(): AnyTool[] {
    return []
  }

  getConversationMeta(): ConversationStoreMeta {
    // pageSlug is intentionally not persisted yet — see plan §3.4 (deferred to
    // the future page-chat plan, which will land the Prisma migration).
    return this.userId ? { userId: this.userId } : {}
  }

  shouldLoadHistory(): boolean {
    return true
  }

  transformUserInput(input: string, _history: AiMessage[]): string {
    return input
  }
}
