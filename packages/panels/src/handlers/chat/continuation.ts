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
    const reason = messagesDiff(persisted[i]!, bodyMessages[i]!)
    if (reason) {
      throw new ContinuationError(
        400,
        `Continuation diverges from persisted conversation at message ${i}: ${reason}`,
      )
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

/**
 * Compares two messages and returns null if equal, or a human-readable reason
 * string describing the first divergence. Used by `validateContinuation` so
 * 400 responses tell the client exactly what mismatched.
 */
function messagesDiff(a: AiMessage, b: AiMessage): string | null {
  if (a.role !== b.role) return `role: persisted="${a.role}" body="${b.role}"`
  const aContent = stringifyContent(a.content)
  const bContent = stringifyContent(b.content)
  if (aContent !== bContent) {
    return `content: persisted=${truncate(aContent)} body=${truncate(bContent)}`
  }
  if ((a.toolCallId ?? null) !== (b.toolCallId ?? null)) {
    return `toolCallId: persisted=${a.toolCallId ?? 'null'} body=${b.toolCallId ?? 'null'}`
  }
  const aCalls = a.toolCalls ?? []
  const bCalls = b.toolCalls ?? []
  if (aCalls.length !== bCalls.length) {
    return `toolCalls.length: persisted=${aCalls.length} body=${bCalls.length}`
  }
  for (let i = 0; i < aCalls.length; i++) {
    const ac = aCalls[i]!
    const bc = bCalls[i]!
    if (ac.id !== bc.id) return `toolCalls[${i}].id: persisted=${ac.id} body=${bc.id}`
    if (ac.name !== bc.name) return `toolCalls[${i}].name: persisted=${ac.name} body=${bc.name}`
    const aArgs = canonicalJson(ac.arguments)
    const bArgs = canonicalJson(bc.arguments)
    if (aArgs !== bArgs) {
      return `toolCalls[${i}].arguments (${ac.name}): persisted=${truncate(aArgs)} body=${truncate(bArgs)}`
    }
  }
  return null
}

function truncate(s: string, max = 200): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

function stringifyContent(content: AiMessage['content']): string {
  return typeof content === 'string' ? content : canonicalJson(content)
}

/**
 * JSON.stringify variant with sorted object keys and dropped `undefined`
 * values. Used by `messagesEqual` so that an assistant tool call serialized
 * server-side compares equal to the same call replayed by the browser, even
 * when the two paths produce the same data with different key ordering or
 * one side stripping `undefined` slots.
 *
 * Without this, multi-turn chat 400s after any tool call whose arguments
 * contain nested objects/arrays — the agent can't make any progress because
 * each round-trip's prefix check fails on canonicalization differences.
 */
function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(canonicalize)
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const v = (value as Record<string, unknown>)[key]
    if (v === undefined) continue
    out[key] = canonicalize(v)
  }
  return out
}
