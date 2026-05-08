// ─── ORM Types ─────────────────────────────────────────────

export type WhereOperator = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'LIKE' | 'IN' | 'NOT IN'

export interface WhereClause {
  column:   string
  operator: WhereOperator
  value:    unknown
}

export interface OrderClause {
  column:    string
  direction: 'ASC' | 'DESC'
}

export interface QueryState {
  wheres:  WhereClause[]
  orders:  OrderClause[]
  limitN:  number | null
  offsetN: number | null
  withs:   string[]
  aggregates: AggregateRequest[]
}

/**
 * Scalar aggregate function. Used both as the discriminator in
 * {@link AggregateRequest} and as the parameter to the internal
 * {@link QueryBuilder._aggregate} terminal for single-scalar reads.
 */
export type AggregateFn = 'count' | 'sum' | 'min' | 'max' | 'avg' | 'exists'

/**
 * One normalized aggregate-eager-load entry. The orm Model layer translates
 * every `withCount(...)` / `withSum(...)` / etc. overload — including the
 * map-form constraint shape — into one or more of these and pushes them
 * onto {@link QueryState.aggregates} for the adapter to consume.
 *
 * `relation` is the relation name on the parent Model. `column` is required
 * for `sum`/`min`/`max`/`avg` and ignored for `count`/`exists`.
 *
 * `alias` is the property name stamped onto the parent row in result hydration.
 * Default = `<relation><FnSuffix>`: `posts` + count → `postsCount`,
 * `posts` + sumViews → `postsSumViews`. The orm layer fills `alias` from
 * `<aliasOverride ?? relation><FnSuffix>` where `aliasOverride` is the
 * `.as(name)` setter on the constraint builder.
 *
 * `joinShape` carries the fully-resolved join layout — the adapter uses it to
 * build the COUNT/SUM subquery without re-deriving foreign keys, pivot tables,
 * or polymorphic discriminators. Same {@link RelationExistencePredicate}-style
 * decomposition; reusing those fields keeps the adapter mechanics single-shape.
 */
export interface AggregateRequest {
  relation:    string
  fn:          AggregateFn
  alias:       string
  /** Required for sum/min/max/avg; absent for count/exists. */
  column?:     string
  joinShape:   AggregateJoinShape
  /** Recorded `where`/`orWhere` calls captured from the constraint callback. */
  constraintWheres: WhereClause[]
}

/**
 * Join layout for an {@link AggregateRequest}. Mirrors the
 * {@link RelationExistencePredicate} fields adapters already understand for
 * `whereHas` so a single subquery shape covers both.
 */
export interface AggregateJoinShape {
  relatedTable:    string
  parentColumn:    string
  relatedColumn:   string
  /** Polymorphic discriminator(s) (`{morphName}Type` for morph relations,
   *  pivot-side type discriminator for `morphToMany`/`morphedByMany`). */
  extraEquals?:    Record<string, unknown>
  /** Pivot table the relation passes through (`belongsToMany` /
   *  `morphToMany` / `morphedByMany`). Two-step subquery when set. */
  through?: {
    pivotTable:      string
    foreignPivotKey: string
    relatedPivotKey: string
  }
  /** True when the related Model has soft deletes enabled — adapters AND
   *  `deleted_at IS NULL` (or its camelCase `deletedAt`) into the subquery. */
  softDeletes?: boolean
}

/**
 * Relation predicate passed by `@rudderjs/orm`'s Model layer to the adapter
 * via {@link QueryBuilder.whereRelationExists}. Carries everything an adapter
 * needs to express "rows whose named relation has (or doesn't have) at least
 * one matching child" without leaking ORM-package types.
 *
 * - Name-based adapters (Prisma) usually only need `relation`, `exists`, and
 *   `constraintWheres` to build a `{ [relation]: { some|none: ... } }` filter.
 * - SQL-based adapters (Drizzle) need the structural columns + tables to
 *   build a correlated `EXISTS (...)` subquery.
 *
 * `extraEquals` carries the polymorphic discriminator (`{morph}Type`) for
 * morph relations and the pivot-side discriminator for `morphToMany`.
 *
 * `through` is set when the relation passes through a pivot table
 * (`belongsToMany` / `morphToMany` / `morphedByMany`). When set, the EXISTS
 * subquery is two-step: pivot rows by parent + extras → project related ids,
 * then the related table is filtered by `relatedKey IN (...)` plus
 * `constraintWheres`.
 */
export interface RelationExistencePredicate {
  /** Relation name on the parent model (used for clearer error messages). */
  relation:        string
  /** True for `whereHas`, false for `whereDoesntHave`. */
  exists:          boolean
  /** Related table name (already resolved from the relation declaration). */
  relatedTable:    string
  /** Column on the parent table joined against `relatedColumn`. */
  parentColumn:    string
  /** Column on the related table joined against `parentColumn`. */
  relatedColumn:   string
  /** Where clauses to AND into the relation subquery. */
  constraintWheres: WhereClause[]
  /** Optional equality filter — used by morph relations to add the
   *  discriminator (`{morph}Type`), and by morph pivots to add the pivot-side
   *  type discriminator. */
  extraEquals?:    Record<string, unknown>
  /** Optional pivot table the relation passes through. When set, the subquery
   *  is two-step (pivot → related) instead of a single direct EXISTS. */
  through?: {
    pivotTable:      string
    /** Pivot column compared against the parent's `parentColumn`. */
    foreignPivotKey: string
    /** Pivot column projected as the inner select for the second step. */
    relatedPivotKey: string
  }
}

export interface QueryBuilder<T> {
  where(column: string, value: unknown): this
  where(column: string, operator: WhereOperator, value: unknown): this
  orWhere(column: string, value: unknown): this
  orWhere(column: string, operator: WhereOperator, value: unknown): this
  /**
   * Wrap a chain of `where`/`orWhere` (and nested `whereGroup`s) in a single
   * AND-grouped clause. Composes with surrounding AND/OR like any other where
   * call. The callback receives a fresh sub-builder; calls inside it compose
   * among themselves and the resulting grouped clause is spliced back into
   * this builder. Empty groups (no recorded calls) are a no-op. Terminal
   * methods (`get`/`find`/`first`/`paginate`/etc.) on the sub-builder throw.
   *
   * @example
   *   q.where('status', 'active')
   *    .whereGroup(g => g.where('priority', 'high').orWhere('starred', true))
   *   // WHERE status = 'active' AND (priority = 'high' OR starred = TRUE)
   */
  whereGroup(fn: (q: QueryBuilder<T>) => QueryBuilder<T> | void): this
  /** OR-rooted variant of {@link whereGroup}. */
  orWhereGroup(fn: (q: QueryBuilder<T>) => QueryBuilder<T> | void): this
  orderBy(column: string, direction?: 'ASC' | 'DESC'): this
  limit(n: number): this
  offset(n: number): this
  with(...relations: string[]): this
  /**
   * Project pivot-table columns onto each related row when the query is
   * a deferred `belongsToMany` / `morphToMany` / `morphedByMany` lookup.
   *
   * Each returned related row carries `row.pivot = { col: value, ... }` for
   * the requested columns. No-op on non-pivot queries (the column list is
   * discarded by adapters that don't run a pivot lookup).
   *
   * Throws when called with no arguments — the column list is required so
   * the contract is explicit, not "all pivot columns".
   */
  withPivot(...columns: string[]): this
  /** Include soft-deleted records in query results. */
  withTrashed(): this
  /** Return only soft-deleted records. */
  onlyTrashed(): this
  first(): Promise<T | null>
  find(id: number | string): Promise<T | null>
  get(): Promise<T[]>
  all(): Promise<T[]>
  count(): Promise<number>
  create(data: Partial<T>): Promise<T>
  update(id: number | string, data: Partial<T>): Promise<T>
  delete(id: number | string): Promise<void>
  /**
   * Bulk insert. Used by `belongsToMany` attach to write pivot rows in one
   * round-trip and by callers that need batched inserts. No return value —
   * adapters that can't echo inserted ids without a round-trip don't have to.
   */
  insertMany(rows: Partial<T>[]): Promise<void>
  /**
   * Delete every row matching the chained `where`/`orWhere` clauses.
   * Returns the number of rows deleted. Bypasses soft deletes — call
   * `withTrashed()` first if you need to scope including trashed rows
   * (most adapters apply the soft-delete filter automatically otherwise).
   */
  deleteAll(): Promise<number>
  /**
   * Update every row matching the chained `where`/`orWhere` clauses with
   * the given partial. Returns the number of rows updated. Used by the
   * `belongsToMany` / `morphToMany` / `morphedByMany` accessors'
   * `updatePivot()` to write extras on a composite-keyed pivot row, and
   * available for any bulk-update need beyond pivots.
   */
  updateAll(data: Partial<T>): Promise<number>
  /** Restore a soft-deleted record. */
  restore(id: number | string): Promise<T>
  /** Permanently delete a record, bypassing soft deletes. */
  forceDelete(id: number | string): Promise<void>
  /**
   * Atomically add `amount` to `column`. Optionally update other columns at the
   * same time via `extra`. Returns the updated record. Throws if the row is missing.
   */
  increment(id: number | string, column: string, amount?: number, extra?: Record<string, unknown>): Promise<T>
  /**
   * Atomically subtract `amount` from `column`. Optionally update other columns
   * at the same time via `extra`. Returns the updated record. Throws if the row is missing.
   */
  decrement(id: number | string, column: string, amount?: number, extra?: Record<string, unknown>): Promise<T>
  paginate(page: number, perPage?: number): Promise<PaginatedResult<T>>
  /**
   * Add an EXISTS / NOT EXISTS subquery filter representing a relation
   * predicate. Adapters translate to their native shape (Prisma → `some`/
   * `none`; Drizzle → correlated subquery via `exists()`/`notExists()`).
   *
   * Called by `@rudderjs/orm`'s `Model.whereHas` / `whereDoesntHave` /
   * `withWhereHas`. Apps don't call this directly.
   */
  whereRelationExists(predicate: RelationExistencePredicate): this
  /**
   * Eager-load `relation` constrained to rows matching `constraintWheres`.
   * Adapters that don't support a constrained include (Drizzle today) may
   * apply the filter in JS or throw a clear "not yet supported" error.
   *
   * Optional — adapters may omit it and `Model.withWhereHas` falls back to
   * unconstrained `with(relation)`.
   */
  withConstrained?(relation: string, constraintWheres: WhereClause[]): this

  /**
   * Append one or more aggregate eager-load requests. Adapters translate to
   * their native shape (Prisma → `_count` selector for count/exists +
   * `groupBy` second-batch for sum/min/max/avg; Drizzle → correlated subselect
   * in the SELECT list).
   *
   * Called by `@rudderjs/orm`'s Model layer with already-normalized
   * {@link AggregateRequest} entries — apps don't call this directly. The
   * Model proxy translates the typed `withCount`/`withSum`/etc. overloads
   * into requests and forwards them here.
   *
   * Aggregate values are stamped onto the result row under `alias` and
   * the orm hydration layer copies them onto the Model instance.
   */
  withAggregate(requests: AggregateRequest[]): this

  /**
   * Single-scalar aggregate terminal — runs `SELECT fn(column) FROM table
   * WHERE …` against the QB's accumulated wheres and returns the value.
   *
   * Used by `Model#loadSum`/`loadMin`/`loadMax`/`loadAvg` for the per-instance
   * aggregate-load path. Apps don't call this directly; use the typed
   * `Model.query().withSum(...)` overloads on the parent or the instance
   * `loadSum` helper instead.
   *
   * `column` is required for `sum`/`min`/`max`/`avg`; ignored for
   * `count`/`exists`. Returns `null` when no rows match (sum/avg on empty
   * sets) — adapters coerce numeric `null` to `0` for `count` to match
   * SQL semantics. `exists` returns a boolean.
   *
   * @internal
   */
  _aggregate(fn: AggregateFn, column?: string): Promise<unknown>
}

export interface PaginatedResult<T> {
  data:        T[]
  total:       number
  perPage:     number
  currentPage: number
  lastPage:    number
  from:        number
  to:          number
}

export interface OrmAdapter {
  query<T>(table: string): QueryBuilder<T>
  connect(): Promise<void>
  disconnect(): Promise<void>
}

export interface OrmAdapterProvider {
  create(): OrmAdapter | Promise<OrmAdapter>
}

/**
 * Minimal chainable query surface a `ModelLike` exposes via `.query()`.
 * `QueryBuilder<T>` from this file already structurally satisfies it for
 * any concrete `T` — invariance in the input positions is widened to
 * `unknown` here so the contract is consumer-facing rather than tied to
 * a specific Model type.
 */
export interface ModelQuery {
  where(column: string, value: unknown): ModelQuery
  where(column: string, operator: WhereOperator, value: unknown): ModelQuery
  orWhere(column: string, value: unknown): ModelQuery
  orWhere(column: string, operator: WhereOperator, value: unknown): ModelQuery
  orderBy(column: string, direction?: 'ASC' | 'DESC'): ModelQuery
  paginate(page: number, perPage?: number): Promise<{ data: unknown[]; total: number }>
}

/**
 * Static surface of an Eloquent-style ORM Model — the contract that
 * downstream tools (e.g. admin panels with auto-wired CRUD, generic
 * resource browsers) target when they want to call into "the model"
 * without depending on the `@rudderjs/orm` package directly.
 * `@rudderjs/orm`'s `Model` base class satisfies this structurally.
 */
export interface ModelLike {
  /** Primary-key column name. Defaults to `'id'`. */
  primaryKey?: string

  find(id: string | number):                                  Promise<unknown>
  create(data: Record<string, unknown>):                      Promise<unknown>
  update(id: string | number, data: Record<string, unknown>): Promise<unknown>
  delete(id: string | number):                                Promise<void>
  query():                                                    ModelQuery
}

// ─── Request & Response ────────────────────────────────────

/**
 * Thrown by typed request accessors when the value cannot be coerced.
 */
export class InputTypeError extends Error {
  constructor(key: string, expected: string, received: unknown) {
    const type = received === null ? 'null'
      : Array.isArray(received) ? 'array'
      : typeof received
    super(`Input "${key}" expected ${expected}, got ${type}.`)
    this.name = 'InputTypeError'
  }
}

export interface AppRequest {
  method:  string
  url:     string
  path:    string
  query:   Record<string, string>
  params:  Record<string, string>
  headers: Record<string, string>
  body:    unknown
  raw:     unknown  // the original server-specific request object

  /**
   * Client IP address. Set by the server adapter when `trustProxy: true`;
   * `undefined` otherwise. Always read from `req.ip` rather than raw headers —
   * the adapter normalises `::1` → `127.0.0.1` and picks the right header.
   */
  ip?: string

  /**
   * The authenticated user for this request. Populated by `AuthMiddleware`
   * on web routes (and by bearer-token guards on api routes). `undefined`
   * on unauthenticated requests or routes that don't run auth middleware.
   */
  user?: unknown

  /**
   * The active session for this request. Populated by `SessionMiddleware`
   * on web routes. `undefined` on api routes (stateless by default).
   */
  session?: unknown

  /**
   * The bearer token for this request. Populated by token-based auth guards
   * (e.g. `@rudderjs/sanctum`, `@rudderjs/passport`). `undefined` when no
   * bearer token was provided or the guard has not run.
   */
  token?: unknown

  /**
   * Resolved values for any route parameters bound via `router.bind(name, ...)`.
   * Populated by the router's per-route binding middleware before the handler runs.
   * Absent on routes that have no bound params; the raw string value remains in
   * `req.params[name]` regardless.
   *
   * @example
   * router.bind('user', User)
   * router.get('/users/:user', (req) => req.bound!['user'])
   */
  bound?: Record<string, unknown>

  // ── Typed input accessors ─────────────────────────────────
  // Merge order: params > body > query (params take priority)

  /** Raw merged input value for `key`. */
  input<T = unknown>(key: string, fallback?: T): T
  /** Input as a string. Throws `InputTypeError` if the value is an object or array. */
  string(key: string, fallback?: string): string
  /** Input as an integer. Throws `InputTypeError` if not parseable. */
  integer(key: string, fallback?: number): number
  /** Input as a float. Throws `InputTypeError` if not parseable. */
  float(key: string, fallback?: number): number
  /** Input as a boolean. Truthy: `'true'`,`'1'`,`'yes'`,`'on'`. Falsy: `'false'`,`'0'`,`'no'`,`'off'`. */
  boolean(key: string, fallback?: boolean): boolean
  /** Input parsed as a `Date`. Throws `InputTypeError` if not parseable. */
  date(key: string, fallback?: Date): Date
  /** Input as an array. Accepts arrays, comma-separated strings, or JSON array strings. */
  array(key: string, fallback?: unknown[]): unknown[]
  /** True if the key exists in any input source. */
  has(key: string): boolean
  /** True if the key is absent from all input sources. */
  missing(key: string): boolean
  /** True if key exists and value is non-empty (not null/undefined/''). */
  filled(key: string): boolean
}

// ─── Input accessor factory ───────────────────────────────

/**
 * Attach typed input accessor methods to a plain `AppRequest`-shaped object.
 * Called by server adapters in their request normalizer.
 * Merge priority: params > body > query.
 */
export function attachInputAccessors(req: Record<string, unknown>): void {
  function merged(): Record<string, unknown> {
    const body = typeof req['body'] === 'object' && req['body'] !== null
      ? req['body'] as Record<string, unknown>
      : {}
    return {
      ...(req['query'] as Record<string, unknown>),
      ...body,
      ...(req['params'] as Record<string, unknown>),
    }
  }

  req['input'] = function <T = unknown>(key: string, fallback?: T): T {
    const val = merged()[key]
    return (val !== undefined ? val : fallback) as T
  }

  req['has'] = function (key: string): boolean {
    return merged()[key] !== undefined
  }

  req['missing'] = function (key: string): boolean {
    return merged()[key] === undefined
  }

  req['filled'] = function (key: string): boolean {
    const val = merged()[key]
    return val !== undefined && val !== null && val !== ''
  }

  req['string'] = function (key: string, fallback?: string): string {
    const val = merged()[key]
    if (val === undefined || val === null) return fallback ?? ''
    if (typeof val === 'object') throw new InputTypeError(key, 'string', val)
    return String(val)
  }

  req['integer'] = function (key: string, fallback?: number): number {
    const val = merged()[key]
    if (val === undefined || val === null) return fallback ?? 0
    const n = parseInt(String(val), 10)
    if (isNaN(n)) throw new InputTypeError(key, 'integer', val)
    return n
  }

  req['float'] = function (key: string, fallback?: number): number {
    const val = merged()[key]
    if (val === undefined || val === null) return fallback ?? 0
    const n = parseFloat(String(val))
    if (isNaN(n)) throw new InputTypeError(key, 'float', val)
    return n
  }

  req['boolean'] = function (key: string, fallback?: boolean): boolean {
    const val = merged()[key]
    if (val === undefined || val === null) return fallback ?? false
    if (typeof val === 'boolean') return val
    const str = String(val).toLowerCase().trim()
    if (['true', '1', 'yes', 'on'].includes(str))   return true
    if (['false', '0', 'no', 'off'].includes(str))  return false
    throw new InputTypeError(key, 'boolean', val)
  }

  req['date'] = function (key: string, fallback?: Date): Date {
    const val = merged()[key]
    if (val === undefined || val === null) {
      if (fallback !== undefined) return fallback
      throw new InputTypeError(key, 'date', undefined)
    }
    if (val instanceof Date) return val
    const d = new Date(String(val))
    if (isNaN(d.getTime())) throw new InputTypeError(key, 'date', val)
    return d
  }

  req['array'] = function (key: string, fallback?: unknown[]): unknown[] {
    const val = merged()[key]
    if (val === undefined || val === null) return fallback ?? []
    if (Array.isArray(val)) return val
    if (typeof val === 'string') {
      if (val.startsWith('[')) {
        try { return JSON.parse(val) as unknown[] } catch { /* fall through to CSV */ }
      }
      return val.split(',').map(v => v.trim())
    }
    return [val]
  }
}

export interface AppResponse {
  /** Current response status code (read after middleware chain completes) */
  statusCode: number
  status:  (code: number) => AppResponse
  header:  (key: string, value: string) => AppResponse
  json:    (data: unknown) => void
  send:    (data: string) => void
  redirect:(url: string, code?: number) => void
  raw:     unknown  // the original server-specific response object
}

// ─── Handler & Middleware ──────────────────────────────────

export type RouteHandler = (
  req: AppRequest,
  res: AppResponse
) => unknown | Promise<unknown>

export type MiddlewareHandler = (
  req: AppRequest,
  res: AppResponse,
  next: () => Promise<void>
) => unknown | Promise<unknown>

// ─── HTTP Methods ──────────────────────────────────────────

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD' | 'ALL'

// ─── Route Groups ──────────────────────────────────────────

/**
 * Route group — Laravel-style middleware scoping.
 * Routes loaded via `withRouting({ web })` are tagged 'web'; via `withRouting({ api })` tagged 'api'.
 * The server adapter prepends the matching group's middleware stack before per-route middleware.
 */
export type RouteGroup = 'web' | 'api'

// ─── Route Definition ──────────────────────────────────────

export interface RouteDefinition {
  method:     HttpMethod
  path:       string
  handler:    RouteHandler
  middleware: MiddlewareHandler[]
  /** Middleware group this route belongs to. Undefined = no group middleware applied. */
  group?:     RouteGroup
  /**
   * Subdomain match template. Plain hosts (`'api.example.com'`) match exact;
   * `:param` segments capture into `req.params` (`':tenant.example.com'`).
   * The server adapter must 404 on host mismatch and merge captured params.
   */
  host?:      string
  /**
   * Custom 404 handler when an explicit route binding (`router.bind(...)`) fails
   * to resolve. The error has duck-typed fields (`httpStatus`, `param`, `value`,
   * `model`) so contracts stays free of `@rudderjs/router`. Return any value the
   * route handler may return — `Response`, plain object → JSON, string → body,
   * or `undefined` if the callback wrote to `res` directly.
   */
  missing?:   (
    req: AppRequest,
    err: Error & { httpStatus: number; param: string; value: string; model: string },
  ) => unknown | Promise<unknown>
}

// ─── Server Adapter Contract ───────────────────────────────

export interface ServerAdapter {
  /** Register a single route */
  registerRoute(route: RouteDefinition): void

  /** Apply a global middleware — runs on every request regardless of route group */
  applyMiddleware(middleware: MiddlewareHandler): void

  /**
   * Apply middleware to a named route group. Routes tagged with this group get
   * these handlers prepended to their per-route middleware chain. Optional —
   * adapters without group support ignore group tags entirely.
   */
  applyGroupMiddleware?(group: RouteGroup, middleware: MiddlewareHandler): void

  /** Register a global error handler — called for any unhandled error thrown by a route */
  setErrorHandler?(handler: (err: unknown, req: AppRequest) => Response | Promise<Response>): void

  /** Start listening on a port */
  listen(port: number, callback?: () => void): void

  /** Return the underlying native server instance (Hono/Express/etc) */
  getNativeServer(): unknown
}

export interface ServerAdapterFactory<TConfig = unknown> {
  (config?: TConfig): ServerAdapterProvider
}

export type FetchHandler = (
  request: Request,
  env?:    unknown,
  ctx?:    unknown
) => Promise<Response>

export interface ServerAdapterProvider {
  /** Identifies the server framework */
  type: string

  /** Create the ServerAdapter instance for decorator routing */
  create(): ServerAdapter

  /** Create the raw native framework app (Hono, H3, …) */
  createApp(): unknown

  /**
   * Create a WinterCG-compatible fetch handler with Vike SSR applied.
   * `setup` receives a ServerAdapter — mount your router onto it.
   */
  createFetchHandler(setup?: (adapter: ServerAdapter) => void): Promise<FetchHandler>
}
