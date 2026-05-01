import { Layout } from './Layout.js'

export interface DashboardProps {
  basePath:  string
  apiPrefix: string
}

/**
 * Dashboard landing page — overview cards (job counts by status) and
 * a queue-metrics table. Auto-refreshes every 10 seconds.
 */
export function Dashboard(props: DashboardProps): string {
  const { basePath, apiPrefix } = props

  const body = `
    <div x-data="dashboard()" x-init="load()" x-cloak>
      <h2 class="text-xl font-bold mb-6">Dashboard</h2>

      <!-- Stats Cards -->
      <div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        <div class="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div class="text-2xl font-bold" x-text="stats.jobs?.total || 0"></div>
          <div class="text-sm text-gray-500">Total Jobs</div>
        </div>
        <div class="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div class="text-2xl font-bold text-amber-600" x-text="stats.jobs?.pending || 0"></div>
          <div class="text-sm text-gray-500">Pending</div>
        </div>
        <div class="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div class="text-2xl font-bold text-blue-600" x-text="stats.jobs?.processing || 0"></div>
          <div class="text-sm text-gray-500">Processing</div>
        </div>
        <div class="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div class="text-2xl font-bold text-green-600" x-text="stats.jobs?.completed || 0"></div>
          <div class="text-sm text-gray-500">Completed</div>
        </div>
        <div class="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div class="text-2xl font-bold text-red-600" x-text="stats.jobs?.failed || 0"></div>
          <div class="text-sm text-gray-500">Failed</div>
        </div>
      </div>

      <!-- Queue Metrics -->
      <div class="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div class="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 class="text-sm font-semibold text-gray-700">Queue Metrics</h3>
          <span class="text-xs text-gray-400" x-text="stats.workers + ' worker(s)'"></span>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th class="px-5 py-3 text-left">Queue</th>
                <th class="px-5 py-3 text-right">Throughput</th>
                <th class="px-5 py-3 text-right">Wait Time</th>
                <th class="px-5 py-3 text-right">Runtime</th>
                <th class="px-5 py-3 text-right">Pending</th>
                <th class="px-5 py-3 text-right">Failed</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              <template x-for="q in stats.queues || []" :key="q.queue">
                <tr class="hover:bg-gray-50">
                  <td class="px-5 py-3 font-medium" x-text="q.queue"></td>
                  <td class="px-5 py-3 text-right" x-text="q.throughput + '/min'"></td>
                  <td class="px-5 py-3 text-right" x-text="q.waitTime + 'ms'"></td>
                  <td class="px-5 py-3 text-right" x-text="q.runtime + 'ms'"></td>
                  <td class="px-5 py-3 text-right text-amber-600" x-text="q.pending"></td>
                  <td class="px-5 py-3 text-right text-red-600" x-text="q.failed"></td>
                </tr>
              </template>
              <tr x-show="!stats.queues?.length">
                <td colspan="6" class="px-5 py-8 text-center text-gray-400">No queue data yet.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="mt-4 text-center text-xs text-gray-400">Auto-refreshes every 10 seconds</div>
    </div>
    <script>
      function dashboard() {
        return {
          stats: {},
          async load() { await this.refresh(); setInterval(() => this.refresh(), 10000) },
          async refresh() { this.stats = await fetch('${apiPrefix}/stats').then(r => r.json()) }
        }
      }
    </script>`

  return Layout({ title: 'Dashboard', body, basePath, activePath: '/' })
}
