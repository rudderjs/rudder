// ─── Paginator shapes (duck-typed) ──────────────────────────
//
// `Resource.collection()` accepts paginator results directly and derives the
// envelope `meta` from them. Detection is structural, NOT `instanceof` —
// dev-HMR re-evaluates modules, so a `CursorPaginator` created before a
// re-boot fails `instanceof` against the re-imported class.

/** Offset-paginated shape — what `Model.paginate()` resolves to (`PaginatedResult`). */
export interface OffsetPaginated<T> {
  data:        T[]
  total:       number
  perPage:     number
  currentPage: number
  lastPage:    number
}

/** Cursor-paginated shape — what `Model.cursorPaginate()` resolves to (`CursorPaginator`). */
export interface CursorPaginated<T> {
  data:       T[]
  perPage:    number
  nextCursor: string | null
  prevCursor: string | null
  hasMore:    boolean
}

function isOffsetPaginated<T>(v: unknown): v is OffsetPaginated<T> {
  if (v === null || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return Array.isArray(o['data'])
    && typeof o['total'] === 'number'
    && typeof o['perPage'] === 'number'
    && typeof o['currentPage'] === 'number'
    && typeof o['lastPage'] === 'number'
}

function isCursorPaginated<T>(v: unknown): v is CursorPaginated<T> {
  if (v === null || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return Array.isArray(o['data'])
    && typeof o['perPage'] === 'number'
    && 'nextCursor' in o
    && 'prevCursor' in o
    && typeof o['hasMore'] === 'boolean'
}

// ─── JsonResource ───────────────────────────────────────────

/**
 * Base class for API resource transformations.
 *
 * @example
 * class UserResource extends JsonResource<User> {
 *   toArray() {
 *     return {
 *       id:    this.resource.id,
 *       name:  this.resource.name,
 *       email: this.resource.email,
 *       // conditional
 *       admin: this.when(this.resource.role === 'admin', true),
 *       posts: this.whenLoaded('posts', PostResource.collection(this.resource.posts as Post[])),
 *     }
 *   }
 * }
 *
 * // In a route handler:
 * res.json(new UserResource(user).toArray())
 * res.json(UserResource.collection(users).toResponse())
 */
export abstract class JsonResource<T extends Record<string, unknown> = Record<string, unknown>> {
  /** Extra top-level envelope keys added via `additional()`. */
  #additional: Record<string, unknown> = {}

  constructor(protected readonly resource: T) {}

  /** Transform the resource into an array/object. Override in subclasses. */
  abstract toArray(req?: unknown): Record<string, unknown> | Promise<Record<string, unknown>>

  // ── Conditional helpers ────────────────────────────────

  /**
   * Include `value` only when `condition` is true.
   * Returns `fallback` (default `undefined`) when false.
   *
   * Undefined values are stripped from the output object — use `mergeWhen()` for
   * conditional blocks of multiple keys.
   */
  protected when<V>(condition: boolean, value: V): V | undefined
  protected when<V>(condition: boolean, value: V, fallback: V): V
  protected when<V>(condition: boolean, value: V, fallback?: V): V | undefined {
    return condition ? value : fallback
  }

  /**
   * Include `then` only when `value` is not null/undefined.
   * If `then` is a function it receives the non-null value.
   */
  protected whenNotNull<V, R>(
    value: V | null | undefined,
    then: R | ((v: NonNullable<V>) => R),
    fallback?: R,
  ): R | undefined {
    if (value !== null && value !== undefined) {
      return typeof then === 'function'
        ? (then as (v: NonNullable<V>) => R)(value as NonNullable<V>)
        : then
    }
    return fallback
  }

  /**
   * Include `value` only when the named relation is loaded on the resource.
   * Falls back to `fallback` (default `undefined`) when not loaded.
   */
  protected whenLoaded<R>(relation: string): unknown
  protected whenLoaded<R>(relation: string, value: R): R | undefined
  protected whenLoaded<R>(relation: string, value: R, fallback: R): R
  protected whenLoaded<R>(relation: string, value?: R, fallback?: R): R | undefined {
    const res = this.resource as Record<string, unknown>
    if (relation in res && res[relation] !== undefined) {
      return value !== undefined ? value : res[relation] as R
    }
    return fallback
  }

  /**
   * Merge `attributes` into the output only when `condition` is true.
   * Returns `{}` when false — spread the result at the call site.
   *
   * @example
   * toArray() {
   *   return {
   *     id: this.resource.id,
   *     ...this.mergeWhen(this.resource.isAdmin, {
   *       permissions: this.resource.permissions,
   *       lastLogin:   this.resource.lastLogin,
   *     }),
   *   }
   * }
   */
  protected mergeWhen(condition: boolean, attributes: Record<string, unknown>): Record<string, unknown> {
    return condition ? attributes : {}
  }

  /**
   * Merge extra top-level keys into the `toResponse()` envelope —
   * alongside `data`, never inside it (Laravel's `additional()` semantics).
   * The envelope's own `data` key wins on conflict. Returns `this`.
   *
   * @example
   * res.json(await new UserResource(user).additional({ status: 'ok' }).toResponse())
   * // → { status: 'ok', data: { ... } }
   */
  additional(extra: Record<string, unknown>): this {
    Object.assign(this.#additional, extra)
    return this
  }

  /**
   * The wrapped single-resource envelope: `{ data: toArray(), ...additional }`.
   * Async-safe — use this (not `toJSON()`) when `toArray()` is async. The
   * unwrapped `new R(x).toArray()` form stays the default for bare payloads;
   * `toResponse()` is the opt-in envelope.
   */
  async toResponse(req?: unknown): Promise<{ data: Record<string, unknown> } & Record<string, unknown>> {
    return { ...this.#additional, data: await this.toArray(req) }
  }

  /**
   * Create a `ResourceCollection` from an array of raw items — or directly
   * from a paginator result, which auto-derives the envelope `meta`:
   *
   * - `Model.paginate()` result → `meta: { total, page, perPage, lastPage }`
   * - `Model.cursorPaginate()` result → `meta: { perPage, nextCursor, prevCursor, hasMore }`
   * - plain array → no derived meta (exactly the original behavior)
   *
   * An explicit `meta` second argument merges over (wins on key conflict
   * with) the derived meta.
   *
   * @example
   * res.json(await UserResource.collection(await User.paginate(1, 15)).toResponse())
   * // → { data: [...], meta: { total, page, perPage, lastPage } }
   */
  static collection<T extends Record<string, unknown>>(
    this: new (item: T) => JsonResource<T>,
    items: T[] | OffsetPaginated<T> | CursorPaginated<T>,
    meta?: Record<string, unknown>,
  ): ResourceCollection<T> {
    let list: T[]
    let derived: Record<string, unknown> | undefined
    if (Array.isArray(items)) {
      list = items
    } else if (isOffsetPaginated<T>(items)) {
      list = items.data
      derived = { total: items.total, page: items.currentPage, perPage: items.perPage, lastPage: items.lastPage }
    } else if (isCursorPaginated<T>(items)) {
      list = items.data
      derived = { perPage: items.perPage, nextCursor: items.nextCursor, prevCursor: items.prevCursor, hasMore: items.hasMore }
    } else {
      // Unrecognized object shape — preserve the historical "treat it as a
      // list" behavior rather than throwing on a duck that almost quacks.
      list = items as unknown as T[]
    }
    const merged = derived !== undefined || meta !== undefined ? { ...derived, ...meta } : undefined
    return new ResourceCollection(list.map(item => new this(item)), merged)
  }

  toJSON(): Record<string, unknown> {
    const result = this.toArray()
    if (result instanceof Promise) {
      throw new Error(
        `[RudderJS] ${this.constructor.name}.toJSON() does not support an async toArray() — ` +
        `async work in resources must be awaited explicitly. ` +
        `Replace \`res.json(resource)\` with \`res.json(await resource.toArray())\` for this resource.`,
      )
    }
    return result
  }
}

// ─── ResourceCollection ─────────────────────────────────────

/**
 * Wraps multiple `JsonResource` instances for collection responses.
 *
 * @example
 * class UserResource extends JsonResource<User> { ... }
 *
 * // From a route handler:
 * const collection = UserResource.collection(users)
 * res.json(await collection.toResponse())
 * // → { data: [...] }
 *
 * // Pagination metadata is derived automatically from a paginator result:
 * const collection = UserResource.collection(await User.paginate(1, 15))
 * res.json(await collection.toResponse())
 * // → { data: [...], meta: { total, page, perPage, lastPage } }
 *
 * // Or passed (and merged over the derived values) explicitly:
 * const collection = UserResource.collection(users, { total: 100, page: 1, perPage: 15 })
 * res.json(await collection.toResponse())
 * // → { data: [...], meta: { total: 100, page: 1, perPage: 15 } }
 */
export class ResourceCollection<T extends Record<string, unknown> = Record<string, unknown>> {
  /** Extra top-level envelope keys added via `additional()`. */
  #additional: Record<string, unknown> = {}

  constructor(
    private readonly items: JsonResource<T>[],
    private readonly meta?: Record<string, unknown>,
  ) {}

  static of<T extends Record<string, unknown>>(
    items: JsonResource<T>[],
    meta?: Record<string, unknown>,
  ): ResourceCollection<T> {
    return new ResourceCollection(items, meta)
  }

  /**
   * Merge extra top-level keys into the `toResponse()` envelope —
   * alongside `data`/`meta`, never inside them (Laravel's `additional()`
   * semantics). The envelope's own `data`/`meta` keys win on conflict.
   * Returns `this`.
   *
   * @example
   * res.json(await UserResource.collection(users).additional({ status: 'ok' }).toResponse())
   * // → { status: 'ok', data: [...] }
   */
  additional(extra: Record<string, unknown>): this {
    Object.assign(this.#additional, extra)
    return this
  }

  async toArray(req?: unknown): Promise<Record<string, unknown>[]> {
    return Promise.all(this.items.map(item => item.toArray(req)))
  }

  async toResponse(req?: unknown): Promise<{ data: Record<string, unknown>[]; meta?: Record<string, unknown> } & Record<string, unknown>> {
    const data = await this.toArray(req)
    return this.meta !== undefined
      ? { ...this.#additional, data, meta: this.meta }
      : { ...this.#additional, data }
  }
}
