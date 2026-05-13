import { html, raw, type SafeString } from '../_html.js'
import { Card, KeyValueTable, JsonBlock, CodeBlock, Badge, Tabs } from './sections.js'
import { escape } from './format.js'
import { RequestView, HttpView } from './request-views.js'
import { AiView } from './ai-views.js'
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

const GateView: ViewFn = (entry) => {
  const c = entry.content as Record<string, unknown>
  const args = c['args'] as unknown[] | undefined
  const hasArgs = Array.isArray(args) && args.length > 0
  const rows: Record<string, unknown> = {
    Ability:        raw(`<span class="font-mono text-xs">${escape(c['ability'] as string ?? '')}</span>`),
    Result:         Badge(c['allowed'] ? 'Allowed' : 'Denied'),
    'Resolved Via': Badge(c['resolvedVia'] as string),
    'User ID':      c['userId'] ?? '—',
    Duration:       c['duration'] != null ? `${c['duration']}ms` : '—',
  }
  if (c['policy']) rows['Policy'] = c['policy']
  if (c['model'])  rows['Model']  = raw(`<span class="font-mono text-xs">${escape(c['model'] as string)}</span>`)
  return html`
    ${Card(null, KeyValueTable(rows))}
    ${hasArgs ? Card('Arguments', JsonBlock(args.length === 1 ? args[0] : args)) : ''}
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
    ${args ? args.map((arg, i) => Card(`Argument ${i + 1}`, JsonBlock(arg))) : ''}
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

