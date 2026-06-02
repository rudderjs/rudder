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

import { camelHead } from './utils.js'
import type { RelationDefinition } from './index.js'

type StateFn<TAttrs extends Record<string, unknown>> =
  (attrs: TAttrs) => Partial<TAttrs> | Promise<Partial<TAttrs>>

/**
 * Instance surface the factory drives when persisting. Methods (not arrow
 * fields) so parameter bivariance keeps a concrete `Model` subclass assignable
 * regardless of the factory's `TAttrs`.
 */
interface FactoryModelInstance {
  forceFill(data: Record<string, unknown>): unknown
  save(): Promise<unknown>
}

/**
 * Minimal Model-class shape the factory needs: construct an instance,
 * read FK conventions off `static relations` / `primaryKey` / `name`, and
 * attach pivot rows via `belongsToMany()`. Widened from the old `{ create }`
 * so the persist path can use `forceFill()` + `save()` (bypassing
 * mass-assignment, Laravel-parity) and build relationships.
 */
interface FactoryModelClass {
  new (): FactoryModelInstance
  readonly name: string
  primaryKey: string
  relations: Record<string, RelationDefinition>
  belongsToMany(parent: object, name: string): {
    attach(input: unknown, flatPivot?: Record<string, unknown>): Promise<void>
  }
}

/** Deferred `belongsTo` build — resolved into an FK override before persist. */
interface BelongsToBuild {
  factory: ModelFactory<Record<string, unknown>>
  relationName?: string
}

/** Deferred `hasMany`/`hasOne` build — children created after the parent persists. */
interface HasBuild {
  factory: ModelFactory<Record<string, unknown>>
  count: number
  relationName?: string
}

/** Deferred `belongsToMany` build — related rows created + attached after persist. */
interface AttachBuild {
  factory: ModelFactory<Record<string, unknown>>
  count: number
  pivotData?: Record<string, unknown>
  relationName?: string
}

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
  /** The Model class used for `create()` / relationship building. */
  protected abstract readonly modelClass: FactoryModelClass

  /** The base attribute definition. May return dynamic values or callables. */
  abstract definition(): TAttrs | Promise<TAttrs>

  /** Named states — override to add. */
  protected states(): Record<string, StateFn<TAttrs>> {
    return {}
  }

  private _stateOverrides: StateFn<TAttrs>[] = []
  private _belongsToBuilds: BelongsToBuild[] = []
  private _hasBuilds: HasBuild[] = []
  private _attachBuilds: AttachBuild[] = []

  private _clone(): this {
    const c = Object.create(this) as this
    c._stateOverrides  = [...this._stateOverrides]
    c._belongsToBuilds = [...this._belongsToBuilds]
    c._hasBuilds       = [...this._hasBuilds]
    c._attachBuilds    = [...this._attachBuilds]
    return c
  }

  /** Create a new factory instance. */
  // `ModelFactory<any>` (not `<Record<string, unknown>>`) so a concrete factory
  // — e.g. `class UserFactory extends ModelFactory<{ name: string }>` — satisfies
  // the `this` constraint. The narrower bound trips on `states()` / `with()`,
  // whose `StateFn<TAttrs>` parameter is contravariant and so isn't assignable
  // up to the base generic. Returns the concrete `T`, preserving precise typing.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static new<T extends ModelFactory<any>>(
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

  // ── Relationship building (create-time) ──────────────

  /**
   * Create child rows for a `hasMany` / `hasOne` relation, with the parent's
   * foreign key set. The parent is persisted first, then `count` children via
   * `childFactory`.
   *
   * @example
   * await User.factory().has(Post.factory(), 3).create()   // user + 3 posts (userId set)
   *
   * @param childFactory Factory for the related (child) model.
   * @param count        Number of children per parent (default 1).
   * @param relationName Relation key on `static relations`. Omit to infer the
   *   single `hasMany`/`hasOne` relation pointing at the child model.
   */
  has(
    childFactory: ModelFactory<Record<string, unknown>>,
    count = 1,
    relationName?: string,
  ): this {
    const c = this._clone()
    c._hasBuilds.push({ factory: childFactory, count, ...(relationName ? { relationName } : {}) })
    return c
  }

  /**
   * Set this model's `belongsTo` foreign key to a freshly-created parent.
   * The parent is created first; its primary key is written into this row's
   * FK column before persist.
   *
   * @example
   * await Post.factory().for(User.factory()).create()   // post.userId → new user
   *
   * @param parentFactory Factory for the owning (parent) model.
   * @param relationName  Relation key on `static relations`. Omit to infer the
   *   single `belongsTo` relation pointing at the parent model.
   */
  for(
    parentFactory: ModelFactory<Record<string, unknown>>,
    relationName?: string,
  ): this {
    const c = this._clone()
    c._belongsToBuilds.push({ factory: parentFactory, ...(relationName ? { relationName } : {}) })
    return c
  }

  /**
   * Create related rows for a `belongsToMany` relation and attach them through
   * the pivot. The parent is persisted first, then `count` related rows are
   * created and attached (with optional flat pivot data).
   *
   * @example
   * await User.factory().hasAttached(Role.factory(), 2, { active: true }).create()
   *
   * @param relatedFactory Factory for the related model.
   * @param count          Number of related rows to attach (default 1).
   * @param pivotData      Flat pivot columns written on every attach row.
   * @param relationName   Relation key on `static relations`. Omit to infer the
   *   single `belongsToMany` relation pointing at the related model.
   */
  hasAttached(
    relatedFactory: ModelFactory<Record<string, unknown>>,
    count = 1,
    pivotData?: Record<string, unknown>,
    relationName?: string,
  ): this {
    const c = this._clone()
    c._attachBuilds.push({
      factory: relatedFactory,
      count,
      ...(pivotData ? { pivotData } : {}),
      ...(relationName ? { relationName } : {}),
    })
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

  /**
   * Build and persist model(s). Persistence bypasses mass-assignment
   * (`fillable`/`guarded`) — Laravel-parity — by constructing the model and
   * `forceFill()` + `save()`, so a guarded model still receives every factory
   * attribute. Observer events (`creating`/`created`/`saving`/`saved`) fire as
   * with `Model.create()`.
   *
   * Relationship builders queued via `.has()` / `.for()` / `.hasAttached()`
   * are resolved here: `belongsTo` parents before persist, `hasMany`/`hasOne`
   * children and `belongsToMany` attachments after.
   */
  create(overrides?: Partial<TAttrs>): Promise<TAttrs>
  create(count: number, overrides?: Partial<TAttrs>): Promise<TAttrs[]>
  async create(
    countOrOverrides?: number | Partial<TAttrs>,
    overrides?: Partial<TAttrs>,
  ): Promise<TAttrs | TAttrs[]> {
    if (typeof countOrOverrides === 'number') {
      const n = countOrOverrides
      // Sequential: relation builds + sequence() are side-effecting and order-sensitive.
      const out: TAttrs[] = []
      for (let i = 0; i < n; i++) out.push(await this._persistOne(overrides))
      return out
    }
    return this._persistOne(countOrOverrides)
  }

  // ── Persist one (with relationships) ─────────────────

  private async _persistOne(overrides?: Partial<TAttrs>): Promise<TAttrs> {
    // 1. belongsTo: create parents first → foreign-key overrides on this row.
    const fkOverrides: Record<string, unknown> = {}
    for (const b of this._belongsToBuilds) {
      const parent = (await b.factory.create()) as Record<string, unknown>
      const { fk, ownerKey } = this._resolveBelongsTo(b.factory, b.relationName)
      fkOverrides[fk] = parent[ownerKey]
    }

    // 2. Build attrs (FK overrides win over inline/state values for consistency).
    const merged = { ...(overrides ?? {}), ...fkOverrides } as Partial<TAttrs>
    const attrs = await this._build(merged)

    // 3. Persist — forceFill + save bypasses mass-assignment, keeps observers.
    const instance = new this.modelClass()
    instance.forceFill(attrs)
    await instance.save()
    const record = instance as unknown as TAttrs

    // 4. hasMany/hasOne: create children pointing back at this parent.
    for (const h of this._hasBuilds) {
      const { fk, localVal } = this._resolveHas(h.factory, h.relationName, record)
      await h.factory.create(h.count, { [fk]: localVal } as Record<string, unknown>)
    }

    // 5. belongsToMany: create related rows + attach through the pivot.
    for (const a of this._attachBuilds) {
      await this._runAttach(a, instance)
    }

    return record
  }

  // ── Relation resolution (reads static relations) ─────

  /** Resolve the FK column + owner key for a `belongsTo` relation on this model. */
  private _resolveBelongsTo(
    parentFactory: ModelFactory<Record<string, unknown>>,
    relationName?: string,
  ): { fk: string; ownerKey: string } {
    const name = relationName ?? this._inferRelation(
      parentFactory,
      d => d.type === 'belongsTo',
      'belongsTo',
    )
    const def = this.modelClass.relations[name]
    if (!def) throw new Error(`[RudderJS ORM] Factory.for(): relation "${name}" is not defined on ${this.modelClass.name}.`)
    if (def.type !== 'belongsTo') {
      throw new Error(`[RudderJS ORM] Factory.for(): relation "${name}" on ${this.modelClass.name} is "${def.type}", expected "belongsTo".`)
    }
    const related = def.model() as unknown as FactoryModelClass
    const fk = def.foreignKey ?? `${camelHead(related.name)}Id`
    const ownerKey = def.localKey ?? related.primaryKey
    return { fk, ownerKey }
  }

  /** Resolve the FK column on the child + the parent's local value for a `hasMany`/`hasOne`. */
  private _resolveHas(
    childFactory: ModelFactory<Record<string, unknown>>,
    relationName: string | undefined,
    parentRecord: TAttrs,
  ): { fk: string; localVal: unknown } {
    const name = relationName ?? this._inferRelation(
      childFactory,
      d => d.type === 'hasMany' || d.type === 'hasOne',
      'hasMany/hasOne',
    )
    const def = this.modelClass.relations[name]
    if (!def) throw new Error(`[RudderJS ORM] Factory.has(): relation "${name}" is not defined on ${this.modelClass.name}.`)
    if (def.type !== 'hasMany' && def.type !== 'hasOne') {
      const hint = def.type === 'morphMany' || def.type === 'morphOne'
        ? ' Polymorphic relations are not supported by has() yet — set the morph columns via .with().'
        : ''
      throw new Error(`[RudderJS ORM] Factory.has(): relation "${name}" on ${this.modelClass.name} is "${def.type}", expected "hasMany" or "hasOne".${hint}`)
    }
    const fk = def.foreignKey ?? `${camelHead(this.modelClass.name)}Id`
    const localKey = def.localKey ?? this.modelClass.primaryKey
    return { fk, localVal: (parentRecord as Record<string, unknown>)[localKey] }
  }

  /** Create related rows for a `belongsToMany` and attach them through the pivot. */
  private async _runAttach(build: AttachBuild, parentInstance: FactoryModelInstance): Promise<void> {
    const name = build.relationName ?? this._inferRelation(
      build.factory,
      d => d.type === 'belongsToMany',
      'belongsToMany',
    )
    const def = this.modelClass.relations[name]
    if (!def) throw new Error(`[RudderJS ORM] Factory.hasAttached(): relation "${name}" is not defined on ${this.modelClass.name}.`)
    if (def.type !== 'belongsToMany') {
      const hint = def.type === 'morphToMany' || def.type === 'morphedByMany'
        ? ' Polymorphic pivots are not supported by hasAttached() yet.'
        : ''
      throw new Error(`[RudderJS ORM] Factory.hasAttached(): relation "${name}" on ${this.modelClass.name} is "${def.type}", expected "belongsToMany".${hint}`)
    }
    const related = def.model() as unknown as FactoryModelClass
    const relatedKey = def.relatedKey ?? related.primaryKey
    const rows = (await build.factory.create(build.count)) as Array<Record<string, unknown>>
    const ids = rows.map(r => r[relatedKey])
    await this.modelClass.belongsToMany(parentInstance as object, name).attach(ids, build.pivotData)
  }

  /**
   * Infer the single relation on this model matching `predicate` whose related
   * model class equals `other`'s `modelClass`. Throws when zero or many match.
   */
  private _inferRelation(
    other: ModelFactory<Record<string, unknown>>,
    predicate: (def: RelationDefinition) => boolean,
    kindLabel: string,
  ): string {
    const target = other.modelClass as unknown
    const matches = Object.entries(this.modelClass.relations).filter(([, def]) =>
      predicate(def) && 'model' in def && (def.model() as unknown) === target,
    )
    if (matches.length === 0) {
      throw new Error(`[RudderJS ORM] No ${kindLabel} relation on ${this.modelClass.name} points at ${other.modelClass.name}. Pass an explicit relation name.`)
    }
    if (matches.length > 1) {
      throw new Error(`[RudderJS ORM] Ambiguous ${kindLabel} relation on ${this.modelClass.name} → ${other.modelClass.name} (${matches.map(([n]) => n).join(', ')}). Pass an explicit relation name.`)
    }
    return matches[0]![0]
  }
}
