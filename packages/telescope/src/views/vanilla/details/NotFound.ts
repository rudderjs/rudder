import { Layout } from '../Layout.js'
import { html } from '../_html.js'

export interface NotFoundProps {
  basePath: string
  /** What we were looking up — used in the message. */
  what:    string
  id:      string
}

export function NotFoundPage(props: NotFoundProps): string {
  const { basePath, what, id } = props
  const body = html`
    <div class="text-center py-20">
      <div class="inline-flex items-center justify-center w-12 h-12 bg-gray-100 rounded-full mb-4">
        <svg class="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
      </div>
      <h2 class="text-lg font-semibold text-gray-900 mb-1">${what} not found</h2>
      <p class="text-sm text-gray-500 mb-6">No entry with id <span class="font-mono">${id}</span> exists.</p>
      <a href="${basePath}" class="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"/></svg>
        Back to Dashboard
      </a>
    </div>
  `.toString()

  return Layout({ title: 'Not Found', body, basePath, activePath: '/' })
}
