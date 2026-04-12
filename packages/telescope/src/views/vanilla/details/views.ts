import { html, raw, type SafeString } from '../_html.js'
import { Card, KeyValueTable, JsonBlock, CodeBlock, Badge } from './sections.js'
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
  const headers   = c['headers']   as Record<string, string> | undefined
  const body      = c['body']
  const response  = c['response']  as Record<string, unknown> | undefined
  const respBody  = response?.['body']
  const respHeaders = response?.['headers'] as Record<string, string> | undefined

  return html`
    ${Card(null, KeyValueTable({
      Method:    Badge(c['method'] as string),
      Path:      raw(`<span class="font-mono text-xs">${escape(c['path'] as string)}</span>`),
      Status:    Badge(String(response?.['status'] ?? '')),
      Duration:  c['duration'] != null ? `${c['duration']}ms` : '—',
      IP:        c['ip'],
      'User-Agent': c['userAgent'],
    }))}

    ${headers ? Card('Request Headers', KeyValueTable(headers)) : ''}
    ${body !== undefined && body !== null && body !== '' ? Card('Request Body', JsonBlock(body)) : ''}
    ${respHeaders ? Card('Response Headers', KeyValueTable(respHeaders)) : ''}
    ${respBody !== undefined && respBody !== null && respBody !== '' ? Card('Response Body', JsonBlock(respBody)) : ''}
  `
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
      Class:   raw(`<span class="font-mono text-xs text-red-600">${escape(c['class'] as string ?? '')}</span>`),
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

  return html`
    ${Card(null, KeyValueTable({
      Class:   raw(`<span class="font-mono text-xs">${escape(c['class'] as string ?? '')}</span>`),
      Subject: c['subject'],
      From:    c['from'],
      To:      to,
      CC:      Array.isArray(c['cc']) ? (c['cc'] as string[]).join(', ') : c['cc'],
      BCC:     Array.isArray(c['bcc']) ? (c['bcc'] as string[]).join(', ') : c['bcc'],
    }))}
    ${htmlBody ? Card('HTML Preview', html`
      <iframe srcdoc="${String(htmlBody)}" class="w-full h-96 bg-white border border-gray-200 rounded-lg" sandbox=""></iframe>
    `) : ''}
    ${textBody ? Card('Plain Text', CodeBlock(String(textBody))) : ''}
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
