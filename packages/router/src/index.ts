import 'reflect-metadata'

import type {
  ServerAdapter,
  RouteDefinition,
  RouteHandler,
  MiddlewareHandler,
  HttpMethod,
  RouteGroup,
} from '@rudderjs/contracts'

import type { ZodType, z } from 'zod'

import type { TypedHandler } from './typed-routes.js'
import { buildQueryValidator } from './query-validator.js'
import { buildBodyValidator } from './body-validator.js'
export type { ExtractParams, TypedRequest, TypedHandler } from './typed-routes.js'

/**
 * Per-route options accepted in the 3-arg form of `Router.get/post/etc`.
 *
 * The 3-arg form exists so the handler closure can be typed against the
 * Zod-inferred query/body shapes *at write time* — the bare 2-arg form
 * types `req.query` as `Record<string, string>` and `req.body` as
 * `unknown`, and chaining `.query()` / `.body()` after that can't go back
 * and re-type the closure.
 */
export interface RouteOptions<Q extends ZodType = ZodType, B extends ZodType = ZodType> {
  /** Zod schema to validate `req.query` against. Parsed result replaces `req.query`. */
  query?:      Q
  /** Zod schema to validate `req.body` against. Parsed result replaces `req.body`. */
  body?:       B
  /** Per-route middleware (prepended before the handler). */
  middleware?: MiddlewareHandler[]
}

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
// resolves.
//
// The slot is hosted on `globalThis` so it survives bundle duplication. In a
// vite-built SSR app, `@rudderjs/router` can end up loaded twice — once via
// `@rudderjs/core`'s `await import('@rudderjs/router')` (resolves to the
// linked workspace dist) and once via the SSR chunk that `routes/web.ts`
// statically imports (resolves to a vite-bundled copy). With a plain module-
// level `let`, `runWithGroup` writes to one copy's slot and `currentGroup()`
// (called by `_rb` / `registerController`) reads from the other — every route
// gets `group: undefined`, all `web` group middleware (Session / Auth /
// RateLimit / Csrf) silently no-ops. Caught by the Phase 4 scaffolder
// auth-flow E2E. Same pattern as #498/#500–#507/#516.
const CURRENT_GROUP_KEY = '__rudderjs_router_current_group__'
const _groupSlotGlobal  = globalThis as unknown as Record<string, RouteGroup | undefined>

/**
 * Tag every route registered while `fn` runs with `group` ('web' | 'api').
 *
 * **Synchronous bodies are the supported case.** Route loaders call
 * `Route.get/post/...` at module-evaluation time — those calls complete
 * before `fn` resolves, even when `fn` is `async`. The implementation
 * supports an async `fn` (restoring the previous group in a `.finally()`),
 * but two concurrent `runWithGroup` invocations will clobber each other:
 * this is a single global slot, not an AsyncLocalStorage scope. Callers
 * must run loaders **serially** — see `@rudderjs/core`'s `withRouting()`
 * which sequentially `await`s each loader.
 *
 * Outside any `runWithGroup` scope, routes register without a group tag and
 * receive only global `m.use(...)` middleware (no `m.web(...)` / `m.api(...)`
 * stack).
 */
export function runWithGroup<R>(group: RouteGroup, fn: () => R | Promise<R>): R | Promise<R> {
  const prev = _groupSlotGlobal[CURRENT_GROUP_KEY]
  _groupSlotGlobal[CURRENT_GROUP_KEY] = group
  try {
    const out = fn()
    if (out instanceof Promise) {
      return out.finally(() => { _groupSlotGlobal[CURRENT_GROUP_KEY] = prev })
    }
    _groupSlotGlobal[CURRENT_GROUP_KEY] = prev
    return out
  } catch (e) {
    _groupSlotGlobal[CURRENT_GROUP_KEY] = prev
    throw e
  }
}

/**
 * Read the current group tag. Returns `undefined` outside any
 * `runWithGroup(...)` block. Called by route decorators to stamp each
 * `RouteDefinition` with its group.
 */
export function currentGroup(): RouteGroup | undefined {
  return _groupSlotGlobal[CURRENT_GROUP_KEY]
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

// ─── Path utilities ────────────────────────────────────────

/**
 * Walk a balanced `{ ... }` block starting at `i` (must point at the opening
 * `{`). Returns the index AFTER the matching `}`, or `path.length` if the
 * block is unterminated. Recognises:
 *
 *   - `\<char>` escape pairs — `\{` and `\}` from regex-escaped values
 *     (e.g. `whereIn(['x}y'])`) don't affect depth.
 *   - `[ ... ]` character classes — `{` and `}` inside `[^}]`-style classes
 *     are literal and don't affect depth.
 *
 * Used by both `stripRegexSegments()` and `RouteBuilder.where()`'s scanner so
 * the two stay in lock-step on regex syntax recognition.
 */
function consumeBraceBlock(path: string, i: number): number {
  let depth   = 1
  let inClass = false
  i++
  while (i < path.length && depth > 0) {
    const ch = path[i]
    if (ch === '\\') { i += 2; continue }
    if (inClass) {
      if (ch === ']') inClass = false
    } else {
      if      (ch === '[') inClass = true
      else if (ch === '{') depth++
      else if (ch === '}') depth--
    }
    i++
  }
  return i
}

/**
 * Remove every balanced `{...}` block from a path. Used to peel off
 * `where*()` regex constraint segments before scanning the path for `:param`
 * names.
 */
/** @internal — exported so sibling modules (binding-middleware) can reuse. */
export function stripRegexSegments(path: string): string {
  let out = ''
  let i = 0
  while (i < path.length) {
    if (path[i] !== '{') { out += path[i]; i++; continue }
    i = consumeBraceBlock(path, i)
  }
  return out
}

// ─── Route param constraint patterns ──────────────────────
//
// Reusable regex shards consumed by `RouteBuilder.where*()` and exported so
// app code can compose its own Hono `:param{pattern}` strings if needed.

/** Matches one or more digits — `[0-9]+`. */
export const ROUTE_PATTERN_NUMBER   = '[0-9]+'
/** Matches one or more ASCII letters — `[A-Za-z]+`. */
export const ROUTE_PATTERN_ALPHA    = '[A-Za-z]+'
/** Matches one or more ASCII letters or digits — `[A-Za-z0-9]+`. */
export const ROUTE_PATTERN_ALPHANUM = '[A-Za-z0-9]+'
/** Matches a UUID of any version (case-insensitive). */
export const ROUTE_PATTERN_UUID     = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
/** Matches a Crockford base32 ULID (26 chars). */
export const ROUTE_PATTERN_ULID     = '[0-7][0-9A-HJKMNP-TV-Z]{25}'

// ─── RouteBuilder ──────────────────────────────────────────

/**
 * Returned by `router.get/post/etc` — allows naming the registered route and
 * constraining `:param` segments via Laravel-style `where*` shortcuts.
 *
 * @example
 * router.get('/users/:id', handler).name('users.show').whereNumber('id')
 * route('users.show', { id: 1 })  // → '/users/1'
 */
export class RouteBuilder<
  P extends string = string,  // path literal — preserved for .query() / .body() chains
  Q = Record<string, string>, // query shape — replaced by .query(schema) overload
  B = unknown,                // body shape  — replaced by .body(schema) overload
> {
  // Phantom branding so `P`/`Q`/`B` participate in structural typing — keeps
  // distinct `RouteBuilder<'/a'>` and `RouteBuilder<'/b'>` from collapsing.
  declare readonly _path:  P
  declare readonly _query: Q
  declare readonly _body:  B

  constructor(
    private readonly definition: RouteDefinition,
    private readonly _router: Router,
  ) {}

  /** Assign a name to this route for use with `route()` and `Url.signedRoute()`. */
  name(n: string): this {
    // Pass the definition itself so later `where*()` calls (which mutate
    // `definition.path`) are reflected when the named route is looked up.
    this._router._registerName(n, this.definition)
    return this
  }

  /**
   * Constrain a `:param` segment with a custom regex. Accepts either a string
   * (used verbatim) or a `RegExp` (its `.source` is taken — flags are dropped
   * automatically; anchors `^` / `$` pass through but are typically redundant
   * since Hono anchors per-segment).
   *
   * Mutates the route's path in place to `:param{pattern}` (Hono regex syntax).
   * Calling `where*` again on the same param overwrites the previous pattern.
   *
   * Throws if the route path has no `:param` segment.
   */
  where(param: string, regex: string | RegExp): this {
    const pattern = regex instanceof RegExp ? regex.source : regex
    const path    = this.definition.path
    let out       = ''
    let matched   = false
    let i         = 0

    while (i < path.length) {
      if (path[i] !== ':') { out += path[i]; i++; continue }

      // Scan a `:paramName(?)?{balanced regex}?` segment.
      let j = i + 1
      while (j < path.length && /[A-Za-z0-9_]/.test(path[j] ?? '')) j++
      const name = path.slice(i + 1, j)
      let opt = ''
      if (path[j] === '?') { opt = '?'; j++ }

      // Consume a balanced `{ ... }` block via the shared scanner — handles
      // `[0-9]{8}`-style nesting, `\{`/`\}` escapes, and `}` literals inside
      // `[^}]`-style character classes.
      const bodyEnd = path[j] === '{' ? consumeBraceBlock(path, j) : j

      if (name === param) {
        out += `:${name}${opt}{${pattern}}`
        matched = true
      } else {
        out += path.slice(i, bodyEnd)
      }
      i = bodyEnd
    }

    if (!matched) {
      throw new Error(`[RudderJS Router] where("${param}", ...) — route path "${path}" has no :${param} segment.`)
    }
    this.definition.path = out
    return this
  }

  /** Constrain `:param` to one or more digits. */
  whereNumber(param: string): this { return this.where(param, ROUTE_PATTERN_NUMBER) }

  /** Constrain `:param` to one or more ASCII letters. */
  whereAlpha(param: string): this { return this.where(param, ROUTE_PATTERN_ALPHA) }

  /** Constrain `:param` to one or more ASCII letters or digits. */
  whereAlphaNumeric(param: string): this { return this.where(param, ROUTE_PATTERN_ALPHANUM) }

  /** Constrain `:param` to a UUID of any version. */
  whereUuid(param: string): this { return this.where(param, ROUTE_PATTERN_UUID) }

  /** Constrain `:param` to a Crockford base32 ULID. */
  whereUlid(param: string): this { return this.where(param, ROUTE_PATTERN_ULID) }

  /**
   * Constrain `:param` to one of the supplied literal values. Each value is
   * regex-escaped, so `'a.b'` matches the literal string `a.b`, not "a then any
   * char then b". Throws when `values` is empty.
   *
   * @example
   * router.get('/posts/:status', handler).whereIn('status', ['draft', 'published'])
   */
  whereIn(param: string, values: readonly (string | number)[]): this {
    if (values.length === 0) {
      throw new Error(`[RudderJS Router] whereIn("${param}", []) — values must be non-empty.`)
    }
    const escaped = values.map(v => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    return this.where(param, `(?:${escaped.join('|')})`)
  }

  /**
   * Restrict this route to a specific subdomain. The template is matched against
   * the request's `Host` header (port stripped, case-insensitive); `:param`
   * segments capture into `req.params` alongside path params.
   *
   * @example
   * router.get('/users', listUsers).domain('api.example.com')
   * router.get('/admin', dash).domain(':tenant.example.com')  // captures req.params.tenant
   */
  domain(template: string): this {
    this.definition.host = template
    return this
  }

  /**
   * Custom response when an explicit route binding (`router.bind('user', User)`)
   * resolves to `null`. Receives the request and the not-found error; return any
   * value a handler may return (`Response`, plain object → JSON, string → body,
   * or `undefined` after writing to `res` directly). Does not fire for optional
   * bindings — those quietly resolve to `null` instead.
   *
   * @example
   * router.get('/users/:user', show)
   *   .missing((_req, err) => Response.json({ error: err.message }, { status: 404 }))
   */
  missing(fn: NonNullable<RouteDefinition['missing']>): this {
    this.definition.missing = fn
    return this
  }

  /**
   * Install a Zod validator on `req.query` for this route. The parsed result
   * replaces `req.query` at request time, so `z.coerce.number()` end-to-end
   * works.
   *
   * **Note on typing:** the handler was already passed (and typed) when this
   * route was registered. Chaining `.query(schema)` AFTER cannot re-type a
   * closure that's already been bound. The returned `RouteBuilder<P, z.infer<S>>`
   * carries the inferred query for downstream chain methods, but the
   * already-registered handler still sees the original typing of its closure.
   *
   * For type-safe query at the handler closure, use the opts-object form:
   *
   * @example
   * // Type-safe (handler closure sees `req.query.page: number`)
   * Route.get('/users', { query: z.object({ page: z.coerce.number() }) }, (req) => req.query.page)
   *
   * // Runtime-only (validation runs, but `req.query.page` is still typed string)
   * Route.get('/users', (req) => req.query.page).query(z.object({ page: z.coerce.number() }))
   */
  query<S extends ZodType>(schema: S): RouteBuilder<P, z.infer<S>, B> {
    // Prepend so the validator runs before any other per-route middleware.
    this.definition.middleware.unshift(buildQueryValidator(schema))
    return this as unknown as RouteBuilder<P, z.infer<S>, B>
  }

  /**
   * Install a Zod validator on `req.body` for this route. Mirrors `.query()`:
   * the parsed result replaces `req.body` so the handler sees the inferred
   * shape end-to-end (including `z.coerce.*` / `z.transform()` / `.default()`).
   *
   * **Note on typing:** the handler was already passed (and typed) when this
   * route was registered. Chaining `.body(schema)` AFTER cannot re-type a
   * closure that's already been bound. The returned `RouteBuilder<P, Q, z.infer<S>>`
   * carries the inferred body for downstream chain methods, but the
   * already-registered handler still sees its original body typing.
   *
   * For type-safe body at the handler closure, use the opts-object form:
   *
   * @example
   * // Type-safe (handler closure sees `req.body.title: string`)
   * Route.post('/posts', { body: z.object({ title: z.string() }) }, (req) => req.body.title)
   *
   * // Runtime-only (validation runs, but `req.body` is still typed unknown)
   * Route.post('/posts', (req) => req.body).body(z.object({ title: z.string() }))
   */
  body<S extends ZodType>(schema: S): RouteBuilder<P, Q, z.infer<S>> {
    // Prepend so the validator runs before any other per-route middleware.
    this.definition.middleware.unshift(buildBodyValidator(schema))
    return this as unknown as RouteBuilder<P, Q, z.infer<S>>
  }
}

// ─── Route Group Options ───────────────────────────────────

/**
 * Options accepted by `router.group(opts, fn)`. Each route registered inside
 * `fn` inherits the prefix, domain, and middleware. Nested groups concatenate
 * prefixes and middleware; the innermost defined `domain` wins (hosts can't
 * compose). Distinct from `runWithGroup('web' | 'api', …)`, which only tags
 * routes with their middleware-group label.
 */
export interface RouteGroupOptions {
  /** Path prefix applied to every route registered in the group. */
  prefix?:     string
  /** Subdomain template applied to every route registered in the group. */
  domain?:     string
  /** Middleware prepended to every route's chain (before per-route middleware). */
  middleware?: MiddlewareHandler[]
}

// ─── Route Model Binding ───────────────────────────────────

import {
  buildBindingMiddleware,
  type RouteResolver,
  type RouteBindingOptions,
  type RouteBinding,
} from './binding-middleware.js'
export { RouteModelNotFoundError } from './binding-middleware.js'
export type { RouteResolver, RouteBindingOptions } from './binding-middleware.js'

// ─── Router ────────────────────────────────────────────────

export class Router {
  private routes: RouteDefinition[] = []
  private globalMiddleware: MiddlewareHandler[] = []
  private namedRoutes = new Map<string, RouteDefinition>()
  private bindings = new Map<string, RouteBinding>()
  /**
   * Active `group()` scopes, outermost first. Synchronous module-level state
   * is fine — route loaders execute synchronously at module evaluation, and
   * `group()` only mutates the stack inside its own callback's lifetime.
   */
  private _groupStack: RouteGroupOptions[] = []

  /** @internal — called by RouteBuilder */
  _registerName(name: string, def: RouteDefinition): void {
    this.namedRoutes.set(name, def)
  }

  /** Look up a named route's path. Reflects any `where*()` mutations. */
  getNamedRoute(name: string): string | undefined {
    return this.namedRoutes.get(name)?.path
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
    const out: Record<string, string> = {}
    for (const [name, def] of this.namedRoutes) out[name] = def.path
    return out
  }

  /** Clear registered routes, middleware, named routes, and route bindings. */
  reset(): this {
    this.routes = []
    this.globalMiddleware = []
    this.namedRoutes.clear()
    this.bindings.clear()
    this._groupStack = []
    return this
  }

  /**
   * Run `fn` with a group scope active. Every route registered (via fluent
   * `.get()`/`.post()`/etc. or `registerController()`) inside `fn` inherits
   * the group's `prefix`, `domain`, and `middleware`. Nested calls compose:
   * prefixes concatenate, middleware stacks accumulate, the innermost defined
   * `domain` wins.
   *
   * Distinct from `runWithGroup('web' | 'api', …)` — that tags routes with
   * their middleware-group label (web vs api) and is called once by the
   * framework's route loader. `router.group()` is the user-facing scoping
   * primitive; both can be active at the same time.
   *
   * @example
   * router.group({ prefix: '/admin', middleware: [adminAuth] }, () => {
   *   router.get('/users', listUsers)        // GET /admin/users (with adminAuth)
   *   router.get('/posts', listPosts)        // GET /admin/posts (with adminAuth)
   * })
   *
   * router.group({ domain: ':tenant.example.com', prefix: '/api' }, () => {
   *   router.get('/me', me)                  // GET :tenant.example.com/api/me
   * })
   */
  group(opts: RouteGroupOptions, fn: () => void): this {
    this._groupStack = [...this._groupStack, opts]
    try { fn() } finally { this._groupStack = this._groupStack.slice(0, -1) }
    return this
  }

  /**
   * Compose the active group stack into the values used to register a route.
   * Path prefixes concatenate (and collapse `/+` to `/`), middleware stacks
   * concatenate, the innermost defined `host` wins.
   */
  private _applyGroupStack(
    path: string,
    middleware: MiddlewareHandler[],
  ): { path: string; middleware: MiddlewareHandler[]; host: string | undefined } {
    if (this._groupStack.length === 0) {
      return { path, middleware, host: undefined }
    }
    let prefix = ''
    let host: string | undefined
    const groupMw: MiddlewareHandler[] = []
    for (const g of this._groupStack) {
      if (g.prefix)     prefix += g.prefix
      if (g.domain)     host = g.domain
      if (g.middleware) groupMw.push(...g.middleware)
    }
    const composedPath = `${prefix}${path}`.replace(/\/+/g, '/')
    return {
      path:       composedPath,
      middleware: [...groupMw, ...middleware],
      host,
    }
  }

  /** Register a global middleware (runs on every route). */
  use(middleware: MiddlewareHandler): this {
    this.globalMiddleware.push(middleware)
    return this
  }

  /**
   * Bind a route parameter name to a resolver. When a route's path contains
   * `:<name>`, the matching string param is resolved before the handler runs;
   * the result is exposed as `req.bound[name]`. The raw string remains in
   * `req.params[name]` so existing code keeps working.
   *
   * Resolvers are duck-typed — pass any class with a static `findForRoute(val)`
   * method (`@rudderjs/orm` Model classes match by default). Bindings are
   * opt-in: routes whose path does not include the bound `:name` are unaffected.
   *
   * @example
   * import { router } from '@rudderjs/router'
   * import { User } from '../app/Models/User.js'
   *
   * router.bind('user', User)
   * router.get('/users/:user', (req) => req.bound!['user'])
   *
   * // Custom column → declare on the model:
   * class Post extends Model {
   *   static override routeKey = 'slug'
   * }
   * router.bind('post', Post)  // resolves /posts/:post by slug
   *
   * // Optional binding — null when missing instead of 404:
   * router.bind('viewer', User, { optional: true })
   */
  bind(name: string, resolver: RouteResolver, options: RouteBindingOptions = {}): this {
    this.bindings.set(name, { resolver, optional: options.optional ?? false })
    return this
  }

  /** All registered route bindings, keyed by param name. */
  listBindings(): Record<string, RouteResolver> {
    const out: Record<string, RouteResolver> = {}
    for (const [name, binding] of this.bindings) out[name] = binding.resolver
    return out
  }

  /**
   * Build the per-route binding middleware. Walks the route's `:param` segments,
   * looks them up in the binding map, and resolves each before calling `next()`.
   * No-op for routes whose path contains no bound params.
   *
   * Takes the full `RouteDefinition` (not just path) so the closure can capture
   * `def.missing` — the per-route 404 customisation set via `RouteBuilder.missing()`.
   */
  private _buildBindingMiddleware(def: RouteDefinition): MiddlewareHandler | null {
    return buildBindingMiddleware(this.bindings, def)
  }

  /** Manually register a route. Returns `this` for bulk registration. */
  add(
    method: HttpMethod,
    path: string,
    handler: RouteHandler,
    middleware: MiddlewareHandler[] = [],
  ): this {
    const composed = this._applyGroupStack(path, middleware)
    const def: RouteDefinition = {
      method,
      path:       composed.path,
      handler,
      middleware: composed.middleware,
    }
    if (composed.host) def.host = composed.host
    const group = currentGroup()
    if (group) def.group = group
    this.routes.push(def)
    return this
  }

  // ── Shorthand methods — return RouteBuilder for .name() support ──
  //
  // Four overloads per verb, ordered most-specific to least-specific (TS picks
  // the FIRST matching overload — listing the broader `{ query }` / `{ body }`
  // forms first would shadow the `{ query, body }` form and `req.body` would
  // collapse to `unknown`):
  //
  //   1. `get(path, handler, middleware?)` — bare form. `req.params` is typed
  //      from `:param` segments. `req.query` is `Record<string, string>`,
  //      `req.body` is `unknown`.
  //   2. `get(path, { query, body }, handler)` — both schemas. Both `req.query`
  //      and `req.body` typed from Zod inference.
  //   3. `get(path, { query }, handler)` — typed query only.
  //   4. `get(path, { body }, handler)` — typed body only.
  //
  // Validator middleware is installed automatically and replaces the parsed
  // field at request time so `z.coerce.*`/`z.transform()` work end-to-end.

  get   <P extends string>(path: P, handler: TypedHandler<P>, middleware?: MiddlewareHandler[]): RouteBuilder<P>
  get   <P extends string, Q extends ZodType, B extends ZodType>(path: P, opts: RouteOptions<Q, B> & { query: Q; body: B }, handler: TypedHandler<P, z.infer<Q>, z.infer<B>>): RouteBuilder<P, z.infer<Q>, z.infer<B>>
  get   <P extends string, Q extends ZodType>(path: P, opts: RouteOptions<Q>          & { query: Q          }, handler: TypedHandler<P, z.infer<Q>>):              RouteBuilder<P, z.infer<Q>>
  get   <P extends string, B extends ZodType>(path: P, opts: RouteOptions<ZodType, B> & { body:  B          }, handler: TypedHandler<P, Record<string, string>, z.infer<B>>): RouteBuilder<P, Record<string, string>, z.infer<B>>
  // Impl signature — `b` is intentionally `unknown` so all four typed
  // overload-handler shapes (bare / query / body / both) are assignment-
  // compatible. The runtime cast back to `RouteHandler` happens in `_verb`.
  get   <P extends string>(path: P, a: TypedHandler<P> | RouteOptions, b?: unknown): RouteBuilder<P> { return this._verb('GET', path, a, b as MiddlewareHandler[] | RouteHandler | undefined) }

  post  <P extends string>(path: P, handler: TypedHandler<P>, middleware?: MiddlewareHandler[]): RouteBuilder<P>
  post  <P extends string, Q extends ZodType, B extends ZodType>(path: P, opts: RouteOptions<Q, B> & { query: Q; body: B }, handler: TypedHandler<P, z.infer<Q>, z.infer<B>>): RouteBuilder<P, z.infer<Q>, z.infer<B>>
  post  <P extends string, Q extends ZodType>(path: P, opts: RouteOptions<Q>          & { query: Q          }, handler: TypedHandler<P, z.infer<Q>>):              RouteBuilder<P, z.infer<Q>>
  post  <P extends string, B extends ZodType>(path: P, opts: RouteOptions<ZodType, B> & { body:  B          }, handler: TypedHandler<P, Record<string, string>, z.infer<B>>): RouteBuilder<P, Record<string, string>, z.infer<B>>
  post  <P extends string>(path: P, a: TypedHandler<P> | RouteOptions, b?: unknown): RouteBuilder<P> { return this._verb('POST', path, a, b as MiddlewareHandler[] | RouteHandler | undefined) }

  put   <P extends string>(path: P, handler: TypedHandler<P>, middleware?: MiddlewareHandler[]): RouteBuilder<P>
  put   <P extends string, Q extends ZodType, B extends ZodType>(path: P, opts: RouteOptions<Q, B> & { query: Q; body: B }, handler: TypedHandler<P, z.infer<Q>, z.infer<B>>): RouteBuilder<P, z.infer<Q>, z.infer<B>>
  put   <P extends string, Q extends ZodType>(path: P, opts: RouteOptions<Q>          & { query: Q          }, handler: TypedHandler<P, z.infer<Q>>):              RouteBuilder<P, z.infer<Q>>
  put   <P extends string, B extends ZodType>(path: P, opts: RouteOptions<ZodType, B> & { body:  B          }, handler: TypedHandler<P, Record<string, string>, z.infer<B>>): RouteBuilder<P, Record<string, string>, z.infer<B>>
  put   <P extends string>(path: P, a: TypedHandler<P> | RouteOptions, b?: unknown): RouteBuilder<P> { return this._verb('PUT', path, a, b as MiddlewareHandler[] | RouteHandler | undefined) }

  patch <P extends string>(path: P, handler: TypedHandler<P>, middleware?: MiddlewareHandler[]): RouteBuilder<P>
  patch <P extends string, Q extends ZodType, B extends ZodType>(path: P, opts: RouteOptions<Q, B> & { query: Q; body: B }, handler: TypedHandler<P, z.infer<Q>, z.infer<B>>): RouteBuilder<P, z.infer<Q>, z.infer<B>>
  patch <P extends string, Q extends ZodType>(path: P, opts: RouteOptions<Q>          & { query: Q          }, handler: TypedHandler<P, z.infer<Q>>):              RouteBuilder<P, z.infer<Q>>
  patch <P extends string, B extends ZodType>(path: P, opts: RouteOptions<ZodType, B> & { body:  B          }, handler: TypedHandler<P, Record<string, string>, z.infer<B>>): RouteBuilder<P, Record<string, string>, z.infer<B>>
  patch <P extends string>(path: P, a: TypedHandler<P> | RouteOptions, b?: unknown): RouteBuilder<P> { return this._verb('PATCH', path, a, b as MiddlewareHandler[] | RouteHandler | undefined) }

  delete<P extends string>(path: P, handler: TypedHandler<P>, middleware?: MiddlewareHandler[]): RouteBuilder<P>
  delete<P extends string, Q extends ZodType, B extends ZodType>(path: P, opts: RouteOptions<Q, B> & { query: Q; body: B }, handler: TypedHandler<P, z.infer<Q>, z.infer<B>>): RouteBuilder<P, z.infer<Q>, z.infer<B>>
  delete<P extends string, Q extends ZodType>(path: P, opts: RouteOptions<Q>          & { query: Q          }, handler: TypedHandler<P, z.infer<Q>>):              RouteBuilder<P, z.infer<Q>>
  delete<P extends string, B extends ZodType>(path: P, opts: RouteOptions<ZodType, B> & { body:  B          }, handler: TypedHandler<P, Record<string, string>, z.infer<B>>): RouteBuilder<P, Record<string, string>, z.infer<B>>
  delete<P extends string>(path: P, a: TypedHandler<P> | RouteOptions, b?: unknown): RouteBuilder<P> { return this._verb('DELETE', path, a, b as MiddlewareHandler[] | RouteHandler | undefined) }

  all   <P extends string>(path: P, handler: TypedHandler<P>, middleware?: MiddlewareHandler[]): RouteBuilder<P>
  all   <P extends string, Q extends ZodType, B extends ZodType>(path: P, opts: RouteOptions<Q, B> & { query: Q; body: B }, handler: TypedHandler<P, z.infer<Q>, z.infer<B>>): RouteBuilder<P, z.infer<Q>, z.infer<B>>
  all   <P extends string, Q extends ZodType>(path: P, opts: RouteOptions<Q>          & { query: Q          }, handler: TypedHandler<P, z.infer<Q>>):              RouteBuilder<P, z.infer<Q>>
  all   <P extends string, B extends ZodType>(path: P, opts: RouteOptions<ZodType, B> & { body:  B          }, handler: TypedHandler<P, Record<string, string>, z.infer<B>>): RouteBuilder<P, Record<string, string>, z.infer<B>>
  all   <P extends string>(path: P, a: TypedHandler<P> | RouteOptions, b?: unknown): RouteBuilder<P> { return this._verb('ALL', path, a, b as MiddlewareHandler[] | RouteHandler | undefined) }

  /**
   * Internal dispatcher for the four-overload shorthand methods. Decides
   * between bare and opts form by whether the second arg is callable.
   *
   * Middleware order in the opts form: query validator (if any) → body
   * validator (if any) → user middleware. Validators run first so the
   * handler's typed `req.query` / `req.body` are parsed before any
   * user-supplied middleware runs.
   */
  private _verb<P extends string>(
    method: HttpMethod,
    path: P,
    a: TypedHandler<P> | RouteOptions,
    b?: MiddlewareHandler[] | RouteHandler,
  ): RouteBuilder<P> {
    if (typeof a === 'function') {
      // Bare form: (path, handler, middleware?)
      return this._rb(method, path, a as RouteHandler, b as MiddlewareHandler[] | undefined) as RouteBuilder<P>
    }
    // Opts form: (path, { query, body, middleware }, handler)
    const opts = a
    const handler = b as RouteHandler
    const mw: MiddlewareHandler[] = []
    if (opts.query)      mw.push(buildQueryValidator(opts.query))
    if (opts.body)       mw.push(buildBodyValidator(opts.body))
    if (opts.middleware) mw.push(...opts.middleware)
    return this._rb(method, path, handler, mw) as RouteBuilder<P>
  }

  /**
   * Register a catch-all fallback route. Runs when no other route matches.
   * Register it last — Hono evaluates routes in registration order.
   *
   * @example
   * router.fallback((_req, res) => res.status(404).json({ message: 'Not found' }))
   */
  fallback(handler: RouteHandler, middleware: MiddlewareHandler[] = []): RouteBuilder {
    return this.all('*', handler, middleware)
  }

  private _rb(method: HttpMethod, path: string, handler: RouteHandler, middleware: MiddlewareHandler[] = []): RouteBuilder {
    const composed = this._applyGroupStack(path, middleware)
    const def: RouteDefinition = {
      method,
      path:       composed.path,
      handler,
      middleware: composed.middleware,
    }
    if (composed.host) def.host = composed.host
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
      // Native bound fns get name "bound <method>" — overwrite with
      // "Controller@method" for telescope / observability.
      Object.defineProperty(handler, 'name', {
        value:        `${ControllerClass.name}@${String(route.handlerKey)}`,
        configurable: true,
      })
      const composed = this._applyGroupStack(fullPath, [...ctrlMw, ...route.middleware])
      const def: RouteDefinition = {
        method:     route.method,
        path:       composed.path,
        handler,
        middleware: composed.middleware,
      }
      if (composed.host) def.host = composed.host
      if (group) def.group = group
      this.routes.push(def)
    }

    return this
  }

  /** Mount all routes onto a server adapter. */
  mount(server: ServerAdapter): void {
    for (const mw of this.globalMiddleware) server.applyMiddleware(mw)
    for (const route of this.routes) {
      const bindingMw = this._buildBindingMiddleware(route)
      if (bindingMw) {
        server.registerRoute({
          ...route,
          middleware: [bindingMw, ...route.middleware],
        })
      } else {
        server.registerRoute(route)
      }
    }
  }

  /** All registered routes — useful for `routes:list`. */
  list(): RouteDefinition[] {
    return [...this.routes]
  }

  // ── Resource controllers ───────────────────────────────────

  /**
   * Register the canonical seven CRUD routes for a plain controller class:
   * `index`, `create`, `store`, `show`, `edit`, `update`, `destroy`. Methods
   * the controller doesn't implement are silently skipped, so a partial
   * controller works without `only`/`except` boilerplate.
   *
   * The `update` route is registered for both `PUT` and `PATCH`. Route names
   * default to `<name>.<verb>` (`posts.show`, `posts.update`). The path param
   * defaults to a naive singular (`posts` → `:post`); pass
   * `{ parameters: { posts: 'article' } }` to override.
   *
   * Use plain method names — no decorators. Call `router.registerController()`
   * for decorator-driven controllers instead.
   *
   * @example
   * router.resource('posts', PostController)
   * router.resource('posts', PostController, { only: ['index', 'show'] })
   * router.resource('posts', PostController, { middleware: [authMw] })
   */
  resource(name: string, Ctrl: new () => object, opts: ResourceOptions = {}): ResourceRegistration {
    return this._registerResource(name, Ctrl, RESOURCE_VERBS, opts)
  }

  /**
   * Register an API-only resource — the same routes as `resource()` minus
   * `create` and `edit`, since those render HTML forms and have no JSON
   * equivalent.
   *
   * @example
   * router.apiResource('posts', PostController)
   */
  apiResource(name: string, Ctrl: new () => object, opts: ResourceOptions = {}): ResourceRegistration {
    return this._registerResource(name, Ctrl, RESOURCE_VERBS, {
      ...opts,
      except: [...(opts.except ?? []), 'create', 'edit'],
    })
  }

  /**
   * Register a singleton resource — `show`, `edit`, `update` only. Use for
   * "the current user's profile" / "the application's settings" style
   * resources where there's only ever one of the thing.
   *
   * Add a creation flow with `.creatable()` (registers `create` + `store`) or
   * a deletion flow with `.destroyable()` (registers `destroy`).
   *
   * @example
   * router.singleton('profile', ProfileController)            // /profile + /profile/edit
   * router.singleton('profile', ProfileController).creatable() // also /profile/create + POST /profile
   */
  singleton(name: string, Ctrl: new () => object, opts: ResourceOptions = {}): SingletonRegistration {
    const reg = this._registerResource(name, Ctrl, SINGLETON_VERBS, opts)
    return new SingletonRegistration(reg.builders, this, name, Ctrl, opts)
  }

  /** @internal — shared registration loop for resource/apiResource/singleton. */
  _registerResource(
    name: string,
    Ctrl: new () => object,
    table: readonly ResourceVerbSpec[],
    opts: ResourceOptions,
  ): ResourceRegistration {
    const instance  = new Ctrl() as Record<string, unknown>
    const verbs     = filterVerbs(table, opts)
    const paramName = opts.parameters?.[name] ?? singularize(name)
    const builders: RouteBuilder[] = []

    for (const spec of verbs) {
      const fn = instance[spec.verb]
      if (typeof fn !== 'function') continue                              // partial controller — skip
      const path    = spec.path(name, paramName)
      const handler = (fn as RouteHandler).bind(instance)
      Object.defineProperty(handler, 'name', {
        value:        `${Ctrl.name}@${spec.verb}`,
        configurable: true,
      })

      const builder = this._rb(spec.method, path, handler, opts.middleware ?? [])
      builder.name(opts.names?.[spec.verb] ?? `${name}.${spec.nameSuffix}`)
      builders.push(builder)

      if (spec.verb === 'update') {
        // `update` registers PUT + PATCH at the same path. The PATCH route
        // doesn't get a name to avoid a collision with the PUT route's name —
        // both verbs resolve the same path, so `route('posts.update')` works
        // for either.
        const patch = this._rb('PATCH', path, handler, opts.middleware ?? [])
        builders.push(patch)
      }
    }
    return new ResourceRegistration(builders)
  }
}

// ─── Resource verb tables / helpers ────────────────────────

import {
  RESOURCE_VERBS,
  SINGLETON_VERBS,
  filterVerbs,
  singularize,
  ResourceRegistration,
  SingletonRegistration,
  type ResourceOptions,
  type ResourceVerbSpec,
} from './resource.js'
export type { ResourceVerb, ResourceOptions } from './resource.js'
export { ResourceRegistration, SingletonRegistration } from './resource.js'

// ─── Global router instance ────────────────────────────────
//
// The singleton lives on `globalThis` (not at module scope) so consumers that
// reach the router through two different module instances — typically a
// bundled app (entry.mjs) plus a node_modules copy loaded by
// `resolveOptionalPeer('@rudderjs/router')` — see the same routes/middleware
// arrays. A module-level `new Router()` splits into independent instances:
// e.g. `@rudderjs/mcp`'s `McpProvider.boot()` registers `/mcp/echo` on the
// node_modules copy, while server-hono dispatches against the bundled copy,
// so the route silently 404s. Matches the pattern used by
// `groupMiddlewareStore` in `@rudderjs/core` and the static-state registries
// audited in PRs #498/#500–#506.

const ROUTER_KEY = '__rudderjs_router__'
const _routerGlobal = globalThis as Record<string, unknown>
export const router: Router = (_routerGlobal[ROUTER_KEY] as Router | undefined) ?? (() => {
  const r = new Router()
  _routerGlobal[ROUTER_KEY] = r
  return r
})()

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

  // Strip `:param{regex}` constraint segments before substitution so the
  // simple param-name regex doesn't get confused by nested braces (UUID's
  // `[0-9a-f]{8}-...{12}` etc.).
  let result = stripRegexSegments(path).replace(/:([a-zA-Z_][a-zA-Z0-9_]*)(\?)?/g, (_match, key: string, optional: string | undefined) => {
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

// ─── URL signing ───────────────────────────────────────────

export { Url, ValidateSignature } from './url-signing.js'