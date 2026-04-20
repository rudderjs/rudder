import { Container, ContextualBindingBuilder, container } from './di.js'
import { ServiceProvider } from './service-provider.js'
import { Env, ConfigRepository, setConfigRepository } from '@rudderjs/support'
import type { ServerAdapterProvider, ServerAdapter, FetchHandler, MiddlewareHandler, AppRequest } from '@rudderjs/contracts'
import { rudder } from '@rudderjs/rudder'
import { ValidationError } from './validation.js'
import {
  HttpException,
  renderHttpException,
  renderServerError,
  report,
  setExceptionReporter,
} from './exceptions.js'
import { getLastLoadedProviderEntries } from './default-providers.js'

// ─── Config ────────────────────────────────────────────────

export interface BootConfig {
  name?:      string
  env?:       string
  debug?:     boolean
  providers?: (new (app: Application) => ServiceProvider)[]
  /** Config values loaded from config/ files — bound to the container as 'config' */
  config?:    Record<string, unknown>
}

// ─── Application ───────────────────────────────────────────

export type ProviderClass = new (app: Application) => ServiceProvider

export class Application {
  private static instance: Application
  readonly container: Container
  private providers: ServiceProvider[] = []
  private booted = false
  private _booting = false
  private _bootedProviders = new WeakSet<ServiceProvider>()

  /** Tracks registered provider classes to prevent duplicates. */
  private _registeredClasses = new Set<ProviderClass>()
  /** Tracks registered provider names to prevent duplicates from factory functions. */
  private _registeredNames   = new Set<string>()

  /** Deferred providers — token → ProviderClass (lazily booted on first resolve). */
  private _deferredProviders = new Map<string, ProviderClass>()

  readonly name:  string
  readonly env:   string
  readonly debug: boolean

  private constructor(config: BootConfig = {}) {
    this.container = container
    this.name  = config.name  ?? Env.get('APP_NAME',  'RudderJS')
    this.env   = config.env   ?? Env.get('APP_ENV',   'production')
    this.debug = config.debug ?? Env.getBool('APP_DEBUG', false)

    this.container.instance('app', this)
    this.container.instance('Application', this)

    if (config.config) {
      const repo = new ConfigRepository(config.config)
      setConfigRepository(repo)
      this.container.instance('config', repo)
    }

    for (const Provider of config.providers ?? []) {
      this._trackProvider(Provider)
      this.providers.push(new Provider(this))
    }
  }

  /** Track a provider class for duplicate detection. */
  private _trackProvider(Provider: ProviderClass): void {
    this._registeredClasses.add(Provider)
    if (Provider.name) this._registeredNames.add(Provider.name)
  }

  /** Check whether a provider class (or its name) has already been registered. */
  private _isDuplicate(Provider: ProviderClass): boolean {
    if (this._registeredClasses.has(Provider)) return true
    if (Provider.name && this._registeredNames.has(Provider.name)) return true
    return false
  }

  static create(config?: BootConfig): Application {
    const g = globalThis as Record<string, unknown>

    if (!g['__rudderjs_app__']) {
      g['__rudderjs_app__'] = new Application(config)
    }
    Application.instance = g['__rudderjs_app__'] as Application
    return Application.instance
  }

  static getInstance(): Application {
    const g = globalThis as Record<string, unknown>
    const inst = (g['__rudderjs_app__'] ?? Application.instance) as Application | undefined
    if (!inst) {
      throw new Error('[RudderJS] Application has not been created yet. Call Application.create() first.')
    }
    return inst
  }

  // ── Container proxy methods ───────────────────────────────

  bind(token: Parameters<Container['bind']>[0], factory: Parameters<Container['bind']>[1]): this {
    this.container.bind(token, factory)
    return this
  }

  singleton(token: Parameters<Container['singleton']>[0], factory: Parameters<Container['singleton']>[1]): this {
    this.container.singleton(token, factory)
    return this
  }

  instance<T>(token: Parameters<Container['instance']>[0], value: T): this {
    this.container.instance(token, value)
    return this
  }

  make<T>(token: Parameters<Container['make']>[0]): T {
    return this.container.make(token) as T
  }

  scoped(token: Parameters<Container['scoped']>[0], factory: Parameters<Container['scoped']>[1]): this {
    this.container.scoped(token, factory)
    return this
  }

  runScoped<T>(fn: () => T): T {
    return this.container.runScoped(fn)
  }

  when(concrete: Parameters<Container['when']>[0]): ContextualBindingBuilder {
    return this.container.when(concrete)
  }

  // ── Lifecycle ─────────────────────────────────────────────

  /**
   * Dynamically register a service provider at runtime.
   *
   * - Calls `register()` immediately so bindings are available.
   * - If the application is already booted, calls `boot()` too.
   * - Duplicate providers (by class reference or class name) are silently skipped.
   *
   * Works with both provider classes and factory return values:
   * ```ts
   * await this.app.register(MyServiceProvider)
   * await this.app.register(cache(cacheConfig))
   * ```
   */
  async register(Provider: ProviderClass | ProviderClass[]): Promise<this> {
    if (Array.isArray(Provider)) {
      for (const P of Provider) await this.register(P)
      return this
    }

    if (this._isDuplicate(Provider)) return this
    this._trackProvider(Provider)

    const instance = new Provider(this)
    this.providers.push(instance)
    instance.register()

    if (this.booted || this._booting) {
      try {
        await instance.boot?.()
        this._bootedProviders.add(instance)
      } catch (err) {
        const name  = instance.constructor.name || Provider.name || 'AnonymousProvider'
        const cause = err instanceof Error ? err.message : String(err)
        throw new Error(
          `[RudderJS] Provider "${name}" failed to boot.\n  Cause: ${cause}\n  Check your provider configuration in bootstrap/providers.ts`,
          { cause: err },
        )
      }
    }

    return this
  }

  private _registerAll(): void {
    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i]!
      const tokens = provider.provides?.()
      if (tokens && tokens.length > 0) {
        // Deferred — map each token to the provider's constructor for lazy boot
        const Ctor = provider.constructor as ProviderClass
        for (const token of tokens) {
          this._deferredProviders.set(token, Ctor)
        }
        continue
      }
      provider.register()
    }

    // Wire the missing handler so deferred providers boot on first resolve
    if (this._deferredProviders.size > 0) {
      this.container.setMissingHandler((token) => {
        const key = typeof token === 'symbol' ? undefined : token
        if (!key) return
        const Provider = this._deferredProviders.get(key)
        if (!Provider) return

        // Remove all tokens for this provider to prevent re-entry
        for (const [t, P] of this._deferredProviders) {
          if (P === Provider) this._deferredProviders.delete(t)
        }

        const instance = new Provider(this)
        this.providers.push(instance)
        instance.register()
        // Deferred providers must have sync boot (or none)
        instance.boot?.()
        this._bootedProviders.add(instance)
      })
    }
  }

  private async _bootAll(): Promise<void> {
    this._booting = true
    for (const provider of this.providers) {
      if (this._bootedProviders.has(provider)) continue
      try {
        await provider.boot?.()
        this._bootedProviders.add(provider)
      } catch (err) {
        const name  = provider.constructor.name
        const cause = err instanceof Error ? err.message : String(err)
        throw new Error(
          `[RudderJS] Provider "${name}" failed to boot.\n  Cause: ${cause}\n  Check your provider configuration in bootstrap/providers.ts`,
          { cause: err },
        )
      }
    }
    this._booting = false
    this.booted = true
  }

  async bootstrap(): Promise<this> {
    if (this.booted) return this
    this._registerAll()
    await this._bootAll()
    return this
  }

  isBooted(): boolean      { return this.booted }
  isProduction(): boolean  { return this.env === 'production' }
  isDevelopment(): boolean { return this.env === 'development' || this.env === 'local' }

  static configure(options: ConfigureOptions): AppBuilder {
    return new AppBuilder(options)
  }

  /** @internal — testing only */
  static resetForTesting(): void {
    ;(Application as unknown as Record<string, unknown>)['instance'] = undefined
    ;(globalThis as Record<string, unknown>)['__rudderjs_app__'] = undefined
  }
}

// ─── Configure Options ─────────────────────────────────────

export interface ConfigureOptions {
  server:     ServerAdapterProvider
  config?:    Record<string, unknown>
  providers?: (new (app: Application) => ServiceProvider)[]
}

export interface RoutingOptions {
  web?:      () => Promise<unknown>
  api?:      () => Promise<unknown>
  commands?: () => Promise<unknown>
  channels?: () => Promise<unknown>
}

// ─── Middleware Configurator ───────────────────────────────

type RouteGroupName = 'web' | 'api'

export class MiddlewareConfigurator {
  private _handlers: MiddlewareHandler[] = []
  private _groupHandlers: Record<RouteGroupName, MiddlewareHandler[]> = { web: [], api: [] }

  /** Global middleware — runs on every request, regardless of route group. */
  use(handler: MiddlewareHandler): this {
    this._handlers.push(handler)
    return this
  }

  /** Append middleware to the `web` route group (routes loaded via withRouting({ web })). */
  web(...handlers: MiddlewareHandler[]): this {
    this._groupHandlers.web.push(...handlers)
    return this
  }

  /** Append middleware to the `api` route group (routes loaded via withRouting({ api })). */
  api(...handlers: MiddlewareHandler[]): this {
    this._groupHandlers.api.push(...handlers)
    return this
  }

  getHandlers(): MiddlewareHandler[] { return this._handlers }

  /** Combined group stack — user-config + any provider-registered group middleware. */
  getGroupHandlers(group: RouteGroupName): MiddlewareHandler[] {
    return [...groupMiddlewareStore[group], ...this._groupHandlers[group]]
  }
}

// ─── Provider-facing group-middleware registry ────────────
//
// Providers can't reach `MiddlewareConfigurator` directly (it's constructed per
// RudderJS instance). Instead they call `appendToGroup('web', mw)` during their
// `boot()` — handlers accumulate in this globally-scoped store and are combined
// with user-config group handlers inside `_createHandler()`.
//
// The store lives on `globalThis` (not at module scope) so provider boot and
// server request handling see the same array even when two `@rudderjs/core`
// module instances are loaded — which happens any time a consumer app mixes
// pnpm-linked workspace packages with installed npm packages. A module-level
// const there splits into independent stores: provider writes to one, server
// reads from the other, middleware silently vanishes. Matches the pattern
// used by ai/mcp/http/gate/live observer registries.
//
// The store is drained on reset() so HMR-style boot cycles don't double-register.

const GROUP_MIDDLEWARE_KEY = '__rudderjs_group_middleware__'
const groupMiddlewareStore = (() => {
  const g = globalThis as Record<string, unknown>
  const existing = g[GROUP_MIDDLEWARE_KEY] as Record<RouteGroupName, MiddlewareHandler[]> | undefined
  if (existing) return existing
  const store: Record<RouteGroupName, MiddlewareHandler[]> = { web: [], api: [] }
  g[GROUP_MIDDLEWARE_KEY] = store
  return store
})()

/**
 * Register middleware for a named route group (`'web'` | `'api'`). Called
 * by framework providers during `boot()` — e.g. `@rudderjs/auth` appends
 * `AuthMiddleware()` to the `web` group so it only runs on web routes.
 */
export function appendToGroup(group: RouteGroupName, handler: MiddlewareHandler): void {
  groupMiddlewareStore[group].push(handler)
}

/** @internal — drain provider-registered group middleware (HMR dev reloads). */
export function resetGroupMiddleware(): void {
  groupMiddlewareStore.web.length = 0
  groupMiddlewareStore.api.length = 0
}

// ─── Exception Configurator ────────────────────────────────

export type ErrorRenderer = (err: unknown, req: AppRequest) => Response | Promise<Response>

export class ExceptionConfigurator {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _renders: Array<{ type: new (...args: any[]) => unknown; fn: ErrorRenderer }> = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _ignored: Set<new (...args: any[]) => unknown> = new Set()

  /**
   * Register a custom renderer for a specific error type.
   *
   * @example
   * e.render(PaymentError, (err, req) =>
   *   new Response(JSON.stringify({ code: err.code }), { status: 402, headers: { 'Content-Type': 'application/json' } })
   * )
   */
  render<T extends Error>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type: new (...args: any[]) => T,
    fn: (err: T, req: AppRequest) => Response | Promise<Response>,
  ): this {
    this._renders.push({ type, fn: fn as ErrorRenderer })
    return this
  }

  /**
   * Ignore an error type — re-throws it so the server's native handler sees it.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ignore(type: new (...args: any[]) => unknown): this {
    this._ignored.add(type)
    return this
  }

  /**
   * Override the global exception reporter for unhandled errors.
   * By default, `@rudderjs/log` wires this automatically when installed.
   *
   * @example
   * e.reportUsing((err) => Sentry.captureException(err))
   */
  reportUsing(fn: (err: unknown) => void): this {
    setExceptionReporter(fn)
    return this
  }

  /** @internal — called by RudderJS to produce the combined error handler */
  buildHandler(): ErrorRenderer {
    const renders = this._renders.slice()
    const ignored = new Set(this._ignored)

    return async (err: unknown, req: AppRequest): Promise<Response> => {
      // 1. Explicitly ignored — re-throw
      for (const type of ignored) {
        if (err instanceof type) throw err
      }

      // 2. User-registered renderers (take priority)
      for (const { type, fn } of renders) {
        if (err instanceof type) return fn(err, req)
      }

      // 3. ValidationError — 422 JSON
      if (err instanceof ValidationError) {
        return new Response(JSON.stringify(err.toJSON()), {
          status: 422,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // 4. HttpException — render with its status code (JSON or HTML)
      if (err instanceof HttpException) {
        return renderHttpException(err, req)
      }

      // 5. Unhandled — report + render 500
      report(err)
      let debug = false
      try { debug = Application.getInstance().debug } catch { /* app not ready */ }
      return renderServerError(req, debug, err)
    }
  }
}

// ─── App Builder ───────────────────────────────────────────

export class AppBuilder {
  private _loaders: Array<() => Promise<unknown>> = []
  private _mwFn?:  (m: MiddlewareConfigurator) => void
  private _excFn?: (e: ExceptionConfigurator) => void

  constructor(private readonly _options: ConfigureOptions) {}

  withRouting(routes: RoutingOptions): this {
    if (routes.web)      this._loaders.push(this._taggedLoader('web', routes.web))
    if (routes.api)      this._loaders.push(this._taggedLoader('api', routes.api))
    if (routes.commands) this._loaders.push(routes.commands)
    if (routes.channels) this._loaders.push(routes.channels)
    return this
  }

  /** Wrap a route loader so routes registered inside it get tagged with `group`. */
  private _taggedLoader(group: 'web' | 'api', loader: () => Promise<unknown>): () => Promise<unknown> {
    return async () => {
      const { runWithGroup } = await import('@rudderjs/router')
      return runWithGroup(group, loader)
    }
  }

  withMiddleware(fn: (m: MiddlewareConfigurator) => void): this {
    this._mwFn = fn
    return this
  }

  withExceptions(fn: (e: ExceptionConfigurator) => void): this {
    this._excFn = fn
    return this
  }

  create(): RudderJS {
    const g = globalThis as Record<string, unknown>
    if (g['__rudderjs_instance__']) return g['__rudderjs_instance__'] as RudderJS

    const app = Application.create({
      ...(this._options.config    && { config:    this._options.config }),
      ...(this._options.providers && { providers: this._options.providers }),
    })
    const instance = new RudderJS(app, this._options.server, this._loaders, this._mwFn, this._excFn)
    g['__rudderjs_instance__'] = instance
    return instance
  }
}

// ─── RudderJS (Configured Application) ─────────────────────

export class RudderJS {
  /** Phase 1: providers only — safe to await in CLI (no Vike virtual imports) */
  private _providerBoot: Promise<void>
  /** Phase 2: provider boot + HTTP handler — created lazily on first handleRequest call */
  private _boot: Promise<void> | null = null
  private _handler: FetchHandler | null = null

  constructor(
    private readonly _app:     Application,
    private readonly _server:  ServerAdapterProvider,
    private readonly _loaders: Array<() => Promise<unknown>>,
    private readonly _mwFn?:   (m: MiddlewareConfigurator) => void,
    private readonly _excFn?:  (e: ExceptionConfigurator) => void,
  ) {
    this._providerBoot = this._bootstrapProviders()
  }

  private _suppressVikeNoise(): void {
    const isNoise = (args: unknown[]): boolean => {
      const msg = args.map(a => String(a ?? '')).join(' ')
      if (msg.includes('[vike]')) return true
      if (msg.includes('Server running at ')) return true
      return false
    }
    const _log  = console.log
    const _warn = console.warn
    const _info = console.info
    console.log  = (...a: unknown[]) => { if (!isNoise(a)) _log(...a)  }
    console.warn = (...a: unknown[]) => { if (!isNoise(a)) _warn(...a) }
    console.info = (...a: unknown[]) => { if (!isNoise(a)) _info(...a) }
  }

  /** Phase 1 — boot providers + routes. Safe in CLI (no Vike virtual URLs). */
  private async _bootstrapProviders(): Promise<void> {
    this._suppressVikeNoise()
    if (this._app.isDevelopment()) {
      rudder.reset()
      const { router } = await import('@rudderjs/router') as { router: { reset(): void } }
      router.reset()
      resetGroupMiddleware()
    }
    await this._app.bootstrap()
    // Serial loader execution — required for per-loader group tagging in
    // @rudderjs/router's runWithGroup(). Parallel execution would set the
    // module-level currentGroup to whichever loader was invoked last before
    // any module bodies evaluated in microtasks. Sequential is negligibly
    // slower for ≤4 loaders and keeps the group context correct.
    for (const loader of this._loaders) await loader()
    if (this._app.isDevelopment()) this._printDevBootLog()
    console.log('[RudderJS] ready')
  }

  /**
   * Dev-only — print the auto-discovered providers grouped by stage so a missing
   * package is visible at every boot instead of failing silently when first used.
   * Wraps long stage lines so the output stays readable in narrow terminals.
   */
  private _printDevBootLog(): void {
    const entries = getLastLoadedProviderEntries()
    if (entries.length === 0) return

    const C = {
      dim:     (s: string) => `\x1b[2m${s}\x1b[0m`,
      magenta: (s: string) => `\x1b[35m${s}\x1b[0m`,
      cyan:    (s: string) => `\x1b[36m${s}\x1b[0m`,
      green:   (s: string) => `\x1b[32m${s}\x1b[0m`,
      yellow:  (s: string) => `\x1b[33m${s}\x1b[0m`,
    }
    const STAGE_COLORS = {
      foundation:     C.magenta,
      infrastructure: C.cyan,
      feature:        C.green,
      monitoring:     C.yellow,
    } as const
    const STAGE_ORDER = ['foundation', 'infrastructure', 'feature', 'monitoring'] as const

    const shortName = (p: string): string => p.startsWith('@rudderjs/') ? p.slice('@rudderjs/'.length) : p

    const grouped = new Map<string, string[]>()
    for (const e of entries) {
      const list = grouped.get(e.stage) ?? []
      list.push(shortName(e.package))
      grouped.set(e.stage, list)
    }

    console.log(`[RudderJS] ${entries.length} provider${entries.length === 1 ? '' : 's'} booted`)

    // Find which stages have entries — needed to know which one is the last
    // (gets `└─` instead of `├─`).
    const activeStages = STAGE_ORDER.filter(s => (grouped.get(s)?.length ?? 0) > 0)

    const labelWidth = 16
    const indent     = '  '
    const connector  = '── '   // 3 visible chars after the corner
    const cornerLen  = 2 + connector.length // ├─ + space-after width
    // Wrap at min(terminal width, 80) so the layout is consistent across
    // narrow and wide terminals — wide terminals would otherwise stretch a
    // long feature list to one unreadable line.
    const termCols   = Math.min(process.stdout.columns ?? 80, 80)
    const wrapWidth  = termCols - indent.length - cornerLen - labelWidth - 2

    activeStages.forEach((stage, idx) => {
      const list   = grouped.get(stage)!
      const isLast = idx === activeStages.length - 1
      const corner = isLast ? '└─ ' : '├─ '

      const colorize = STAGE_COLORS[stage]
      const label    = colorize(stage.padEnd(labelWidth))

      // Greedy line-wrap: pack as many comma-joined names as fit per line.
      const lines: string[][] = [[]]
      let currentLen = 0
      for (const name of list) {
        const piece = (lines[lines.length - 1]!.length === 0 ? '' : ', ') + name
        if (currentLen + piece.length > wrapWidth && lines[lines.length - 1]!.length > 0) {
          lines.push([name])
          currentLen = name.length
        } else {
          lines[lines.length - 1]!.push(name)
          currentLen += piece.length
        }
      }

      // Continuation lines use `│` to maintain the tree visual when there are
      // more stages below; the last stage uses spaces instead.
      const continuation = isLast
        ? ' '.repeat(corner.length + labelWidth)
        : C.dim('│  ') + ' '.repeat(labelWidth)

      lines.forEach((parts, i) => {
        const prefix = i === 0
          ? `${indent}${C.dim(corner)}${label}`
          : `${indent}${continuation}`
        console.log(`${prefix}${parts.join(', ')}`)
      })
    })
  }

  /** Phase 2 — create the HTTP fetch handler. Requires Vite context (virtual: URLs). */
  private async _createHandler(): Promise<void> {
    const mw = new MiddlewareConfigurator()
    this._mwFn?.(mw)
    const exc = new ExceptionConfigurator()
    this._excFn?.(exc)
    const errorHandler = exc.buildHandler()
    const { router } = await import('@rudderjs/router') as { router: { mount(adapter: ServerAdapter): void } }
    this._handler = await this._server.createFetchHandler((adapter: ServerAdapter) => {
      for (const h of mw.getHandlers()) adapter.applyMiddleware(h)
      if (adapter.applyGroupMiddleware) {
        for (const h of mw.getGroupHandlers('web')) adapter.applyGroupMiddleware('web', h)
        for (const h of mw.getGroupHandlers('api')) adapter.applyGroupMiddleware('api', h)
      }
      router.mount(adapter)
      adapter.setErrorHandler?.(errorHandler)
    })
  }

  /** Boot providers without starting an HTTP server — used by the CLI */
  async boot(): Promise<void> {
    await this._providerBoot
  }

  async handleRequest(request: Request, env?: unknown, ctx?: unknown): Promise<Response> {
    if (!this._boot) this._boot = this._providerBoot.then(() => this._createHandler())
    await this._boot
    if (!this._handler) throw new Error('[RudderJS] Request handler not initialized.')
    return this._handler(request, env, ctx)
  }

  readonly fetch = (request: Request, env?: unknown, ctx?: unknown): Promise<Response> =>
    this.handleRequest(request, env, ctx)
}

// ─── Global helpers ────────────────────────────────────────

export const app = (): Application => Application.getInstance()

export const resolve = <T>(token: Parameters<Container['make']>[0]): T =>
  Application.getInstance().make<T>(token)

export function defineConfig<T>(config: T): T { return config }
