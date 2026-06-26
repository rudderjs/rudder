import type { McpResolver } from '@gemstack/mcp'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctor<T = unknown> = new (...args: any[]) => T

type RudderContainer = {
  make?: <U>(target: Ctor<U> | string | symbol) => U
}

/**
 * Read the Rudder application container off `globalThis`. `__rudderjs_app__` is
 * the Application singleton (exposes `.make()`); `__rudderjs_instance__` is the
 * Rudder wrapper. Mirrors the lookup the core used to perform inline before the
 * DI seam was made framework-agnostic.
 */
function getContainer(): RudderContainer | undefined {
  const g = globalThis as Record<string, unknown>
  return (g['__rudderjs_app__'] as RudderContainer | undefined)
      ?? (g['__rudderjs_instance__'] as RudderContainer | undefined)
}

/**
 * An {@link McpResolver} backed by the Rudder DI container. The provider
 * constructs every registered MCP server with this resolver so `@Handle(...)`
 * dependencies resolve through `container.make(token)` exactly as they did when
 * `@rudderjs/mcp` owned the framework core.
 *
 * Resolution semantics (faithful to the pre-graduation behaviour):
 *  - Container present: delegate to `container.make(token)` and let it throw if
 *    the binding is missing (the core surfaces that as a loud, named error).
 *  - No container: construct a class token with `new Token()` (so plain tools
 *    still instantiate); a string/symbol token throws, since there is nothing
 *    to construct without a container.
 */
export function rudderContainerResolver(): McpResolver {
  return {
    resolve(token: unknown): unknown {
      const container = getContainer()
      if (container?.make) {
        return container.make(token as Ctor)
      }
      if (typeof token === 'function') {
        return new (token as Ctor)()
      }
      throw new Error(
        `[rudderjs/mcp] no Rudder container available to resolve dependency ${String(token)}. ` +
        `MCP DI requires the Rudder app to be booted.`,
      )
    },
  }
}
