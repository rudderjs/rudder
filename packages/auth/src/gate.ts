import type { Authenticatable } from './contracts.js'
import { currentAuth } from './auth-manager.js'

// ─── Types ────────────────────────────────────────────────

type AbilityCallback = (user: Authenticatable, ...args: unknown[]) => boolean | Promise<boolean>
type BeforeCallback = (user: Authenticatable, ability: string) => boolean | null | undefined | Promise<boolean | null | undefined>

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

  static define(ability: string, callback: AbilityCallback): void {
    this._abilities.set(ability, callback)
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
    if (!user) return false
    return this._check(user, ability, ...args)
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

  private static async _check(user: Authenticatable, ability: string, ...args: unknown[]): Promise<boolean> {
    // Run before callbacks
    for (const cb of this._beforeCallbacks) {
      const result = await cb(user, ability)
      if (result === true) return true
      if (result === false) return false
    }

    // Check if the first arg is a model instance with a registered policy
    const model = args[0]
    if (model && typeof model === 'object') {
      const policyClass = this.findPolicy(model)
      if (policyClass) {
        return this.callPolicy(policyClass, user, ability, ...args)
      }
    }

    // Fall back to defined abilities
    const callback = this._abilities.get(ability)
    if (!callback) return false
    return callback(user, ...args)
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
    // Before callbacks
    for (const cb of this.beforeCallbacks) {
      const result = await cb(this.user, ability)
      if (result === true) return true
      if (result === false) return false
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
            if (result === true) return true
            if (result === false) return false
          }
          const method = (policy as Record<string, unknown>)[ability]
          if (typeof method !== 'function') return false
          return (method as (...a: unknown[]) => boolean | Promise<boolean>).call(policy, this.user, ...args)
        }
      }
    }

    // Ability check
    const callback = this.abilities.get(ability)
    if (!callback) return false
    return callback(this.user, ...args)
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

// ─── Authorization Error ──────────────────────────────────

export class AuthorizationError extends Error {
  readonly status = 403

  constructor(message = 'This action is unauthorized.') {
    super(message)
    this.name = 'AuthorizationError'
  }
}
