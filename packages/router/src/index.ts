import 'reflect-metadata'

// Lazy-load node:crypto to avoid bundling it into the client.
// Only used by Url (signed URLs) and ValidateSignature — server-only features.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _crypto: { createHmac: any; timingSafeEqual: any } | undefined
// Fire-and-forget: preload on server, no-op in browser
if (typeof globalThis.process !== 'undefined') {
  import(/* @vite-ignore */ 'node:crypto').then(m => { _crypto = m }).catch(() => {})
}
import type {
  ServerAdapter,
  RouteDefinition,
  RouteHandler,
  MiddlewareHandler,
  HttpMethod,
  RouteGroup,
  AppRequest,
} from '@rudderjs/contracts'

// ─── Route Group Context ──────────────────────────────────
//
// `runWithGroup(group, fn)` sets the current group for the duration of `fn`.
// Any `Route.get/post/...` / `registerController()` call inside `fn` tags its
// routes with `group`. The server adapter prepends the matching group's
// middleware stack before per-route middleware. Outside any `runWithGroup`
// scope, `currentGroup()` returns `undefined` and routes stay ungrouped
// (only plain global `m.use(...)` middleware applies).
//
// Route loaders (`routes/web.ts`, `routes/api.ts`) run synchronously at module
// evaluation time — all `Route.get()` calls happen before the loader promise
// resolves. A plain module-level variable is sufficient; no AsyncLocalStorage
// needed, and nothing node-specific leaks into the browser bundle.

let _currentGroup: RouteGroup | undefined

export function runWithGroup<R>(group: RouteGroup, fn: () => R | Promise<R>): R | Promise<R> {
  const prev = _currentGroup
  _currentGroup = group
  try {
    const out = fn()
    if (out instanceof Promise) {
      return out.finally(() => { _currentGroup = prev })
    }
    _currentGroup = prev
    return out
  } catch (e) {
    _currentGroup = prev
    throw e
  }
}

export function currentGroup(): RouteGroup | undefined {
  return _currentGroup
}

// ─── Metadata Keys ─────────────────────────────────────────

const CONTROLLER_PREFIX     = 'rudderjs:controller:prefix'
const CONTROLLER_MIDDLEWARE = 'rudderjs:controller:middleware'
const ROUTE_DEFINITIONS     = 'rudderjs:route:definitions'
const ROUTE_MIDDLEWARE      = 'rudderjs:route:middleware'

// ─── Route Meta (stored per method) ───────────────────────

interface RouteMeta {
  method:     HttpMethod
  path:       string
  handlerKey: string | symbol
  middleware: MiddlewareHandler[]
}

// ─── Decorators ────────────────────────────────────────────

/** Mark a class as a controller with an optional route prefix */
export function Controller(prefix = ''): ClassDecorator {
  return target => {
    Reflect.defineMetadata(CONTROLLER_PREFIX, prefix, target)
  }
}

/** Attach middleware to a controller class or route method */
export function Middleware(middleware: MiddlewareHandler[]): ClassDecorator & MethodDecorator {
  return (target: object, key?: string | symbol) => {
    if (key) {
      // Method-level middleware (supports both decorator orders)
      const perHandler: Record<string, MiddlewareHandler[]> =
        Reflect.getMetadata(ROUTE_MIDDLEWARE, target) ?? {}
      const handlerKey = String(key)
      perHandler[handlerKey] = [...(perHandler[handlerKey] ?? []), ...middleware]
      Reflect.defineMetadata(ROUTE_MIDDLEWARE, perHandler, target)

      // If route metadata already exists, merge immediately too.
      const routes: RouteMeta[] = Reflect.getMetadata(ROUTE_DEFINITIONS, target) ?? []
      const route = routes.find(r => r.handlerKey === key)
      if (route) route.middleware = [...middleware, ...route.middleware]
    } else {
      // Class-level middleware
      Reflect.defineMetadata(CONTROLLER_MIDDLEWARE, middleware, target)
    }
  }
}

/** Create an HTTP method decorator */
function createMethodDecorator(method: HttpMethod) {
  return (path = '/'): MethodDecorator =>
    (target, key) => {
      const perHandler: Record<string, MiddlewareHandler[]> =
        Reflect.getMetadata(ROUTE_MIDDLEWARE, target) ?? {}
      const handlerMiddleware = perHandler[String(key)] ?? []

      const routes: RouteMeta[] =
        Reflect.getMetadata(ROUTE_DEFINITIONS, target) ?? []
      routes.push({ method, path, handlerKey: key, middleware: [...handlerMiddleware] })
      Reflect.defineMetadata(ROUTE_DEFINITIONS, routes, target)
    }
}

export const Get     = createMethodDecorator('GET')
export const Post    = createMethodDecorator('POST')
export const Put     = createMethodDecorator('PUT')
export const Patch   = createMethodDecorator('PATCH')
export const Delete  = createMethodDecorator('DELETE')
export const Options = createMethodDecorator('OPTIONS')

// ─── RouteBuilder ──────────────────────────────────────────

/**
 * Returned by `router.get/post/etc` — allows naming the registered route.
 *
 * @example
 * router.get('/users/:id', handler).name('users.show')
 * route('users.show', { id: 1 })  // → '/users/1'
 */
export class RouteBuilder {
  constructor(
    private readonly definition: RouteDefinition,
    private readonly _router: Router,
  ) {}

  /** Assign a name to this route for use with `route()` and `Url.signedRoute()`. */
  name(n: string): this {
    this._router._registerName(n, this.definition.path)
    return this
  }
}

// ─── Router ────────────────────────────────────────────────

export class Router {
  private routes: RouteDefinition[] = []
  private globalMiddleware: MiddlewareHandler[] = []
  private namedRoutes = new Map<string, string>()

  /** @internal — called by RouteBuilder */
  _registerName(name: string, path: string): void {
    this.namedRoutes.set(name, path)
  }

  /** Look up a named route's path. */
  getNamedRoute(name: string): string | undefined {
    return this.namedRoutes.get(name)
  }

  /**
   * Check whether a named route is registered.
   *
   * Laravel equivalent: `Route::has('login')`. Useful for rendering nav links
   * conditionally in views — e.g. hide "Log in" when the auth package isn't
   * installed.
   *
   * @example
   * const loginUrl = Route.has('login') ? '/login' : null
   */
  has(name: string): boolean {
    return this.namedRoutes.has(name)
  }

  /** All registered named routes. */
  listNamed(): Record<string, string> {
    return Object.fromEntries(this.namedRoutes)
  }

  /** Clear registered routes, middleware, and named routes. */
  reset(): this {
    this.routes = []
    this.globalMiddleware = []
    this.namedRoutes.clear()
    return this
  }

  /** Register a global middleware (runs on every route). */
  use(middleware: MiddlewareHandler): this {
    this.globalMiddleware.push(middleware)
    return this
  }

  /** Manually register a route. Returns `this` for bulk registration. */
  add(
    method: HttpMethod,
    path: string,
    handler: RouteHandler,
    middleware: MiddlewareHandler[] = [],
  ): this {
    const def: RouteDefinition = { method, path, handler, middleware }
    const group = currentGroup()
    if (group) def.group = group
    this.routes.push(def)
    return this
  }

  // ── Shorthand methods — return RouteBuilder for .name() support ──

  get   (path: string, handler: RouteHandler, middleware?: MiddlewareHandler[]): RouteBuilder { return this._rb('GET',    path, handler, middleware) }
  post  (path: string, handler: RouteHandler, middleware?: MiddlewareHandler[]): RouteBuilder { return this._rb('POST',   path, handler, middleware) }
  put   (path: string, handler: RouteHandler, middleware?: MiddlewareHandler[]): RouteBuilder { return this._rb('PUT',    path, handler, middleware) }
  patch (path: string, handler: RouteHandler, middleware?: MiddlewareHandler[]): RouteBuilder { return this._rb('PATCH',  path, handler, middleware) }
  delete(path: string, handler: RouteHandler, middleware?: MiddlewareHandler[]): RouteBuilder { return this._rb('DELETE', path, handler, middleware) }
  all   (path: string, handler: RouteHandler, middleware?: MiddlewareHandler[]): RouteBuilder { return this._rb('ALL',    path, handler, middleware) }

  private _rb(method: HttpMethod, path: string, handler: RouteHandler, middleware: MiddlewareHandler[] = []): RouteBuilder {
    const def: RouteDefinition = { method, path, handler, middleware }
    const group = currentGroup()
    if (group) def.group = group
    this.routes.push(def)
    return new RouteBuilder(def, this)
  }

  /** Register all routes from a decorator-based controller class. */
  registerController(ControllerClass: new () => object): this {
    const instance = new ControllerClass() as Record<string, unknown>
    const prefix   = Reflect.getMetadata(CONTROLLER_PREFIX, ControllerClass) as string ?? ''
    const ctrlMw: MiddlewareHandler[] =
      Reflect.getMetadata(CONTROLLER_MIDDLEWARE, ControllerClass) as MiddlewareHandler[] ?? []
    const routes: RouteMeta[] =
      Reflect.getMetadata(ROUTE_DEFINITIONS, ControllerClass.prototype) as RouteMeta[] ?? []

    const group = currentGroup()
    for (const route of routes) {
      const fullPath = `${prefix}${route.path}`.replace(/\/+/g, '/')
      const handler  = (instance[route.handlerKey as string] as RouteHandler).bind(instance)
      const def: RouteDefinition = {
        method:     route.method,
        path:       fullPath,
        handler,
        middleware: [...ctrlMw, ...route.middleware],
      }
      if (group) def.group = group
      this.routes.push(def)
    }

    return this
  }

  /** Mount all routes onto a server adapter. */
  mount(server: ServerAdapter): void {
    for (const mw of this.globalMiddleware) server.applyMiddleware(mw)
    for (const route of this.routes) server.registerRoute(route)
  }

  /** All registered routes — useful for `routes:list`. */
  list(): RouteDefinition[] {
    return [...this.routes]
  }
}

// ─── Global router instance ────────────────────────────────

export const router = new Router()

/** Alias for router — Laravel-style capitalised name */
export const Route = router

// ─── route() helper ────────────────────────────────────────

/**
 * Generate a URL from a named route.
 *
 * - Route parameters (`:id`) are substituted from `params`.
 * - Optional parameters (`:id?`) are omitted when not provided.
 * - Unused params are appended as a query string.
 *
 * @example
 * route('users.show', { id: 42 })           // '/users/42'
 * route('search', { q: 'hello', page: 2 })  // '/search?q=hello&page=2'
 */
export function route(name: string, params: Record<string, string | number> = {}): string {
  const path = router.getNamedRoute(name)
  if (path === undefined) throw new Error(`[RudderJS] Named route "${name}" is not defined.`)

  const used = new Set<string>()

  let result = path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)(\?)?/g, (_match, key: string, optional: string | undefined) => {
    if (key in params) {
      used.add(key)
      return String(params[key])
    }
    if (optional) return ''
    throw new Error(`[RudderJS] Missing required parameter "${key}" for route "${name}".`)
  })

  // Remove duplicate slashes that may appear when optional params are omitted
  result = result.replace(/\/+/g, '/').replace(/\/$/, '') || '/'

  // Remaining params → query string
  const unused = Object.entries(params).filter(([k]) => !used.has(k))
  if (unused.length > 0) {
    const qs = new URLSearchParams(unused.map(([k, v]) => [k, String(v)] as [string, string])).toString()
    result += (result.includes('?') ? '&' : '?') + qs
  }

  return result
}

// ─── Url ───────────────────────────────────────────────────

let _urlKey = ''

function _getSigningKey(): string {
  const key = _urlKey || process.env['APP_KEY'] || ''
  if (!key) throw new Error('[RudderJS] No signing key configured. Set APP_KEY in your .env or call Url.setKey().')
  return key
}

function _splitPath(path: string): [string, string] {
  const idx = path.indexOf('?')
  return idx === -1 ? [path, ''] : [path.slice(0, idx), path.slice(idx + 1)]
}

function _computeSignature(pathname: string, params: URLSearchParams): string {
  // Sort params for deterministic signing (exclude 'signature' itself)
  const sorted = new URLSearchParams(
    [...params.entries()]
      .filter(([k]) => k !== 'signature')
      .sort(([a], [b]) => a.localeCompare(b))
  )
  const toSign = sorted.size > 0 ? `${pathname}?${sorted.toString()}` : pathname
  if (!_crypto) throw new Error('[RudderJS Router] node:crypto not available — Url signing requires a server environment.')
  return _crypto.createHmac('sha256', _getSigningKey()).update(toSign).digest('hex')
}

export class Url {
  /**
   * Override the HMAC signing key used for signed URLs.
   * Falls back to `process.env.APP_KEY`.
   */
  static setKey(key: string): void {
    _urlKey = key
  }

  /** The full URL of the current request. */
  static current(req: AppRequest): string {
    return req.url
  }

  /** The previous URL from the `Referer` header, or `fallback`. */
  static previous(req: AppRequest, fallback = '/'): string {
    return req.headers['referer'] ?? fallback
  }

  /**
   * Generate a signed URL for a named route.
   *
   * @example
   * Url.signedRoute('invoice.download', { id: 42 })
   * // → '/invoice/42?signature=abc123'
   */
  static signedRoute(
    name: string,
    params: Record<string, string | number> = {},
    expiresAt?: Date,
  ): string {
    return Url.sign(route(name, params), expiresAt)
  }

  /**
   * Generate a signed URL that expires after `seconds` seconds.
   *
   * @example
   * Url.temporarySignedRoute('invoice.download', 3600, { id: 42 })
   * // → '/invoice/42?expires=1234567890&signature=abc123'
   */
  static temporarySignedRoute(
    name: string,
    seconds: number,
    params: Record<string, string | number> = {},
  ): string {
    return Url.signedRoute(name, params, new Date(Date.now() + seconds * 1000))
  }

  /**
   * Sign an arbitrary path string.
   * Appends `?signature=...` (and `?expires=...` if `expiresAt` given).
   */
  static sign(path: string, expiresAt?: Date): string {
    const [pathname, search] = _splitPath(path)
    const params = new URLSearchParams(search)

    if (expiresAt) {
      params.set('expires', String(Math.floor(expiresAt.getTime() / 1000)))
    }

    const sig = _computeSignature(pathname, params)
    params.set('signature', sig)

    return `${pathname}?${params.toString()}`
  }

  /**
   * Return `true` if the request has a valid (and non-expired) signature.
   */
  static isValidSignature(req: AppRequest): boolean {
    const [pathname, search] = _splitPath(req.url)
    const params = new URLSearchParams(search)

    const signature = params.get('signature')
    if (!signature) return false

    // Check expiry before touching the signature
    const expires = params.get('expires')
    if (expires !== null) {
      const expiry = parseInt(expires, 10)
      if (isNaN(expiry) || Date.now() / 1000 > expiry) return false
    }

    const expected = _computeSignature(pathname, params)

    try {
      if (!_crypto) return signature === expected
      return _crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    } catch {
      return false
    }
  }
}

// ─── ValidateSignature middleware ───────────────────────────

/**
 * Middleware that verifies a signed URL signature.
 * Responds with 403 if the signature is missing, invalid, or expired.
 *
 * @example
 * router.get('/invoice/:id/download', handler, [ValidateSignature()])
 */
export function ValidateSignature(): MiddlewareHandler {
  return async (req, res, next) => {
    if (!Url.isValidSignature(req)) {
      return res.status(403).json({ message: 'Invalid or expired URL signature.' })
    }
    await next()
  }
}