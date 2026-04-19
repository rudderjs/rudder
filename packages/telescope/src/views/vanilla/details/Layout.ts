import { Layout as BaseLayout } from '../Layout.js'
import { html, raw, type SafeString } from '../_html.js'
import { Card, Badge, Tabs } from './sections.js'
import type { TelescopeEntry } from '../../../types.js'

export interface DetailLayoutProps {
  basePath:    string
  /** URL segment for this watcher (e.g. `requests`, `mail`, `cache`) */
  pageKey:     string
  /** Display title — usually the watcher type pluralised */
  pageTitle:   string
  entry:       TelescopeEntry
  /** Pre-rendered detail body — must be a `SafeString` */
  body:        SafeString
  /** Related entries from the same batch (if any) */
  relatedEntries?: TelescopeEntry[] | undefined
}

/**
 * Shared chrome for every per-watcher detail page. Wraps the existing
 * sidebar Layout and adds a back link, entry header (id, type, age, tags),
 * watcher-specific body, and inline related entries from the same batch.
 */
export function DetailLayout(props: DetailLayoutProps): string {
  const { basePath, pageKey, pageTitle, entry, body, relatedEntries } = props

  const ageText = formatAge(new Date(entry.createdAt))
  const tagPills = entry.tags.length > 0
    ? html`<div class="flex flex-wrap gap-1 mt-2">
        ${entry.tags.map((tag: string) => html`<a href="${basePath}/${pageKey}?tag=${tag}" @click.prevent="$dispatch('telescope:navigate', '${basePath}/${pageKey}?tag=${tag}')" class="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700">${tag}</a>`)}
      </div>`
    : ''

  const batchLink = entry.batchId
    ? html`<a href="${basePath}/batches/${entry.batchId}" @click.prevent="$dispatch('telescope:navigate', '${basePath}/batches/${entry.batchId}')" class="inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 ml-3">
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
        View all related entries
      </a>`
    : ''

  const headerHtml = html`
    <div class="mb-6">
      <a href="${basePath}/${pageKey}" @click.prevent="$dispatch('telescope:navigate', '${basePath}/${pageKey}')" class="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 mb-3">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"/></svg>
        Back to ${pageTitle}
      </a>
      <div class="flex items-baseline justify-between">
        <h2 class="text-xl font-bold">${pageTitle.replace(/s$/, '')} Detail</h2>
        <div class="text-xs text-gray-500 dark:text-gray-400">
          <span class="font-mono">${entry.id}</span>
          <span class="mx-2">·</span>
          <span>${ageText}</span>
          ${batchLink}
        </div>
      </div>
      ${tagPills}
    </div>
  `

  // Render inline related entries grouped by type
  const relatedHtml = renderRelatedEntries(relatedEntries ?? [], basePath, entry)

  const fullBody = html`${headerHtml}${body}${relatedHtml}`.toString()

  return BaseLayout({
    title:      `${pageTitle.replace(/s$/, '')} ${entry.id.slice(0, 8)}`,
    body:       fullBody,
    basePath,
    activePath: `/${pageKey}`,
  })
}

// ─── Related Entries ──────────────────────────────────────

function renderRelatedEntries(
  entries: TelescopeEntry[],
  basePath: string,
  parentEntry: TelescopeEntry,
): SafeString {
  if (entries.length === 0) return html``

  // Group by type
  const groups = new Map<string, TelescopeEntry[]>()
  for (const e of entries) {
    const list = groups.get(e.type) ?? []
    list.push(e)
    groups.set(e.type, list)
  }

  // Sort entries within each group chronologically
  for (const list of groups.values()) {
    list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  }

  // Render each group as a tab (Laravel-style Related Entries tab block)
  const parentTime = new Date(parentEntry.createdAt).getTime()

  const tabs = [...groups.entries()].map(([type, list]) => {
    const label = `${typeLabel(type)} (${list.length})`
    const rows = list.map(e => {
      const c = e.content as Record<string, unknown>
      const summary = entrySummary(type, c)
      const detailUrl = `${basePath}/${pluralUrlSegment(type)}/${e.id}`
      const offsetMs = new Date(e.createdAt).getTime() - parentTime
      const durationText = c['duration'] != null ? `${c['duration']}ms` : ''

      return html`
        <tr class="hover:bg-gray-50 dark:hover:bg-gray-800">
          <td class="px-4 py-2 text-right text-xs text-gray-400 dark:text-gray-500 font-mono w-16">${offsetMs >= 0 ? '+' : ''}${offsetMs}ms</td>
          <td class="px-4 py-2 text-sm break-all">
            <a href="${detailUrl}" @click.prevent="$dispatch('telescope:navigate', '${detailUrl}')" class="text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300">${summary}</a>
          </td>
          <td class="px-4 py-2 text-right text-xs text-gray-400 dark:text-gray-500 font-mono">${durationText}</td>
        </tr>
      `
    })

    const content = html`
      <table class="w-full -m-5">
        <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
          ${rows}
        </tbody>
      </table>
    `
    return { label, content }
  })

  return html`
    <div class="mt-6">
      <h3 class="text-sm uppercase tracking-wide font-medium text-gray-500 dark:text-gray-400 mb-3">Related Entries</h3>
      ${Tabs(tabs)}
    </div>
  `
}

function typeLabel(type: string): string {
  const labels: Record<string, string> = {
    request: 'Requests', query: 'Queries', job: 'Jobs', exception: 'Exceptions',
    log: 'Logs', mail: 'Mail', notification: 'Notifications', event: 'Events',
    cache: 'Cache', schedule: 'Scheduled Tasks', model: 'Model Changes',
    command: 'Commands', http: 'HTTP Client', gate: 'Gates', dump: 'Dumps',
    broadcast: 'WebSockets', live: 'Live (Yjs)', view: 'Views',
  }
  return labels[type] ?? type
}

function pluralUrlSegment(type: string): string {
  if (type === 'mail' || type === 'cache' || type === 'schedule' || type === 'http') return type
  if (type === 'query') return 'queries'
  if (type === 'view') return 'views'
  return `${type}s`
}

function entrySummary(type: string, c: Record<string, unknown>): string {
  switch (type) {
    case 'request':      return `${c['method'] ?? ''} ${c['path'] ?? ''}`
    case 'query':        return String(c['sql'] ?? '').slice(0, 120)
    case 'job':          return String(c['class'] ?? '')
    case 'exception':    return `${c['class'] ?? ''}: ${c['message'] ?? ''}`
    case 'log':          return `[${c['level'] ?? ''}] ${String(c['message'] ?? '').slice(0, 100)}`
    case 'mail':         return String(c['subject'] ?? '')
    case 'notification': return String(c['class'] ?? '')
    case 'event':        return String(c['name'] ?? '')
    case 'cache':        return `${c['operation'] ?? ''} ${c['key'] ?? ''}`
    case 'schedule':     return String(c['description'] ?? '')
    case 'model':        return `${c['action'] ?? ''} ${c['model'] ?? ''}`
    case 'command':      return `${c['name'] ?? ''} (exit ${c['exitCode'] ?? '?'})`
    case 'http':         return `${c['method'] ?? ''} ${c['url'] ?? ''}`
    case 'gate':         return `${c['ability'] ?? ''} → ${c['allowed'] ? 'allowed' : 'denied'}`
    case 'dump':         return `${c['method'] ?? ''}(${c['count'] ?? 0} args)`
    case 'broadcast':    return `${c['kind'] ?? ''}${c['channel'] ? ' ' + c['channel'] : ''}`
    case 'live':         return `${c['kind'] ?? ''}${c['docName'] ? ' ' + c['docName'] : ''}`
    case 'view':         return `${c['id'] ?? ''} (${Array.isArray(c['propKeys']) ? (c['propKeys'] as unknown[]).length : 0} props)`
    default:             return ''
  }
}

function formatAge(date: Date): string {
  const s = Math.floor((Date.now() - date.getTime()) / 1000)
  const relative = s < 60 ? `${s}s ago`
    : s < 3600  ? `${Math.floor(s / 60)}m ago`
    : s < 86400 ? `${Math.floor(s / 3600)}h ago`
    : `${Math.floor(s / 86400)}d ago`

  return `${formatFullDate(date)} (${relative})`
}

function formatFullDate(date: Date): string {
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December']
  const month = months[date.getMonth()]
  const day = date.getDate()
  const year = date.getFullYear()
  const suffix = day === 1 || day === 21 || day === 31 ? 'st'
    : day === 2 || day === 22 ? 'nd'
    : day === 3 || day === 23 ? 'rd' : 'th'
  const h = date.getHours()
  const m = date.getMinutes().toString().padStart(2, '0')
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${month} ${day}${suffix} ${year}, ${h12}:${m} ${ampm}`
}
