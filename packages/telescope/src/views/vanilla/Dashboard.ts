import { Layout } from './Layout.js'

export interface DashboardProps {
  basePath:  string
  apiPrefix: string
}

/**
 * Dashboard landing page — count cards for each watcher type linking
 * through to the corresponding list page.
 */
export function Dashboard(props: DashboardProps): string {
  const { basePath, apiPrefix } = props

  const body = `
    <div x-data="dashboard()" x-init="load()" x-cloak>
      <h2 class="text-xl font-bold mb-6">Dashboard</h2>
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <template x-for="[type, count] of Object.entries(counts)" :key="type">
          <a :href="'${basePath}/' + typeUrl(type)"
             @click.prevent="$dispatch('telescope:navigate', '${basePath}/' + typeUrl(type))"
             class="bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:shadow-md transition group">
            <div class="text-2xl font-bold group-hover:text-indigo-600 transition-colors" x-text="count"></div>
            <div class="text-sm text-gray-500" x-text="typeLabel(type)"></div>
          </a>
        </template>
      </div>
    </div>
    <script>
      function dashboard() {
        const labels = {
          request: 'Requests', query: 'Queries', job: 'Jobs', exception: 'Exceptions',
          log: 'Logs', mail: 'Mail', notification: 'Notifications', event: 'Events',
          cache: 'Cache', schedule: 'Schedule', model: 'Models', command: 'Commands',
          http: 'HTTP Client', gate: 'Gates', dump: 'Dumps', broadcast: 'WebSockets',
          live: 'Live (Yjs)',
        }
        const urls = {
          query: 'queries', http: 'http', mail: 'mail', cache: 'cache', schedule: 'schedule',
        }
        return {
          counts: {},
          async load() {
            const data = await fetch('${apiPrefix}/overview').then(r => r.json())
            this.counts = data.counts || {}
          },
          typeLabel(type) { return labels[type] || (type.charAt(0).toUpperCase() + type.slice(1) + 's') },
          typeUrl(type) { return urls[type] || type + 's' },
        }
      }
    </script>`

  return Layout({ title: 'Dashboard', body, basePath, activePath: '/' })
}
