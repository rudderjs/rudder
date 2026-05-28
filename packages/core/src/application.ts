import { Container, ContextualBindingBuilder, container } from './di.js'
import { ServiceProvider } from './service-provider.js'
import { Env, ConfigRepository, setConfigRepository } from '@rudderjs/support'
import type { MiddlewareHandler } from '@rudderjs/contracts'
import { AppBuilder, type ConfigureOptions } from './app-builder.js'

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

/**
 * @internal — return true if `fn` is an async function (declared with the
 * `async` keyword). Used by the deferred-provider lifecycle to reject
 * providers whose `boot()` can't be awaited from the synchronous missing
 * handler path. Bound `async () => {}` instances drop the AsyncFunction
 * constructor name, so we fall through to a `[object AsyncFunction]`
 * `toString` check for that case.
 */
function _isAsyncFunction(fn: unknown): boolean {
  if (typeof fn !== 'function') return false
  if (fn.constructor.name === 'AsyncFunction') return true
  return Object.prototype.toString.call(fn) === '[object AsyncFunction]'
}

export class Application {
  private static instance: Application | undefined
  readonly container: Container
  private providers: ServiceProvider[] = []
  private booted = false
  private _booting = false
  private _bootedProviders = new WeakSet<ServiceProvider>()

  /** Tracks registered provider classes to prevent duplicates. */
  private _registeredClasses = new Set<ProviderClass>()
  /** Tracks registered provider names to prevent duplicates from factory functions. */
  private _registeredNames   = new Set<string>()
  /** Tracks provider instances that have already had register() called — prevents double-registration when app().register() is called before bootstrap(). */
  private _registeredInstances = new Set<ServiceProvider>()

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
      // RUDDER_HMR_TRACE=1 — count fresh Application constructions. The dev HMR
      // single-flight + request gate assume exactly ONE fresh Application per
      // re-boot. A flood of concurrent requests landing after the watcher clears
      // the globals should still construct only one (the globalThis guard + JS's
      // single-threaded run-to-completion dedupe them). A count >1 within a
      // re-boot window would mean concurrent `bootstrap/app.ts` re-evaluations
      // are each racing past the guard — the open question in the reboot plan.
      if (process.env['RUDDER_HMR_TRACE'] === '1') {
        const n = ((g['__rudderjs_app_ctor_count__'] as number) ?? 0) + 1
        g['__rudderjs_app_ctor_count__'] = n
        console.log(`[hmr] Application construct #${n}`)
      }
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
    this._registeredInstances.add(instance)

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
        // Deferred — map each token to the provider's constructor for lazy boot.
        // Validate boot() is synchronous: the deferred lifecycle invokes boot
        // inside `_missingHandler`, which itself runs synchronously inside a
        // `container.make()` call. An async boot would return a Promise that
        // the handler can't await — the consumer would see a half-booted
        // service. Catch this at registration so the failure surfaces near
        // the provider author's intent, not at a confusing late-resolve site.
        if (provider.boot && _isAsyncFunction(provider.boot)) {
          throw new Error(
            `[RudderJS] Deferred provider "${provider.constructor.name}" has an async boot() — ` +
            `provides() requires synchronous boot because lazy resolution can't await across container.make(). ` +
            `Move async work into the bound services themselves (lazy-init pattern), or drop provides() if eager boot is acceptable.`,
          )
        }
        const Ctor = provider.constructor as ProviderClass
        for (const token of tokens) {
          this._deferredProviders.set(token, Ctor)
        }
        // Mark the original instance as booted so `_bootAll()` skips it. The
        // lazy resolution path creates a fresh instance and runs its register/
        // boot inside the missing handler; without this skip the original
        // instance's boot fires eagerly during `_bootAll()` too — duplicate
        // work and (worse) the eager path is `await`ed, so an async boot here
        // would silently land before the async-boot validator above could
        // catch it on a future re-bootstrap. Belt-and-braces: validator
        // throws first, and the skip seals the no-eager-boot contract.
        this._bootedProviders.add(provider)
        continue
      }
      if (this._registeredInstances.has(provider)) continue
      provider.register()
      this._registeredInstances.add(provider)
    }

    // Wire the missing handler so deferred providers boot on first resolve
    if (this._deferredProviders.size > 0) {
      // Cycle-detection state — tokens being resolved right now. Re-entering
      // the handler with a token already in this set indicates a deferred
      // provider's register/boot reached for one of its own tokens before
      // that token was bound, or a cross-provider chain where every token
      // is still mid-registration. Without this guard, the handler bottoms
      // out by hitting the deferred-map miss path (the same provider's
      // tokens are eagerly deleted at the top of resolution to prevent
      // re-entry), and `container.make()` then throws the generic
      // "Cannot resolve <token>" — masking the real cause.
      const _resolving = new Set<string>()
      this.container.setMissingHandler((token) => {
        const key = typeof token === 'symbol' ? undefined : token
        if (!key) return
        if (_resolving.has(key)) {
          throw new Error(
            `[RudderJS] Circular deferred resolution: "${key}" requires itself during register/boot. ` +
            `Break the cycle by lazy-resolving via app().make("${key}") inside a method body instead of at register/boot time.`,
          )
        }
        const Provider = this._deferredProviders.get(key)
        if (!Provider) return

        _resolving.add(key)
        try {
          // Remove all tokens for this provider to prevent re-entry
          for (const [t, P] of this._deferredProviders) {
            if (P === Provider) this._deferredProviders.delete(t)
          }

          const instance = new Provider(this)
          this.providers.push(instance)
          instance.register()
          // Deferred providers must have sync boot — validated at register
          // time above. A subclass with `provides()` and a sync boot is the
          // expected shape here.
          instance.boot?.()
          this._bootedProviders.add(instance)
        } finally {
          _resolving.delete(key)
        }
      })
    }
  }

  private async _bootAll(): Promise<void> {
    this._booting = true
    // RUDDER_PERF_TRACE=2 — per-provider boot timing. Surfaces which providers
    // dominate the re-boot on a dev HMR reload (see RUDDER_HMR_TRACE).
    const deepTrace = process.env['RUDDER_PERF_TRACE'] === '2'
    for (const provider of this.providers) {
      if (this._bootedProviders.has(provider)) continue
      try {
        const tp = deepTrace ? performance.now() : 0
        await provider.boot?.()
        if (deepTrace) console.log(`[perf]   ${provider.constructor.name} boot ${(performance.now() - tp).toFixed(1)}ms`)
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
    // Level 2 implies the level-1 summary (and adds per-provider lines in _bootAll).
    const traceLevel = process.env['RUDDER_PERF_TRACE']
    const trace = traceLevel === '1' || traceLevel === '2'
    const t0 = trace ? performance.now() : 0
    this._registerAll()
    const t1 = trace ? performance.now() : 0
    await this._bootAll()
    if (trace) {
      const t2 = performance.now()
      console.log(`[perf] providers:register ${(t1 - t0).toFixed(1)}ms`)
      console.log(`[perf] providers:boot ${(t2 - t1).toFixed(1)}ms`)
      console.log(`[perf] application.bootstrap total ${(t2 - t0).toFixed(1)}ms`)
    }
    return this
  }

  isBooted(): boolean      { return this.booted }
  isProduction(): boolean  { return this.env === 'production' }
  isDevelopment(): boolean { return this.env === 'development' || this.env === 'local' }

  static configure(options: ConfigureOptions): AppBuilder {
    return new AppBuilder(options)
  }

  /**
   * Clear the process-wide `Application` singleton. Test-only escape hatch —
   * kept on the public API because `@rudderjs/pennant` (and other packages)
   * call it from their own test suites across the package boundary.
   */
  static resetForTesting(): void {
    Application.instance = undefined
    ;(globalThis as Record<string, unknown>)['__rudderjs_app__'] = undefined
  }
}

// ─── App-builder re-exports ────────────────────────────────
//
// AppBuilder / RudderJS / MiddlewareConfigurator / ExceptionConfigurator live
// in `./app-builder.ts` — they orchestrate Application but don't share its
// private state, so the split keeps `application.ts` to the kernel.

export {
  AppBuilder,
  ExceptionConfigurator,
  MiddlewareConfigurator,
  RudderJS,
} from './app-builder.js'
export type {
  ConfigureOptions,
  ErrorRenderer,
  RoutingOptions,
} from './app-builder.js'

type RouteGroupName = 'web' | 'api'

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
/** @internal — read by `MiddlewareConfigurator.getGroupHandlers()` in `./app-builder.ts`. */
export const groupMiddlewareStore = (() => {
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
 *
 * **Not deduplicated.** Calling this twice with the same handler installs it
 * twice. Providers that may `boot()` more than once (HMR reload, test
 * harness) must either guard against re-installation or rely on
 * `resetGroupMiddleware()` to clear the store before re-boot.
 */
export function appendToGroup(group: RouteGroupName, handler: MiddlewareHandler): void {
  groupMiddlewareStore[group].push(handler)
}

/** @internal — drain provider-registered group middleware (HMR dev reloads). */
export function resetGroupMiddleware(): void {
  groupMiddlewareStore.web.length = 0
  groupMiddlewareStore.api.length = 0
}

// ─── Global helpers ────────────────────────────────────────

export const app = (): Application => Application.getInstance()

export const resolve = <T>(token: Parameters<Container['make']>[0]): T =>
  Application.getInstance().make<T>(token)

export function defineConfig<T>(config: T): T { return config }
