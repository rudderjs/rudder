import { Layout } from './Layout.js'

export interface Column {
  label:      string
  /** Alpine.js expression evaluated against the row variable `entry` */
  key:        string
  badge?:     boolean
  mono?:      boolean
  className?: string
}

export interface EntryListProps {
  basePath:  string
  apiPrefix: string
  /** Entry type — used in the API path. Special-cased: `query` → `/queries`. */
  type:      string
  /** URL segment used in the detail-page links. Same as the page key in `columns.ts`. */
  pageKey:   string
  title:     string
  columns:   Column[]
}

/**
 * Generic master/list page for any watcher type. Renders a table with
 * search + tag filter + pagination. Each row links to the detail page
 * at `/{basePath}/{pageKey}/{id}`.
 *
 * Phase 2a removed the inline JSON-dump modal in favour of dedicated
 * detail pages per watcher (see `details/views.ts`).
 * Phase 2b added the `?tag=` filter and tag pill column.
 */
export function EntryList(props: EntryListProps): string {
  const { basePath, apiPrefix, type, pageKey, title, columns } = props

  const colHeaders = columns.map(c => {
    const align = c.className?.includes('text-right') ? 'text-right' : 'text-left'
    return `<th class="px-4 py-3 ${align} text-xs uppercase font-medium text-gray-500">${c.label}</th>`
  }).join('\n              ')

  const colCells = columns.map(c => {
    if (c.badge) {
      return `<td class="px-4 py-3"><span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium" :class="badgeClass(${c.key})" x-text="${c.key}"></span></td>`
    }
    if (c.mono) {
      return `<td class="px-4 py-3 font-mono text-xs ${c.className ?? ''}" x-text="${c.key}"></td>`
    }
    return `<td class="px-4 py-3 ${c.className ?? ''}" x-text="${c.key}"></td>`
  }).join('\n                ')

  const activePath = `/${pageKey}`
  const apiPath    = type === 'query' ? 'queries' : `${type}s`

  const body = `
    <div x-data="entryList()" x-init="load()" x-cloak>
      <div class="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <h2 class="text-xl font-bold">${title}</h2>
        <div class="flex gap-2 items-center">
          <button @click="toggleAutoRefresh()" :title="autoRefresh ? 'Auto-refresh on (click to disable)' : 'Auto-refresh off (click to enable)'"
                  class="text-xs border rounded-lg px-3 py-1.5 transition flex items-center gap-1.5"
                  :class="autoRefresh ? 'border-green-300 bg-green-50 text-green-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'">
            <span class="w-2 h-2 rounded-full" :class="autoRefresh ? 'bg-green-500 animate-pulse' : 'bg-gray-400'"></span>
            <span x-text="autoRefresh ? 'Live' : 'Live'"></span>
          </button>
          <input type="text" x-model="search" @input.debounce.300ms="load()"
                 placeholder="Search..." class="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none">
        </div>
      </div>

      <!-- Active tag filter pill -->
      <div x-show="tag" class="mb-3 flex items-center gap-2 text-sm">
        <span class="text-gray-500">Filtering by tag:</span>
        <a :href="window.location.pathname" @click.prevent="tag = ''; load()" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 hover:bg-indigo-100">
          <span x-text="tag"></span>
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </a>
      </div>

      <div class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 border-b border-gray-200">
            <tr>
              ${colHeaders}
              <th class="px-4 py-3 text-left text-xs uppercase font-medium text-gray-500">Tags</th>
              <th class="px-4 py-3 text-right text-xs uppercase font-medium text-gray-500">Time</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <template x-for="entry in entries" :key="entry.id">
              <tr class="hover:bg-gray-50 cursor-pointer" @click="goTo(entry.id)">
                ${colCells}
                <td class="px-4 py-3">
                  <template x-for="t in (entry.tags || []).slice(0, 3)" :key="t">
                    <a :href="window.location.pathname + '?tag=' + encodeURIComponent(t)" @click.stop.prevent="tag = t; page = 1; load()" class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-gray-100 text-gray-600 hover:bg-gray-200 mr-1">
                      <span x-text="t"></span>
                    </a>
                  </template>
                  <span x-show="(entry.tags || []).length > 3" class="text-xs text-gray-400" x-text="'+' + ((entry.tags || []).length - 3)"></span>
                </td>
                <td class="px-4 py-3 text-right text-gray-400 text-xs" x-text="ago(entry.createdAt)"></td>
              </tr>
            </template>
            <tr x-show="entries.length === 0">
              <td colspan="${columns.length + 2}" class="px-4 py-12 text-center text-gray-400">No entries found.</td>
            </tr>
          </tbody>
        </table>

        <!-- Pagination -->
        <div class="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50 text-sm">
          <span class="text-gray-500">Total: <span x-text="meta.total"></span></span>
          <div class="flex gap-1">
            <button @click="page > 1 && (page--, load())" :disabled="page <= 1"
                    class="px-3 py-1 border rounded text-xs disabled:opacity-30">Prev</button>
            <span class="px-3 py-1 text-gray-500" x-text="'Page ' + page + ' of ' + meta.last_page"></span>
            <button @click="page < meta.last_page && (page++, load())" :disabled="page >= meta.last_page"
                    class="px-3 py-1 border rounded text-xs disabled:opacity-30">Next</button>
          </div>
        </div>
      </div>
    </div>

    <script>
      function entryList() {
        return {
          entries: [],
          meta: { total: 0, last_page: 1 },
          page: 1,
          search: '',
          tag: new URLSearchParams(window.location.search).get('tag') || '',
          autoRefresh: localStorage.getItem('telescope.autoRefresh') === 'true',
          _refreshTimer: null,

          init() {
            if (this.autoRefresh) this.startAutoRefresh()
          },

          async load() {
            const params = new URLSearchParams({ page: this.page, per_page: 50 })
            if (this.search) params.set('search', this.search)
            if (this.tag)    params.set('tag', this.tag)
            const data = await fetch('${apiPrefix}/${apiPath}?' + params).then(r => r.json())
            this.entries = data.data || []
            this.meta = data.meta || { total: 0, last_page: 1 }
          },

          toggleAutoRefresh() {
            this.autoRefresh = !this.autoRefresh
            localStorage.setItem('telescope.autoRefresh', String(this.autoRefresh))
            if (this.autoRefresh) this.startAutoRefresh()
            else                  this.stopAutoRefresh()
          },

          startAutoRefresh() {
            if (this._refreshTimer) return
            this._refreshTimer = setInterval(() => this.load(), 2000)
          },

          stopAutoRefresh() {
            if (this._refreshTimer) {
              clearInterval(this._refreshTimer)
              this._refreshTimer = null
            }
          },

          goTo(id) {
            window.dispatchEvent(new CustomEvent('telescope:navigate', { detail: '${basePath}/${pageKey}/' + id }))
          },

          badgeClass(value) {
            const colors = {
              GET: 'bg-green-100 text-green-700', POST: 'bg-blue-100 text-blue-700',
              PUT: 'bg-amber-100 text-amber-700', DELETE: 'bg-red-100 text-red-700',
              PATCH: 'bg-purple-100 text-purple-700',
              error: 'bg-red-100 text-red-700', warning: 'bg-amber-100 text-amber-700',
              info: 'bg-blue-100 text-blue-700', debug: 'bg-gray-100 text-gray-700',
              dispatched: 'bg-blue-100 text-blue-700', failed: 'bg-red-100 text-red-700',
              hit: 'bg-green-100 text-green-700', miss: 'bg-red-100 text-red-700',
              set: 'bg-blue-100 text-blue-700', forget: 'bg-gray-100 text-gray-700',
              created: 'bg-green-100 text-green-700', updated: 'bg-blue-100 text-blue-700',
              deleted: 'bg-red-100 text-red-700',
            }
            return colors[value] || 'bg-gray-100 text-gray-600'
          },

          ago(dateStr) {
            const s = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
            if (s < 60) return s + 's ago'
            if (s < 3600) return Math.floor(s / 60) + 'm ago'
            if (s < 86400) return Math.floor(s / 3600) + 'h ago'
            return Math.floor(s / 86400) + 'd ago'
          }
        }
      }
    </script>`

  return Layout({ title, body, basePath, activePath })
}
