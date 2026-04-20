import type { Authenticatable } from './contracts.js'
import { currentAuth } from './auth-manager.js'
import type { GateObserverRegistry } from './gate-observers.js'

// Lazy accessor — reads the process-wide singleton set by gate-observers.ts.
let _gateObs: GateObserverRegistry | null | undefined
function _getGateObservers(): GateObserverRegistry | null {
  if (_gateObs === undefined) {
    _gateObs = (globalThis as Record<string, unknown>)['__rudderjs_gate_observers__'] as GateObserverRegistry | undefined ?? null
  }
  return _gateObs
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

// ─── Gate ─────────────────────────────────────────────────

export class Gate {
  private static _abilities = new Map<string, AbilityCallback>()
  private static _policies = new Map<ModelClass, PolicyClass>()
  private static _beforeCallbacks: BeforeCallback[] = []

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
    this._abilities.set(ability, callback as AbilityCallback)
  }

  static before(callback: BeforeCallback): void {
    this._beforeCallbacks.push(callback)
  }

  static policy(model: ModelClass, policy: PolicyClass): void {
    this._policies.set(model, policy)
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
      throw new AuthorizationError(`This action is unauthorized. [${ability}]`)
    }
  }

  // ── Scoped to a specific user ─────────────────────────

  static forUser(user: Authenticatable): GateForUser {
    return new GateForUser(user, this._abilities, this._policies, this._beforeCallbacks)
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
    for (const cb of this._beforeCallbacks) {
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
    const callback = this._abilities.get(ability)
    if (!callback) return { allowed: false, resolvedVia: 'default' }
    return { allowed: await callback(user, ...args), resolvedVia: 'ability' }
  }

  private static findPolicy(model: unknown): PolicyClass | undefined {
    if (!model || typeof model !== 'object') return undefined
    const constructor = (model as unknown as { constructor?: ModelClass }).constructor
    if (!constructor) return undefined

    // Direct match
    const direct = this._policies.get(constructor)
    if (direct) return direct

    // Check prototype chain
    for (const [modelClass, policyClass] of this._policies) {
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

    // Call the specific method
    const method = (policy as Record<string, unknown>)[ability]
    if (typeof method !== 'function') return false
    return (method as (...a: unknown[]) => boolean | Promise<boolean>).call(policy, user, ...args)
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

  /** @internal — reset all definitions. Used for testing. */
  static reset(): void {
    this._abilities.clear()
    this._policies.clear()
    this._beforeCallbacks = []
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
          const method = (policy as Record<string, unknown>)[ability]
          if (typeof method !== 'function') return { allowed: false, resolvedVia: 'default' }
          const allowed = await (method as (...a: unknown[]) => boolean | Promise<boolean>).call(policy, this.user, ...args)
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
      throw new AuthorizationError(`This action is unauthorized. [${ability}]`)
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
