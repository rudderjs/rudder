/**
 * Shared job-table partial used by both `RecentJobs` and `FailedJobs`.
 *
 * Both pages render the same table shape and Alpine `jobList()` component;
 * only the `type` argument (`'recent'` vs `'failed'`) and the page title
 * differ. Co-locating the table + script here keeps the two page files
 * thin and prevents drift.
 */

export function jobTable(): string {
  return `
      <div class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 border-b border-gray-200 text-xs uppercase text-gray-500">
            <tr>
              <th class="px-4 py-3 text-left">Name</th>
              <th class="px-4 py-3 text-left">Queue</th>
              <th class="px-4 py-3 text-left">Status</th>
              <th class="px-4 py-3 text-right">Duration</th>
              <th class="px-4 py-3 text-right">Time</th>
              <th class="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <template x-for="job in jobs" :key="job.id">
              <tr class="hover:bg-gray-50">
                <td class="px-4 py-3 font-mono text-xs" x-text="job.name"></td>
                <td class="px-4 py-3" x-text="job.queue"></td>
                <td class="px-4 py-3">
                  <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                        :class="{pending:'bg-amber-100 text-amber-700',processing:'bg-blue-100 text-blue-700',completed:'bg-green-100 text-green-700',failed:'bg-red-100 text-red-700'}[job.status]"
                        x-text="job.status"></span>
                </td>
                <td class="px-4 py-3 text-right" x-text="job.duration ? job.duration + 'ms' : '—'"></td>
                <td class="px-4 py-3 text-right text-gray-400 text-xs" x-text="ago(job.dispatchedAt)"></td>
                <td class="px-4 py-3 text-right">
                  <button x-show="job.status === 'failed'" @click="retry(job.id)"
                          class="text-xs text-teal-600 hover:text-teal-800 mr-2">Retry</button>
                  <button @click="remove(job.id)"
                          class="text-xs text-red-500 hover:text-red-700">Delete</button>
                </td>
              </tr>
            </template>
            <tr x-show="jobs.length === 0">
              <td colspan="6" class="px-4 py-12 text-center text-gray-400">No jobs found.</td>
            </tr>
          </tbody>
        </table>
        <div class="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50 text-sm">
          <span class="text-gray-500">Total: <span x-text="meta.total"></span></span>
          <div class="flex gap-1">
            <button @click="page > 1 && (page--, load())" :disabled="page <= 1" class="px-3 py-1 border rounded text-xs disabled:opacity-30">Prev</button>
            <button @click="page++; load()" class="px-3 py-1 border rounded text-xs">Next</button>
          </div>
        </div>
      </div>`
}

export function jobScript(apiPrefix: string): string {
  return `
    <script>
      function jobList(type) {
        return {
          jobs: [], meta: { total: 0 }, page: 1, search: '',
          async load() {
            const params = new URLSearchParams({ page: this.page, per_page: 50 })
            if (this.search) params.set('search', this.search)
            const data = await fetch('${apiPrefix}/jobs/' + type + '?' + params).then(r => r.json())
            this.jobs = data.data || []
            this.meta = data.meta || { total: 0 }
          },
          async retry(id) {
            await fetch('${apiPrefix}/jobs/' + id + '/retry', { method: 'POST' })
            this.load()
          },
          async remove(id) {
            await fetch('${apiPrefix}/jobs/' + id, { method: 'DELETE' })
            this.load()
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
}
