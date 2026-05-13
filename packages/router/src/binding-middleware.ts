import type { MiddlewareHandler, RouteDefinition } from '@rudderjs/contracts'
import { stripRegexSegments } from './index.js'

// ─── Route Model Binding ───────────────────────────────────

/**
 * Duck-typed contract for any object that resolves a string route parameter
 * into a value (typically a Model instance, but the router doesn't depend on
 * `@rudderjs/orm` — anything with a static `findForRoute` method works).
 *
 * Returning `null` signals "not found" — the router maps that to a thrown
 * `RouteModelNotFoundError`, which the framework's HTTP layer renders as a 404.
 */
export interface RouteResolver {
  /** Owning class name — used for error messages only. */
  name: string
  /** Resolve the raw param value. Return `null` for not-found. */
  findForRoute(value: string): Promise<unknown | null> | unknown | null
}

export interface RouteBindingOptions {
  /**
   * When `true`, an absent or unresolvable param value silently sets
   * `req.bound[name] = null` instead of throwing. Useful for shared routes
   * that may or may not have a logged-in subject.
   */
  optional?: boolean
}

/** @internal — stored entry in `Router.bindings`. */
export interface RouteBinding {
  resolver: RouteResolver
  optional: boolean
}

/**
 * Thrown by route binding middleware when a required `{param}` cannot be
 * resolved into a model instance. `@rudderjs/core` picks up the duck-typed
 * `httpStatus` and renders this as an HTTP 404; apps can catch it explicitly
 * to render a custom not-found page.
 */
export class RouteModelNotFoundError extends Error {
  readonly model: string
  readonly param: string
  readonly value: string

  /** Duck-typed signal to `@rudderjs/core`'s exception handler. */
  readonly httpStatus = 404

  constructor(model: string, param: string, value: string) {
    super(`[RudderJS] No ${model} matched route parameter "${param}" with value "${value}".`)
    this.name = 'RouteModelNotFoundError'
    this.model = model
    this.param = param
    this.value = value
  }
}

/**
 * Build per-route binding middleware from the route's `{param}` segments and
 * the router's binding map. Returns `null` when the route's path contains no
 * bound params — callers skip installation in that case so unbound routes
 * keep their original middleware chain.
 *
 * Takes the full `RouteDefinition` (not just `path`) so the closure can
 * capture `def.missing` — the per-route 404 customisation set via
 * `RouteBuilder.missing()`.
 */
export function buildBindingMiddleware(
  bindings: Map<string, RouteBinding>,
  def: RouteDefinition,
): MiddlewareHandler | null {
  // Strip `{regex}` constraint segments from `where*()` before scanning for
  // param names — otherwise a `:` inside a custom pattern could be misread
  // as a route param. Uses balanced-brace stripping to support nested `{n}`
  // quantifiers (e.g. UUID's `[0-9a-f]{8}-...`).
  const stripped = stripRegexSegments(def.path)
  const paramNames = [...stripped.matchAll(/:([a-zA-Z_][a-zA-Z0-9_]*)\??/g)].map(m => m[1] as string)
  const matches: Array<[string, RouteBinding]> = []
  for (const name of paramNames) {
    const binding = bindings.get(name)
    if (binding) matches.push([name, binding])
  }
  if (matches.length === 0) return null

  return async (req, res, next) => {
    // Lazy-init bound bag so handlers always see an object.
    const bound = (req as unknown as { bound?: Record<string, unknown> }).bound ?? {}
    ;(req as unknown as { bound: Record<string, unknown> }).bound = bound

    for (const [name, binding] of matches) {
      const raw = req.params[name]
      let err: RouteModelNotFoundError | null = null

      if (raw === undefined || raw === '') {
        if (binding.optional) { bound[name] = null; continue }
        err = new RouteModelNotFoundError(binding.resolver.name, name, '')
      } else {
        const resolved = await binding.resolver.findForRoute(raw)
        if (resolved === null || resolved === undefined) {
          if (binding.optional) { bound[name] = null; continue }
          err = new RouteModelNotFoundError(binding.resolver.name, name, raw)
        } else {
          bound[name] = resolved
        }
      }

      if (err) {
        if (def.missing) {
          // Route opted into a custom 404 — dispatch the result the same
          // way registerRoute() handles a route handler's return value.
          const result = await def.missing(req, err)
          if (result instanceof Response) {
            ;(res.raw as { res?: Response }).res = result
            return
          }
          if (typeof result === 'string') { res.send(result); return }
          if (result !== undefined && result !== null) { res.json(result); return }
          // undefined → callback wrote to res directly; trust that.
          return
        }
        throw err
      }
    }
    await next()
  }
}
