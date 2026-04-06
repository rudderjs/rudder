import { ServiceProvider } from '@rudderjs/core'
import type { Application, MiddlewareHandler } from '@rudderjs/core'

// ─── Types ────────────────────────────────────────────────

export interface Scopeable {
  id: string | number
  [key: string]: unknown
}

export type FeatureScope = Scopeable | string | number | null | undefined

export type FeatureResolver<T = unknown> = (scope: FeatureScope) => T | Promise<T>

export interface PennantDriver {
  get(feature: string, scope: string): Promise<unknown | undefined>
  set(feature: string, scope: string, value: unknown): Promise<void>
  delete(feature: string, scope: string): Promise<void>
  purge(feature: string): Promise<void>
}

export interface PennantConfig {
  driver?: 'memory'
}

// ─── Lottery ──────────────────────────────────────────────

export class Lottery {
  private constructor(
    private readonly _winners: number,
    private readonly _total: number,
  ) {}

  static odds(winners: number, total: number): Lottery {
    return new Lottery(winners, total)
  }

  pick(): boolean {
    return Math.random() * this._total < this._winners
  }
}

// ─── Memory Driver ────────────────────────────────────────

export class MemoryDriver implements PennantDriver {
  private store = new Map<string, Map<string, unknown>>()

  async get(feature: string, scope: string): Promise<unknown | undefined> {
    return this.store.get(feature)?.get(scope)
  }

  async set(feature: string, scope: string, value: unknown): Promise<void> {
    let featureMap = this.store.get(feature)
    if (!featureMap) {
      featureMap = new Map()
      this.store.set(feature, featureMap)
    }
    featureMap.set(scope, value)
  }

  async delete(feature: string, scope: string): Promise<void> {
    this.store.get(feature)?.delete(scope)
  }

  async purge(feature: string): Promise<void> {
    this.store.delete(feature)
  }
}

// ─── PennantManager ───────────────────────────────────────

function normalizeScope(scope: FeatureScope): string {
  if (scope === null || scope === undefined) return '__null__'
  if (typeof scope === 'string' || typeof scope === 'number') return String(scope)
  return `${scope.constructor?.name ?? 'obj'}:${scope.id}`
}

class PennantManager {
  private definitions = new Map<string, FeatureResolver>()
  private driver: PennantDriver

  constructor(driver: PennantDriver) {
    this.driver = driver
  }

  define<T = unknown>(name: string, resolver: FeatureResolver<T>): void {
    this.definitions.set(name, resolver as FeatureResolver)
  }

  async active(name: string, scope?: FeatureScope): Promise<boolean> {
    const value = await this.value(name, scope)
    return Boolean(value)
  }

  async value<T = unknown>(name: string, scope?: FeatureScope): Promise<T> {
    const scopeKey = normalizeScope(scope)

    // Check stored value first
    const stored = await this.driver.get(name, scopeKey)
    if (stored !== undefined) return stored as T

    // Resolve
    const resolver = this.definitions.get(name)
    if (!resolver) {
      throw new Error(
        `[RudderJS Pennant] Feature "${name}" is not defined.\n` +
        `  Call Feature.define('${name}', resolver) first.`
      )
    }

    let result = await resolver(scope)

    // If result is a Lottery, pick and store the boolean result
    if (result instanceof Lottery) {
      result = result.pick()
    }

    // Store the resolved value
    await this.driver.set(name, scopeKey, result)

    return result as T
  }

  async values(names: string[], scope?: FeatureScope): Promise<Record<string, unknown>> {
    const entries = await Promise.all(
      names.map(async (name) => [name, await this.value(name, scope)] as const)
    )
    return Object.fromEntries(entries)
  }

  async activate(name: string, scope?: FeatureScope): Promise<void> {
    await this.driver.set(name, normalizeScope(scope), true)
  }

  async deactivate(name: string, scope?: FeatureScope): Promise<void> {
    await this.driver.set(name, normalizeScope(scope), false)
  }

  async purge(name: string): Promise<void> {
    await this.driver.purge(name)
  }

  for(scope: FeatureScope): ScopedFeature {
    return new ScopedFeature(this, scope)
  }
}

// ─── Scoped Feature Check ─────────────────────────────────

class ScopedFeature {
  constructor(
    private readonly manager: PennantManager,
    private readonly scope: FeatureScope,
  ) {}

  active(name: string): Promise<boolean> {
    return this.manager.active(name, this.scope)
  }

  value<T = unknown>(name: string): Promise<T> {
    return this.manager.value<T>(name, this.scope)
  }

  values(names: string[]): Promise<Record<string, unknown>> {
    return this.manager.values(names, this.scope)
  }
}

// ─── Registry ─────────────────────────────────────────────

class PennantRegistry {
  private static manager: PennantManager | null = null

  static set(manager: PennantManager): void { this.manager = manager }

  static get(): PennantManager {
    if (!this.manager) {
      throw new Error(
        '[RudderJS Pennant] Not registered.\n' +
        '  Add pennant() to your providers in bootstrap/providers.ts'
      )
    }
    return this.manager
  }

  static reset(): void { this.manager = null }
}

// ─── Fake ─────────────────────────────────────────────────

interface FakeRecord {
  feature: string
  scope: string
}

export class FakePennant {
  private _checks: FakeRecord[] = []
  private _overrides = new Map<string, unknown>()

  /** @internal */
  _recordCheck(feature: string, scope: FeatureScope): void {
    this._checks.push({ feature, scope: normalizeScope(scope) })
  }

  /** Force a feature to always return a specific value */
  override(feature: string, value: unknown): this {
    this._overrides.set(feature, value)
    return this
  }

  /** @internal */
  _getOverride(feature: string): unknown | undefined {
    return this._overrides.get(feature)
  }

  /** @internal */
  _hasOverride(feature: string): boolean {
    return this._overrides.has(feature)
  }

  assertChecked(feature: string): void {
    const found = this._checks.find(r => r.feature === feature)
    if (!found) {
      throw new Error(`Expected feature "${feature}" to have been checked, but it was not.`)
    }
  }

  assertNotChecked(feature: string): void {
    const found = this._checks.find(r => r.feature === feature)
    if (found) {
      throw new Error(`Expected feature "${feature}" NOT to have been checked, but it was.`)
    }
  }

  assertCheckedFor(feature: string, scope: FeatureScope): void {
    const scopeKey = normalizeScope(scope)
    const found = this._checks.find(r => r.feature === feature && r.scope === scopeKey)
    if (!found) {
      throw new Error(
        `Expected feature "${feature}" to have been checked for scope "${scopeKey}", but it was not.`
      )
    }
  }

  restore(): void {
    _fake = null
  }
}

let _fake: FakePennant | null = null

// ─── Feature facade ───────────────────────────────────────

export class Feature {
  static define<T = unknown>(name: string, resolver: FeatureResolver<T>): void {
    PennantRegistry.get().define(name, resolver)
  }

  static async active(name: string, scope?: FeatureScope): Promise<boolean> {
    if (_fake) {
      _fake._recordCheck(name, scope)
      if (_fake._hasOverride(name)) return Boolean(_fake._getOverride(name))
    }
    return PennantRegistry.get().active(name, scope)
  }

  static async value<T = unknown>(name: string, scope?: FeatureScope): Promise<T> {
    if (_fake) {
      _fake._recordCheck(name, scope)
      if (_fake._hasOverride(name)) return _fake._getOverride(name) as T
    }
    return PennantRegistry.get().value<T>(name, scope)
  }

  static values(names: string[], scope?: FeatureScope): Promise<Record<string, unknown>> {
    return PennantRegistry.get().values(names, scope)
  }

  static for(scope: FeatureScope): ScopedFeature {
    return PennantRegistry.get().for(scope)
  }

  static activate(name: string, scope?: FeatureScope): Promise<void> {
    return PennantRegistry.get().activate(name, scope)
  }

  static deactivate(name: string, scope?: FeatureScope): Promise<void> {
    return PennantRegistry.get().deactivate(name, scope)
  }

  static purge(name: string): Promise<void> {
    return PennantRegistry.get().purge(name)
  }

  static fake(): FakePennant {
    const fake = new FakePennant()
    _fake = fake
    return fake
  }
}

// ─── Middleware ────────────────────────────────────────────

export function FeatureMiddleware(featureName: string): MiddlewareHandler {
  return async function featureMiddleware(req, res, next) {
    const scope = (req as unknown as { user?: FeatureScope }).user ?? null
    const isActive = await Feature.active(featureName, scope)
    if (!isActive) {
      res.status(403)
      res.json({ message: 'Feature not available.' })
      return
    }
    await next()
  }
}

// ─── Service Provider factory ─────────────────────────────

export function pennant(config: PennantConfig = {}): new (app: Application) => ServiceProvider {
  class PennantServiceProvider extends ServiceProvider {
    register(): void {}

    boot(): void {
      const driver = new MemoryDriver()
      const manager = new PennantManager(driver)
      PennantRegistry.set(manager)
      this.app.instance('pennant', Feature)
    }
  }
  return PennantServiceProvider
}
