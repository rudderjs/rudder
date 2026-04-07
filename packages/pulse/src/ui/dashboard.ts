import { layout } from './layout.js'

/**
 * Renders the Pulse dashboard — a single page with metric cards that auto-refresh.
 */
export function dashboardPage(apiPrefix: string): string {
  return layout('Dashboard', `
    <div x-data="dashboard()" x-init="load()" x-cloak>
      <!-- Metric Cards Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        <!-- Request Throughput -->
        <div class="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-medium text-gray-500">Requests</h3>
            <span class="text-xs text-gray-400" x-text="period"></span>
          </div>
          <div class="text-2xl font-bold" x-text="fmt(metrics.request_count?.total || 0)"></div>
          <div class="text-sm text-gray-500 mt-1">
            avg <span x-text="fmt(metrics.request_duration?.avg || 0)"></span>ms
          </div>
          <div class="sparkline mt-3" x-html="sparkline(requestBuckets)"></div>
        </div>

        <!-- Cache Hit Rate -->
        <div class="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-medium text-gray-500">Cache Hit Rate</h3>
          </div>
          <div class="text-2xl font-bold">
            <span x-text="cacheData.hit_rate || 0"></span>%
          </div>
          <div class="text-sm text-gray-500 mt-1">
            <span x-text="fmt(cacheData.total_hits || 0)"></span> hits /
            <span x-text="fmt(cacheData.total_misses || 0)"></span> misses
          </div>
          <div class="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div class="h-full bg-green-500 rounded-full transition-all" :style="'width:' + (cacheData.hit_rate || 0) + '%'"></div>
          </div>
        </div>

        <!-- Queue Throughput -->
        <div class="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-medium text-gray-500">Queue Jobs</h3>
          </div>
          <div class="text-2xl font-bold" x-text="fmt(metrics.queue_throughput?.total || 0)"></div>
          <div class="text-sm text-gray-500 mt-1">
            avg wait <span x-text="fmt(metrics.queue_wait_time?.avg || 0)"></span>ms
          </div>
          <div class="sparkline mt-3" x-html="sparkline(queueBuckets)"></div>
        </div>

        <!-- Exceptions -->
        <div class="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-medium text-gray-500">Exceptions</h3>
          </div>
          <div class="text-2xl font-bold" :class="(metrics.exceptions?.total || 0) > 0 ? 'text-red-600' : ''"
               x-text="fmt(metrics.exceptions?.total || 0)"></div>
          <div class="text-sm text-gray-500 mt-1">
            min <span x-text="metrics.exceptions?.min ?? 0"></span> /
            max <span x-text="metrics.exceptions?.max ?? 0"></span>
          </div>
        </div>

        <!-- Active Users -->
        <div class="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-medium text-gray-500">Active Users</h3>
          </div>
          <div class="text-2xl font-bold" x-text="fmt(metrics.active_users?.total || 0)"></div>
          <div class="text-sm text-gray-500 mt-1">unique in period</div>
        </div>

        <!-- Server CPU -->
        <div class="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-medium text-gray-500">CPU Usage</h3>
          </div>
          <div class="text-2xl font-bold">
            <span x-text="(metrics.server_cpu?.avg || 0).toFixed(1)"></span>%
          </div>
          <div class="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div class="h-full rounded-full transition-all" :class="(metrics.server_cpu?.avg || 0) > 80 ? 'bg-red-500' : 'bg-blue-500'"
                 :style="'width:' + Math.min(metrics.server_cpu?.avg || 0, 100) + '%'"></div>
          </div>
        </div>

        <!-- Server Memory -->
        <div class="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-medium text-gray-500">Memory Usage</h3>
          </div>
          <div class="text-2xl font-bold">
            <span x-text="(metrics.server_memory?.avg || 0).toFixed(1)"></span>%
          </div>
          <div class="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div class="h-full rounded-full transition-all" :class="(metrics.server_memory?.avg || 0) > 80 ? 'bg-red-500' : 'bg-amber-500'"
                 :style="'width:' + Math.min(metrics.server_memory?.avg || 0, 100) + '%'"></div>
          </div>
        </div>
      </div>

      <!-- Slow Requests Table -->
      <div class="mt-8 bg-white rounded-xl border border-gray-200 shadow-sm">
        <div class="px-5 py-4 border-b border-gray-100">
          <h3 class="text-sm font-semibold text-gray-700">Slow Requests</h3>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th class="px-5 py-3 text-left">Method</th>
                <th class="px-5 py-3 text-left">Path</th>
                <th class="px-5 py-3 text-right">Duration</th>
                <th class="px-5 py-3 text-right">Time</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              <template x-for="r in slowRequests" :key="r.id">
                <tr class="hover:bg-gray-50">
                  <td class="px-5 py-3">
                    <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                          :class="r.content.method === 'GET' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'"
                          x-text="r.content.method"></span>
                  </td>
                  <td class="px-5 py-3 font-mono text-xs" x-text="r.content.path"></td>
                  <td class="px-5 py-3 text-right text-red-600 font-medium" x-text="r.content.duration + 'ms'"></td>
                  <td class="px-5 py-3 text-right text-gray-400 text-xs" x-text="ago(r.createdAt)"></td>
                </tr>
              </template>
              <tr x-show="slowRequests.length === 0">
                <td colspan="4" class="px-5 py-8 text-center text-gray-400">No slow requests recorded.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Recent Exceptions Table -->
      <div class="mt-6 bg-white rounded-xl border border-gray-200 shadow-sm">
        <div class="px-5 py-4 border-b border-gray-100">
          <h3 class="text-sm font-semibold text-gray-700">Recent Exceptions</h3>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th class="px-5 py-3 text-left">Class</th>
                <th class="px-5 py-3 text-left">Message</th>
                <th class="px-5 py-3 text-right">Time</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              <template x-for="e in exceptions" :key="e.id">
                <tr class="hover:bg-gray-50">
                  <td class="px-5 py-3 font-mono text-xs text-red-600" x-text="e.content.class"></td>
                  <td class="px-5 py-3 text-gray-600 truncate max-w-md" x-text="e.content.message"></td>
                  <td class="px-5 py-3 text-right text-gray-400 text-xs" x-text="ago(e.createdAt)"></td>
                </tr>
              </template>
              <tr x-show="exceptions.length === 0">
                <td colspan="3" class="px-5 py-8 text-center text-gray-400">No exceptions recorded.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Auto-refresh indicator -->
      <div class="mt-4 text-center text-xs text-gray-400">
        Auto-refreshes every 10 seconds
      </div>
    </div>

    <script>
      function dashboard() {
        return {
          period: new URLSearchParams(location.search).get('period') || '1h',
          metrics: {},
          cacheData: {},
          requestBuckets: [],
          queueBuckets: [],
          slowRequests: [],
          exceptions: [],

          async load() {
            await this.refresh()
            setInterval(() => this.refresh(), 10000)
          },

          async refresh() {
            const p = '?period=' + this.period
            const [overview, cache, requests, queues, exceptions, slowReqs] = await Promise.all([
              fetch('${apiPrefix}/overview' + p).then(r => r.json()),
              fetch('${apiPrefix}/cache' + p).then(r => r.json()),
              fetch('${apiPrefix}/requests' + p).then(r => r.json()),
              fetch('${apiPrefix}/queues' + p).then(r => r.json()),
              fetch('${apiPrefix}/exceptions' + p).then(r => r.json()),
              fetch('${apiPrefix}/slow-requests?per_page=10').then(r => r.json()),
            ])
            this.metrics = overview.metrics || {}
            this.cacheData = cache
            this.requestBuckets = (requests.throughput || []).map(b => b.count)
            this.queueBuckets = (queues.throughput || []).map(b => b.count)
            this.slowRequests = slowReqs.data || []
            this.exceptions = exceptions.recent || []
          },

          sparkline(data) {
            if (!data.length) return '<span class="text-xs text-gray-300">No data</span>'
            const max = Math.max(...data, 1)
            return data.slice(-30).map(v =>
              '<div class="bar" style="height:' + Math.max((v / max) * 100, 2) + '%"></div>'
            ).join('')
          },

          fmt(n) {
            if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
            if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
            return Math.round(n)
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
    </script>`, 'pulse')
}
