import { Layout } from '../Layout.js'
import { html, raw } from '../_html.js'
import { Card, Badge } from './sections.js'
import type { TelescopeEntry } from '../../../types.js'

export interface BatchPageProps {
  basePath: string
  batchId:  string
  entries:  TelescopeEntry[]
}

/**
 * Batch view — lists every entry sharing one `batchId`. Typically a single
 * HTTP request and all the queries / cache lookups / events / model writes
 * it triggered. The framework's batch propagation through the request
 * lifecycle is what makes this useful.
 */
export function BatchPage(props: BatchPageProps): string {
  const { basePath, batchId, entries } = props

  const sorted = [...entries].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )

  // The first request entry (if any) is the entry-point
  const requestEntry = sorted.find(e => e.type === 'request')
  const counts: Record<string, number> = {}
  for (const e of sorted) counts[e.type] = (counts[e.type] ?? 0) + 1

  const summary = html`
    ${Card(null, html`
      <div class="flex items-center justify-between">
        <div>
          <div class="text-xs uppercase tracking-wide text-gray-500 mb-1">Batch</div>
          <div class="font-mono text-xs">${batchId}</div>
        </div>
        <div class="flex flex-wrap gap-2">
          ${Object.entries(counts).map(([type, count]) => html`
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 text-xs">
              <span class="font-medium">${count}</span>
              <span class="text-gray-500">${type}${count === 1 ? '' : 's'}</span>
            </span>
          `)}
        </div>
      </div>
      ${requestEntry ? html`
        <div class="mt-4 pt-4 border-t border-gray-100 text-sm">
          <div class="flex items-center gap-2">
            ${Badge(String((requestEntry.content as Record<string, unknown>)['method'] ?? ''))}
            <span class="font-mono text-xs">${String((requestEntry.content as Record<string, unknown>)['path'] ?? '')}</span>
          </div>
        </div>
      ` : ''}
    `)}
  `

  const tableRows = sorted.map(e => {
    const c = e.content as Record<string, unknown>
    const detailUrl = `${basePath}/${pluralUrlSegment(e.type)}/${e.id}`
    const summaryText = entrySummary(e.type, c)
    const offsetMs = requestEntry
      ? new Date(e.createdAt).getTime() - new Date(requestEntry.createdAt).getTime()
      : 0
    return html`
      <tr class="hover:bg-gray-50">
        <td class="px-4 py-2 text-right text-xs text-gray-400 font-mono w-16">+${offsetMs}ms</td>
        <td class="px-4 py-2 w-24">${Badge(e.type)}</td>
        <td class="px-4 py-2 text-sm break-all">${summaryText}</td>
        <td class="px-4 py-2 text-right">
          <a href="${detailUrl}" class="text-xs text-indigo-600 hover:text-indigo-700">View →</a>
        </td>
      </tr>
    `
  })

  const table = html`
    ${Card(null, html`
      <table class="w-full">
        <thead class="text-left">
          <tr class="text-xs uppercase tracking-wide text-gray-500 border-b border-gray-100">
            <th class="px-4 py-2 text-right">Offset</th>
            <th class="px-4 py-2">Type</th>
            <th class="px-4 py-2">Summary</th>
            <th class="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          ${tableRows}
        </tbody>
      </table>
    `)}
  `

  const backLink = html`
    <a href="${basePath}" class="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"/></svg>
      Back to Dashboard
    </a>
  `

  const body = html`
    ${backLink}
    <h2 class="text-xl font-bold mb-6">Batch Detail</h2>
    ${summary}
    ${table}
  `.toString()

  return Layout({ title: 'Batch', body, basePath, activePath: '/' })
}

function pluralUrlSegment(type: string): string {
  // Mirrors the URL segments declared in `columns.ts` `pages` map.
  if (type === 'mail' || type === 'cache' || type === 'schedule') return type
  if (type === 'query') return 'queries'
  return `${type}s`  // request → requests, command → commands, etc.
}

function entrySummary(type: string, c: Record<string, unknown>): string {
  switch (type) {
    case 'request':      return `${c['method'] ?? ''} ${c['path'] ?? ''}`
    case 'query':        return String(c['sql'] ?? '')
    case 'job':          return String(c['class'] ?? '')
    case 'exception':    return `${c['class'] ?? ''}: ${c['message'] ?? ''}`
    case 'log':          return `[${c['level'] ?? ''}] ${c['message'] ?? ''}`
    case 'mail':         return String(c['subject'] ?? '')
    case 'notification': return String(c['class'] ?? '')
    case 'event':        return String(c['name'] ?? '')
    case 'cache':        return `${c['operation'] ?? ''} ${c['key'] ?? ''}`
    case 'schedule':     return String(c['description'] ?? '')
    case 'model':        return `${c['action'] ?? ''} ${c['model'] ?? ''}`
    case 'command':      return `${c['name'] ?? ''} (exit ${c['exitCode'] ?? '?'})`
    case 'broadcast':    return `${c['kind'] ?? ''}${c['channel'] ? ' ' + c['channel'] : ''}${c['event'] ? ' → ' + c['event'] : ''}`
    default:             return ''
  }
}
