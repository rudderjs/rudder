export function configPulse(): string {
  return `import { Env } from '@rudderjs/core'
import type { PulseConfig } from '@rudderjs/pulse'

// Metrics dashboard mounted at /pulse. Records throughput, latency,
// queue lag, cache hit rates, slow queries, and exception counts.
//
// Storage defaults to in-memory (bounded). Switch to 'sqlite' for
// persistence across restarts — install better-sqlite3 first:
//   pnpm add -D better-sqlite3
export default {
  enabled:              Env.getBool('PULSE_ENABLED', true),
  path:                 'pulse',
  storage:              'memory',
  pruneAfterHours:      168,    // 7 days
  slowRequestThreshold: 1000,
  slowQueryThreshold:   100,
} satisfies PulseConfig
`
}
