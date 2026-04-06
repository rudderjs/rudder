// ─── Collection ────────────────────────────────────────────

export class Collection<T> {
  private items: T[]

  constructor(items: T[] = []) {
    this.items = [...items]
  }

  static of<T>(items: T[]): Collection<T> {
    return new Collection(items)
  }

  // ── Core ─────────────────────────────────────────────────

  all(): T[] {
    return this.items
  }

  count(): number {
    return this.items.length
  }

  first(fn?: (item: T) => boolean): T | undefined {
    return fn ? this.items.find(fn) : this.items[0]
  }

  last(fn?: (item: T) => boolean): T | undefined {
    if (fn) {
      const filtered = this.items.filter(fn)
      return filtered[filtered.length - 1]
    }
    return this.items[this.items.length - 1]
  }

  isEmpty(): boolean {
    return this.items.length === 0
  }

  isNotEmpty(): boolean {
    return this.items.length > 0
  }

  // ── Iteration ────────────────────────────────────────────

  each(fn: (item: T, index: number) => void): this {
    this.items.forEach(fn)
    return this
  }

  // ── Transform ────────────────────────────────────────────

  map<U>(fn: (item: T, index: number) => U): Collection<U> {
    return new Collection(this.items.map(fn))
  }

  flatMap<U>(fn: (item: T, index: number) => U[]): Collection<U> {
    return new Collection(this.items.flatMap(fn))
  }

  filter(fn: (item: T) => boolean): Collection<T> {
    return new Collection(this.items.filter(fn))
  }

  reject(fn: (item: T) => boolean): Collection<T> {
    return new Collection(this.items.filter(item => !fn(item)))
  }

  pluck<K extends keyof T>(key: K): Collection<T[K]> {
    return new Collection(this.items.map(item => item[key]))
  }

  // ── Search ───────────────────────────────────────────────

  find(fn: (item: T) => boolean): T | undefined {
    return this.items.find(fn)
  }

  contains(fn: ((item: T) => boolean) | T): boolean {
    if (typeof fn === 'function') return this.items.some(fn as (item: T) => boolean)
    return this.items.includes(fn)
  }

  /**
   * Return the single matching item. Throws if 0 or more than 1 item matches.
   */
  sole(fn?: (item: T) => boolean): T {
    const filtered = fn ? this.items.filter(fn) : this.items
    if (filtered.length === 0) throw new Error('[Collection] sole() found no matching items.')
    if (filtered.length > 1)  throw new Error(`[Collection] sole() found ${filtered.length} items — expected exactly 1.`)
    return filtered[0]!
  }

  // ── Grouping ─────────────────────────────────────────────

  groupBy<K extends keyof T>(key: K | ((item: T) => string)): Record<string, T[]> {
    return this.items.reduce((acc, item) => {
      const group = typeof key === 'function' ? key(item) : String(item[key])
      acc[group] = [...(acc[group] ?? []), item]
      return acc
    }, {} as Record<string, T[]>)
  }

  /** Index items by a key or resolver — last write wins on collision. */
  keyBy<K extends keyof T>(key: K | ((item: T) => string)): Record<string, T> {
    const result: Record<string, T> = {}
    for (const item of this.items) {
      const k = typeof key === 'function' ? key(item) : String(item[key])
      result[k] = item
    }
    return result
  }

  /** Transform into a key→value record. `fn` returns `[key, value]` for each item. */
  mapWithKeys<V>(fn: (item: T, index: number) => [string, V]): Record<string, V> {
    const result: Record<string, V> = {}
    for (let i = 0; i < this.items.length; i++) {
      const [k, v] = fn(this.items[i]!, i)
      result[k] = v
    }
    return result
  }

  // ── Splitting ────────────────────────────────────────────

  /**
   * Split into chunks of `size`.
   * @example collect([1,2,3,4,5]).chunk(2) → [[1,2],[3,4],[5]]
   */
  chunk(size: number): Collection<T[]> {
    if (size < 1) throw new Error('[Collection] chunk() size must be >= 1.')
    const chunks: T[][] = []
    for (let i = 0; i < this.items.length; i += size) {
      chunks.push(this.items.slice(i, i + size))
    }
    return new Collection(chunks)
  }

  /**
   * Split into exactly `n` roughly-equal groups.
   * @example collect([1,2,3,4,5]).splitIn(2) → [[1,2,3],[4,5]]
   */
  splitIn(n: number): Collection<T[]> {
    return this.chunk(Math.ceil(this.items.length / n))
  }

  /**
   * Split into [passing, failing] based on `fn`.
   * @example collect([1,2,3,4]).partition(n => n % 2 === 0) → [[2,4], [1,3]]
   */
  partition(fn: (item: T) => boolean): [Collection<T>, Collection<T>] {
    const pass: T[] = []
    const fail: T[] = []
    for (const item of this.items) {
      ;(fn(item) ? pass : fail).push(item)
    }
    return [new Collection(pass), new Collection(fail)]
  }

  /**
   * Sliding window — yields overlapping sub-arrays of `size`.
   * @example collect([1,2,3,4]).sliding(2) → [[1,2],[2,3],[3,4]]
   */
  sliding(size: number, step = 1): Collection<T[]> {
    const result: T[][] = []
    for (let i = 0; i <= this.items.length - size; i += step) {
      result.push(this.items.slice(i, i + size))
    }
    return new Collection(result)
  }

  // ── Combination ──────────────────────────────────────────

  /**
   * Zip this collection with one or more arrays/collections (shortest wins).
   * @example collect([1,2]).zip(['a','b']) → [[1,'a'],[2,'b']]
   */
  zip<U>(other: U[] | Collection<U>): Collection<[T, U]> {
    const arr = other instanceof Collection ? other.all() : other
    const len = Math.min(this.items.length, arr.length)
    const result: [T, U][] = []
    for (let i = 0; i < len; i++) result.push([this.items[i]!, arr[i]!])
    return new Collection(result)
  }

  /**
   * Cross-join with another array/collection — returns the cartesian product.
   * @example collect([1,2]).crossJoin(['a','b']) → [[1,'a'],[1,'b'],[2,'a'],[2,'b']]
   */
  crossJoin<U>(other: U[] | Collection<U>): Collection<[T, U]> {
    const arr = other instanceof Collection ? other.all() : other
    const result: [T, U][] = []
    for (const a of this.items) {
      for (const b of arr) result.push([a, b])
    }
    return new Collection(result)
  }

  /**
   * Use this collection as keys and `values` as values — produces a plain object.
   * @example collect(['name','age']).combine(['Alice', 30]) → { name: 'Alice', age: 30 }
   */
  combine<V>(values: V[] | Collection<V>): Record<string, V> {
    const vals   = values instanceof Collection ? values.all() : values
    const result: Record<string, V> = {}
    for (let i = 0; i < this.items.length; i++) {
      result[String(this.items[i])] = vals[i] as V
    }
    return result
  }

  /**
   * Map where each item is spread as individual arguments to `fn`.
   * Useful for tuple collections.
   * @example collect([[1,'a'],[2,'b']]).mapSpread((n, s) => `${n}-${s}`) → ['1-a','2-b']
   */
  mapSpread<U>(fn: (...args: unknown[]) => U): Collection<U> {
    return new Collection(
      this.items.map(item => fn(...(Array.isArray(item) ? item : [item])))
    )
  }

  // ── Conditional / Pipe ───────────────────────────────────

  /** Apply `fn` to this collection if `condition` is truthy — chainable. */
  when(
    condition: boolean | ((c: Collection<T>) => boolean),
    fn: (c: Collection<T>) => Collection<T>,
    otherwise?: (c: Collection<T>) => Collection<T>,
  ): Collection<T> {
    const cond = typeof condition === 'function' ? condition(this) : condition
    if (cond) return fn(this)
    if (otherwise) return otherwise(this)
    return this
  }

  /** Apply `fn` to this collection if `condition` is falsy — chainable. */
  unless(
    condition: boolean | ((c: Collection<T>) => boolean),
    fn: (c: Collection<T>) => Collection<T>,
    otherwise?: (c: Collection<T>) => Collection<T>,
  ): Collection<T> {
    return this.when(
      typeof condition === 'function' ? (c: Collection<T>) => !condition(c) : !condition,
      fn,
      otherwise,
    )
  }

  /**
   * Pass this collection through a callback and return the result.
   * Useful for breaking out of method chains.
   */
  pipe<U>(fn: (collection: Collection<T>) => U): U {
    return fn(this)
  }

  /**
   * Tap into the chain for side-effects — returns `this`.
   * @example collect([1,2,3]).tap(c => console.log(c.count())).map(...)
   */
  tap(fn: (collection: Collection<T>) => void): this {
    fn(this)
    return this
  }

  // ── Serialisation ────────────────────────────────────────

  toArray(): T[] {
    return [...this.items]
  }

  toJSON(): T[] {
    return this.items
  }
}
