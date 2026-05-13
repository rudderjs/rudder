import type { HttpMethod, MiddlewareHandler } from '@rudderjs/contracts'
import type { Router, RouteBuilder } from './index.js'

// ─── Resource verb tables / helpers ────────────────────────

/** The seven canonical RESTful verbs Laravel's `Route::resource` exposes. */
export type ResourceVerb = 'index' | 'create' | 'store' | 'show' | 'edit' | 'update' | 'destroy'

/** @internal — shape of a single row in the verb tables below. */
export interface ResourceVerbSpec {
  verb:       ResourceVerb
  method:     HttpMethod
  path:       (name: string, param: string) => string
  nameSuffix: string
}

/** @internal — verb table for `resource()` / `apiResource()`. */
export const RESOURCE_VERBS: readonly ResourceVerbSpec[] = [
  { verb: 'index',   method: 'GET',    path: (n)    => `/${n}`,            nameSuffix: 'index'   },
  { verb: 'create',  method: 'GET',    path: (n)    => `/${n}/create`,     nameSuffix: 'create'  },
  { verb: 'store',   method: 'POST',   path: (n)    => `/${n}`,            nameSuffix: 'store'   },
  { verb: 'show',    method: 'GET',    path: (n, p) => `/${n}/:${p}`,      nameSuffix: 'show'    },
  { verb: 'edit',    method: 'GET',    path: (n, p) => `/${n}/:${p}/edit`, nameSuffix: 'edit'    },
  { verb: 'update',  method: 'PUT',    path: (n, p) => `/${n}/:${p}`,      nameSuffix: 'update'  },
  { verb: 'destroy', method: 'DELETE', path: (n, p) => `/${n}/:${p}`,      nameSuffix: 'destroy' },
]

/** @internal — verb table for `singleton()`. */
export const SINGLETON_VERBS: readonly ResourceVerbSpec[] = [
  { verb: 'show',   method: 'GET', path: (n) => `/${n}`,       nameSuffix: 'show'   },
  { verb: 'edit',   method: 'GET', path: (n) => `/${n}/edit`,  nameSuffix: 'edit'   },
  { verb: 'update', method: 'PUT', path: (n) => `/${n}`,       nameSuffix: 'update' },
]

/** @internal — `.creatable()` opt-in for singletons. */
export const SINGLETON_CREATE_VERBS: readonly ResourceVerbSpec[] = [
  { verb: 'create', method: 'GET',  path: (n) => `/${n}/create`, nameSuffix: 'create' },
  { verb: 'store',  method: 'POST', path: (n) => `/${n}`,        nameSuffix: 'store'  },
]

/** @internal — `.destroyable()` opt-in for singletons. */
export const SINGLETON_DESTROY_VERBS: readonly ResourceVerbSpec[] = [
  { verb: 'destroy', method: 'DELETE', path: (n) => `/${n}`, nameSuffix: 'destroy' },
]

/** @internal — apply `only` / `except` to a verb table. */
export function filterVerbs(table: readonly ResourceVerbSpec[], opts: ResourceOptions): readonly ResourceVerbSpec[] {
  let verbs = table
  if (opts.only)   { const allow = new Set(opts.only);   verbs = verbs.filter(v => allow.has(v.verb)) }
  if (opts.except) { const deny  = new Set(opts.except); verbs = verbs.filter(v => !deny.has(v.verb)) }
  return verbs
}

/**
 * @internal — naive English singularizer for the default resource param name.
 * Handles the three patterns Laravel users hit constantly (`posts → post`,
 * `categories → category`, `boxes → box`). Anything irregular — `people`,
 * `data`, etc. — should be overridden via the `parameters` option, exactly
 * as in Laravel.
 */
export function singularize(name: string): string {
  if (/[^aeiou]ies$/i.test(name))     return name.slice(0, -3) + 'y'   // categories → category
  if (/(s|x|z|ch|sh)es$/i.test(name)) return name.slice(0, -2)         // boxes → box
  if (/s$/i.test(name) && !/ss$/i.test(name)) return name.slice(0, -1) // posts → post
  return name
}

// ─── Resource options + registrations ──────────────────────

/**
 * Options accepted by `router.resource`/`apiResource`/`singleton`.
 *
 * - `only`/`except` — restrict the verbs registered.
 * - `parameters` — override the `:param` segment name for a given resource
 *   (e.g. `{ posts: 'article' }` → `/posts/:article`).
 * - `names` — override the generated route names per verb.
 * - `middleware` — applied to every route registered by the resource.
 */
export interface ResourceOptions {
  only?:       readonly ResourceVerb[]
  except?:     readonly ResourceVerb[]
  parameters?: Record<string, string>
  names?:      Partial<Record<ResourceVerb, string>>
  middleware?: MiddlewareHandler[]
}

/**
 * Returned by `router.resource()`/`apiResource()`. The `builders` array holds
 * one `RouteBuilder` per registered route in declaration order — apply
 * `where*()`, additional middleware, or rename individual routes by indexing
 * directly. The `update` PATCH alias is included as a separate builder
 * immediately after its PUT counterpart.
 */
export class ResourceRegistration {
  constructor(public readonly builders: RouteBuilder[]) {}
}

/**
 * Returned by `router.singleton()`. Adds two opt-in helpers on top of
 * `ResourceRegistration` for resources that also expose a creation flow
 * (`.creatable()`) or deletion flow (`.destroyable()`).
 */
export class SingletonRegistration extends ResourceRegistration {
  constructor(
    builders: RouteBuilder[],
    private readonly _router: Router,
    private readonly _name: string,
    private readonly _Ctrl: new () => object,
    private readonly _opts: ResourceOptions,
  ) { super(builders) }

  /**
   * Add `GET /<name>/create` and `POST /<name>` — the create/store half of a
   * full resource. Skipped for any verb the controller doesn't implement.
   */
  creatable(): this {
    const reg = this._router._registerResource(this._name, this._Ctrl, SINGLETON_CREATE_VERBS, this._opts)
    this.builders.push(...reg.builders)
    return this
  }

  /**
   * Add `DELETE /<name>` — the destroy half of a full resource. Skipped if
   * the controller doesn't implement `destroy()`.
   */
  destroyable(): this {
    const reg = this._router._registerResource(this._name, this._Ctrl, SINGLETON_DESTROY_VERBS, this._opts)
    this.builders.push(...reg.builders)
    return this
  }
}
