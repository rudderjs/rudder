import { layout } from './layout.js'

// ─── Dashboard ─────────────────────────────────────────────

export function dashboardPage(basePath: string, apiPrefix: string): string {
  return layout('Dashboard', `
    <div x-data="dashboard()" x-init="load()" x-cloak>
      <h2 class="text-xl font-bold mb-6">Dashboard</h2>
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <template x-for="[type, count] of Object.entries(counts)" :key="type">
          <a :href="'${basePath}/' + (type === 'query' ? 'queries' : type + 's')"
             class="bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:shadow-md transition">
            <div class="text-2xl font-bold" x-text="count"></div>
            <div class="text-sm text-gray-500 capitalize" x-text="type + 's'"></div>
          </a>
        </template>
      </div>
    </div>
    <script>
      function dashboard() {
        return {
          counts: {},
          async load() {
            const data = await fetch('${apiPrefix}/overview').then(r => r.json())
            this.counts = data.counts || {}
          }
        }
      }
    </script>`, basePath, '/')
}

// ─── Generic Entry List Page ───────────────────────────────

export function entryListPage(
  basePath: string,
  apiPrefix: string,
  type: string,
  title: string,
  columns: Column[],
): string {
  const colHeaders = columns.map(c =>
    `<th class="px-4 py-3 text-left text-xs uppercase font-medium text-gray-500">${c.label}</th>`
  ).join('\n              ')

  const colCells = columns.map(c => {
    if (c.badge) {
      return `<td class="px-4 py-3"><span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium" :class="badgeClass(${c.key})" x-text="${c.key}"></span></td>`
    }
    if (c.mono) {
      return `<td class="px-4 py-3 font-mono text-xs ${c.className ?? ''}" x-text="${c.key}"></td>`
    }
    return `<td class="px-4 py-3 ${c.className ?? ''}" x-text="${c.key}"></td>`
  }).join('\n                ')

  const activePath = type === 'query' ? '/queries' : `/${type}s`

  return layout(title, `
    <div x-data="entryList()" x-init="load()" x-cloak>
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-xl font-bold">${title}</h2>
        <div class="flex gap-2">
          <input type="text" x-model="search" @input.debounce.300ms="load()"
                 placeholder="Search..." class="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none">
        </div>
      </div>

      <div class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 border-b border-gray-200">
            <tr>
              ${colHeaders}
              <th class="px-4 py-3 text-right text-xs uppercase font-medium text-gray-500">Time</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <template x-for="entry in entries" :key="entry.id">
              <tr class="hover:bg-gray-50 cursor-pointer" @click="selected = entry">
                ${colCells}
                <td class="px-4 py-3 text-right text-gray-400 text-xs" x-text="ago(entry.createdAt)"></td>
              </tr>
            </template>
            <tr x-show="entries.length === 0">
              <td colspan="${columns.length + 1}" class="px-4 py-12 text-center text-gray-400">No entries found.</td>
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

      <!-- Detail Modal -->
      <div x-show="selected" @click.self="selected = null" x-transition
           class="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-8">
        <div class="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-auto" @click.stop>
          <div class="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <h3 class="font-semibold">Entry Detail</h3>
            <button @click="selected = null" class="text-gray-400 hover:text-gray-600">&times;</button>
          </div>
          <div class="px-6 py-4">
            <pre class="text-xs bg-gray-50 rounded-lg p-4 overflow-auto" x-text="JSON.stringify(selected?.content, null, 2)"></pre>
            <div class="mt-3 flex flex-wrap gap-1">
              <template x-for="tag in (selected?.tags || [])" :key="tag">
                <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600" x-text="tag"></span>
              </template>
            </div>
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
          selected: null,

          async load() {
            const params = new URLSearchParams({ page: this.page, per_page: 50 })
            if (this.search) params.set('search', this.search)
            const data = await fetch('${apiPrefix}/${type === 'query' ? 'queries' : type + 's'}?' + params).then(r => r.json())
            this.entries = data.data || []
            this.meta = data.meta || { total: 0, last_page: 1 }
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
    </script>`, basePath, activePath)
}

// ─── Column definition ─────────────────────────────────────

export interface Column {
  label:      string
  key:        string      // Alpine.js expression
  badge?:     boolean
  mono?:      boolean
  className?: string
}

// ─── Page definitions for each entry type ──────────────────

export function requestsPage(basePath: string, api: string): string {
  return entryListPage(basePath, api, 'request', 'Requests', [
    { label: 'Method',   key: 'entry.content.method', badge: true },
    { label: 'Path',     key: 'entry.content.path',   mono: true },
    { label: 'Duration', key: 'entry.content.duration + "ms"', className: 'text-right' },
  ])
}

export function queriesPage(basePath: string, api: string): string {
  return entryListPage(basePath, api, 'query', 'Queries', [
    { label: 'SQL',      key: 'entry.content.sql',      mono: true, className: 'truncate max-w-md' },
    { label: 'Duration', key: 'entry.content.duration + "ms"', className: 'text-right' },
    { label: 'Model',    key: 'entry.content.model || "—"' },
  ])
}

export function jobsPage(basePath: string, api: string): string {
  return entryListPage(basePath, api, 'job', 'Jobs', [
    { label: 'Class',    key: 'entry.content.class',  mono: true },
    { label: 'Queue',    key: 'entry.content.queue' },
    { label: 'Status',   key: 'entry.content.status', badge: true },
    { label: 'Duration', key: '(entry.content.duration || 0) + "ms"', className: 'text-right' },
  ])
}

export function exceptionsPage(basePath: string, api: string): string {
  return entryListPage(basePath, api, 'exception', 'Exceptions', [
    { label: 'Class',   key: 'entry.content.class',   mono: true, className: 'text-red-600' },
    { label: 'Message', key: 'entry.content.message',  className: 'truncate max-w-md' },
  ])
}

export function logsPage(basePath: string, api: string): string {
  return entryListPage(basePath, api, 'log', 'Logs', [
    { label: 'Level',   key: 'entry.content.level',   badge: true },
    { label: 'Channel', key: 'entry.content.channel' },
    { label: 'Message', key: 'entry.content.message',  className: 'truncate max-w-lg' },
  ])
}

export function mailPage(basePath: string, api: string): string {
  return entryListPage(basePath, api, 'mail', 'Mail', [
    { label: 'Class',   key: 'entry.content.class',   mono: true },
    { label: 'Subject', key: 'entry.content.subject',  className: 'truncate max-w-md' },
    { label: 'To',      key: 'Array.isArray(entry.content.to) ? entry.content.to.join(", ") : entry.content.to' },
  ])
}

export function notificationsPage(basePath: string, api: string): string {
  return entryListPage(basePath, api, 'notification', 'Notifications', [
    { label: 'Class',      key: 'entry.content.class',   mono: true },
    { label: 'Channel',    key: 'entry.content.channel' },
    { label: 'Notifiable', key: 'entry.content.notifiable' },
  ])
}

export function eventsPage(basePath: string, api: string): string {
  return entryListPage(basePath, api, 'event', 'Events', [
    { label: 'Name', key: 'entry.content.name', mono: true },
  ])
}

export function cachePage(basePath: string, api: string): string {
  return entryListPage(basePath, api, 'cache', 'Cache', [
    { label: 'Key',       key: 'entry.content.key || "—"', mono: true, className: 'truncate max-w-md' },
    { label: 'Operation', key: 'entry.content.operation', badge: true },
  ])
}

export function schedulePage(basePath: string, api: string): string {
  return entryListPage(basePath, api, 'schedule', 'Scheduled Tasks', [
    { label: 'Description', key: 'entry.content.description' },
    { label: 'Expression',  key: 'entry.content.expression', mono: true },
    { label: 'Status',      key: 'entry.content.status', badge: true },
    { label: 'Duration',    key: '(entry.content.duration || 0) + "ms"', className: 'text-right' },
  ])
}

export function modelsPage(basePath: string, api: string): string {
  return entryListPage(basePath, api, 'model', 'Model Changes', [
    { label: 'Model',  key: 'entry.content.model',  mono: true },
    { label: 'Action', key: 'entry.content.action', badge: true },
  ])
}
