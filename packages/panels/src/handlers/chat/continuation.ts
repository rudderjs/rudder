import type { AiMessage, ToolCall } from '@rudderjs/ai'
import type { ConversationStoreLike } from './types.js'

/**
 * Errors thrown by `validateContinuation` for safe rejection by the dispatcher.
 *
 * Why these checks exist:
 * - Without prefix validation, a client could rewrite history (e.g. forge an
 *   assistant message that approved a tool call).
 * - Without approval-id validation, a client could POST `approvedToolCallIds`
 *   for any string and bypass `needsApproval` gates entirely.
 */
export class ContinuationError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'ContinuationError'
  }
}

export interface ValidateContinuationDeps {
  store:               ConversationStoreLike
  conversationId:      string
  bodyMessages:        AiMessage[]
  approvedToolCallIds: string[] | undefined
  rejectedToolCallIds: string[] | undefined
}

/**
 * Validate a continuation request against the persisted conversation.
 *
 * Rules:
 * 1. The prefix of `bodyMessages` (length = persisted.length) must match the
 *    persisted messages exactly. The client may only *append* (its own user
 *    message + tool result messages from the previous round) — never rewrite.
 * 2. Any id in `approvedToolCallIds`/`rejectedToolCallIds` must reference a
 *    real tool call in the most recent assistant message of the persisted
 *    conversation.
 *
 * Returns the validated `messages` array (same as input on success).
 */
export async function validateContinuation(deps: ValidateContinuationDeps): Promise<AiMessage[]> {
  const { store, conversationId, bodyMessages, approvedToolCallIds, rejectedToolCallIds } = deps

  const persisted = await store.load(conversationId)

  // Rule 1: prefix match.
  if (bodyMessages.length < persisted.length) {
    throw new ContinuationError(400, 'Continuation messages must include the entire persisted conversation as a prefix.')
  }
  for (let i = 0; i < persisted.length; i++) {
    if (!messagesEqual(persisted[i]!, bodyMessages[i]!)) {
      throw new ContinuationError(400, `Continuation diverges from persisted conversation at message ${i}.`)
    }
  }

  // Rule 2: approval ids must reference real pending tool calls.
  const allApproval = [...(approvedToolCallIds ?? []), ...(rejectedToolCallIds ?? [])]
  if (allApproval.length > 0) {
    const lastAssistant = findLastAssistantMessage(persisted)
    const knownIds = new Set<string>(
      (lastAssistant?.toolCalls ?? []).map((tc: ToolCall) => tc.id),
    )
    for (const id of allApproval) {
      if (!knownIds.has(id)) {
        throw new ContinuationError(400, `Approval id "${id}" does not reference a pending tool call in the most recent assistant message.`)
      }
    }
  }

  return bodyMessages
}

function findLastAssistantMessage(messages: AiMessage[]): AiMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m && m.role === 'assistant') return m
  }
  return undefined
}

function messagesEqual(a: AiMessage, b: AiMessage): boolean {
  if (a.role !== b.role) return false
  if (stringifyContent(a.content) !== stringifyContent(b.content)) return false
  if ((a.toolCallId ?? null) !== (b.toolCallId ?? null)) return false
  // toolCalls comparison: shallow by name+id+args (JSON)
  const aCalls = a.toolCalls ?? []
  const bCalls = b.toolCalls ?? []
  if (aCalls.length !== bCalls.length) return false
  for (let i = 0; i < aCalls.length; i++) {
    const ac = aCalls[i]!
    const bc = bCalls[i]!
    if (ac.id !== bc.id || ac.name !== bc.name) return false
    if (JSON.stringify(ac.arguments) !== JSON.stringify(bc.arguments)) return false
  }
  return true
}

function stringifyContent(content: AiMessage['content']): string {
  return typeof content === 'string' ? content : JSON.stringify(content)
}
