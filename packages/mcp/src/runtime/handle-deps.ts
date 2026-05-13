import { getInjectTokens } from '../decorators.js'

export type Ctor<T = unknown> = new (...args: any[]) => T

type RudderContainer = {
  make?: <U>(target: Ctor<U> | string | symbol) => U
}

function getContainer(): RudderContainer | undefined {
  const g = globalThis as Record<string, unknown>
  // `__rudderjs_app__` is the Application singleton (exposes `.make()`).
  // `__rudderjs_instance__` is the RudderJS wrapper (does not).
  return (g['__rudderjs_app__'] as RudderContainer | undefined)
      ?? (g['__rudderjs_instance__'] as RudderContainer | undefined)
}

/**
 * Try to resolve a class via the framework's DI container (auto-injects
 * constructor dependencies). Falls back to plain `new T()` if the container
 * is not available or resolution fails.
 */
export function resolveOrConstruct<T>(Ctor: Ctor<T>): T {
  try {
    const container = getContainer()
    if (container?.make) {
      return container.make(Ctor)
    }
  } catch {
    // DI resolution failed — fall back to plain constructor
  }
  return new Ctor()
}

/**
 * Read `design:paramtypes` for the given method and resolve all parameters
 * beyond index 0 from the DI container. Index 0 is reserved for the tool
 * input (or resource params / prompt arguments).
 *
 * Returns an empty array if:
 *   - the method wasn't decorated (no metadata emitted by TS)
 *   - the framework container isn't available
 *   - no extra parameters were declared
 */
export function resolveHandleDeps(instance: object, propertyKey: string): unknown[] {
  // 1) Preferred: explicit tokens from @Handle(Type1, Type2, …). Always works,
  //    no reliance on emitDecoratorMetadata.
  const explicit = getInjectTokens(instance, propertyKey)
  const container = getContainer()

  if (explicit && explicit.length > 0) {
    if (!container?.make) return []
    return explicit.map((token) => {
      try {
        return container.make!(token as Ctor)
      } catch {
        return undefined
      }
    })
  }

  // 2) Fallback: design:paramtypes (requires tsc or a bundler that emits
  //    decorator metadata — notably esbuild/Vite do not).
  const paramTypes = Reflect.getMetadata('design:paramtypes', instance, propertyKey) as
    Ctor[] | undefined
  if (!paramTypes || paramTypes.length <= 1) return []
  if (!container?.make) return []

  const extras: unknown[] = []
  for (let i = 1; i < paramTypes.length; i++) {
    const Type = paramTypes[i]
    if (!Type) { extras.push(undefined); continue }
    try {
      extras.push(container.make(Type))
    } catch {
      extras.push(undefined)
    }
  }
  return extras
}

/**
 * Resolve `shouldRegister?()` for a primitive. Items without the hook are
 * always registered. Awaits async hooks.
 */
export async function isRegistered(item: { shouldRegister?(): boolean | Promise<boolean> }): Promise<boolean> {
  if (!item.shouldRegister) return true
  return Boolean(await item.shouldRegister())
}

export async function filterRegistered<T extends { shouldRegister?(): boolean | Promise<boolean> }>(
  items: T[],
): Promise<T[]> {
  const out: T[] = []
  for (const item of items) {
    if (await isRegistered(item)) out.push(item)
  }
  return out
}
