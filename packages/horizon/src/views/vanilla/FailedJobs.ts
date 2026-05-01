import { Layout } from './Layout.js'
import { jobTable, jobScript } from './_jobTable.js'

export interface FailedJobsProps {
  basePath:  string
  apiPrefix: string
}

export function FailedJobs(props: FailedJobsProps): string {
  const { basePath, apiPrefix } = props

  const body = `
    <div x-data="jobList('failed')" x-init="load()" x-cloak>
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-xl font-bold">Failed Jobs</h2>
        <input type="text" x-model="search" @input.debounce.300ms="load()"
               placeholder="Search..." class="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-teal-500 outline-none">
      </div>
      ${jobTable()}
    </div>
    ${jobScript(apiPrefix)}`

  return Layout({ title: 'Failed Jobs', body, basePath, activePath: '/jobs/failed' })
}
