import { html, raw, type SafeString } from '../_html.js'
import { Card, KeyValueTable, JsonBlock, CodeBlock, Badge, Tabs } from './sections.js'
import type { TelescopeEntry } from '../../../types.js'

/**
 * Per-watcher detail view functions. Each takes a `TelescopeEntry` and
 * returns a `SafeString` body to be slotted into `DetailLayout`.
 *
 * Keep these short — push reusable rendering into `sections.ts`. The
 * point of having one function per watcher is to make the type-specific
 * rendering decisions explicit and obvious to read.
 */

type ViewFn = (entry: TelescopeEntry) => SafeString

const RequestView: ViewFn = (entry) => {
  const c = entry.content as Record<string, unknown>
  const headers         = c['headers']         as Record<string, string> | undefined
  const responseHeaders = c['responseHeaders'] as Record<string, string> | undefined
  const body            = c['body']
  const query           = c['query']           as Record<string, unknown> | undefined
  const params          = c['params']          as Record<string, unknown> | undefined
  const session         = c['session']         as Record<string, unknown> | undefined
  const user            = c['user']            as Record<string, unknown> | undefined
  const controller      = c['controller']      as string | undefined
  const middlewareList   = c['middleware']       as string[] | undefined
  const memoryUsage     = c['memoryUsage']     as number | undefined
  // Status badge with color based on status code
  const status = c['status'] as number | undefined
  const statusBadge = status
    ? raw(`<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusColor(status)}">${status}</span>`)
    : raw('<span class="text-gray-300 dark:text-gray-600">—</span>')

  // Build the details table — only include fields that have values
  const details: Record<string, unknown> = {
    Time:           formatTimestamp(entry.createdAt),
    Method:         Badge(c['method'] as string),
    Path:           raw(`<span class="font-mono text-xs">${escape(c['path'] as string)}</span>`),
  }
  if (controller) details['Controller Action'] = controller
  if (middlewareList && middlewareList.length > 0) details['Middleware'] = middlewareList.join(', ')
  Object.assign(details, {
    Status:         statusBadge,
    Duration:       c['duration'] != null ? `${c['duration']}ms` : '—',
    Hostname:       c['hostname'],
    'IP Address':   c['ip'],
  })
  if (memoryUsage != null) details['Memory Usage'] = formatBytes(memoryUsage)
  if (entry.tags.length > 0) {
    details['Tags'] = raw(entry.tags.map(t => `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 font-mono">${escape(t)}</span>`).join(' '))
  }

  const responseBody  = c['responseBody']
  const hasQuery      = !!query   && Object.keys(query).length  > 0
  const hasParams     = !!params  && Object.keys(params).length > 0
  const hasBody       = body !== undefined && body !== null && body !== '' && !(typeof body === 'object' && Object.keys(body as object).length === 0)
  const hasPayload    = hasQuery || hasParams || hasBody
  const hasSession    = !!session && Object.keys(session).length > 0
  const hasResHeaders = !!responseHeaders && Object.keys(responseHeaders).length > 0
  const hasResBody    = responseBody !== undefined && responseBody !== null && responseBody !== ''

  const subheading = (label: string): SafeString =>
    raw(`<h4 class="text-xs uppercase tracking-wide font-medium text-gray-500 dark:text-gray-400 mb-2">${escape(label)}</h4>`)

  // Always show a Payload tab — matches Laravel Telescope, which renders `[]`
  // for GET requests with no query/body/params.
  const payloadContent = hasPayload
    ? html`
        ${hasQuery  ? html`<div class="mb-4">${subheading('Query String')}${JsonBlock(query)}</div>` : ''}
        ${hasBody   ? html`<div class="mb-4">${subheading('Body')}${JsonBlock(body)}</div>` : ''}
        ${hasParams ? html`<div class="mb-4">${subheading('Route Parameters')}${JsonBlock(params)}</div>` : ''}
      `
    : JsonBlock([])

  // Two separate tab groups (Laravel-style):
  //   Request  — Payload + Headers
  //   Response — Headers + Session (session is scoped to the resolved response)
  const requestTabs = Tabs([
    { label: 'Payload', content: payloadContent },
    ...(headers ? [{ label: 'Headers', content: JsonBlock(headers) }] : []),
  ])
  const responseBodyContent = hasResBody
    ? (typeof responseBody === 'string'
        ? CodeBlock(responseBody)
        : JsonBlock(responseBody))
    : ''
  const responseTabs = Tabs([
    ...(hasResBody    ? [{ label: 'Response', content: responseBodyContent        }] : []),
    ...(hasResHeaders ? [{ label: 'Headers',  content: JsonBlock(responseHeaders) }] : []),
    ...(hasSession    ? [{ label: 'Session',  content: JsonBlock(session)         }] : []),
  ])

  return html`
    ${Card('Request Details', KeyValueTable(details))}

    ${user ? Card('Authenticated User', KeyValueTable({
      ID:              user['id'],
      Name:            user['name'],
      'Email Address': user['email'],
    })) : ''}

    ${requestTabs}
    ${responseTabs}
  `
}

function formatTimestamp(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d)
  return date.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function statusColor(status: number): string {
  if (status >= 500) return 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
  if (status >= 400) return 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300'
  if (status >= 300) return 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
  if (status >= 200) return 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
  return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
}

const QueryView: ViewFn = (entry) => {
  const c = entry.content as Record<string, unknown>
  return html`
    ${Card(null, KeyValueTable({
      Duration: c['duration'] != null ? `${c['duration']}ms` : '—',
      Model:    c['model'],
      Connection: c['connection'],
    }))}
    ${Card('SQL', CodeBlock(String(c['sql'] ?? ''), { language: 'sql' }))}
    ${c['bindings'] !== undefined ? Card('Bindings', JsonBlock(c['bindings'])) : ''}
  `
}

const ExceptionView: ViewFn = (entry) => {
  const c = entry.content as Record<string, unknown>
  const stack = String(c['stack'] ?? c['trace'] ?? '')
  return html`
    ${Card(null, KeyValueTable({
      Class:   raw(`<span class="font-mono text-xs text-red-600 dark:text-red-400">${escape(c['class'] as string ?? '')}</span>`),
      Message: c['message'],
      File:    c['file'],
      Line:    c['line'],
    }))}
    ${stack ? Card('Stack Trace', CodeBlock(stack, { maxHeight: '[600px]' })) : ''}
    ${c['context'] !== undefined ? Card('Context', JsonBlock(c['context'])) : ''}
  `
}

const MailView: ViewFn = (entry) => {
  const c = entry.content as Record<string, unknown>
  const htmlBody = c['html']
  const textBody = c['text']
  const to = Array.isArray(c['to']) ? (c['to'] as string[]).join(', ') : c['to']

  const bodyTabs: { label: string; content: SafeString | string }[] = []
  if (htmlBody) {
    bodyTabs.push({
      label: 'HTML Preview',
      content: html`<iframe srcdoc="${String(htmlBody)}" class="w-full h-96 bg-white border border-gray-200 dark:border-gray-700 rounded-lg" sandbox=""></iframe>`,
    })
  }
  if (textBody) {
    bodyTabs.push({ label: 'Plain Text', content: CodeBlock(String(textBody)) })
  }

  return html`
    ${Card(null, KeyValueTable({
      Class:   raw(`<span class="font-mono text-xs">${escape(c['class'] as string ?? '')}</span>`),
      Subject: c['subject'],
      From:    c['from'],
      To:      to,
      CC:      Array.isArray(c['cc']) ? (c['cc'] as string[]).join(', ') : c['cc'],
      BCC:     Array.isArray(c['bcc']) ? (c['bcc'] as string[]).join(', ') : c['bcc'],
    }))}
    ${bodyTabs.length > 0 ? Tabs(bodyTabs) : ''}
  `
}

const JobView: ViewFn = (entry) => {
  const c = entry.content as Record<string, unknown>
  return html`
    ${Card(null, KeyValueTable({
      Class:    raw(`<span class="font-mono text-xs">${escape(c['class'] as string ?? '')}</span>`),
      Queue:    c['queue'],
      Status:   Badge(c['status'] as string),
      Attempts: c['attempts'],
      Duration: c['duration'] != null ? `${c['duration']}ms` : '—',
    }))}
    ${c['payload'] !== undefined ? Card('Payload', JsonBlock(c['payload'])) : ''}
    ${c['exception'] ? Card('Exception', CodeBlock(String(c['exception']))) : ''}
  `
}

const LogView: ViewFn = (entry) => {
  const c = entry.content as Record<string, unknown>
  return html`
    ${Card(null, KeyValueTable({
      Level:   Badge(c['level'] as string),
      Channel: c['channel'],
      Message: c['message'],
    }))}
    ${c['context'] !== undefined ? Card('Context', JsonBlock(c['context'])) : ''}
  `
}

const NotificationView: ViewFn = (entry) => {
  const c = entry.content as Record<string, unknown>
  return html`
    ${Card(null, KeyValueTable({
      Class:      raw(`<span class="font-mono text-xs">${escape(c['class'] as string ?? '')}</span>`),
      Channel:    c['channel'],
      Notifiable: c['notifiable'],
    }))}
    ${c['data'] !== undefined ? Card('Payload', JsonBlock(c['data'])) : ''}
  `
}

const EventView: ViewFn = (entry) => {
  const c = entry.content as Record<string, unknown>
  return html`
    ${Card(null, KeyValueTable({
      Name: raw(`<span class="font-mono text-xs">${escape(c['name'] as string ?? '')}</span>`),
    }))}
    ${c['payload'] !== undefined ? Card('Payload', JsonBlock(c['payload'])) : ''}
    ${Array.isArray(c['listeners']) && (c['listeners'] as unknown[]).length > 0
      ? Card('Listeners', JsonBlock(c['listeners']))
      : ''}
  `
}

const CacheView: ViewFn = (entry) => {
  const c = entry.content as Record<string, unknown>
  return html`
    ${Card(null, KeyValueTable({
      Operation: Badge(c['operation'] as string),
      Key:       raw(`<span class="font-mono text-xs">${escape(c['key'] as string ?? '—')}</span>`),
      Store:     c['store'],
      TTL:       c['ttl'],
    }))}
    ${c['value'] !== undefined ? Card('Value', JsonBlock(c['value'])) : ''}
  `
}

const ScheduleView: ViewFn = (entry) => {
  const c = entry.content as Record<string, unknown>
  return html`
    ${Card(null, KeyValueTable({
      Description: c['description'],
      Expression:  raw(`<span class="font-mono text-xs">${escape(c['expression'] as string ?? '')}</span>`),
      Status:      Badge(c['status'] as string),
      Duration:    c['duration'] != null ? `${c['duration']}ms` : '—',
      'Exit Code': c['exitCode'],
    }))}
    ${c['output'] ? Card('Output', CodeBlock(String(c['output']))) : ''}
  `
}

const ModelView: ViewFn = (entry) => {
  const c = entry.content as Record<string, unknown>
  const before = c['before'] as Record<string, unknown> | undefined
  const after  = c['after']  as Record<string, unknown> | undefined

  return html`
    ${Card(null, KeyValueTable({
      Model:  raw(`<span class="font-mono text-xs">${escape(c['model'] as string ?? '')}</span>`),
      Action: Badge(c['action'] as string),
      'Model ID': c['modelId'],
    }))}
    ${before ? Card('Before', JsonBlock(before)) : ''}
    ${after  ? Card('After',  JsonBlock(after))  : ''}
    ${c['changes'] !== undefined ? Card('Changes', JsonBlock(c['changes'])) : ''}
  `
}

const CommandView: ViewFn = (entry) => {
  const c = entry.content as Record<string, unknown>
  const error = c['error'] as { message?: string; stack?: string } | undefined
  const exitCode = c['exitCode'] as number ?? 0
  return html`
    ${Card(null, KeyValueTable({
      Name:     raw(`<span class="font-mono text-xs">${escape(c['name'] as string ?? '')}</span>`),
      Source:   Badge(c['source'] as string),
      Status:   Badge(exitCode === 0 ? 'success' : 'failed'),
      'Exit Code': raw(`<span class="font-mono text-xs">${exitCode}</span>`),
      Duration: c['duration'] != null ? `${c['duration']}ms` : '—',
    }))}
    ${c['args'] && Object.keys(c['args'] as object).length > 0 ? Card('Arguments', JsonBlock(c['args'])) : ''}
    ${c['opts'] && Object.keys(c['opts'] as object).length > 0 ? Card('Options', JsonBlock(c['opts'])) : ''}
    ${error?.message ? Card('Error', html`
      <div class="text-sm text-red-600 dark:text-red-400 mb-2">${error.message}</div>
      ${error.stack ? CodeBlock(error.stack, { maxHeight: '[600px]' }) : ''}
    `) : ''}
  `
}

const HttpView: ViewFn = (entry) => {
  const c = entry.content as Record<string, unknown>
  const reqHeaders  = c['reqHeaders']  as Record<string, string> | undefined
  const resHeaders  = c['resHeaders']  as Record<string, string> | undefined
  const isFailure   = c['kind'] === 'request.failed'

  return html`
    ${Card(null, KeyValueTable({
      Method:        Badge(c['method'] as string),
      URL:           raw(`<span class="font-mono text-xs break-all">${escape(c['url'] as string ?? '')}</span>`),
      Status:        isFailure ? Badge('FAILED') : Badge(String(c['status'] ?? '')),
      Duration:      c['duration'] != null ? `${c['duration']}ms` : '—',
      'Resp Size':   c['resSize'] != null ? `${c['resSize']} bytes` : '—',
    }))}
    ${reqHeaders ? Card('Request Headers', KeyValueTable(reqHeaders)) : ''}
    ${c['reqBody'] !== undefined && c['reqBody'] !== null ? Card('Request Body', JsonBlock(c['reqBody'])) : ''}
    ${resHeaders ? Card('Response Headers', KeyValueTable(resHeaders)) : ''}
    ${c['resBody'] ? Card('Response Body', CodeBlock(String(c['resBody']), { maxHeight: '[400px]' })) : ''}
    ${isFailure && c['error'] ? Card('Error', raw(`<div class="text-sm text-red-600 dark:text-red-400">${escape(c['error'] as string)}</div>`)) : ''}
  `
}

const GateView: ViewFn = (entry) => {
  const c = entry.content as Record<string, unknown>
  return html`
    ${Card(null, KeyValueTable({
      Ability:      raw(`<span class="font-mono text-xs">${escape(c['ability'] as string ?? '')}</span>`),
      Result:       Badge(c['allowed'] ? 'Allowed' : 'Denied'),
      'Resolved Via': Badge(c['resolvedVia'] as string),
      'User ID':    c['userId'] ?? '—',
      Duration:     c['duration'] != null ? `${c['duration']}ms` : '—',
      Policy:       c['policy'] ?? '—',
      Model:        c['model'] ?? '—',
    }))}
  `
}

const DumpView: ViewFn = (entry) => {
  const c = entry.content as Record<string, unknown>
  const args = c['args'] as unknown[] | undefined
  return html`
    ${Card(null, KeyValueTable({
      Method:   Badge(c['method'] as string),
      Caller:   c['caller'] ? raw(`<span class="font-mono text-xs">${escape(c['caller'] as string)}</span>`) : '—',
      'Arg Count': c['count'],
    }))}
    ${args ? args.map((arg, i) => Card(`Argument ${i + 1}`, JsonBlock(arg))).join('') : ''}
  `
}

const BroadcastView: ViewFn = (entry) => {
  const c = entry.content as Record<string, unknown>
  const kind = String(c['kind'] ?? '')

  // Render kind-specific fields. The shared fields (kind, connectionId)
  // appear in the top KeyValueTable; everything else goes in a JSON dump.
  const baseRows: Record<string, unknown> = {
    Kind:         Badge(kind),
    'Connection': c['connectionId'] != null
      ? raw(`<a href="../batches/${escape(c['connectionId'] as string)}" class="font-mono text-xs text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300">${escape((c['connectionId'] as string).slice(0, 12))}…</a>`)
      : raw('<span class="text-gray-300 dark:text-gray-600">—</span>'),
  }

  switch (kind) {
    case 'connection.opened':
      baseRows['IP']         = c['ip']
      baseRows['User-Agent'] = c['userAgent']
      baseRows['URL']        = c['url']
      break
    case 'connection.closed':
      baseRows['Reason']     = c['reason']
      break
    case 'subscribe':
      baseRows['Channel']      = raw(`<span class="font-mono text-xs">${escape(c['channel'] as string ?? '')}</span>`)
      baseRows['Channel Type'] = Badge(c['channelType'] as string)
      baseRows['Allowed']      = Badge(c['allowed'] ? 'allowed' : 'denied')
      if (c['authMs'] != null) baseRows['Auth Time'] = `${c['authMs']}ms`
      if (c['reason'])         baseRows['Reason']    = c['reason']
      break
    case 'unsubscribe':
      baseRows['Channel'] = raw(`<span class="font-mono text-xs">${escape(c['channel'] as string ?? '')}</span>`)
      break
    case 'broadcast':
      baseRows['Channel']        = raw(`<span class="font-mono text-xs">${escape(c['channel'] as string ?? '')}</span>`)
      baseRows['Event']          = raw(`<span class="font-mono text-xs">${escape(c['event'] as string ?? '')}</span>`)
      baseRows['Source']         = Badge(c['source'] as string)
      baseRows['Recipients']     = c['recipientCount']
      baseRows['Payload Size']   = c['payloadSize'] != null ? `${c['payloadSize']} bytes` : '—'
      if (c['sourceConnectionId']) baseRows['From'] = raw(`<span class="font-mono text-xs">${escape(c['sourceConnectionId'] as string)}</span>`)
      break
    case 'presence.join':
    case 'presence.leave':
      baseRows['Channel'] = raw(`<span class="font-mono text-xs">${escape(c['channel'] as string ?? '')}</span>`)
      break
  }

  return html`
    ${Card(null, KeyValueTable(baseRows))}
    ${(kind === 'presence.join' || kind === 'presence.leave') && c['member']
      ? Card('Member', JsonBlock(c['member']))
      : ''}
  `
}

function renderToolCalls(toolCalls: unknown[]): SafeString {
  if (toolCalls.length === 0) return html``
  const items = toolCalls.map((tc) => {
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
  }).join('')
  return raw(items)
}

function renderSteps(steps: unknown[]): SafeString {
  if (steps.length <= 1) return html``
  const items = steps.map((s, i) => {
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
  }).join('')
  return raw(items)
}

const AiView: ViewFn = (entry) => {
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
    Agent:         c['agent'] ?? '—',
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

    ${inputValue !== undefined && inputValue !== null
      ? Card('Input', CodeBlock(inputStr, { maxHeight: '[200px]' }))
      : ''}

    ${outputValue !== undefined && outputValue !== null
      ? Card('Output', CodeBlock(outputStr, { maxHeight: '[400px]' }))
      : ''}

    ${errorValue
      ? Card('Error', raw(`<pre class="text-sm text-red-600 dark:text-red-400 whitespace-pre-wrap break-words">${escape(typeof errorValue === 'string' ? errorValue : JSON.stringify(errorValue, null, 2))}</pre>`))
      : ''}

    ${toolCalls.length > 0 ? Card('Tool Calls', renderToolCalls(toolCalls)) : ''}

    ${steps.length > 1 ? Card('Steps', renderSteps(steps)) : ''}
  `
}

const LiveView: ViewFn = (entry) => {
  const c = entry.content as Record<string, unknown>
  const kind = String(c['kind'] ?? '')

  const baseRows: Record<string, unknown> = {
    Kind:     Badge(kind),
    Document: c['docName'] != null ? raw(`<span class="font-mono text-xs">${escape(c['docName'] as string)}</span>`) : raw('<span class="text-gray-300 dark:text-gray-600">—</span>'),
  }
  if (c['clientId']) {
    baseRows['Client'] = raw(`<a href="../live/${escape(c['clientId'] as string)}" class="font-mono text-xs text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300">${escape((c['clientId'] as string).slice(0, 12))}…</a>`)
  }

  switch (kind) {
    case 'doc.opened':
    case 'doc.closed':
      baseRows['Clients']  = c['clientCount']
      break
    case 'update.applied':
      baseRows['Bytes']         = `${c['byteSize']} bytes`
      baseRows['Recipients']    = c['recipientCount']
      break
    case 'awareness.changed':
      baseRows['Bytes']         = `${c['byteSize']} bytes`
      break
    case 'persistence.load':
      baseRows['Duration']      = `${c['durationMs']}ms`
      baseRows['Bytes']         = `${c['byteSize']} bytes`
      break
    case 'persistence.save':
      baseRows['Bytes']         = `${c['byteSize']} bytes`
      break
    case 'sync.error':
      baseRows['Error']         = c['error']
      break
  }

  return html`
    ${Card(null, KeyValueTable(baseRows))}
  `
}

const McpView: ViewFn = (entry) => {
  const c = entry.content as Record<string, unknown>
  const kind = String(c['kind'] ?? '')
  const subject = kind.split('.')[0] ?? ''
  const errored = Boolean(c['error'])

  const rows: Record<string, unknown> = {
    Server:   c['serverName'],
    Type:     Badge(subject),
    Name:     raw(`<span class="font-mono text-xs">${escape(String(c['name'] ?? ''))}</span>`),
    Duration: c['duration'] != null ? `${Math.round(c['duration'] as number)}ms` : '—',
    Status:   errored ? Badge('Failed') : Badge('OK'),
  }

  return html`
    ${Card('MCP Operation', KeyValueTable(rows))}
    ${c['input'] !== undefined && c['input'] !== null
      ? Card('Input', JsonBlock(c['input']))
      : raw('')}
    ${c['output'] !== undefined && c['output'] !== null && !errored
      ? Card('Output', JsonBlock(c['output']))
      : raw('')}
    ${errored ? Card('Error', CodeBlock(String(c['error']))) : raw('')}
  `
}

const ViewRenderView: ViewFn = (entry) => {
  const c = entry.content as Record<string, unknown>
  const propsVal = c['props']
  const propKeys = (c['propKeys'] as string[] | undefined) ?? []

  return html`
    ${Card(null, KeyValueTable({
      'View ID':    raw(`<span class="font-mono text-xs">${escape(c['id'] as string ?? '')}</span>`),
      Request:      raw(`<span class="font-mono text-xs">${escape(String(c['method'] ?? ''))} ${escape(String(c['path'] ?? ''))}</span>`),
      Status:       c['status'] != null ? Badge(String(c['status'])) : '—',
      Duration:     c['duration'] != null ? `${c['duration']}ms` : '—',
      'Prop Count': propKeys.length,
      'Props Size': c['propsSize'] != null ? `${c['propsSize']} bytes` : '—',
    }))}
    ${propKeys.length > 0
      ? Card('Prop Names', raw(propKeys.map(k => `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 font-mono">${escape(k)}</span>`).join(' ')))
      : ''}
    ${propsVal !== undefined && propsVal !== null
      ? Card('Props', JsonBlock(propsVal))
      : ''}
  `
}

/** Map of EntryType → detail view function. Used by the dispatcher. */
export const detailViews: Record<string, ViewFn> = {
  request:      RequestView,
  query:        QueryView,
  exception:    ExceptionView,
  mail:         MailView,
  job:          JobView,
  log:          LogView,
  notification: NotificationView,
  event:        EventView,
  cache:        CacheView,
  schedule:     ScheduleView,
  model:        ModelView,
  command:      CommandView,
  http:         HttpView,
  gate:         GateView,
  dump:         DumpView,
  broadcast:    BroadcastView,
  live:         LiveView,
  ai:           AiView,
  mcp:          McpView,
  view:         ViewRenderView,
}

/** Internal escape helper — used inside `raw()` blocks for safety. */
function escape(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
