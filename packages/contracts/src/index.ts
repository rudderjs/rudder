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
  orderBy(column: string, direction?: 'ASC' | 'DESC'): this
  limit(n: number): this
  offset(n: number): this
  with(...relations: string[]): this
  first(): Promise<T | null>
  find(id: number | string): Promise<T | null>
  get(): Promise<T[]>
  all(): Promise<T[]>
  count(): Promise<number>
  create(data: Partial<T>): Promise<T>
  update(id: number | string, data: Partial<T>): Promise<T>
  delete(id: number | string): Promise<void>
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

export interface AppRequest {
  method:  string
  url:     string
  path:    string
  query:   Record<string, string>
  params:  Record<string, string>
  headers: Record<string, string>
  body:    unknown
  raw:     unknown  // the original server-specific request object
}

export interface AppResponse {
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
