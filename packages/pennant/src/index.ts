import { ServiceProvider } from '@rudderjs/core'
import type { MiddlewareHandler } from '@rudderjs/core'

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

// Registered (cross-realm) brand. `@rudderjs/pennant` is intentionally loaded
// twice in a Vite-bundled server — a resolver in the inlined bundle copy builds
// a Lottery from THAT copy's class, while the manager runs in the node_modules
// copy. `instanceof` is nominal and fails across copies, so a gradual-rollout
// Lottery would slip through unmatched and `Boolean(lotteryObject)` would make
// the flag always-on. Symbol.for resolves to the same symbol in every copy, so
// the brand check holds across the bundle boundary.
const LOTTERY_BRAND = Symbol.for('rudderjs.pennant.lottery')

export class Lottery {
  readonly [LOTTERY_BRAND] = true

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

/** Cross-realm-safe Lottery check (see {@link LOTTERY_BRAND}). */
function isLottery(value: unknown): value is Lottery {
  return typeof value === 'object' && value !== null
    && (value as Record<symbol, unknown>)[LOTTERY_BRAND] === true
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
  // Type-prefix so distinct scopes never share a key: without this, the number
  // scope `1` and the string scope `"1"` both stringified to "1" and collided,
  // so an app passing `user.id` sometimes as a number and sometimes as a string
  // would silently share one flag value across what it treats as two scopes.
  if (typeof scope === 'string') return `s:${scope}`
  if (typeof scope === 'number') return `n:${scope}`
  return `o:${scope.constructor?.name ?? 'obj'}:${scope.id}`
}

class PennantManager {
  private definitions = new Map<string, FeatureResolver>()
  private driver: PennantDriver
  private inflight   = new Map<string, Promise<unknown>>()

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

    // Deduplicate concurrent resolves for the same feature+scope
    const inflightKey = `${name}:${scopeKey}`
    const pending = this.inflight.get(inflightKey)
    if (pending) return pending as Promise<T>

    // Resolve
    const resolver = this.definitions.get(name)
    if (!resolver) {
      throw new Error(
        `[RudderJS Pennant] Feature "${name}" is not defined.\n` +
        `  Call Feature.define('${name}', resolver) first.`
      )
    }

    const resolution = (async () => {
      let result = await resolver(scope)
      if (isLottery(result)) result = result.pick()
      // Normalize a resolved `undefined` to `null` before storing: drivers key
      // absence on `undefined` (Map.get can't tell a stored undefined from a
      // missing key), so storing undefined would re-run the resolver on every
      // call — defeating the per-scope memoization (and re-rolling a Lottery).
      if (result === undefined) result = null
      await this.driver.set(name, scopeKey, result)
      return result
    })()

    this.inflight.set(inflightKey, resolution)
    try {
      return (await resolution) as T
    } finally {
      this.inflight.delete(inflightKey)
    }
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

/**
 * Shared singleton store routed through `globalThis` so the registry survives
 * the case where `@rudderjs/pennant` is loaded twice — typical in a Vite-bundled
 * server where the framework bundles user code (including `AppServiceProvider`,
 * which calls `Feature.define()`) inline, but `PennantProvider.boot()` runs
 * from a `node_modules` copy of `@rudderjs/pennant` resolved via the provider
 * auto-discovery manifest. Without a shared store, `set()` from the externalized
 * copy would land on a different class than the one `Feature.*` reads from
 * inside the bundle, and every feature check would throw "Not registered".
 * Same pattern as the ORM/AI/MCP registries.
 */
interface PennantRegistryStore {
  manager: PennantManager | null
}

const _g = globalThis as Record<string, unknown>
if (!_g['__rudderjs_pennant_registry__']) {
  _g['__rudderjs_pennant_registry__'] = {
    manager: null,
  } satisfies PennantRegistryStore
}
const _store = _g['__rudderjs_pennant_registry__'] as PennantRegistryStore

class PennantRegistry {
  static set(manager: PennantManager): void { _store.manager = manager }

  static get(): PennantManager {
    if (!_store.manager) {
      throw new Error(
        '[RudderJS Pennant] Not registered.\n' +
        '  Add pennant() to your providers in bootstrap/providers.ts'
      )
    }
    return _store.manager
  }

  static reset(): void { _store.manager = null }
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

export class PennantProvider extends ServiceProvider {
  register(): void {}

  boot(): void {
    const driver = new MemoryDriver()
    const manager = new PennantManager(driver)
    PennantRegistry.set(manager)
    this.app.instance('pennant', Feature)
  }
}
