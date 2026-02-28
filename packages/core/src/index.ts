import 'reflect-metadata'
import { Container, container } from '@forge/di'
import { Env, ConfigRepository, setConfigRepository } from '@forge/support'
import type { ServerAdapterProvider, ServerAdapter, FetchHandler, MiddlewareHandler } from '@forge/server'

// ─── Service Provider ──────────────────────────────────────

export abstract class ServiceProvider {
  constructor(protected app: Application) {}

  /** Register bindings into the container */
  abstract register(): void

  /** Called after all providers are registered */
  boot?(): void | Promise<void>
}

// ─── Config ────────────────────────────────────────────────

export interface AppConfig {
  name?: string
  env?: string
  debug?: boolean
  providers?: (new (app: Application) => ServiceProvider)[]
  /** Config values loaded from config/ files — bound to the container as 'config' */
  config?: Record<string, unknown>
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

  private constructor(config: AppConfig = {}) {
    this.container = container
    this.name  = config.name  ?? Env.get('APP_NAME',  'Forge')
    this.env   = config.env   ?? Env.get('APP_ENV',   'production')
    this.debug = config.debug ?? Env.getBool('APP_DEBUG', false)

    // Bind the app itself into the container
    this.container.instance('app', this)
    this.container.instance('Application', this)

    // Load config repository if provided
    if (config.config) {
      const repo = new ConfigRepository(config.config)
      setConfigRepository(repo)
      this.container.instance('config', repo)
    }

    // Register providers
    for (const Provider of config.providers ?? []) {
      this.providers.push(new Provider(this))
    }
  }

  /** Create or return the singleton Application instance */
  static create(config?: AppConfig): Application {
    const g = globalThis as Record<string, unknown>
    if (!g['__forge_app__']) {
      g['__forge_app__'] = new Application(config)
    }
    Application.instance = g['__forge_app__'] as Application
    return Application.instance
  }

  /** Get the global app instance */
  static getInstance(): Application {
    const g = globalThis as Record<string, unknown>
    const inst = (g['__forge_app__'] ?? Application.instance) as Application | undefined
    if (!inst) {
      throw new Error('[Forge] Application has not been created yet. Call Application.create() first.')
    }
    return inst
  }

  // ── Container proxy methods ───────────────────────────────

  bind<T>(token: Parameters<Container['bind']>[0], factory: Parameters<Container['bind']>[1]): this {
    this.container.bind(token, factory)
    return this
  }

  singleton<T>(token: Parameters<Container['singleton']>[0], factory: Parameters<Container['singleton']>[1]): this {
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

  /** Register all service providers */
  private register(): void {
    for (const provider of this.providers) {
      provider.register()
    }
  }

  /** Boot all service providers */
  private async boot(): Promise<void> {
    for (const provider of this.providers) {
      await provider.boot?.()
    }
    this.booted = true
  }

  /** Bootstrap the application (register + boot) */
  async bootstrap(): Promise<this> {
    if (this.booted) return this
    this.register()
    await this.boot()
    return this
  }

  isBooted(): boolean {
    return this.booted
  }

  isProduction(): boolean {
    return this.env === 'production'
  }

  isDevelopment(): boolean {
    return this.env === 'development' || this.env === 'local'
  }

  /** Start building a configured application (Laravel-style fluent bootstrap) */
  static configure(options: ConfigureOptions): AppBuilder {
    return new AppBuilder(options)
  }
}

// ─── Configure Options ─────────────────────────────────────

export interface ConfigureOptions {
  server:     ServerAdapterProvider
  config?:    Record<string, unknown>
  providers?: (new (app: Application) => ServiceProvider)[]
}

export interface RoutingOptions {
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

export class ExceptionConfigurator {
  // reserved: report(), render(), ignore(), etc.
}

// ─── App Builder ───────────────────────────────────────────

export class AppBuilder {
  private _loaders:  Array<() => Promise<unknown>> = []
  private _mwFn?:   (m: MiddlewareConfigurator) => void
  private _excFn?:  (e: ExceptionConfigurator) => void

  constructor(private readonly _options: ConfigureOptions) {}

  withRouting(routes: RoutingOptions): this {
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

  create(): Forge {
    const app = Application.create({
      ...(this._options.config    && { config:    this._options.config }),
      ...(this._options.providers && { providers: this._options.providers }),
    })
    return new Forge(app, this._options.server, this._loaders, this._mwFn)
  }
}

// ─── Forge (Configured Application) ───────────────────────

export class Forge {
  private _boot:    Promise<void>
  private _handler: FetchHandler | null = null

  constructor(
    private readonly _app:     Application,
    private readonly _server:  ServerAdapterProvider,
    private readonly _loaders: Array<() => Promise<unknown>>,
    private readonly _mwFn?:   (m: MiddlewareConfigurator) => void,
  ) {
    // Boot eagerly — like Laravel/AdonisJS. Errors surface at startup,
    // not on the first request. Serverless still works (promise settles
    // before or during the first request).
    this._boot = this._bootstrap()
  }

  /** Suppress Vike's informational console noise — runs once at boot, adapter-agnostic */
  private _suppressVikeNoise(): void {
    const isNoise = (args: unknown[]): boolean => {
      const msg = args.map(a => String(a ?? '')).join(' ')
      return msg.includes('[vike]') && (
        msg.includes('HTTP request')           ||
        msg.includes('HTTP response')          ||
        msg.includes("doesn't match the route")
      )
    }
    const _log = console.log;  const _warn = console.warn
    console.log  = (...a: unknown[]) => { if (!isNoise(a)) _log(...a)  }
    console.warn = (...a: unknown[]) => { if (!isNoise(a)) _warn(...a) }
  }

  private async _bootstrap(): Promise<void> {
    // Silence Vike's duplicate/noisy logs — works regardless of server adapter
    this._suppressVikeNoise()

    // Load route files — side effects register routes on the global router
    await Promise.all(this._loaders.map(l => l()))

    // Bootstrap the application (register + boot all service providers)
    await this._app.bootstrap()

    // Apply global middleware then mount routes onto the server adapter
    const mw = new MiddlewareConfigurator()
    this._mwFn?.(mw)

    // Dynamic import avoids a circular-dep between @forge/core and @forge/router
    const { router } = await import('@forge/router')
    this._handler = await this._server.createFetchHandler((adapter: ServerAdapter) => {
      for (const h of mw.getHandlers()) adapter.applyMiddleware(h)
      router.mount(adapter)
    })
  }

  /** Boot the application without starting an HTTP server — used by the CLI */
  async boot(): Promise<void> {
    await Promise.all(this._loaders.map(l => l()))
    await this._app.bootstrap()
  }

  async handleRequest(request: Request, env?: unknown, ctx?: unknown): Promise<Response> {
    await this._boot
    return this._handler!(request, env, ctx)
  }

  /** WinterCG-compatible fetch handler — allows bootstrap/app.ts to be used directly as the server entry */
  readonly fetch = (request: Request, env?: unknown, ctx?: unknown): Promise<Response> =>
    this.handleRequest(request, env, ctx)
}

// ─── Artisan Registry ──────────────────────────────────────

export type ConsoleHandler = (args: string[], opts: Record<string, unknown>) => void | Promise<void>

export class CommandBuilder {
  private _description = ''

  constructor(
    readonly name:    string,
    readonly handler: ConsoleHandler,
  ) {}

  description(text: string): this {
    this._description = text
    return this
  }

  /** Alias for description() — matches Laravel's ->purpose() */
  purpose(text: string): this {
    this._description = text
    return this
  }

  getDescription(): string { return this._description }
}

export class ArtisanRegistry {
  private _commands: CommandBuilder[] = []

  command(name: string, handler: ConsoleHandler): CommandBuilder {
    const cmd = new CommandBuilder(name, handler)
    this._commands.push(cmd)
    return cmd
  }

  getCommands(): CommandBuilder[] { return this._commands }
}

const _g = globalThis as Record<string, unknown>
if (!_g['__forge_artisan__']) _g['__forge_artisan__'] = new ArtisanRegistry()

/** Global Artisan command registry — import and call artisan.command() in routes/console.ts */
export const artisan = _g['__forge_artisan__'] as ArtisanRegistry

// ─── Global helpers ────────────────────────────────────────

/** Get the global application instance */
export const app = (): Application => Application.getInstance()

/** Resolve something from the container */
export const resolve = <T>(token: Parameters<Container['make']>[0]): T =>
  Application.getInstance().make<T>(token)

// ─── Re-exports ────────────────────────────────────────────

export { Container, container } from '@forge/di'
export { Injectable, Inject } from '@forge/di'
export { Collection, Env, sleep, ucfirst, tap, pick, omit, defineEnv, ConfigRepository, config } from '@forge/support'

// ─── Config helper ─────────────────────────────────────────

export function defineConfig<T>(config: T): T { return config }