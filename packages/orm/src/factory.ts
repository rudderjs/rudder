// ─── sequence() helper ──────────────────────────────────────

/**
 * Create a value that cycles through `values` each time a new model is made.
 *
 * @example
 * definition() {
 *   return {
 *     name:  sequence(['Alice', 'Bob', 'Carol']),
 *     email: sequence(i => `user${i}@example.com`),
 *   }
 * }
 */
export function sequence<T>(valuesOrFn: T[] | ((index: number) => T)): () => T {
  let i = 0
  return () => {
    const val = Array.isArray(valuesOrFn)
      ? valuesOrFn[i % valuesOrFn.length]!
      : valuesOrFn(i)
    i++
    return val
  }
}

// ─── ModelFactory ────────────────────────────────────────────

type ModelCreateFn<TAttrs extends Record<string, unknown>> = (
  data: Partial<TAttrs>,
) => Promise<TAttrs>

type StateFn<TAttrs extends Record<string, unknown>> =
  (attrs: TAttrs) => Partial<TAttrs> | Promise<Partial<TAttrs>>

/**
 * Base class for model factories. Extend and implement `definition()` and
 * set `modelClass` to the Model you want to create.
 *
 * @example
 * class UserFactory extends ModelFactory<{ name: string; email: string; role: string }> {
 *   protected modelClass = User
 *
 *   definition() {
 *     return {
 *       name:  'Alice',
 *       email: sequence(i => `alice${i}@example.com`)(),
 *       role:  'user',
 *     }
 *   }
 *
 *   protected states() {
 *     return {
 *       admin: () => ({ role: 'admin' }),
 *     }
 *   }
 * }
 *
 * // Usage:
 * const user = await UserFactory.new().create()
 * const admin = await UserFactory.new().state('admin').create()
 * const users = await UserFactory.new().create(3)
 * const dtos  = await UserFactory.new().make(5)
 */
export abstract class ModelFactory<TAttrs extends Record<string, unknown>> {
  /** The Model class used for `create()`. */
  protected abstract readonly modelClass: { create: ModelCreateFn<TAttrs> }

  /** The base attribute definition. May return dynamic values or callables. */
  abstract definition(): TAttrs | Promise<TAttrs>

  /** Named states — override to add. */
  protected states(): Record<string, StateFn<TAttrs>> {
    return {}
  }

  private _stateOverrides: StateFn<TAttrs>[] = []

  private _clone(): this {
    const c = Object.create(this) as this
    c._stateOverrides = [...this._stateOverrides]
    return c
  }

  /** Create a new factory instance. */
  static new<T extends ModelFactory<Record<string, unknown>>>(
    this: new () => T,
  ): T {
    return new this()
  }

  /**
   * Apply a named state defined in `states()`.
   *
   * @example
   * UserFactory.new().state('admin').create()
   */
  state(name: string): this {
    const c = this._clone()
    const fn = this.states()[name]
    if (!fn) throw new Error(`[RudderJS] Factory state "${name}" is not defined on ${this.constructor.name}.`)
    c._stateOverrides.push(fn)
    return c
  }

  /**
   * Apply an inline state override.
   *
   * @example
   * UserFactory.new().with(() => ({ role: 'moderator' })).create()
   */
  with(fn: StateFn<TAttrs>): this {
    const c = this._clone()
    c._stateOverrides.push(fn)
    return c
  }

  // ── Internal build ──────────────────────────────────

  private async _build(overrides?: Partial<TAttrs>): Promise<TAttrs> {
    // Resolve definition (supports sequence() callables inside it)
    const raw = await this.definition()

    // Resolve any callable values (from sequence())
    const resolved: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(raw)) {
      resolved[k] = typeof v === 'function' ? (v as () => unknown)() : v
    }
    let attrs = resolved as TAttrs

    // Apply state overrides
    for (const stateFn of this._stateOverrides) {
      const patch = await stateFn(attrs)
      attrs = { ...attrs, ...patch }
    }

    // Apply inline overrides
    if (overrides) attrs = { ...attrs, ...overrides }

    return attrs
  }

  // ── make() ───────────────────────────────────────────

  /** Build model attribute(s) without saving to the database. */
  make(overrides?: Partial<TAttrs>): Promise<TAttrs>
  make(count: number, overrides?: Partial<TAttrs>): Promise<TAttrs[]>
  async make(
    countOrOverrides?: number | Partial<TAttrs>,
    overrides?: Partial<TAttrs>,
  ): Promise<TAttrs | TAttrs[]> {
    if (typeof countOrOverrides === 'number') {
      const n = countOrOverrides
      return Promise.all(Array.from({ length: n }, () => this._build(overrides)))
    }
    return this._build(countOrOverrides)
  }

  // ── create() ─────────────────────────────────────────

  /** Build and persist model(s) to the database via `Model.create()`. */
  create(overrides?: Partial<TAttrs>): Promise<TAttrs>
  create(count: number, overrides?: Partial<TAttrs>): Promise<TAttrs[]>
  async create(
    countOrOverrides?: number | Partial<TAttrs>,
    overrides?: Partial<TAttrs>,
  ): Promise<TAttrs | TAttrs[]> {
    if (typeof countOrOverrides === 'number') {
      const n = countOrOverrides
      const attrs = await Promise.all(Array.from({ length: n }, () => this._build(overrides)))
      return Promise.all(attrs.map(a => this.modelClass.create(a)))
    }
    const attrs = await this._build(countOrOverrides)
    return this.modelClass.create(attrs)
  }
}
