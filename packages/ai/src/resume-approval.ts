import {
  applyToModelOutput,
  evaluateApproval,
  executeMaybeStreaming,
  validateToolArgs,
} from './tool-helpers.js'
import type { AgentPromptOptions, AiMessage, AnyTool, ToolCall } from './types.js'

/**
 * When continuing a chat after a stop-on-approval round-trip, the supplied
 * `messages` array ends with an `assistant` message whose `toolCalls` were
 * never fulfilled (the loop paused before executing them). Most providers
 * (Anthropic in particular) reject such conversations because every
 * `tool_use` block must be followed by a matching `tool_result`.
 *
 * This helper detects that case, executes the pending **server** tool calls
 * (honoring `approvedToolCallIds` / `rejectedToolCallIds`), appends the
 * resulting tool messages to `messages` in place, and returns them. The
 * caller can attach the returned list to `AgentResponse.resumedToolMessages`
 * so that the panels dispatcher persists them in the conversation store.
 *
 * Client tools (no `execute`) must come back from the browser with their
 * tool result already in the conversation, so the trailing assistant message
 * will not have unmatched `toolCalls` for them — they're handled outside.
 */
export async function resumePendingToolCalls(deps: {
  messages: AiMessage[]
  toolMap:  Map<string, AnyTool>
  options:  AgentPromptOptions | undefined
}): Promise<{
  resumed:               AiMessage[]
  approvalStillRequired: { toolCall: ToolCall; isClientTool: boolean } | undefined
}> {
  const { messages, toolMap, options } = deps
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'assistant' || !last.toolCalls || last.toolCalls.length === 0) {
    return { resumed: [], approvalStillRequired: undefined }
  }

  const resumed: AiMessage[] = []
  let approvalStillRequired: { toolCall: ToolCall; isClientTool: boolean } | undefined

  for (const tc of last.toolCalls) {
    const tool = toolMap.get(tc.name)
    if (!tool) {
      const err = `Error: Unknown tool "${tc.name}"`
      const m: AiMessage = { role: 'tool', content: err, toolCallId: tc.id }
      messages.push(m)
      resumed.push(m)
      continue
    }
    if (!tool.execute) {
      // Client tool whose result is missing from the supplied messages.
      // Surface an error so the model can recover instead of hanging.
      const err = `Error: client tool "${tc.name}" was not executed by the browser`
      const m: AiMessage = { role: 'tool', content: err, toolCallId: tc.id }
      messages.push(m)
      resumed.push(m)
      continue
    }

    const decision = await evaluateApproval(tool, tc, options)
    if (decision === 'rejected') {
      const rej = { rejected: true, reason: 'User rejected this tool call' }
      const m: AiMessage = { role: 'tool', content: JSON.stringify(rej), toolCallId: tc.id }
      messages.push(m)
      resumed.push(m)
      continue
    }
    if (decision === 'pending') {
      // Still pending — the user has not yet approved this call. Re-emit
      // the pending state and stop processing further tools.
      approvalStillRequired = { toolCall: tc, isClientTool: false }
      break
    }

    // Validate args before executing on resume. Approval-resume bypasses
    // middleware so we use the raw tc.arguments. On failure, feed the
    // structured error to the model so it can correct itself.
    const validation = validateToolArgs(tool, tc.arguments)
    if (!validation.ok) {
      const m: AiMessage = { role: 'tool', content: JSON.stringify(validation.error), toolCallId: tc.id }
      messages.push(m)
      resumed.push(m)
      continue
    }

    try {
      // Drain generator yields silently — approval-resume runs outside the
      // stream, so any preliminary updates are discarded; only the final
      // return value is captured.
      const execGen = executeMaybeStreaming(tool, validation.value, { toolCallId: tc.id })
      let result: unknown
      while (true) {
        const step = await execGen.next()
        if (step.done) { result = step.value; break }
      }
      // Approval-resume has no middleware context here, so toModelOutput
      // errors fall back silently to default stringification (R6).
      const content = await applyToModelOutput(tool, result)
      const m: AiMessage = { role: 'tool', content, toolCallId: tc.id }
      messages.push(m)
      resumed.push(m)
    } catch (err) {
      const errMsg = `Error: ${err instanceof Error ? err.message : String(err)}`
      const m: AiMessage = { role: 'tool', content: errMsg, toolCallId: tc.id }
      messages.push(m)
      resumed.push(m)
    }
  }

  return { resumed, approvalStillRequired }
}
