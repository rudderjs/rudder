// ─── Metric Types ──────────────────────────────────────────

export type MetricType =
  | 'request_count'
  | 'request_duration'
  | 'queue_throughput'
  | 'queue_wait_time'
  | 'cache_hits'
  | 'cache_misses'
  | 'exceptions'
  | 'active_users'
  | 'server_cpu'
  | 'server_memory'

export type EntryType =
  | 'slow_request'
  | 'slow_query'
  | 'exception'
  | 'failed_job'

// ─── Aggregate Bucket ──────────────────────────────────────

export interface PulseAggregate {
  id:        string
  bucket:    Date
  type:      MetricType
  key:       string | null
  count:     number
  sum:       number
  min:       number | null
  max:       number | null
  createdAt: Date
}

// ─── Individual Entry ──────────────────────────────────────

export interface PulseEntry {
  id:        string
  type:      EntryType
  content:   Record<string, unknown>
  createdAt: Date
}

// ─── Storage Contract ──────────────────────────────────────

export interface PulseStorage {
  /** Increment an aggregate bucket. Creates the bucket if it doesn't exist. */
  record(type: MetricType, value: number, key?: string | null): void | Promise<void>

  /** Store an individual entry (slow request, exception, etc.) */
  storeEntry(type: EntryType, content: Record<string, unknown>): void | Promise<void>

  /** Get aggregates for a metric type within a time period */
  aggregates(type: MetricType, since: Date, key?: string | null): PulseAggregate[] | Promise<PulseAggregate[]>

  /** Get individual entries by type */
  entries(type: EntryType, options?: EntryListOptions): PulseEntry[] | Promise<PulseEntry[]>

  /** Get the overview — latest bucket for each metric type */
  overview(since: Date): PulseAggregate[] | Promise<PulseAggregate[]>

  /** Delete aggregates and entries older than the given date */
  pruneOlderThan(date: Date): void | Promise<void>
}

export interface EntryListOptions {
  page?:    number | undefined
  perPage?: number | undefined
  search?:  string | undefined
}

// ─── Aggregator Contract ───────────────────────────────────

export interface Aggregator {
  readonly name: string
  register(): void | Promise<void>
}

// ─── Config ────────────────────────────────────────────────

export interface PulseConfig {
  enabled?:                boolean | undefined
  path?:                   string | undefined
  storage?:                'memory' | 'sqlite' | undefined
  sqlitePath?:             string | undefined
  pruneAfterHours?:        number | undefined
  slowRequestThreshold?:   number | undefined
  slowQueryThreshold?:     number | undefined
  recordRequests?:         boolean | undefined
  recordQueues?:           boolean | undefined
  recordCache?:            boolean | undefined
  recordExceptions?:       boolean | undefined
  recordUsers?:            boolean | undefined
  recordServers?:          boolean | undefined
  serverStatsIntervalMs?:  number | undefined
  auth?:                   null | ((req: unknown) => boolean | Promise<boolean>) | undefined
}

export const defaultConfig = {
  enabled:               true,
  path:                  'pulse',
  storage:               'memory' as const,
  sqlitePath:            '.pulse.db',
  pruneAfterHours:       168,  // 7 days
  slowRequestThreshold:  1000, // ms
  slowQueryThreshold:    100,  // ms
  recordRequests:        true,
  recordQueues:          true,
  recordCache:           true,
  recordExceptions:      true,
  recordUsers:           true,
  recordServers:         true,
  serverStatsIntervalMs: 15_000,
  auth:                  null as null | ((req: unknown) => boolean | Promise<boolean>),
}
