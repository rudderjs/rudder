// ─── Entry Types ───────────────────────────────────────────

export type EntryType =
  | 'request'
  | 'query'
  | 'job'
  | 'exception'
  | 'log'
  | 'mail'
  | 'notification'
  | 'event'
  | 'cache'
  | 'schedule'
  | 'model'

export interface TelescopeEntry {
  id:         string
  batchId:    string | null
  type:       EntryType
  content:    Record<string, unknown>
  tags:       string[]
  familyHash: string | null
  createdAt:  Date
}

// ─── Collector Contract ────────────────────────────────────

export interface Collector {
  /** Human-readable name (e.g. "Request Collector") */
  readonly name: string
  /** The entry type this collector produces */
  readonly type: EntryType
  /** Register hooks. Called during provider boot. */
  register(): void | Promise<void>
}

// ─── Storage Contract ──────────────────────────────────────

export interface TelescopeStorage {
  store(entry: TelescopeEntry): void | Promise<void>
  storeBatch(entries: TelescopeEntry[]): void | Promise<void>

  /** List entries by type, with pagination and optional filters */
  list(options: ListOptions): TelescopeEntry[] | Promise<TelescopeEntry[]>
  /** Get a single entry by ID */
  find(id: string): TelescopeEntry | null | Promise<TelescopeEntry | null>
  /** Count entries by type */
  count(type?: EntryType): number | Promise<number>
  /** Delete all entries, optionally filtered by type */
  prune(type?: EntryType): void | Promise<void>
  /** Delete entries older than the given date */
  pruneOlderThan(date: Date): void | Promise<void>
}

export interface ListOptions {
  type?:    EntryType | undefined
  page?:    number | undefined
  perPage?: number | undefined
  tag?:     string | undefined
  search?:  string | undefined
  batchId?: string | undefined
}

// ─── Config ────────────────────────────────────────────────

export interface TelescopeConfig {
  enabled?:              boolean | undefined
  path?:                 string | undefined
  storage?:              'memory' | 'sqlite' | undefined
  sqlitePath?:           string | undefined
  maxEntries?:           number | undefined
  pruneAfterHours?:      number | undefined
  recordRequests?:       boolean | undefined
  recordQueries?:        boolean | undefined
  recordJobs?:           boolean | undefined
  recordExceptions?:     boolean | undefined
  recordLogs?:           boolean | undefined
  recordMail?:           boolean | undefined
  recordNotifications?:  boolean | undefined
  recordEvents?:         boolean | undefined
  recordCache?:          boolean | undefined
  recordSchedule?:       boolean | undefined
  recordModels?:         boolean | undefined
  ignoreRequests?:       string[] | undefined
  slowQueryThreshold?:   number | undefined
  auth?:                 null | ((req: unknown) => boolean | Promise<boolean>) | undefined
}

export const defaultConfig: Required<Omit<TelescopeConfig, 'auth' | 'sqlitePath'>> & { auth: TelescopeConfig['auth']; sqlitePath: string } = {
  enabled:              true,
  path:                 'telescope',
  storage:              'memory',
  sqlitePath:           '.telescope.db',
  maxEntries:           1000,
  pruneAfterHours:      24,
  recordRequests:       true,
  recordQueries:        true,
  recordJobs:           true,
  recordExceptions:     true,
  recordLogs:           true,
  recordMail:           true,
  recordNotifications:  true,
  recordEvents:         true,
  recordCache:          true,
  recordSchedule:       true,
  recordModels:         true,
  ignoreRequests:       ['/telescope*', '/health'],
  slowQueryThreshold:   100,
  auth:                 null,
}
