import { Layout as BaseLayout } from '../Layout.js'
import { html, type SafeString } from '../_html.js'
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
}

/**
 * Shared chrome for every per-watcher detail page. Wraps the existing
 * sidebar Layout and adds a back link, entry header (id, type, age, tags),
 * and slots in a watcher-specific body.
 */
export function DetailLayout(props: DetailLayoutProps): string {
  const { basePath, pageKey, pageTitle, entry, body } = props

  const ageText = formatAge(new Date(entry.createdAt))
  const tagPills = entry.tags.length > 0
    ? html`<div class="flex flex-wrap gap-1 mt-2">
        ${entry.tags.map((tag: string) => html`<a href="${basePath}/${pageKey}?tag=${tag}" class="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600 hover:bg-gray-200">${tag}</a>`)}
      </div>`
    : ''

  const batchLink = entry.batchId
    ? html`<a href="${basePath}/batches/${entry.batchId}" class="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 ml-3">
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
        View related entries
      </a>`
    : ''

  const headerHtml = html`
    <div class="mb-6">
      <a href="${basePath}/${pageKey}" class="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"/></svg>
        Back to ${pageTitle}
      </a>
      <div class="flex items-baseline justify-between">
        <h2 class="text-xl font-bold">${pageTitle.replace(/s$/, '')} Detail</h2>
        <div class="text-xs text-gray-500">
          <span class="font-mono">${entry.id}</span>
          <span class="mx-2">·</span>
          <span>${ageText}</span>
          ${batchLink}
        </div>
      </div>
      ${tagPills}
    </div>
  `

  const fullBody = html`${headerHtml}${body}`.toString()

  return BaseLayout({
    title:      `${pageTitle.replace(/s$/, '')} ${entry.id.slice(0, 8)}`,
    body:       fullBody,
    basePath,
    activePath: `/${pageKey}`,
  })
}

function formatAge(date: Date): string {
  const s = Math.floor((Date.now() - date.getTime()) / 1000)
  if (s < 60)    return `${s}s ago`
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
