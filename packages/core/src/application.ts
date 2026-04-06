import { Container, container } from './di.js'
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
    const env = config?.env ?? Env.get('APP_ENV', 'production')
    const isDev = env === 'development' || env === 'local'
    const shouldRecreate = Boolean(config) && isDev

    if (shouldRecreate) {
      container.reset()
      g['__rudderjs_app__'] = undefined
    }

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
    for (const provider of this.providers) {
      provider.register()
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

export class MiddlewareConfigurator {
  private _handlers: MiddlewareHandler[] = []

  use(handler: MiddlewareHandler): this {
    this._handlers.push(handler)
    return this
  }

  getHandlers(): MiddlewareHandler[] { return this._handlers }
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
    if (routes.web)      this._loaders.push(routes.web)
    if (routes.api)      this._loaders.push(routes.api)
    if (routes.commands) this._loaders.push(routes.commands)
    if (routes.channels) this._loaders.push(routes.channels)
    return this
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
    const app = Application.create({
      ...(this._options.config    && { config:    this._options.config }),
      ...(this._options.providers && { providers: this._options.providers }),
    })
    return new RudderJS(app, this._options.server, this._loaders, this._mwFn, this._excFn)
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
      // Suppress duplicate "Server running at ..." from @hono/node-server / photon
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
    }
    await this._app.bootstrap()
    await Promise.all(this._loaders.map(l => l()))
    console.log('[RudderJS] ready')
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
