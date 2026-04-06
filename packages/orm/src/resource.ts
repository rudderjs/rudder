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

  /** Create a `ResourceCollection` from an array of raw items using this resource class. */
  static collection<T extends Record<string, unknown>>(
    this: new (item: T) => JsonResource<T>,
    items: T[],
    meta?: Record<string, unknown>,
  ): ResourceCollection<T> {
    return new ResourceCollection(items.map(item => new this(item)), meta)
  }

  toJSON(): Record<string, unknown> {
    const result = this.toArray()
    if (result instanceof Promise) {
      throw new Error(
        '[RudderJS] JsonResource.toJSON() does not support async toArray(). Use toArray() directly.',
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
 * // With pagination metadata:
 * const collection = UserResource.collection(users, { total: 100, page: 1, perPage: 15 })
 * res.json(await collection.toResponse())
 * // → { data: [...], meta: { total: 100, page: 1, perPage: 15 } }
 */
export class ResourceCollection<T extends Record<string, unknown> = Record<string, unknown>> {
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

  async toArray(req?: unknown): Promise<Record<string, unknown>[]> {
    return Promise.all(this.items.map(item => item.toArray(req)))
  }

  async toResponse(req?: unknown): Promise<{ data: Record<string, unknown>[]; meta?: Record<string, unknown> }> {
    const data = await this.toArray(req)
    return this.meta !== undefined ? { data, meta: this.meta } : { data }
  }
}
