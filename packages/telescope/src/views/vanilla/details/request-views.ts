import { html, raw, type SafeString } from '../_html.js'
import { Card, KeyValueTable, JsonBlock, CodeBlock, Badge, Tabs } from './sections.js'
import { escape, formatTimestamp, formatBytes, statusColor } from './format.js'
import type { TelescopeEntry } from '../../../types.js'

/**
 * Per-watcher detail views for "request-shaped" entries — those that
 * render a payload-and-response surface around an HTTP status badge.
 *
 * Today: the `request` watcher (inbound) and the `http` watcher (outbound
 * HTTP client). Both share the status-badge / payload-tabs idiom; keeping
 * them in one file makes that family resemblance obvious.
 */

type ViewFn = (entry: TelescopeEntry) => SafeString

export const RequestView: ViewFn = (entry) => {
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

export const HttpView: ViewFn = (entry) => {
  const c = entry.content as Record<string, unknown>
  const reqHeaders  = c['reqHeaders']  as Record<string, string> | undefined
  const resHeaders  = c['resHeaders']  as Record<string, string> | undefined
  const reqBody     = c['reqBody']
  const resBody     = c['resBody']
  const isFailure   = c['kind'] === 'request.failed'

  const status = c['status'] as number | undefined
  const statusBadge = isFailure
    ? Badge('FAILED')
    : (status != null
        ? raw(`<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusColor(status)}">${status}</span>`)
        : Badge('—'))

  // Always show a Payload tab — matches the Request entry's behavior
  const hasReqBody = reqBody !== undefined && reqBody !== null && reqBody !== ''
                     && !(typeof reqBody === 'object' && Object.keys(reqBody as object).length === 0)
  const payloadContent = hasReqBody ? JsonBlock(reqBody) : JsonBlock([])

  const requestTabs = Tabs([
    { label: 'Payload', content: payloadContent },
    { label: 'Headers', content: reqHeaders && Object.keys(reqHeaders).length > 0
        ? JsonBlock(reqHeaders)
        : raw('<p class="text-sm text-gray-400 dark:text-gray-500">No request headers.</p>') },
  ])

  const hasResBody    = resBody !== undefined && resBody !== null && resBody !== ''
  const hasResHeaders = !!resHeaders && Object.keys(resHeaders).length > 0
  const responseBodyContent = hasResBody
    ? (typeof resBody === 'string' ? CodeBlock(resBody, { maxHeight: '[400px]' }) : JsonBlock(resBody))
    : ''
  const responseTabs = Tabs([
    ...(hasResBody    ? [{ label: 'Body',    content: responseBodyContent     }] : []),
    ...(hasResHeaders ? [{ label: 'Headers', content: JsonBlock(resHeaders!) }] : []),
  ])

  return html`
    ${Card(null, KeyValueTable({
      Method:      Badge(c['method'] as string),
      URL:         raw(`<span class="font-mono text-xs break-all">${escape(c['url'] as string ?? '')}</span>`),
      Status:      statusBadge,
      Duration:    c['duration'] != null ? `${c['duration']}ms` : '—',
      'Resp Size': c['resSize'] != null ? `${c['resSize']} bytes` : '—',
    }))}
    ${requestTabs}
    ${responseTabs}
    ${isFailure && c['error'] ? Card('Error', raw(`<div class="text-sm text-red-600 dark:text-red-400">${escape(c['error'] as string)}</div>`)) : ''}
  `
}
