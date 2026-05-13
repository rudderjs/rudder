import { html, raw, type SafeString } from '../_html.js'
import { Card, KeyValueTable, JsonBlock, CodeBlock, Badge, Tabs } from './sections.js'
import { escape } from './format.js'
import type { TelescopeEntry } from '../../../types.js'

/**
 * Detail view for the `ai` watcher — one entry per agent run, with
 * conversation tabs (input/output), token-usage card, and an execution
 * tab group that drills into tool calls and per-step iterations.
 *
 * The two `render*` helpers below are AI-specific (they unpack the
 * provider-agnostic shapes telescope's AI collector records) so they
 * live with this view rather than in `sections.ts`. If a future watcher
 * needs the same shape, promote them — but don't pre-emptively.
 */

type ViewFn = (entry: TelescopeEntry) => SafeString

function renderToolCalls(toolCalls: unknown[]): SafeString {
  if (toolCalls.length === 0) return html``
  // `html\`\`` natively renders SafeString[] — `.map(...).join('')` was the
  // legacy footgun shape (each SafeString.toString() returns its raw value,
  // then raw() re-wraps). Pass the array directly so a future copy of this
  // code doesn't re-introduce the join-then-re-escape bug elsewhere.
  return html`${toolCalls.map((tc) => {
    const t = tc as Record<string, unknown>
    const name      = String(t['name'] ?? t['toolName'] ?? '—')
    const duration  = t['duration'] != null ? `${t['duration']}ms` : null
    const approved  = t['approved'] === true
    const needsApproval = t['requiresApproval'] === true
    const args      = t['args'] ?? t['input'] ?? t['arguments']
    const result    = t['result'] ?? t['output']

    const approvalBadge = needsApproval
      ? raw(`<span class="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">${approved ? 'Approved' : 'Pending'}</span>`)
      : ''

    return html`
      <div class="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden mb-2">
        <div class="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          ${Badge(name)}
          ${approvalBadge}
          ${duration ? raw(`<span class="text-xs text-gray-400 dark:text-gray-500 ml-auto">${escape(duration)}</span>`) : ''}
        </div>
        ${args !== undefined ? html`
          <details class="group">
            <summary class="px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 cursor-pointer select-none hover:bg-gray-50 dark:hover:bg-gray-800">Args</summary>
            <div class="px-3 pb-2">${JsonBlock(args)}</div>
          </details>
        ` : ''}
        ${result !== undefined ? html`
          <details class="group">
            <summary class="px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 cursor-pointer select-none hover:bg-gray-50 dark:hover:bg-gray-800">Result</summary>
            <div class="px-3 pb-2">${JsonBlock(result)}</div>
          </details>
        ` : ''}
      </div>
    `
  })}`
}

function renderSteps(steps: unknown[]): SafeString {
  if (steps.length <= 1) return html``
  return html`${steps.map((s, i) => {
    const step = s as Record<string, unknown>
    const usage = step['usage'] as Record<string, unknown> | undefined
    const tokens = usage ? (usage['totalTokens'] ?? usage['total_tokens']) : undefined
    const tcCount = Array.isArray(step['toolCalls']) ? step['toolCalls'].length : (step['toolCallCount'] ?? 0)
    const finishReason = step['finishReason'] ?? step['finish_reason']

    return html`
      <div class="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 mb-2">
        ${Card(null, KeyValueTable({
          Iteration:     i + 1,
          Tokens:        tokens != null ? String(tokens) : '—',
          'Tool Calls':  String(tcCount),
          'Finish Reason': finishReason ? Badge(String(finishReason)) : raw('<span class="text-gray-300 dark:text-gray-600">—</span>'),
        }))}
      </div>
    `
  })}`
}

export const AiView: ViewFn = (entry) => {
  const c = entry.content as Record<string, unknown>

  const status       = String(c['status'] ?? '')
  const statusBadge  = status === 'failed'
    ? raw(`<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">Failed</span>`)
    : raw(`<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">Completed</span>`)

  const finishReason = c['finishReason'] ?? c['finish_reason']
  const streaming    = c['streaming'] === true ? 'Yes' : 'No'
  const toolCalls    = Array.isArray(c['toolCalls']) ? c['toolCalls'] as unknown[] : []
  const steps        = Array.isArray(c['steps']) ? c['steps'] as unknown[] : []
  const usage        = c['usage'] as Record<string, unknown> | undefined

  const requestRows: Record<string, unknown> = {
    Status:        statusBadge,
    Agent:         c['agentName'] ?? c['agent'] ?? '—',
    Model:         c['model'] ? Badge(String(c['model'])) : raw('<span class="text-gray-300 dark:text-gray-600">—</span>'),
    Provider:      c['provider'] ?? '—',
    Duration:      c['duration'] != null ? `${c['duration']}ms` : '—',
    'Finish Reason': finishReason ? Badge(String(finishReason)) : raw('<span class="text-gray-300 dark:text-gray-600">—</span>'),
    Steps:         steps.length > 0 ? steps.length : (c['stepCount'] ?? '—'),
    'Tool Calls':  toolCalls.length > 0 ? toolCalls.length : (c['toolCallCount'] ?? '—'),
    Streaming:     streaming,
  }
  if (c['conversationId']) {
    requestRows['Conversation ID'] = raw(`<span class="font-mono text-xs">${escape(String(c['conversationId']))}</span>`)
  }
  const failoverAttempts = c['failoverAttempts'] as number | undefined
  if (failoverAttempts != null && failoverAttempts > 0) {
    requestRows['Failover Attempts'] = failoverAttempts
  }

  const inputValue  = c['input']  as unknown
  const outputValue = c['output'] as unknown
  const errorValue  = c['error']  as unknown

  const inputStr  = typeof inputValue  === 'string' ? inputValue  : JSON.stringify(inputValue,  null, 2)
  const outputStr = typeof outputValue === 'string' ? outputValue : JSON.stringify(outputValue, null, 2)

  return html`
    ${Card('AI Request', KeyValueTable(requestRows))}

    ${usage ? Card('Token Usage', KeyValueTable({
      Prompt:     usage['promptTokens']     ?? usage['prompt_tokens']     ?? '—',
      Completion: usage['completionTokens'] ?? usage['completion_tokens'] ?? '—',
      Total:      usage['totalTokens']      ?? usage['total_tokens']      ?? '—',
    })) : ''}

    ${(() => {
      const conversationTabs: { label: string; content: SafeString | string }[] = []
      if (outputValue !== undefined && outputValue !== null) {
        conversationTabs.push({ label: 'Output', content: CodeBlock(outputStr, { maxHeight: '[400px]' }) })
      }
      if (inputValue !== undefined && inputValue !== null) {
        conversationTabs.push({ label: 'Input', content: CodeBlock(inputStr, { maxHeight: '[200px]' }) })
      }
      return conversationTabs.length > 0 ? Tabs(conversationTabs) : ''
    })()}

    ${errorValue
      ? Card('Error', raw(`<pre class="text-sm text-red-600 dark:text-red-400 whitespace-pre-wrap break-words">${escape(typeof errorValue === 'string' ? errorValue : JSON.stringify(errorValue, null, 2))}</pre>`))
      : ''}

    ${(() => {
      const executionTabs: { label: string; content: SafeString | string }[] = []
      if (toolCalls.length > 0) {
        executionTabs.push({ label: `Tool Calls (${toolCalls.length})`, content: renderToolCalls(toolCalls) })
      }
      if (steps.length > 1) {
        executionTabs.push({ label: `Steps (${steps.length})`, content: renderSteps(steps) })
      }
      return executionTabs.length > 0 ? Tabs(executionTabs) : ''
    })()}
  `
}
