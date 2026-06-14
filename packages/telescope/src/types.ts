// ─── Entry Types ───────────────────────────────────────────

/**
 * The canonical, exhaustive list of entry types — the single source of truth.
 * `EntryType` is derived from it, and both `routes.ts` and `api/routes.ts`
 * import this array rather than inlining their own copy.
 *
 * Never inline a partial copy: a truncated list silently prunes the entire
 * store (the `prune` handler falls through to prune-all for any omitted type)
 * and hides the dashboard overview tiles for the missing types. Deriving the
 * type from the array means a new entry type can only be added in one place.
 */
export const ALL_ENTRY_TYPES = [
  'request', 'query', 'job', 'exception', 'log',
  'mail', 'notification', 'event', 'cache', 'schedule',
  'model', 'command', 'broadcast', 'sync', 'http',
  'gate', 'dump', 'ai', 'mcp', 'view',
] as const

export type EntryType = (typeof ALL_ENTRY_TYPES)[number]

/**
 * Map an `EntryType` to the URL slug used by the dashboard list API.
 *
 * Shared between the server (`routes.ts` registers `${apiPrefix}/${slug}`)
 * and the client (`EntryList.ts` fetches `${apiPrefix}/${slug}?...`). A
 * drift between the two sites silently 404s the listing API and the table
 * renders empty — historically a recurring footgun.
 *
 * Both sites must call this helper rather than inlining the slug logic.
 * Adding a new `EntryType` means updating this function in lockstep.
 */
export function toApiSlug(type: EntryType): string {
  if (type === 'query') return 'queries'
  if (type === 'view')  return 'views'
  if (type === 'http' || type === 'ai' || type === 'mcp') return type
  return `${type}s`
}

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
  recordCommands?:       boolean | undefined
  recordBroadcasts?:     boolean | undefined
  recordSync?:           boolean | undefined
  recordHttp?:           boolean | undefined
  recordGate?:           boolean | undefined
  recordDumps?:          boolean | undefined
  recordAi?:             boolean | undefined
  recordMcp?:            boolean | undefined
  recordViews?:          boolean | undefined
  /**
   * Throttle window in ms for Yjs awareness events (cursor / selection /
   * presence diffs). One entry per `(docName, clientId)` is recorded per
   * window — the rest are dropped. Default `500`. Set to `0` to record
   * every awareness change (only useful for very low-traffic debugging).
   */
  syncAwarenessSampleMs?: number | undefined
  ignoreRequests?:       string[] | undefined
  slowQueryThreshold?:   number | undefined
  /** Duration threshold in ms above which an AI agent run is tagged `slow`. Default `5000`. */
  slowAiThreshold?:      number | undefined
  /** Duration threshold in ms above which an MCP operation is tagged `slow`. Default `1000`. */
  slowMcpThreshold?:     number | undefined
  /**
   * Header names (lower-case) to redact from recorded request entries.
   * Values are replaced with `[REDACTED]` before being stored — they
   * never reach the dashboard or the storage backend. Defaults to
   * `['authorization', 'cookie', 'set-cookie', 'x-csrf-token', 'x-api-key']`.
   */
  hideRequestHeaders?:   string[] | undefined
  /**
   * Body field names to redact from recorded request entries (looked up
   * case-insensitively at any depth). Defaults to `['password', 'password_confirmation', 'token', 'secret']`.
   */
  hideRequestFields?:    string[] | undefined
  auth?:                 null | ((req: unknown) => boolean | Promise<boolean>) | undefined
  /**
   * How the dashboard receives new entries.
   *
   * - `'polling'` (default): the entry list re-fetches every `pollInterval` ms
   *   when "Live" is toggled on. Works through any HTTP proxy, no extra wire
   *   protocol.
   * - `'stream'`: the dashboard subscribes to a Server-Sent Events endpoint
   *   (`<path>/api/stream`) and the server pushes new entries as they're
   *   recorded. Lower latency, no spinning request count. Half-duplex —
   *   one connection per dashboard tab.
   *
   * Stream mode is pure HTTP (no peer deps); the recording toggle and auth
   * gate still apply.
   */
  updates?:              'polling' | 'stream' | undefined
  /** Poll interval in ms when `updates === 'polling'`. Default `2000`. Ignored in stream mode. */
  pollInterval?:         number | undefined
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
  recordCommands:       true,
  recordBroadcasts:     true,
  recordSync:           true,
  recordHttp:           true,
  recordGate:           true,
  recordDumps:          true,
  recordAi:             true,
  recordMcp:            true,
  recordViews:          true,
  syncAwarenessSampleMs: 500,
  ignoreRequests:       ['/telescope*', '/health'],
  slowQueryThreshold:   100,
  slowAiThreshold:      5000,
  slowMcpThreshold:     1000,
  hideRequestHeaders:   ['authorization', 'cookie', 'set-cookie', 'x-csrf-token', 'x-api-key', 'x-real-ip'],
  hideRequestFields:    ['password', 'password_confirmation', 'token', 'secret'],
  auth:                 null,
  updates:              'polling',
  pollInterval:         2000,
}
