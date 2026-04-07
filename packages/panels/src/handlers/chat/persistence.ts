import type { AiMessage, AgentResponse } from '@rudderjs/ai'
import type { ConversationStoreLike } from './types.js'
import { generateConversationTitle } from './conversationManager.js'

/**
 * Persist a completed chat turn — including assistant tool calls and tool
 * results, so that future turns can pass the full message graph back to the
 * model. The old chatHandler dropped tool messages on the floor; this is the
 * fix that unblocks `client-tool-roundtrip-plan.md`.
 *
 * Note: we persist the ORIGINAL `userInput`, not the
 * `context.transformUserInput()` output. The transformed version is an
 * implementation detail of multi-turn priming and shouldn't pollute history.
 */
export async function persistConversation(
  store:          ConversationStoreLike,
  conversationId: string,
  userInput:      string,
  result:         AgentResponse,
  isFirstTurn:    boolean,
): Promise<void> {
  const messagesToAppend: AiMessage[] = [
    { role: 'user', content: userInput },
  ]

  // Each step contains: assistant message (possibly with toolCalls) +
  // any tool result messages from this step.
  for (const step of result.steps) {
    messagesToAppend.push(step.message)
    for (const tr of step.toolResults) {
      messagesToAppend.push({
        role:       'tool',
        content:    typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result),
        toolCallId: tr.toolCallId,
      })
    }
  }

  await store.append(conversationId, messagesToAppend)

  if (isFirstTurn) {
    const lastAssistant = result.steps[result.steps.length - 1]?.message
    const text = typeof lastAssistant?.content === 'string' ? lastAssistant.content : result.text
    generateConversationTitle(store, conversationId, userInput, text).catch(() => { /* best-effort */ })
  }
}
