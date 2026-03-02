import 'reflect-metadata'

// ─── Types ─────────────────────────────────────────────────

type Constructor<T = unknown> = new (...args: unknown[]) => T
type Factory<T = unknown> = (container: Container) => T
type Binding<T = unknown> = { factory: Factory<T>; singleton: boolean }

// ─── Decorators ────────────────────────────────────────────

const INJECTABLE_METADATA = 'forge:injectable'
const INJECT_METADATA     = 'forge:inject'

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

  /** Clear all bindings, instances, and aliases */
  reset(): this {
    this.bindings.clear()
    this.instances.clear()
    this.aliases.clear()
    return this
  }

  // ── Registration ──────────────────────────────────────────

  /** Register a factory binding (new instance every call) */
  bind<T>(token: string | symbol | Constructor<T>, factory: Factory<T>): this {
    this.bindings.set(this.toToken(token), { factory, singleton: false })
    return this
  }

  /** Register a singleton binding (same instance every call) */
  singleton<T>(token: string | symbol | Constructor<T>, factory: Factory<T>): this {
    this.bindings.set(this.toToken(token), { factory, singleton: true })
    return this
  }

  /** Register an already-created instance as a singleton */
  instance<T>(token: string | symbol | Constructor<T>, value: T): this {
    const key = this.toToken(token)
    this.instances.set(key, value)
    return this
  }

  /** Alias a token to another token */
  alias(from: string, to: string | symbol): this {
    this.aliases.set(from, to)
    return this
  }

  // ── Resolution ────────────────────────────────────────────

  /** Resolve a binding by token */
  make<T>(token: string | symbol | Constructor<T>): T {
    const key = this.resolveAlias(this.toToken(token))

    // Return existing singleton instance
    if (this.instances.has(key)) {
      return this.instances.get(key) as T
    }

    // Resolve from binding
    if (this.bindings.has(key)) {
      const binding = this.bindings.get(key)!
      const value = binding.factory(this) as T

      if (binding.singleton) {
        this.instances.set(key, value)
      }

      return value
    }

    // Auto-resolve class if it has @Injectable
    if (typeof token === 'function') {
      return this.autoResolve(token as Constructor<T>)
    }

    throw new Error(`[Forge Container] No binding found for token: ${String(key)}`)
  }

  /** Check if a token is bound */
  has(token: string | symbol | Constructor): boolean {
    const key = this.resolveAlias(this.toToken(token))
    return this.bindings.has(key) || this.instances.has(key)
  }

  /** Remove a binding and its cached instance */
  forget(token: string | symbol | Constructor): this {
    const key = this.toToken(token)
    this.bindings.delete(key)
    this.instances.delete(key)
    return this
  }

  // ── Auto-resolution ───────────────────────────────────────

  private autoResolve<T>(target: Constructor<T>): T {
    const isInjectable = Reflect.getMetadata(INJECTABLE_METADATA, target)
    if (!isInjectable) {
      throw new Error(
        `[Forge Container] "${target.name}" is not decorated with @Injectable`
      )
    }

    const paramTypes: Constructor[] =
      Reflect.getMetadata('design:paramtypes', target) ?? []

    const tokenOverrides: Array<{ index: number; token: string | symbol }> =
      Reflect.getMetadata(INJECT_METADATA, target) ?? []

    const args = paramTypes.map((type, i) => {
      const override = tokenOverrides.find(o => o.index === i)
      return override ? this.make(override.token) : this.make(type)
    })

    return new target(...(args as unknown[]))
  }

  // ── Helpers ───────────────────────────────────────────────

  private toToken(token: string | symbol | Constructor): string | symbol {
    return typeof token === 'function' ? token.name : token
  }

  private resolveAlias(key: string | symbol): string | symbol {
    if (typeof key === 'string' && this.aliases.has(key)) {
      return this.aliases.get(key)!
    }
    return key
  }
}

// ─── Global app container instance ─────────────────────────

export const container = new Container()
