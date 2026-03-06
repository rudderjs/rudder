import 'reflect-metadata'

// ─── Types ─────────────────────────────────────────────────

type Constructor<T = unknown> = new (...args: any[]) => T
type Factory<T = unknown> = (container: Container) => T
type Binding<T = unknown> = { factory: Factory<T>; singleton: boolean }

// ─── Decorators ────────────────────────────────────────────

const INJECTABLE_METADATA = 'boostkit:injectable'
const INJECT_METADATA     = 'boostkit:inject'

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

  reset(): this {
    this.bindings.clear()
    this.instances.clear()
    this.aliases.clear()
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

    if (this.bindings.has(key)) {
      const binding = this.bindings.get(key)!
      const value = binding.factory(this) as T
      if (binding.singleton) this.instances.set(key, value)
      return value
    }

    if (typeof token === 'function') {
      return this.autoResolve(token as Constructor<T>)
    }

    throw new Error(`[BoostKit Container] No binding found for token: ${String(key)}`)
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

  private autoResolve<T>(target: Constructor<T>): T {
    const isInjectable = Reflect.getMetadata(INJECTABLE_METADATA, target)
    if (!isInjectable) {
      throw new Error(`[BoostKit Container] "${target.name}" is not decorated with @Injectable`)
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

// ─── Global container singleton ────────────────────────────

export const container = new Container()
