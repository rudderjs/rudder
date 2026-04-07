import 'reflect-metadata'

// Lazy-load node:async_hooks to avoid bundling it into the client.
// AsyncLocalStorage is only used by container.runScoped() — a server-only
// feature for per-request scoped bindings. Importing statically would fail
// in the browser bundle since async_hooks has no browser equivalent.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AsyncLocalStorageType = any
let _AsyncLocalStorage: { new <T>(): { run<R>(store: T, fn: () => R): R; getStore(): T | undefined } } | undefined
if (typeof globalThis.process !== 'undefined') {
  import(/* @vite-ignore */ 'node:async_hooks').then(m => { _AsyncLocalStorage = m.AsyncLocalStorage as never }).catch(() => {})
}

// ─── Types ─────────────────────────────────────────────────

// Constructor must be contravariant in parameter types to accept any class.
// Using `unknown[]` is too strict (existing classes have typed params).
// The widest correct type for a "new-able thing returning T" is:
type Constructor<T = unknown> = new (...args: never) => T
type Factory<T = unknown> = (container: Container) => T
type Binding<T = unknown> = { factory: Factory<T>; singleton: boolean; scoped?: boolean }

// ─── Decorators ────────────────────────────────────────────

const INJECTABLE_METADATA = 'rudderjs:injectable'
const INJECT_METADATA     = 'rudderjs:inject'

/** Mark a class as injectable (auto-resolved by the container) */
export function Injectable(): ClassDecorator {
  return target => {
    Reflect.defineMetadata(INJECTABLE_METADATA, true, target)
  }
}

/** Inject a specific token into a constructor parameter */
export function Inject(token: string | symbol): ParameterDecorator {
  return (target, _, index) => {
    const existing: Array<{ index: number; token: string | symbol }> =
      Reflect.getMetadata(INJECT_METADATA, target) ?? []
    Reflect.defineMetadata(INJECT_METADATA, [...existing, { index, token }], target)
  }
}

// ─── Container ─────────────────────────────────────────────

export class Container {
  private bindings  = new Map<string | symbol, Binding>()
  private instances = new Map<string | symbol, unknown>()
  private aliases   = new Map<string, string | symbol>()

  // ── Scoped bindings (per-request via ALS) ─────────────────
  // Lazy-initialized so the class can be loaded in the browser bundle without
  // triggering a node:async_hooks import error.
  private _scopeAlsInstance: AsyncLocalStorageType = null
  private get _scopeAls(): { run<R>(store: Map<string | symbol, unknown>, fn: () => R): R; getStore(): Map<string | symbol, unknown> | undefined } {
    if (!this._scopeAlsInstance) {
      if (!_AsyncLocalStorage) {
        throw new Error('[RudderJS] AsyncLocalStorage is not available — runScoped() and scoped bindings require Node.js (node:async_hooks).')
      }
      this._scopeAlsInstance = new _AsyncLocalStorage<Map<string | symbol, unknown>>()
    }
    return this._scopeAlsInstance
  }

  // ── Contextual bindings ───────────────────────────────────
  private _contextual = new Map<string, Map<string | symbol, Factory>>()

  // ── Missing handler (for deferred providers) ──────────────
  private _missingHandler: ((token: string | symbol) => void) | null = null

  reset(): this {
    this.bindings.clear()
    this.instances.clear()
    this.aliases.clear()
    this._contextual.clear()
    this._missingHandler = null
    return this
  }

  bind<T>(token: string | symbol | Constructor<T>, factory: Factory<T>): this {
    this.bindings.set(this.toToken(token), { factory, singleton: false })
    return this
  }

  singleton<T>(token: string | symbol | Constructor<T>, factory: Factory<T>): this {
    this.bindings.set(this.toToken(token), { factory, singleton: true })
    return this
  }

  /**
   * Register a scoped binding — like singleton but per-request.
   * The factory runs once per `runScoped()` call and is cached for that scope.
   */
  scoped<T>(token: string | symbol | Constructor<T>, factory: Factory<T>): this {
    this.bindings.set(this.toToken(token), { factory, singleton: false, scoped: true })
    return this
  }

  /**
   * Execute `fn` inside a fresh scope. Scoped bindings resolved within
   * this call are cached and automatically discarded when `fn` completes.
   */
  runScoped<T>(fn: () => T): T {
    return this._scopeAls.run(new Map(), fn)
  }

  instance<T>(token: string | symbol | Constructor<T>, value: T): this {
    const key = this.toToken(token)
    this.instances.set(key, value)
    return this
  }

  alias(from: string, to: string | symbol): this {
    this.aliases.set(from, to)
    return this
  }

  make<T>(token: string | symbol | Constructor<T>): T {
    const key = this.resolveAlias(this.toToken(token))

    if (this.instances.has(key)) {
      return this.instances.get(key) as T
    }

    const binding = this.bindings.get(key)
    if (binding) {
      // Scoped binding: cache per-request in ALS store
      if (binding.scoped) {
        const scope = this._scopeAls.getStore()
        if (!scope) {
          throw new Error(
            `[RudderJS] Cannot resolve scoped binding outside of a request scope.\n` +
            `  Wrap the call in container.runScoped() or add ScopeMiddleware().`
          )
        }
        if (scope.has(key)) return scope.get(key) as T
        const value = binding.factory(this) as T
        scope.set(key, value)
        return value
      }

      const value = binding.factory(this) as T
      if (binding.singleton) this.instances.set(key, value)
      return value
    }

    if (typeof token === 'function') {
      return this.autoResolve(token as Constructor<T>)
    }

    // Deferred provider hook — give the missing handler a chance to register the binding
    if (this._missingHandler) {
      this._missingHandler(key)
      // Retry after handler may have registered the binding
      if (this.instances.has(key)) return this.instances.get(key) as T
      const retryBinding = this.bindings.get(key)
      if (retryBinding) {
        const value = retryBinding.factory(this) as T
        if (retryBinding.singleton) this.instances.set(key, value)
        return value
      }
    }

    const label = typeof key === 'symbol' ? key.toString() : `"${String(key)}"`
    throw new Error(
      `[RudderJS] Cannot resolve ${label} from the DI container.\n` +
      `  Did you forget to add @Injectable() to the class, or register it in a ServiceProvider?`
    )
  }

  has(token: string | symbol | Constructor): boolean {
    const key = this.resolveAlias(this.toToken(token))
    return this.bindings.has(key) || this.instances.has(key)
  }

  forget(token: string | symbol | Constructor): this {
    const key = this.toToken(token)
    this.bindings.delete(key)
    this.instances.delete(key)
    return this
  }

  /**
   * Set a handler called when `make()` cannot find a binding.
   * Used by Application to lazily boot deferred providers.
   */
  setMissingHandler(fn: ((token: string | symbol) => void) | null): this {
    this._missingHandler = fn
    return this
  }

  /**
   * Contextual binding — when resolving `concrete`, override a dependency.
   *
   * @example
   * container.when(PhotoController).needs('storage').give(() => new S3Storage())
   */
  when(concrete: Constructor): ContextualBindingBuilder {
    return new ContextualBindingBuilder(this, concrete)
  }

  /** @internal — called by ContextualBindingBuilder */
  _addContextualBinding(concrete: Constructor, need: string | symbol, factory: Factory): void {
    const name = this.toToken(concrete) as string
    let map = this._contextual.get(name)
    if (!map) {
      map = new Map()
      this._contextual.set(name, map)
    }
    map.set(need, factory)
  }

  private autoResolve<T>(target: Constructor<T>): T {
    if (typeof Reflect === 'undefined' || typeof Reflect.getMetadata !== 'function') {
      throw new Error(
        `[RudderJS] reflect-metadata is not loaded.\n` +
        `  Add: import 'reflect-metadata' at the top of your bootstrap/app.ts`
      )
    }

    const isInjectable = Reflect.getMetadata(INJECTABLE_METADATA, target)
    if (!isInjectable) {
      throw new Error(
        `[RudderJS] "${target.name}" is not decorated with @Injectable().\n` +
        `  Add @Injectable() above the class declaration to enable auto-resolution.`
      )
    }

    const paramTypes: Constructor[] =
      Reflect.getMetadata('design:paramtypes', target) ?? []

    const tokenOverrides: Array<{ index: number; token: string | symbol }> =
      Reflect.getMetadata(INJECT_METADATA, target) ?? []

    // Check contextual bindings for this target class
    const ctxMap = this._contextual.get(target.name)

    const args = paramTypes.map((type, i) => {
      const override = tokenOverrides.find(o => o.index === i)
      const needToken = override ? override.token : this.toToken(type)

      // Contextual override takes priority
      if (ctxMap) {
        const ctxFactory = ctxMap.get(needToken)
        if (ctxFactory) return ctxFactory(this)
      }

      return override ? this.make(override.token) : this.make(type)
    })

    return new (target as new (...a: unknown[]) => T)(...args)
  }

  private toToken(token: string | symbol | Constructor): string | symbol {
    return typeof token === 'function' ? token.name : token
  }

  private resolveAlias(key: string | symbol): string | symbol {
    if (typeof key === 'string') {
      return this.aliases.get(key) ?? key
    }
    return key
  }
}

// ─── Contextual Binding Builder ───────────────────────────

export class ContextualBindingBuilder {
  constructor(
    private readonly _container: Container,
    private readonly _concrete: Constructor,
  ) {}

  needs(token: string | symbol | Constructor): { give: (factoryOrValue: Factory | unknown) => void } {
    return {
      give: (factoryOrValue: Factory | unknown): void => {
        const factory = typeof factoryOrValue === 'function'
          ? (c: Container) => (factoryOrValue as Factory)(c)
          : () => factoryOrValue
        this._container._addContextualBinding(this._concrete, resolveToken(token), factory)
      },
    }
  }
}

function resolveToken(token: string | symbol | Constructor): string | symbol {
  return typeof token === 'function' ? token.name : token
}

// ─── Global container singleton ────────────────────────────

export const container = new Container()
