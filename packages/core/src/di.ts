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
type Extender<T = unknown> = (resolved: T, container: Container) => T
type Rebinder<T = unknown> = (instance: T, container: Container) => void

// ─── Decorators ────────────────────────────────────────────

const INJECTABLE_METADATA = 'rudderjs:injectable'
const INJECT_METADATA     = 'rudderjs:inject'
const TAG_METADATA        = 'rudderjs:tag'
const TAG_TOKEN_PREFIX    = 'rudderjs:tag:'

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

/**
 * Inject the array of bindings tagged with `name` into a constructor parameter.
 * Constructor-only — esbuild drops `design:paramtypes` for method decorators.
 */
export function Tag(name: string): ParameterDecorator {
  return (target, _, index) => {
    const existing: Array<{ index: number; tag: string }> =
      Reflect.getMetadata(TAG_METADATA, target) ?? []
    Reflect.defineMetadata(TAG_METADATA, [...existing, { index, tag: name }], target)
  }
}

/**
 * Stable token sentinel for `when().needs(tagToken('group')).give(...)`.
 * Backed by `Symbol.for()` so cross-bundle plugin authors share the same token.
 */
export function tagToken(name: string): symbol {
  return Symbol.for(TAG_TOKEN_PREFIX + name)
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

  // ── Tagging ───────────────────────────────────────────────
  // Map of tag name → set of token keys (resolved via toToken()).
  // Tagging an unbound token is allowed (Laravel parity); tagged() throws
  // the standard "cannot resolve" error when one is asked for.
  private _tags = new Map<string, Set<string | symbol>>()

  // ── Extenders ─────────────────────────────────────────────
  // Wrappers chained in registration order, applied to resolved values.
  // Keyed on resolved-alias key so aliases share extender state.
  private _extenders = new Map<string | symbol, Array<Extender>>()

  // ── Rebinding listeners ───────────────────────────────────
  // Listeners that fire when a token is *re*-bound (not on initial bind).
  // Keyed on resolved-alias key.
  private _rebinders = new Map<string | symbol, Array<Rebinder>>()

  // ── Missing handler (for deferred providers) ──────────────
  private _missingHandler: ((token: string | symbol) => void) | null = null

  // ── Circular dependency guard ─────────────────────────────
  // Keys currently mid-construction. A token that re-enters make() while still
  // on this set is a constructor cycle (A needs B, B needs A) — throw a clear
  // error instead of recursing into a stack overflow. Laravel guards the same
  // way with a build stack.
  private _building = new Set<string | symbol>()

  reset(): this {
    this.bindings.clear()
    this.instances.clear()
    this.aliases.clear()
    this._contextual.clear()
    this._tags.clear()
    this._extenders.clear()
    this._rebinders.clear()
    this._missingHandler = null
    return this
  }

  bind<T>(token: string | symbol | Constructor<T>, factory: Factory<T>): this {
    const key = this.toToken(token)
    const wasBound = this.bindings.has(key) || this.instances.has(key)
    this.instances.delete(key)
    this.bindings.set(key, { factory, singleton: false })
    if (wasBound) this.fireRebinders(this.resolveAlias(key))
    return this
  }

  singleton<T>(token: string | symbol | Constructor<T>, factory: Factory<T>): this {
    const key = this.toToken(token)
    const wasBound = this.bindings.has(key) || this.instances.has(key)
    this.instances.delete(key)
    this.bindings.set(key, { factory, singleton: true })
    if (wasBound) this.fireRebinders(this.resolveAlias(key))
    return this
  }

  /**
   * Register a scoped binding — like singleton but per-request.
   * The factory runs once per `runScoped()` call and is cached for that scope.
   */
  scoped<T>(token: string | symbol | Constructor<T>, factory: Factory<T>): this {
    const key = this.toToken(token)
    const wasBound = this.bindings.has(key) || this.instances.has(key)
    this.instances.delete(key)
    this.bindings.set(key, { factory, singleton: false, scoped: true })
    if (wasBound) this.fireRebinders(this.resolveAlias(key))
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
    const resolvedKey = this.resolveAlias(key)
    const wasBound = this.bindings.has(key) || this.instances.has(key)
    const wrapped = this.runExtenders(resolvedKey, value)
    this.instances.set(key, wrapped)
    if (wasBound) this.fireRebinders(resolvedKey)
    return this
  }

  /**
   * Wrap the value resolved for `token` with `extender`. Multiple extenders
   * chain in registration order. Applies eagerly to any currently cached
   * instance — only the newly registered extender wraps the cached value
   * (the chain was already applied to it). Singletons and `instance()`-bound
   * values cache the wrapped form; transient bindings re-wrap on each
   * `make()`; scoped bindings re-wrap once per scope.
   */
  extend<T>(token: string | symbol | Constructor<T>, extender: Extender<T>): this {
    const key = this.resolveAlias(this.toToken(token))
    const list = this._extenders.get(key) ?? []
    list.push(extender as Extender)
    this._extenders.set(key, list)
    if (this.instances.has(key)) {
      const current = this.instances.get(key)
      this.instances.set(key, (extender as Extender)(current, this))
    }
    return this
  }

  /**
   * Register a listener that fires whenever `token` is *re*-bound. Listeners
   * do not fire on the initial bind — only when an existing binding is
   * replaced via `bind`/`singleton`/`scoped`/`instance`. The listener
   * receives the freshly-resolved value, not the stale singleton cache.
   */
  rebinding<T>(token: string | symbol | Constructor<T>, listener: Rebinder<T>): this {
    const key = this.resolveAlias(this.toToken(token))
    const list = this._rebinders.get(key) ?? []
    list.push(listener as Rebinder)
    this._rebinders.set(key, list)
    return this
  }

  /**
   * Bind a factory only if the token is not already bound. Returns `this` either way.
   * Useful for framework providers registering sane defaults that an app provider
   * can override by binding the same token first.
   */
  bindIf<T>(token: string | symbol | Constructor<T>, factory: Factory<T>): this {
    return this.has(token) ? this : this.bind(token, factory)
  }

  /** Singleton variant of `bindIf`. */
  singletonIf<T>(token: string | symbol | Constructor<T>, factory: Factory<T>): this {
    return this.has(token) ? this : this.singleton(token, factory)
  }

  /** Scoped variant of `bindIf`. */
  scopedIf<T>(token: string | symbol | Constructor<T>, factory: Factory<T>): this {
    return this.has(token) ? this : this.scoped(token, factory)
  }

  /**
   * Tag one or more tokens with one or more tag names. Calls are additive —
   * tagging the same token twice with the same tag is a no-op.
   * Tagging an unbound token is allowed; resolution via `tagged()` will
   * throw the standard "cannot resolve" error.
   */
  tag(
    tokens: string | symbol | Constructor | Array<string | symbol | Constructor>,
    tags: string | string[],
  ): this {
    const tokenList = Array.isArray(tokens) ? tokens : [tokens]
    const tagList   = Array.isArray(tags)   ? tags   : [tags]
    for (const tag of tagList) {
      let set = this._tags.get(tag)
      if (!set) {
        set = new Set<string | symbol>()
        this._tags.set(tag, set)
      }
      for (const t of tokenList) set.add(this.toToken(t))
    }
    return this
  }

  /**
   * Resolve every token registered under `tag` via `make()`. Returns `[]` for
   * an unknown tag (no throw). Order is insertion order.
   */
  tagged<T>(tag: string): T[] {
    const set = this._tags.get(tag)
    if (!set) return []
    const out: T[] = []
    for (const token of set) out.push(this.make<T>(token))
    return out
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

    if (this._building.has(key)) {
      const chain = [...this._building, key].map(k => this._tokenLabel(k)).join(' → ')
      throw new Error(
        `[RudderJS] Circular dependency detected while resolving from the DI container:\n` +
        `  ${chain}\n` +
        `  Break the cycle with a deferred provider, a factory binding, or a setter dependency.`
      )
    }

    this._building.add(key)
    try {
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
          const value = this.runExtenders(key, binding.factory(this) as T)
          scope.set(key, value)
          return value
        }

        const value = this.runExtenders(key, binding.factory(this) as T)
        if (binding.singleton) this.instances.set(key, value)
        return value
      }

      if (typeof token === 'function') {
        return this.runExtenders(key, this.autoResolve(token as Constructor<T>))
      }

      // Deferred provider hook — give the missing handler a chance to register
      // the binding. Hand off OUTSIDE the build guard (drop the marker first):
      // the deferred-provider path has its own cycle detection (Application's
      // `_resolving`, with a more actionable message), and a provider
      // legitimately resolves sibling tokens during register/boot. Dropping the
      // marker also lets the same-key retry below re-resolve cleanly (deferred
      // registration, not recursion).
      if (this._missingHandler) {
        this._building.delete(key)
        this._missingHandler(key)
        if (this.instances.has(key) || this.bindings.has(key)) {
          return this.make<T>(token)
        }
      }

      const label = this._tokenLabel(key)
      throw new Error(
        `[RudderJS] Cannot resolve ${label} from the DI container.\n` +
        `  Did you forget to add @Injectable() to the class, or register it in a ServiceProvider?`
      )
    } finally {
      this._building.delete(key)
    }
  }

  private _tokenLabel(key: string | symbol): string {
    return typeof key === 'symbol' ? key.toString() : `"${String(key)}"`
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

    const tagOverrides: Array<{ index: number; tag: string }> =
      Reflect.getMetadata(TAG_METADATA, target) ?? []

    // Check contextual bindings for this target class
    const ctxMap = this._contextual.get(target.name)

    const args = paramTypes.map((type, i) => {
      const tagOverride = tagOverrides.find(o => o.index === i)
      const override    = tokenOverrides.find(o => o.index === i)
      const needToken   = override ? override.token : this.toToken(type)

      // Contextual override takes priority over decorators
      if (ctxMap) {
        const ctxFactory = ctxMap.get(needToken)
        if (ctxFactory) return ctxFactory(this)
      }

      // @Tag wins over @Inject — they should not coexist on the same param,
      // but if they do, the more specific intent (tagged array) takes precedence.
      if (tagOverride) return this.tagged(tagOverride.tag)

      return override ? this.make(override.token) : this.make(type)
    })

    return new (target as new (...a: unknown[]) => T)(...args)
  }

  private runExtenders<T>(key: string | symbol, value: T): T {
    const exts = this._extenders.get(key)
    if (!exts || exts.length === 0) return value
    let v: unknown = value
    for (const ext of exts) v = ext(v, this)
    return v as T
  }

  private fireRebinders(key: string | symbol): void {
    const listeners = this._rebinders.get(key)
    if (!listeners?.length) return
    const fresh = this.make(key)
    for (const fn of listeners) fn(fresh, this)
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
//
// Routed through `globalThis` so duplicate bundles of `@rudderjs/core` share
// the same Container instance. Defensive — today only `Application` imports
// this, and the Application itself lives on globalThis, so consumers reaching
// the container through `app().container` / `app().make()` already share one
// instance. But if a future consumer ever imports `container` directly across
// a bundle boundary, the singleton needs to survive the split.

const CONTAINER_KEY = '__rudderjs_core_container__'
const _containerGlobal = globalThis as Record<string, unknown>
export const container: Container = (_containerGlobal[CONTAINER_KEY] as Container | undefined)
  ?? (() => { const c = new Container(); _containerGlobal[CONTAINER_KEY] = c; return c })()
