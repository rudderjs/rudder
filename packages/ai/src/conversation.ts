import type { AiMessage, ConversationStore } from './types.js'

function generateId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export class MemoryConversationStore implements ConversationStore {
  private readonly conversations = new Map<string, {
    title: string
    messages: AiMessage[]
    createdAt: Date
  }>()

  async create(title?: string): Promise<string> {
    const id = generateId()
    this.conversations.set(id, {
      title: title ?? 'New conversation',
      messages: [],
      createdAt: new Date(),
    })
    return id
  }

  async load(conversationId: string): Promise<AiMessage[]> {
    const conv = this.conversations.get(conversationId)
    if (!conv) throw new Error(`[RudderJS AI] Conversation "${conversationId}" not found.`)
    return [...conv.messages]
  }

  async append(conversationId: string, messages: AiMessage[]): Promise<void> {
    const conv = this.conversations.get(conversationId)
    if (!conv) throw new Error(`[RudderJS AI] Conversation "${conversationId}" not found.`)
    conv.messages.push(...messages)
  }

  async setTitle(conversationId: string, title: string): Promise<void> {
    const conv = this.conversations.get(conversationId)
    if (!conv) throw new Error(`[RudderJS AI] Conversation "${conversationId}" not found.`)
    conv.title = title
  }

  async list(_userId?: string): Promise<{ id: string; title: string; createdAt: Date }[]> {
    return Array.from(this.conversations.entries()).map(([id, conv]) => ({
      id,
      title: conv.title,
      createdAt: conv.createdAt,
    }))
  }
}
