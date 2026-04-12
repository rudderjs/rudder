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
          <a :href="'${basePath}/' + (type === 'query' ? 'queries' : type === 'http' ? 'http' : type + 's')"
             @click.prevent="$dispatch('telescope:navigate', '${basePath}/' + (type === 'query' ? 'queries' : type === 'http' ? 'http' : type + 's'))"
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
    </script>`

  return Layout({ title: 'Dashboard', body, basePath, activePath: '/' })
}
