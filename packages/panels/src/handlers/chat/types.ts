import type { AppRequest } from '@rudderjs/core'
import type { AiMessage, ConversationStoreMeta } from '@rudderjs/ai'

export interface ChatRequestBody {
  // Either of these is required (not both)
  message?:         string
  /** Reserved for the future client-tool round-trip plan; not used today. */
  messages?:        AiMessage[]

  conversationId?:  string
  model?:           string
  history?:         Array<{ role: 'user' | 'assistant'; content: string }>

  // Discriminated context (zero or one of these). Absence of all = global.
  resourceContext?: { resourceSlug: string; recordId: string }
  pageContext?:     { pageSlug: string }

  forceAgent?:      string
  selection?:       { field: string; text: string }
}

export interface ConversationStoreLike {
  create(title?: string, meta?: ConversationStoreMeta): Promise<string>
  load(conversationId: string): Promise<AiMessage[]>
  append(conversationId: string, messages: AiMessage[]): Promise<void>
  setTitle(conversationId: string, title: string): Promise<void>
  list(userId?: string): Promise<Array<{ id: string; title: string; createdAt: Date; updatedAt?: Date }>>
  delete?(conversationId: string): Promise<void>
  getMeta?(conversationId: string): Promise<{ userId?: string } | null>
  listForResource?(resourceSlug: string, recordId?: string, userId?: string): Promise<Array<{ id: string; title: string; createdAt: Date; updatedAt?: Date }>>
}

export type SSESend = (event: string, data: unknown) => void

export function extractUserId(req: AppRequest): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = req as any
  return r.user?.id ?? r.session?.get?.('userId') ?? undefined
}

export async function resolveConversationStore(): Promise<ConversationStoreLike | null> {
  try {
    const { app } = await import(/* @vite-ignore */ '@rudderjs/core') as { app(): { make(k: string): unknown } }
    return app().make('ai.conversations') as ConversationStoreLike
  } catch { return null }
}

export function createSSEStream() {
  const encoder = new TextEncoder()
  let controller: ReadableStreamDefaultController<Uint8Array>

  const readable = new ReadableStream<Uint8Array>({
    start(c) { controller = c },
  })

  const send: SSESend = (event, data) => {
    try {
      controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
    } catch { /* stream closed */ }
  }

  const close = () => {
    try { controller.close() } catch { /* already closed */ }
  }

  return { readable, send, close }
}
