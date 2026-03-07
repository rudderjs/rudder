import { Container, container } from './di.js'
import { ServiceProvider } from './service-provider.js'
import { Env, ConfigRepository, setConfigRepository } from '@boostkit/support'
import type { ServerAdapterProvider, ServerAdapter, FetchHandler, MiddlewareHandler, AppRequest } from '@boostkit/contracts'
import { artisan } from '@boostkit/artisan'
import { ValidationError } from './validation.js'

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

export class Application {
  private static instance: Application
  readonly container: Container
  private providers: ServiceProvider[] = []
  private booted = false

  readonly name:  string
  readonly env:   string
  readonly debug: boolean

  private constructor(config: BootConfig = {}) {
    this.container = container
    this.name  = config.name  ?? Env.get('APP_NAME',  'BoostKit')
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
      this.providers.push(new Provider(this))
    }
  }

  static create(config?: BootConfig): Application {
    const g = globalThis as Record<string, unknown>
    const env = config?.env ?? Env.get('APP_ENV', 'production')
    const isDev = env === 'development' || env === 'local'
    const shouldRecreate = Boolean(config) && isDev

    if (shouldRecreate) {
      container.reset()
      g['__boostkit_app__'] = undefined
    }

    if (!g['__boostkit_app__']) {
      g['__boostkit_app__'] = new Application(config)
    }
    Application.instance = g['__boostkit_app__'] as Application
    return Application.instance
  }

  static getInstance(): Application {
    const g = globalThis as Record<string, unknown>
    const inst = (g['__boostkit_app__'] ?? Application.instance) as Application | undefined
    if (!inst) {
      throw new Error('[BoostKit] Application has not been created yet. Call Application.create() first.')
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

  private register(): void {
    for (const provider of this.providers) {
      provider.register()
    }
  }

  private async boot(): Promise<void> {
    for (const provider of this.providers) {
      try {
        await provider.boot?.()
      } catch (err) {
        const name  = provider.constructor.name
        const cause = err instanceof Error ? err.message : String(err)
        throw new Error(
          `[BoostKit] Provider "${name}" failed to boot.\n  Cause: ${cause}\n  Check your provider configuration in bootstrap/providers.ts`,
          { cause: err },
        )
      }
    }
    this.booted = true
  }

  async bootstrap(): Promise<this> {
    if (this.booted) return this
    this.register()
    await this.boot()
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
    ;(globalThis as Record<string, unknown>)['__boostkit_app__'] = undefined
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
   * Return a `Response` to short-circuit the default handling.
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
   * Ignore an error type — re-throws it so the server's fallback handler sees it.
   * In development this surfaces the HTML error page; in production it becomes a 500.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ignore(type: new (...args: any[]) => unknown): this {
    this._ignored.add(type)
    return this
  }

  /** @internal — called by BoostKit to produce the combined error handler */
  buildHandler(): ErrorRenderer {
    const renders = this._renders.slice()
    const ignored = new Set(this._ignored)

    return async (err: unknown, req: AppRequest): Promise<Response> => {
      // Explicitly ignored — re-throw to surface in dev error page / server fallback
      for (const type of ignored) {
        if (err instanceof type) throw err
      }

      // User-registered renderers take priority (including ValidationError subclasses)
      for (const { type, fn } of renders) {
        if (err instanceof type) return fn(err, req)
      }

      // ValidationError — built-in 422 JSON (no manual try/catch needed in routes)
      if (err instanceof ValidationError) {
        return new Response(JSON.stringify(err.toJSON()), {
          status: 422,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Unhandled — re-throw so the server fallback can handle it
      throw err
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

  create(): BoostKit {
    const app = Application.create({
      ...(this._options.config    && { config:    this._options.config }),
      ...(this._options.providers && { providers: this._options.providers }),
    })
    return new BoostKit(app, this._options.server, this._loaders, this._mwFn, this._excFn)
  }
}

// ─── BoostKit (Configured Application) ─────────────────────

export class BoostKit {
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
      // Suppress vike internal request/response chatter
      if (msg.includes('[vike]') && (
        msg.includes('HTTP request')            ||
        msg.includes('HTTP response')           ||
        msg.includes("doesn't match the route") ||
        msg.includes('thrown by')
      )) return true
      // Suppress duplicate "Server running at ..." from @hono/node-server / photon
      // (vike already prints the canonical "→ Listening on:" line)
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
      artisan.reset()
      const { router } = await import('@boostkit/router') as { router: { reset(): void } }
      router.reset()
    }
    await this._app.bootstrap()
    await Promise.all(this._loaders.map(l => l()))
    console.log('[BoostKit] ready')
  }

  /** Phase 2 — create the HTTP fetch handler. Requires Vite context (virtual: URLs). */
  private async _createHandler(): Promise<void> {
    const mw = new MiddlewareConfigurator()
    this._mwFn?.(mw)
    const exc = new ExceptionConfigurator()
    this._excFn?.(exc)
    const errorHandler = exc.buildHandler()
    const { router } = await import('@boostkit/router') as { router: { mount(adapter: ServerAdapter): void } }
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
    return this._handler!(request, env, ctx)
  }

  readonly fetch = (request: Request, env?: unknown, ctx?: unknown): Promise<Response> =>
    this.handleRequest(request, env, ctx)
}

// ─── Global helpers ────────────────────────────────────────

export const app = (): Application => Application.getInstance()

export const resolve = <T>(token: Parameters<Container['make']>[0]): T =>
  Application.getInstance().make<T>(token)

export function defineConfig<T>(config: T): T { return config }
