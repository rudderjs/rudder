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
}

export interface QueryBuilder<T> {
  where(column: string, value: unknown): this
  where(column: string, operator: WhereOperator, value: unknown): this
  orWhere(column: string, value: unknown): this
  orWhere(column: string, operator: WhereOperator, value: unknown): this
  orderBy(column: string, direction?: 'ASC' | 'DESC'): this
  limit(n: number): this
  offset(n: number): this
  with(...relations: string[]): this
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
  /** Restore a soft-deleted record. */
  restore(id: number | string): Promise<T>
  /** Permanently delete a record, bypassing soft deletes. */
  forceDelete(id: number | string): Promise<void>
  paginate(page: number, perPage?: number): Promise<PaginatedResult<T>>
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

// ─── Route Definition ──────────────────────────────────────

export interface RouteDefinition {
  method:     HttpMethod
  path:       string
  handler:    RouteHandler
  middleware: MiddlewareHandler[]
}

// ─── Server Adapter Contract ───────────────────────────────

export interface ServerAdapter {
  /** Register a single route */
  registerRoute(route: RouteDefinition): void

  /** Apply a global middleware */
  applyMiddleware(middleware: MiddlewareHandler): void

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
