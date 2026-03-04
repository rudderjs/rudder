// ─── Request & Response ────────────────────────────────────

export interface BoostKitRequest {
  method:  string
  url:     string
  path:    string
  query:   Record<string, string>
  params:  Record<string, string>
  headers: Record<string, string>
  body:    unknown
  raw:     unknown  // the original server-specific request object
}

export interface BoostKitResponse {
  status:  (code: number) => BoostKitResponse
  header:  (key: string, value: string) => BoostKitResponse
  json:    (data: unknown) => void
  send:    (data: string) => void
  redirect:(url: string, code?: number) => void
  raw:     unknown  // the original server-specific response object
}

// ─── Handler & Middleware ──────────────────────────────────

export type RouteHandler = (
  req: BoostKitRequest,
  res: BoostKitResponse
) => unknown | Promise<unknown>

export type MiddlewareHandler = (
  req: BoostKitRequest,
  res: BoostKitResponse,
  next: () => Promise<void>
) => void | Promise<void>

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
