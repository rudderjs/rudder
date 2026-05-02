export function configTelescope(): string {
  return `import type { TelescopeConfig } from '@rudderjs/telescope'

// Debug dashboard mounted at /telescope. 18 collectors record requests, queries,
// jobs, exceptions, logs, mail, events, cache, schedule, models, commands,
// broadcasts, live, HTTP client, gate checks, dumps, AI runs, and MCP calls.
//
// Storage defaults to in-memory (bounded, no extra deps). Switch to 'sqlite'
// for persistence across restarts — install better-sqlite3 first:
//   pnpm add -D better-sqlite3
//
// In production, gate access by returning \`false\` from \`auth(req)\` or simply
// disable by setting \`enabled: false\` via an env var.
export default {
  enabled:            true,
  path:               'telescope',
  storage:            'memory',
  maxEntries:         1000,
  pruneAfterHours:    24,
  slowQueryThreshold: 100,
  ignoreRequests:     ['/telescope*', '/health', '/@*'],
} satisfies TelescopeConfig
`
}
