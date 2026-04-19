import { html, raw, SafeString } from '../_html.js'

/**
 * Reusable detail-page sections. Composed by per-watcher views in `views.ts`
 * to keep each detail view small and consistent.
 */

/**
 * Card wrapper used to group a section of a detail page. Title is optional —
 * omit it for sections where the content is self-explanatory.
 */
export function Card(title: string | null, body: SafeString | string): SafeString {
  const titleHtml = title ? html`<h3 class="text-xs uppercase tracking-wide font-medium text-gray-500 dark:text-gray-400 mb-3">${title}</h3>` : ''
  return html`
    <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm p-5 mb-4">
      ${titleHtml}
      ${typeof body === 'string' ? body : body}
    </div>
  `
}

/**
 * Two-column key/value table. `null`/`undefined` values are rendered as `—`.
 * String values are HTML-escaped automatically by `html\`\``.
 */
export function KeyValueTable(rows: Record<string, unknown>): SafeString {
  const entries = Object.entries(rows)
  if (entries.length === 0) return html`<p class="text-sm text-gray-400 dark:text-gray-500">No data.</p>`

  return html`
    <table class="w-full text-sm">
      <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
        ${entries.map(([k, v]) => html`
          <tr>
            <td class="py-2 pr-4 text-gray-500 dark:text-gray-400 font-medium align-top w-40">${k}</td>
            <td class="py-2 break-all">${formatValue(v)}</td>
          </tr>
        `)}
      </tbody>
    </table>
  `
}

function formatValue(v: unknown): SafeString | string {
  if (v === null || v === undefined || v === '') return raw('<span class="text-gray-300 dark:text-gray-600">—</span>')
  if (v instanceof SafeString) return v
  if (typeof v === 'boolean') return raw(`<span class="font-mono text-xs">${v}</span>`)
  if (typeof v === 'number')  return raw(`<span class="font-mono text-xs">${v}</span>`)
  if (typeof v === 'object')  return JsonBlock(v)
  return String(v)
}

/**
 * Formatted JSON block in a `<pre>`. Used for arbitrary nested values
 * (request bodies, payloads, dirty attribute diffs, etc.).
 */
export function JsonBlock(value: unknown): SafeString {
  let json: string
  try {
    json = JSON.stringify(value, null, 2)
  } catch {
    json = String(value)
  }
  return html`<pre class="text-xs bg-gray-50 dark:bg-gray-800 rounded-lg p-3 overflow-auto max-h-96 font-mono">${json}</pre>`
}

/**
 * Code block — like JsonBlock but for arbitrary text (SQL, stack traces,
 * log messages). No JSON formatting.
 */
export function CodeBlock(text: string, opts: { language?: string; maxHeight?: string } = {}): SafeString {
  const cls = opts.maxHeight ? `max-h-${opts.maxHeight}` : 'max-h-96'
  const langCls = opts.language ? ` language-${opts.language}` : ''
  return html`<pre class="text-xs bg-gray-50 dark:bg-gray-800 rounded-lg p-3 overflow-auto ${cls} font-mono${langCls}">${text}</pre>`
}

/**
 * Coloured pill matching the badge style used in EntryList.
 * The colour palette mirrors `EntryList.ts`'s `badgeClass()` function.
 */
export function Badge(value: string | undefined): SafeString {
  if (!value) return html`<span class="text-gray-300 dark:text-gray-600">—</span>`
  // HTTP status codes — range-based coloring (2xx/3xx/4xx/5xx)
  const n = Number(value)
  if (Number.isInteger(n) && n >= 100 && n < 600) {
    const cls = n >= 500 ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
      : n >= 400 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
      : n >= 300 ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400'
      : n >= 200 ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
      : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
    return html`<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}">${value}</span>`
  }
  const colors: Record<string, string> = {
    GET: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
    POST: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
    PUT: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
    DELETE: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
    PATCH: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400',
    error: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
    warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
    info: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
    debug: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    dispatched: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
    failed: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
    completed: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
    running: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
    hit: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
    miss: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
    set: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
    forget: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    created: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
    updated: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
    deleted: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
  }
  const cls = colors[value] ?? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
  return html`<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}">${value}</span>`
}

/**
 * Tabbed sections — uses Alpine.js `x-data` for tab switching.
 * Only renders tabs that have non-empty content.
 */
export function Tabs(tabs: { label: string; content: SafeString | string }[]): SafeString {
  const visible = tabs.filter(t => {
    const s = typeof t.content === 'string' ? t.content : t.content.toString()
    return s.trim().length > 0
  })
  if (visible.length === 0) return html``

  const id = `tabs_${Math.random().toString(36).slice(2, 8)}`
  return html`
    <div x-data="{ tab: '${visible[0]!.label}' }" class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm mb-4">
      <div class="flex border-b border-gray-200 dark:border-gray-800">
        ${visible.map(t => html`
          <button @click="tab = '${t.label}'"
            :class="tab === '${t.label}' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'"
            class="px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors">
            ${t.label}
          </button>
        `)}
      </div>
      ${visible.map(t => html`
        <div x-show="tab === '${t.label}'" class="p-5">${t.content}</div>
      `)}
    </div>
  `
}

/**
 * Get a content field with a fallback. Helper to keep view files terse.
 */
export function field(content: Record<string, unknown>, key: string): unknown {
  return content[key]
}
