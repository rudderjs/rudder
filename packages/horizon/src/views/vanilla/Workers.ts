import { Layout } from './Layout.js'

export interface WorkersProps {
  basePath:  string
  apiPrefix: string
}

export function Workers(props: WorkersProps): string {
  const { basePath, apiPrefix } = props

  const body = `
    <div x-data="workers()" x-init="load()" x-cloak>
      <h2 class="text-xl font-bold mb-6">Workers</h2>
      <div class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 border-b border-gray-200 text-xs uppercase text-gray-500">
            <tr>
              <th class="px-5 py-3 text-left">ID</th>
              <th class="px-5 py-3 text-left">Queue</th>
              <th class="px-5 py-3 text-left">Status</th>
              <th class="px-5 py-3 text-right">Jobs Run</th>
              <th class="px-5 py-3 text-right">Memory</th>
              <th class="px-5 py-3 text-right">Last Job</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <template x-for="w in data" :key="w.id">
              <tr class="hover:bg-gray-50">
                <td class="px-5 py-3 font-mono text-xs" x-text="w.id"></td>
                <td class="px-5 py-3" x-text="w.queue"></td>
                <td class="px-5 py-3">
                  <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                        :class="{active:'bg-green-100 text-green-700',idle:'bg-gray-100 text-gray-600',paused:'bg-amber-100 text-amber-700'}[w.status]"
                        x-text="w.status"></span>
                </td>
                <td class="px-5 py-3 text-right" x-text="w.jobsRun"></td>
                <td class="px-5 py-3 text-right" x-text="w.memoryMb + ' MB'"></td>
                <td class="px-5 py-3 text-right text-gray-400 text-xs" x-text="w.lastJobAt ? ago(w.lastJobAt) : '—'"></td>
              </tr>
            </template>
            <tr x-show="data.length === 0">
              <td colspan="6" class="px-5 py-12 text-center text-gray-400">No workers registered.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <script>
      function workers() {
        return {
          data: [],
          async load() {
            const res = await fetch('${apiPrefix}/workers').then(r => r.json())
            this.data = res.data || []
          },
          ago(dateStr) {
            const s = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
            if (s < 60) return s + 's ago'
            if (s < 3600) return Math.floor(s / 60) + 'm ago'
            return Math.floor(s / 3600) + 'h ago'
          }
        }
      }
    </script>`

  return Layout({ title: 'Workers', body, basePath, activePath: '/workers' })
}
