/**
 * `withDefault` — null-object defaults for single-result relations
 * (`belongsTo` / `hasOne`), mirroring Laravel's `->withDefault()`.
 *
 * When a `belongsTo` / `hasOne` relation resolves to no row, the relation can
 * return a fresh **unsaved** instance of the related model instead of `null`,
 * so call sites like `(await post.related('author').first()).name` don't have
 * to null-check. Declared on `static relations`:
 *
 * ```ts
 * static relations = {
 *   // bare default — empty Author instance
 *   author: { type: 'belongsTo', model: () => Author, withDefault: true },
 *   // attribute default
 *   author: { type: 'belongsTo', model: () => Author, withDefault: { name: 'Guest' } },
 *   // callback default — customise per parent
 *   author: { type: 'belongsTo', model: () => Author,
 *             withDefault: (author, post) => { author.name = `by ${post.id}` } },
 * }
 * ```
 *
 * Applies on both read paths and is pure Model-layer (no adapter/contract
 * change), so all three adapters honour it:
 *  - **lazy** — `related('author').first()` is wrapped by {@link wrapWithDefault}
 *  - **eager** — `with('author')` substitutes the default after the terminal
 *    returns (in `Model._hydratingQb`'s `attachPoly`), regardless of whether the
 *    adapter resolves the relation natively (Prisma) or in the Model layer.
 *
 * `withDefault` is meaningful only for the single-result relations; it is
 * ignored on `hasMany` (an empty list is already its own null-object).
 */

import type { QueryBuilder } from '@rudderjs/contracts'
import { Model } from '../index.js'

/**
 * Default specification, as declared on a relation's `withDefault` field:
 *  - `true` — a fresh, attribute-less instance
 *  - an object — a fresh instance with these attributes assigned
 *  - a callback — receives the fresh instance + the parent to customise it
 */
export type RelationDefault =
  | boolean
  | Record<string, unknown>
  | ((instance: Model, parent: Model) => void)

/**
 * Build the default related instance. Attributes are assigned directly (like
 * `forceFill`) so mass-assignment policy never drops a configured default.
 * The instance is unsaved — no primary key, no `#originalRaw` baseline.
 */
export function buildRelationDefault(
  Related: typeof Model,
  spec:    RelationDefault,
  parent:  Model,
): Model {
  const instance = new (Related as unknown as new () => Model)()
  if (typeof spec === 'function') {
    spec(instance, parent)
  } else if (spec && typeof spec === 'object') {
    Object.assign(instance, spec)
  }
  return instance
}

/**
 * Wrap a single-result relation's QueryBuilder so its `first()` / `find()`
 * terminal returns the default instance instead of `null`. Chain methods
 * (`where`/`orderBy`/…) re-wrap so the default still applies after a chain
 * (`related('author').where(...).first()`). Every other terminal (`get`,
 * `count`, `paginate`, …) passes through untouched.
 */
export function wrapWithDefault(
  qb:   QueryBuilder<Model>,
  make: () => Model,
): QueryBuilder<Model> {
  const proxy: QueryBuilder<Model> = new Proxy(qb, {
    get(target, prop, receiver): unknown {
      if (prop === 'first' || prop === 'find') {
        const fn = Reflect.get(target, prop, receiver) as (...a: unknown[]) => Promise<unknown>
        return async (...args: unknown[]): Promise<unknown> => (await fn.apply(target, args)) ?? make()
      }
      const v = Reflect.get(target, prop, receiver)
      if (typeof v !== 'function') return v
      return (...args: unknown[]): unknown => {
        const out = (v as (...a: unknown[]) => unknown).apply(target, args)
        // Re-wrap chainable returns (the QB returns itself) so the default
        // survives a chain; pass terminals/values through unchanged.
        return out === target ? proxy : out
      }
    },
  })
  return proxy
}
