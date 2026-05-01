import { Layout } from './Layout.js'

export interface QueuesProps {
  basePath:  string
  apiPrefix: string
}

export function Queues(props: QueuesProps): string {
  const { basePath, apiPrefix } = props

  const body = `
    <div x-data="queues()" x-init="load()" x-cloak>
      <h2 class="text-xl font-bold mb-6">Queues</h2>
      <div class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 border-b border-gray-200 text-xs uppercase text-gray-500">
            <tr>
              <th class="px-5 py-3 text-left">Queue</th>
              <th class="px-5 py-3 text-right">Throughput/min</th>
              <th class="px-5 py-3 text-right">Avg Wait</th>
              <th class="px-5 py-3 text-right">Avg Runtime</th>
              <th class="px-5 py-3 text-right">Pending</th>
              <th class="px-5 py-3 text-right">Active</th>
              <th class="px-5 py-3 text-right">Completed</th>
              <th class="px-5 py-3 text-right">Failed</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <template x-for="q in data" :key="q.queue">
              <tr class="hover:bg-gray-50">
                <td class="px-5 py-3 font-medium" x-text="q.queue"></td>
                <td class="px-5 py-3 text-right" x-text="q.throughput"></td>
                <td class="px-5 py-3 text-right" x-text="q.waitTime + 'ms'"></td>
                <td class="px-5 py-3 text-right" x-text="q.runtime + 'ms'"></td>
                <td class="px-5 py-3 text-right text-amber-600" x-text="q.pending"></td>
                <td class="px-5 py-3 text-right text-blue-600" x-text="q.active"></td>
                <td class="px-5 py-3 text-right text-green-600" x-text="q.completed"></td>
                <td class="px-5 py-3 text-right text-red-600" x-text="q.failed"></td>
              </tr>
            </template>
            <tr x-show="data.length === 0">
              <td colspan="8" class="px-5 py-12 text-center text-gray-400">No queue data yet.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <script>
      function queues() {
        return {
          data: [],
          async load() {
            const res = await fetch('${apiPrefix}/queues').then(r => r.json())
            this.data = res.data || []
          }
        }
      }
    </script>`

  return Layout({ title: 'Queues', body, basePath, activePath: '/queues' })
}
