/**
 * First-connect record seeding for `@rudderjs/sync`.
 *
 * `SyncConfig.onFirstConnect` fires once per room, after persistence has
 * hydrated the Y.Doc and before the first client receives the initial state
 * vector — the exact moment to seed an empty doc from a database record.
 * Every consumer building record-backed collaboration (one Y.Doc per
 * `resource:recordId`) ends up re-writing the same chain by hand: parse the
 * room id, resolve the backing resource, load the record, project it to seed
 * data, and write it into the doc only if the doc is still empty.
 * {@link createCollabRoomSeeder} packages that chain into a single builder —
 * the seeding counterpart to {@link createCollabRoomAuth}.
 *
 * The contract is duck-typed against a minimal resource shape
 * ({@link CollabSeedResource}: `find` + `seed`), so it stays adapter-agnostic —
 * no hard dependency on `@rudderjs/orm`. The same object can satisfy both this
 * and {@link CollabResource} (add a `seed` method alongside `find`/`canView`)
 * so one model drives auth AND seeding.
 */

import type * as Y from 'yjs'

import { defaultParseCollabRoom, type ParsedCollabRoom } from './index.js'
import type { SyncConfig } from '../index.js'

/** Default Y.Map name seeded into, matching {@link Sync.seed}. */
const DEFAULT_MAP_NAME = 'fields'
/** Default transact origin tagged on seed writes, so consumers can filter them. */
const DEFAULT_ORIGIN = 'rudder-sync-seed'

/**
 * The minimal record-source contract the seeder drives. Duck-typed: any object
 * exposing `find` + `seed` qualifies — an `@rudderjs/orm` model, a repository,
 * or a plain stub. No `@rudderjs/orm` dependency.
 *
 * @typeParam Rec - the record shape `find` returns and `seed` projects.
 */
export interface CollabSeedResource<Rec = unknown> {
  /**
   * Load the record behind a room by its id. Return `null` (or `undefined`)
   * when the record does not exist — nothing is seeded (a clean skip). May be
   * sync or async. A thrown error propagates so the framework retries on the
   * next connection (see {@link SyncConfig.onFirstConnect}).
   */
  find(id: string): Promise<Rec | null | undefined> | Rec | null | undefined
  /**
   * Project the loaded record to the initial field map written into the doc.
   * Return an empty object to seed nothing. Values are written verbatim
   * (`undefined` is normalized to `null`, matching {@link Sync.seed}). May be
   * sync or async; a throw propagates (retry on next connection).
   */
  seed(record: Rec): Record<string, unknown> | Promise<Record<string, unknown>>
}

/**
 * Resolves the {@link CollabSeedResource} backing a parsed room — a static map
 * keyed by the room's resource segment, or a function (sync or async) returning
 * the resource (or `null`/`undefined` to skip). Mirrors
 * {@link CollabResourceResolver}.
 */
export type CollabSeedResourceResolver<Rec = unknown> =
  | Record<string, CollabSeedResource<Rec>>
  | ((
      resource: string,
      ctx: { recordId: string; docName: string },
    ) =>
      | CollabSeedResource<Rec>
      | null
      | undefined
      | Promise<CollabSeedResource<Rec> | null | undefined>)

export interface CreateCollabRoomSeederOptions<Rec = unknown> {
  /**
   * Resolve the {@link CollabSeedResource} for a room's resource segment. A
   * static map is looked up with own-property semantics (so `constructor`,
   * `__proto__`, etc. never resolve a prototype method); a function can route
   * dynamically. Returns `null`/`undefined` → skip seeding.
   */
  resources: CollabSeedResourceResolver<Rec>
  /**
   * Extract `{ resource, recordId }` from the room name. Return `null` to skip
   * (e.g. a room that is not record-scoped). Defaults to
   * {@link defaultParseCollabRoom} — splits on the room separator and takes the
   * last two segments as `[resource, recordId]`, so both `posts:42` and
   * `tenant:posts:42` resolve to `{ resource: 'posts', recordId: '42' }`.
   */
  parseRoom?: (docName: string) => ParsedCollabRoom | null
  /**
   * Y.Map name to seed into. Default `'fields'` — the same map
   * {@link Sync.seed} and the React `useCollabSeed` helpers use.
   */
  mapName?: string
  /**
   * Transact origin tagged on the seed writes, so a client / observer can tell
   * a seed apart from a user edit. Default `'rudder-sync-seed'`.
   */
  origin?: string
  /**
   * Separator passed to the default room parser (default `':'`). Ignored when
   * you supply your own `parseRoom`.
   */
  separator?: string
}

function resolveSeedResource<Rec>(
  resources: CollabSeedResourceResolver<Rec>,
  key: string,
  ctx: { recordId: string; docName: string },
): CollabSeedResource<Rec> | null | undefined | Promise<CollabSeedResource<Rec> | null | undefined> {
  if (typeof resources === 'function') return resources(key, ctx)
  // Own-property lookup only: a room segment of `constructor` / `toString` /
  // `__proto__` must never resolve an inherited Object.prototype method.
  return Object.prototype.hasOwnProperty.call(resources, key) ? resources[key] : null
}

function isSeedResource(value: unknown): value is CollabSeedResource {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as CollabSeedResource).find === 'function' &&
    typeof (value as CollabSeedResource).seed === 'function'
  )
}

/**
 * Build a {@link SyncConfig.onFirstConnect} handler that seeds a room's Y.Doc
 * from the backing record the first time a client connects. Idempotent and
 * safe under concurrent first-connects: the write happens inside a single
 * `doc.transact`, gated on the target map still being empty, so a doc already
 * hydrated from persistence (or seeded by a racing connection) is left
 * untouched.
 *
 * Fail-soft on absence, fail-loud on error:
 *
 *   - a room id that does not parse → skip (no seed)
 *   - no resource resolved for the segment → skip
 *   - the record not found (`find` returns null/undefined) → skip
 *   - `seed(record)` returns `{}` or the doc is already populated → skip
 *   - a resolver / `find` / `seed` **throw** propagates, so the framework
 *     leaves the room unfired and retries on the next connection (the error
 *     surfaces via `syncObservers`, never killing the socket)
 *
 * @example
 * import { createCollabRoomSeeder } from '@rudderjs/sync/collab'
 * import { Post } from 'App/Models/Post.js'
 *
 * export default {
 *   path: '/ws-sync',
 *   onFirstConnect: createCollabRoomSeeder({
 *     resources: {
 *       posts: {
 *         find: (id) => Post.find(id),
 *         seed: (post) => ({ title: post.title, body: post.body }),
 *       },
 *     },
 *   }),
 *   // …persistence, onAuth (createCollabRoomAuth)
 * } satisfies SyncConfig
 */
export function createCollabRoomSeeder<Rec = unknown>(
  opts: CreateCollabRoomSeederOptions<Rec>,
): NonNullable<SyncConfig['onFirstConnect']> {
  const parseRoom = opts.parseRoom ?? ((docName: string) => defaultParseCollabRoom(docName, opts.separator))
  const mapName = opts.mapName ?? DEFAULT_MAP_NAME
  const origin = opts.origin ?? DEFAULT_ORIGIN

  return async (
    docName: string,
    doc: Y.Doc,
    _ctx: { firstClient: unknown; persistence: unknown },
  ): Promise<void> => {
    const parsed = parseRoom(docName)
    if (!parsed) return

    const resource = await resolveSeedResource(opts.resources, parsed.resource, {
      recordId: parsed.recordId,
      docName,
    })
    if (!isSeedResource(resource)) return
    const res = resource as CollabSeedResource<Rec>

    const record = await res.find(parsed.recordId)
    if (record === null || record === undefined) return

    const data = await res.seed(record)
    const entries = Object.entries(data ?? {})
    if (entries.length === 0) return

    // Single transaction, gated on the map still being empty — idempotent and
    // race-safe against a second concurrent first-connect (Yjs serialises
    // transacts per doc, so the loser sees size > 0 and skips).
    const fields = doc.getMap(mapName)
    doc.transact(() => {
      if (fields.size > 0) return
      for (const [key, val] of entries) fields.set(key, val ?? null)
    }, origin)
  }
}
