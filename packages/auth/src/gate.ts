import type { Authenticatable } from './contracts.js'
import { currentAuth } from './auth-manager.js'
import type { GateObserverRegistry } from './gate-observers.js'

// Reads the process-wide singleton set by gate-observers.ts on every call.
// Caching the result would trap an early null when Gate.allows() runs before
// gate-observers.ts is imported — a later subscription (e.g. Telescope's
// GateCollector) would never see events. The lookup is a single property
// read; cost is negligible compared to the auth decision it surrounds.
function _getGateObservers(): GateObserverRegistry | null {
  return (globalThis as Record<string, unknown>)['__rudderjs_gate_observers__'] as GateObserverRegistry | undefined ?? null
}

/**
 * Compose the `AuthorizationError` message thrown by `Gate.authorize()`/policy
 * `authorize()` denials. The base form ("This action is unauthorized.
 * [<ability>]") is what the client sees through the duck-typed `httpStatus`
 * renderer (status 403). In dev (`NODE_ENV !== 'production'`) we append a
 * targeted hint at the most common cause of an *unexpected* 403 — typo'd
 * ability name or a missing `Gate.define()` / `Policy.<ability>()`. Strip the
 * dev tail in prod so the JSON message stays terse.
 */
function describeUnauthorized(ability: string): string {
  const base = `This action is unauthorized. [${ability}]`
  if (process.env['NODE_ENV'] === 'production') return base
  return `${base} (if you didn't expect a 403 here, check that the "${ability}" gate or policy method exists — Gate.define("${ability}", ...) or Policy.${ability}(user, ...).)`
}

// ─── Types ────────────────────────────────────────────────

type AbilityCallback = (user: Authenticatable, ...args: unknown[]) => boolean | Promise<boolean>
type BeforeCallback = (user: Authenticatable, ability: string) => boolean | null | undefined | Promise<boolean | null | undefined>

/** Internal result with resolution metadata for observers. */
interface CheckResult {
  allowed:     boolean
  resolvedVia: 'ability' | 'policy' | 'before' | 'default'
  policy?:     string
}

// ─── Policy Base Class ────────────────────────────────────

export abstract class Policy {
  /**
   * Run before any other check. Return true/false to short-circuit,
   * or null/undefined to fall through to the specific method.
   */
  before?(_user: Authenticatable): boolean | null | undefined | Promise<boolean | null | undefined>
}

type PolicyClass = new () => Policy
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ModelClass = abstract new (...args: any[]) => unknown

/**
 * Resolve an ability to a *genuine* policy method.
 *
 * A naive `policy[ability]` lookup is a fail-open authorization hole: every
 * object inherits callable members from `Object.prototype` (`toString`,
 * `valueOf`, `toLocaleString`, `hasOwnProperty`, `isPrototypeOf`,
 * `propertyIsEnumerable`), all of which are functions that return a truthy
 * value. So `Gate.allows('toString', somePoliciedModel)` would call
 * `Object.prototype.toString` and treat its `"[object Object]"` result as
 * "allowed" — granting access for any authenticated user against any model
 * with a registered policy whenever the ability name collides with an inherited
 * member. `constructor` is similar (a function that throws when called).
 *
 * Resolve the method only from the policy instance's own properties and its
 * prototype chain *up to but excluding* `Object.prototype`, where real policy
 * methods actually live. Anything inherited from `Object.prototype` (or the
 * reserved `constructor` / `__proto__`) yields `null` → the caller denies.
 */
function resolvePolicyMethod(
  policy: object,
  ability: string,
): ((...a: unknown[]) => boolean | Promise<boolean>) | null {
  if (!ability || ability === 'constructor' || ability === '__proto__') return null

  // Own instance property (covers arrow-function fields assigned in the ctor).
  if (Object.prototype.hasOwnProperty.call(policy, ability)) {
    const own = (policy as Record<string, unknown>)[ability]
    return typeof own === 'function' ? (own as (...a: unknown[]) => boolean | Promise<boolean>) : null
  }

  // Prototype chain, stopping before Object.prototype so inherited Object
  // methods can never be mistaken for an authorization method.
  let proto = Object.getPrototypeOf(policy) as object | null
  while (proto && proto !== Object.prototype) {
    if (Object.prototype.hasOwnProperty.call(proto, ability)) {
      const m = (proto as Record<string, unknown>)[ability]
      return typeof m === 'function' ? (m as (...a: unknown[]) => boolean | Promise<boolean>) : null
    }
    proto = Object.getPrototypeOf(proto) as object | null
  }
  return null
}

// ─── Gate ─────────────────────────────────────────────────

/**
 * Shared singleton store routed through `globalThis` so the registry survives
 * the case where `@rudderjs/auth` is loaded twice — typical in a Vite-bundled
 * server where the framework bundles `@rudderjs/auth` inline but
 * `AuthProvider.boot()` (and any `Gate.define()` / `Gate.policy()` calls in
 * `AppServiceProvider.boot()`) runs from a `node_modules` copy resolved via
 * the provider auto-discovery manifest. Without a shared store, abilities
 * registered from the externalized copy would never be visible to
 * `Gate.allows()` calls from inside the bundle, silently denying every
 * authorization check.
 *
 * Defensive migration per the #499 static-state singleton audit (the
 * `@rudderjs/auth` provider currently boots from the bundle in practice, so
 * this isn't broken today — but the layout is identical to packages that
 * were). Same pattern as PR #498 (`@rudderjs/orm` `ModelRegistry`), #500–#505
 * (pennant, cache, queue, mail, storage, hash).
 */
interface GateRegistryStore {
  abilities: Map<string, AbilityCallback>
  policies: Map<ModelClass, PolicyClass>
  beforeCallbacks: BeforeCallback[]
}

const _g = globalThis as Record<string, unknown>
if (!_g['__rudderjs_gate_registry__']) {
  _g['__rudderjs_gate_registry__'] = {
    abilities: new Map<string, AbilityCallback>(),
    policies: new Map<ModelClass, PolicyClass>(),
    beforeCallbacks: [],
  } satisfies GateRegistryStore
}
const _store = _g['__rudderjs_gate_registry__'] as GateRegistryStore

export class Gate {
  // ── Define abilities ──────────────────────────────────

  /**
   * Register an ability callback. The args tuple is generic so callers can
   * narrow parameter types without casting:
   *
   * ```ts
   * Gate.define('edit-post', (user, post: Post) => user.id === post.authorId)
   * ```
   *
   * The stored callback is widened to `AbilityCallback` (unknown args) for
   * the Map; narrowing only matters at the call site.
   */
  static define<TArgs extends unknown[] = unknown[]>(
    ability: string,
    callback: (user: Authenticatable, ...args: TArgs) => boolean | Promise<boolean>,
  ): void {
    _store.abilities.set(ability, callback as AbilityCallback)
  }

  static before(callback: BeforeCallback): void {
    _store.beforeCallbacks.push(callback)
  }

  static policy(model: ModelClass, policy: PolicyClass): void {
    _store.policies.set(model, policy)
  }

  // ── Check abilities ───────────────────────────────────

  static async allows(ability: string, ...args: unknown[]): Promise<boolean> {
    const user = await this.resolveUser()
    if (!user) {
      this._emitObservation(ability, null, { allowed: false, resolvedVia: 'default' }, args, 0)
      return false
    }
    const start = performance.now()
    const result = await this._check(user, ability, ...args)
    const duration = Math.round(performance.now() - start)
    this._emitObservation(ability, user, result, args, duration)
    return result.allowed
  }

  static async denies(ability: string, ...args: unknown[]): Promise<boolean> {
    return !(await this.allows(ability, ...args))
  }

  /**
   * Check ability — throw 403 if denied.
   */
  static async authorize(ability: string, ...args: unknown[]): Promise<void> {
    if (await this.denies(ability, ...args)) {
      throw new AuthorizationError(describeUnauthorized(ability))
    }
  }

  // ── Scoped to a specific user ─────────────────────────

  static forUser(user: Authenticatable): GateForUser {
    return new GateForUser(user, _store.abilities, _store.policies, _store.beforeCallbacks)
  }

  // ── Internal ──────────────────────────────────────────

  private static async resolveUser(): Promise<Authenticatable | null> {
    try {
      const manager = currentAuth()
      return await manager.guard().user()
    } catch {
      return null
    }
  }

  private static async _check(user: Authenticatable, ability: string, ...args: unknown[]): Promise<CheckResult> {
    // Run before callbacks
    for (const cb of _store.beforeCallbacks) {
      const result = await cb(user, ability)
      if (result === true)  return { allowed: true,  resolvedVia: 'before' }
      if (result === false) return { allowed: false, resolvedVia: 'before' }
    }

    // Check if the first arg is a model instance with a registered policy
    const model = args[0]
    if (model && typeof model === 'object') {
      const policyClass = this.findPolicy(model)
      if (policyClass) {
        const allowed = await this.callPolicy(policyClass, user, ability, ...args)
        return { allowed, resolvedVia: 'policy', policy: policyClass.name }
      }
    }

    // Fall back to defined abilities
    const callback = _store.abilities.get(ability)
    if (!callback) return { allowed: false, resolvedVia: 'default' }
    return { allowed: await callback(user, ...args), resolvedVia: 'ability' }
  }

  private static findPolicy(model: unknown): PolicyClass | undefined {
    if (!model || typeof model !== 'object') return undefined
    const constructor = (model as unknown as { constructor?: ModelClass }).constructor
    if (!constructor) return undefined

    // Direct match
    const direct = _store.policies.get(constructor)
    if (direct) return direct

    // Check prototype chain
    for (const [modelClass, policyClass] of _store.policies) {
      if (model instanceof modelClass) return policyClass
    }

    return undefined
  }

  private static async callPolicy(
    PolicyCtor: PolicyClass,
    user: Authenticatable,
    ability: string,
    ...args: unknown[]
  ): Promise<boolean> {
    const policy = new PolicyCtor()

    // Policy.before
    if (policy.before) {
      const result = await policy.before(user)
      if (result === true) return true
      if (result === false) return false
    }

    // Call the specific method (own/prototype method only — never an inherited
    // Object.prototype member, which would fail-open to "allowed").
    const method = resolvePolicyMethod(policy, ability)
    if (!method) return false
    return method.call(policy, user, ...args)
  }

  /** Emit an observation event to the gate observer registry (if present). */
  private static _emitObservation(
    ability: string,
    user: Authenticatable | null,
    result: CheckResult,
    args: unknown[],
    duration: number,
  ): void {
    const obs = _getGateObservers()
    if (!obs) return

    const modelName = _modelName(args[0])
    const safeArgs  = _safeSerializeArgs(args)

    obs.emit({
      ability,
      userId:      user ? user.getAuthIdentifier() : null,
      allowed:     result.allowed,
      resolvedVia: result.resolvedVia,
      policy:      result.policy,
      model:       modelName,
      args:        safeArgs,
      duration,
    })
  }

  /** Test-cleanup hook (public — other packages reset across the boundary). */
  static reset(): void {
    _store.abilities.clear()
    _store.policies.clear()
    _store.beforeCallbacks = []
  }
}

// ─── GateForUser ──────────────────────────────────────────

class GateForUser {
  constructor(
    private readonly user: Authenticatable,
    private readonly abilities: Map<string, AbilityCallback>,
    private readonly policies: Map<ModelClass, PolicyClass>,
    private readonly beforeCallbacks: BeforeCallback[],
  ) {}

  async allows(ability: string, ...args: unknown[]): Promise<boolean> {
    const start = performance.now()
    const result = await this._check(ability, ...args)
    const duration = Math.round(performance.now() - start)

    const obs = _getGateObservers()
    if (obs) {
      obs.emit({
        ability,
        userId:      this.user.getAuthIdentifier(),
        allowed:     result.allowed,
        resolvedVia: result.resolvedVia,
        policy:      result.policy,
        model:       _modelName(args[0]),
        args:        _safeSerializeArgs(args),
        duration,
      })
    }
    return result.allowed
  }

  private async _check(ability: string, ...args: unknown[]): Promise<CheckResult> {
    // Deny-by-default for a null/undefined principal — mirrors `Gate.allows`,
    // which short-circuits guests before any policy/ability runs. `forUser`'s
    // type forbids null, but a runtime `forUser(null as any)` must not reach a
    // policy method with a null user (where `!post.private` would fail-open).
    if (!this.user) return { allowed: false, resolvedVia: 'default' }

    // Before callbacks
    for (const cb of this.beforeCallbacks) {
      const result = await cb(this.user, ability)
      if (result === true)  return { allowed: true,  resolvedVia: 'before' }
      if (result === false) return { allowed: false, resolvedVia: 'before' }
    }

    // Policy check
    const model = args[0]
    if (model && typeof model === 'object') {
      const constructor = (model as unknown as { constructor?: ModelClass }).constructor
      if (constructor) {
        const PolicyCtor = this.policies.get(constructor)
        if (PolicyCtor) {
          const policy = new PolicyCtor()
          if (policy.before) {
            const result = await policy.before(this.user)
            if (result === true)  return { allowed: true,  resolvedVia: 'before' }
            if (result === false) return { allowed: false, resolvedVia: 'before' }
          }
          const method = resolvePolicyMethod(policy, ability)
          if (!method) {
            return { allowed: false, resolvedVia: 'policy', policy: PolicyCtor.name }
          }
          const allowed = await method.call(policy, this.user, ...args)
          return { allowed, resolvedVia: 'policy', policy: PolicyCtor.name }
        }
      }
    }

    // Ability check
    const callback = this.abilities.get(ability)
    if (!callback) return { allowed: false, resolvedVia: 'default' }
    return { allowed: await callback(this.user, ...args), resolvedVia: 'ability' }
  }

  async denies(ability: string, ...args: unknown[]): Promise<boolean> {
    return !(await this.allows(ability, ...args))
  }

  async authorize(ability: string, ...args: unknown[]): Promise<void> {
    if (await this.denies(ability, ...args)) {
      throw new AuthorizationError(describeUnauthorized(ability))
    }
  }
}

// ─── Observation helpers ──────────────────────────────────

/**
 * Returns the constructor name of `value` if it's a class instance with a
 * meaningful name. `Object` (plain object literals) and `Array` are filtered
 * out as noise — they don't tell the reader anything useful in Telescope.
 */
function _modelName(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || !('constructor' in value)) return undefined
  const name = (value.constructor as { name?: string }).name
  if (!name || name === 'Object' || name === 'Array') return undefined
  return name
}

/**
 * JSON-safe snapshot of the gate args so the observer can serialize them
 * for storage. Strips functions, handles circular references, falls back to
 * `String(value)` for anything that can't be serialized.
 */
function _safeSerializeArgs(args: unknown[]): unknown[] {
  return args.map(a => {
    if (a === null || a === undefined) return a
    if (typeof a !== 'object') return a
    try {
      const seen = new WeakSet()
      return JSON.parse(JSON.stringify(a, (_k, v) => {
        if (typeof v === 'object' && v !== null) {
          if (seen.has(v)) return '[Circular]'
          seen.add(v)
        }
        if (typeof v === 'function') return undefined
        return v
      }))
    } catch {
      return String(a)
    }
  })
}

// ─── Authorization Error ──────────────────────────────────

export class AuthorizationError extends Error {
  readonly status = 403

  constructor(message = 'This action is unauthorized.') {
    super(message)
    this.name = 'AuthorizationError'
  }
}
