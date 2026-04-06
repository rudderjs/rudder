import type { Model } from './index.js'
import type { QueryBuilder } from '@rudderjs/contracts'

// ─── ModelCollection ────────────────────────────────────────

/**
 * A typed array wrapper for Eloquent-style model collection operations.
 * Returned by ORM queries when using `ModelCollection.wrap()`.
 *
 * @example
 * const users = ModelCollection.wrap(await User.all())
 *
 * users.modelKeys()          // [1, 2, 3]
 * users.find(2)              // { id: 2, ... }
 * users.contains(2)          // true
 * users.except([1, 3])       // [{ id: 2, ... }]
 * users.only([1, 2])         // [{ id: 1, ... }, { id: 2, ... }]
 * users.unique('email')      // deduplicated by email
 * users.makeHidden(['email']) // each item's email hidden from JSON
 */
export class ModelCollection<T extends Record<string, unknown>> {
  private constructor(
    private readonly _items: T[],
    private readonly _primaryKey: string = 'id',
  ) {}

  static wrap<T extends Record<string, unknown>>(
    items: T[],
    primaryKey = 'id',
  ): ModelCollection<T> {
    return new ModelCollection(items, primaryKey)
  }

  // ── Core ──────────────────────────────────────────────

  all(): T[] { return this._items }
  count(): number { return this._items.length }
  isEmpty(): boolean { return this._items.length === 0 }
  isNotEmpty(): boolean { return this._items.length > 0 }
  toArray(): T[] { return [...this._items] }

  /** Returns an array of primary key values. */
  modelKeys(): Array<string | number> {
    return this._items.map(item => item[this._primaryKey] as string | number)
  }

  // ── Search ────────────────────────────────────────────

  /** Find item by primary key, or `undefined` if not found. */
  find(id: string | number): T | undefined {
    return this._items.find(item => item[this._primaryKey] === id)
  }

  /**
   * Returns true if any item matches. Accepts a primary key value or a predicate.
   */
  contains(idOrFn: string | number | ((item: T) => boolean)): boolean {
    if (typeof idOrFn === 'function') return this._items.some(idOrFn)
    return this._items.some(item => item[this._primaryKey] === idOrFn)
  }

  // ── Filtering ─────────────────────────────────────────

  /** Items whose primary key is NOT in `ids`. */
  except(ids: Array<string | number>): ModelCollection<T> {
    const set = new Set<string | number>(ids)
    return ModelCollection.wrap(
      this._items.filter(item => !set.has(item[this._primaryKey] as string | number)),
      this._primaryKey,
    )
  }

  /** Items whose primary key IS in `ids`. */
  only(ids: Array<string | number>): ModelCollection<T> {
    const set = new Set<string | number>(ids)
    return ModelCollection.wrap(
      this._items.filter(item => set.has(item[this._primaryKey] as string | number)),
      this._primaryKey,
    )
  }

  /** Items not present in `other` (diff by primary key). */
  diff(other: ModelCollection<T> | T[]): ModelCollection<T> {
    const otherItems = other instanceof ModelCollection ? other.all() : other
    const otherKeys = new Set(otherItems.map(i => i[this._primaryKey]))
    return ModelCollection.wrap(
      this._items.filter(item => !otherKeys.has(item[this._primaryKey])),
      this._primaryKey,
    )
  }

  /**
   * Items unique by the given key (or primary key if omitted).
   * First occurrence wins.
   */
  unique(key?: string): ModelCollection<T> {
    const k  = key ?? this._primaryKey
    const seen = new Set<unknown>()
    return ModelCollection.wrap(
      this._items.filter(item => {
        const val = item[k]
        if (seen.has(val)) return false
        seen.add(val)
        return true
      }),
      this._primaryKey,
    )
  }

  // ── Serialization controls ────────────────────────────

  /** Call `makeVisible(keys)` on each model instance and return a new collection. */
  makeVisible(keys: string[]): ModelCollection<T> {
    return ModelCollection.wrap(
      this._items.map(item => {
        const m = item as Record<string, unknown>
        if (typeof m['makeVisible'] === 'function') {
          return (m['makeVisible'] as (k: string[]) => T)(keys)
        }
        return item
      }),
      this._primaryKey,
    )
  }

  /** Call `makeHidden(keys)` on each model instance and return a new collection. */
  makeHidden(keys: string[]): ModelCollection<T> {
    return ModelCollection.wrap(
      this._items.map(item => {
        const m = item as Record<string, unknown>
        if (typeof m['makeHidden'] === 'function') {
          return (m['makeHidden'] as (k: string[]) => T)(keys)
        }
        return item
      }),
      this._primaryKey,
    )
  }

  // ── Async ORM operations ──────────────────────────────

  /**
   * Reload each item from the database. Returns a new collection with fresh data.
   * Items are loaded via `Model.find(id)` so they must have their primary key set.
   */
  async fresh(modelClass: typeof Model): Promise<ModelCollection<Record<string, unknown>>> {
    const ids = this.modelKeys()
    const results = await Promise.all(ids.map(id => modelClass.find(id)))
    return ModelCollection.wrap(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      results.filter((r): r is NonNullable<typeof r> => r !== null) as unknown as Record<string, unknown>[],
      this._primaryKey,
    )
  }

  /**
   * Eager-load relations for all items.
   * Returns a new collection with relations loaded.
   */
  async load(
    modelClass: typeof Model,
    ...relations: string[]
  ): Promise<ModelCollection<Record<string, unknown>>> {
    const ids = this.modelKeys()
    const items = await modelClass.with(...relations).where(this._primaryKey, ids).get()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ModelCollection.wrap(items as any[], this._primaryKey)
  }

  /**
   * Eager-load relations that are not already present on the items.
   * Only loads relations where `item[relation]` is undefined.
   */
  async loadMissing(
    modelClass: typeof Model,
    ...relations: string[]
  ): Promise<ModelCollection<Record<string, unknown>>> {
    const first = this._items[0]
    if (!first) return ModelCollection.wrap([], this._primaryKey)

    const missing = relations.filter(rel => !(rel in first) || first[rel] === undefined)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (missing.length === 0) return ModelCollection.wrap(this._items as any[], this._primaryKey)

    return this.load(modelClass, ...missing)
  }

  /**
   * Return a query builder scoped to this collection's primary keys.
   * Useful for building additional queries on the same set of records.
   */
  toQuery(modelClass: typeof Model): QueryBuilder<T> {
    const ids = this.modelKeys()
    // Use where with array to produce a WHERE IN equivalent
    return modelClass.where(this._primaryKey, ids) as unknown as QueryBuilder<T>
  }

  toJSON(): T[] {
    return this.toArray()
  }
}
