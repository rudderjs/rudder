/**
 * Record-backed collaboration authorization for `@rudderjs/sync`.
 *
 * `SyncConfig.onAuth` is a raw allow/deny hook. Every consumer building
 * record-scoped collaboration (one Y.Doc per `resource:recordId`) ends up
 * re-writing the same chain by hand: parse the room id, resolve the
 * authenticated user, load the backing record, apply a view policy, and fail
 * closed on every gap. {@link createCollabRoomAuth} packages that chain into a
 * single builder.
 *
 * **This closes a collab IDOR class.** Without an `onAuth`, every
 * `resource:recordId` room is world-open — any client can read and write any
 * record's Y.Doc by guessing the key. The builder gates each WebSocket upgrade
 * against the per-record policy the rest of the app already enforces.
 *
 * The contract is duck-typed against a minimal resource shape ({@link
 * CollabResource}: `find` + `canView`), so it stays adapter-agnostic — no hard
 * dependency on `@rudderjs/orm`. Any object exposing those two methods works,
 * whether it is an ORM model, a repository, or a hand-written stub.
 */

import { parseRoomId, type SyncAuthRequest, type SyncConfig } from '../index.js'

/**
 * The minimal record-source contract the authorizer drives. Duck-typed: any
 * object exposing `find` + `canView` qualifies — an `@rudderjs/orm` model, a
 * repository, or a plain stub. No `@rudderjs/orm` dependency.
 *
 * @typeParam User - the authenticated-user shape your `resolveUser` returns.
 * @typeParam Rec  - the record shape `find` returns and `canView` inspects.
 */
export interface CollabResource<User = unknown, Rec = unknown> {
  /**
   * Load the record behind a room by its id. Return `null` (or `undefined`)
   * when the record does not exist — the connection is denied. May be sync or
   * async. A thrown error is treated as a denial (fail closed).
   */
  find(id: string): Promise<Rec | null | undefined> | Rec | null | undefined
  /**
   * Per-record view policy — the same gate the record's read surface enforces.
   * Receives the resolved user (`null` for an admitted guest) and the loaded
   * record; return `true` to allow. Anything other than a literal `true`, or a
   * throw, denies (fail closed).
   */
  canView(user: User | null, record: Rec): boolean | Promise<boolean>
  /**
   * Per-resource guest admission, overriding the builder-wide `allowGuests`.
   * `true` admits anonymous sockets to this resource's rooms even when the
   * builder default is off; `false` denies them even when the builder default
   * is on; omitted inherits the builder-wide setting. An admitted guest still
   * passes through `canView(null, record)`.
   */
  allowGuests?: boolean
}

/**
 * Resolves the {@link CollabResource} backing a parsed room. Either a static
 * map keyed by the room's resource segment, or a function (sync or async)
 * returning the resource — or `null`/`undefined` to deny. The function form
 * receives the parsed `recordId` and raw `docName` for richer routing.
 */
export type CollabResourceResolver<User = unknown, Rec = unknown> =
  | Record<string, CollabResource<User, Rec>>
  | ((
      resource: string,
      ctx: { recordId: string; docName: string },
    ) => CollabResource<User, Rec> | null | undefined | Promise<CollabResource<User, Rec> | null | undefined>)

/** The `{ resource, recordId }` a room id resolves to, or `null` to deny. */
export interface ParsedCollabRoom {
  resource: string
  recordId: string
}

export interface CreateCollabRoomAuthOptions<User = unknown, Rec = unknown> {
  /**
   * Resolve the {@link CollabResource} for a room's resource segment. A static
   * map is looked up with own-property semantics (so `constructor`,
   * `__proto__`, etc. never resolve a prototype method); a function can route
   * dynamically. Returns `null`/`undefined` → deny.
   */
  resources: CollabResourceResolver<User, Rec>
  /**
   * Resolve the authenticated user from the upgrade request. `@rudderjs/sync`
   * establishes the app's session + auth `AsyncLocalStorage` context around
   * `onAuth`, so a `() => Auth.user()` resolver returns the real session user
   * here — no manual cookie/session parsing. Return `null`/`undefined` for an
   * anonymous socket (see `allowGuests`). A throw denies the connection.
   */
  resolveUser: (req: SyncAuthRequest) => Promise<User | null | undefined> | User | null | undefined
  /**
   * Extract `{ resource, recordId }` from the room name. Return `null` to deny
   * (e.g. a room that is not record-scoped, or a tenant/panel prefix that does
   * not match). Defaults to {@link defaultParseCollabRoom}: splits on the room
   * separator and takes the **last two** segments as `[resource, recordId]`, so
   * both `posts:42` and `tenant:posts:42` resolve to `{ resource: 'posts',
   * recordId: '42' }`. To scope by the leading segment(s), supply your own.
   */
  parseRoom?: (docName: string) => ParsedCollabRoom | null
  /**
   * Builder-wide default for anonymous sockets (no user resolved). `false`
   * (the default) denies them — the fail-closed posture that closes the IDOR.
   * `true` forwards a `null` user to `canView`, so a resource's `canView(null,
   * record)` still decides per record. A {@link CollabResource.allowGuests}
   * override wins over this. Only enable for deliberately public surfaces: an
   * admitted guest can read AND write the record's Y.Doc.
   */
  allowGuests?: boolean
  /**
   * Separator passed to the default room parser ({@link parseRoomId}'s default
   * is `':'`). Ignored when you supply your own `parseRoom`.
   */
  separator?: string
}

/**
 * Default room parser: split `docName` on the separator and treat the last two
 * segments as `[resource, recordId]`. Returns `null` for a room with fewer than
 * two segments or any empty segment (fail closed). Handles both bare
 * `posts:42` and prefixed `tenant:posts:42` shapes.
 */
export function defaultParseCollabRoom(docName: string, separator?: string): ParsedCollabRoom | null {
  const segments = parseRoomId(docName, separator)
  if (segments.length < 2) return null
  const recordId = segments[segments.length - 1]
  const resource = segments[segments.length - 2]
  if (!resource || !recordId) return null
  return { resource, recordId }
}

function resolveResource<User, Rec>(
  resources: CollabResourceResolver<User, Rec>,
  key: string,
  ctx: { recordId: string; docName: string },
): CollabResource<User, Rec> | null | undefined | Promise<CollabResource<User, Rec> | null | undefined> {
  if (typeof resources === 'function') return resources(key, ctx)
  // Own-property lookup only: a room segment of `constructor` / `toString` /
  // `__proto__` must never resolve an inherited Object.prototype method.
  return Object.prototype.hasOwnProperty.call(resources, key) ? resources[key] : null
}

function isCollabResource(value: unknown): value is CollabResource {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as CollabResource).find === 'function' &&
    typeof (value as CollabResource).canView === 'function'
  )
}

/**
 * Build a {@link SyncConfig.onAuth} handler that authorizes each WebSocket
 * upgrade against the record behind the room. Fail-closed at every step —
 * returns `false` for:
 *
 *   - a room id that does not parse to `{ resource, recordId }`
 *   - no resource resolved for the segment (or a resolver that throws)
 *   - the record not found (`find` returns null/undefined or throws)
 *   - no authenticated user — unless guests are admitted (the resource's
 *     `allowGuests`, falling back to the builder-wide `allowGuests` option),
 *     which forwards a `null` user to `canView`
 *   - `canView(user, record)` returning anything but `true`, or throwing
 *
 * Requires a `@rudderjs/sync` that runs the session + auth ALS context around
 * `onAuth` (so a `() => Auth.user()` resolver works). Returns the same
 * `boolean | Promise<boolean>` shape `onAuth` expects.
 *
 * @example
 * import { createCollabRoomAuth } from '@rudderjs/sync/collab'
 * import { Auth } from '@rudderjs/auth'
 * import { Post } from 'App/Models/Post.js'
 *
 * export default {
 *   path:   '/ws-sync',
 *   onAuth: createCollabRoomAuth({
 *     resources:   { posts: Post },          // room `…:posts:42` → Post.find('42')
 *     resolveUser: () => Auth.user(),
 *   }),
 *   // …persistence, onFirstConnect
 * } satisfies SyncConfig
 */
export function createCollabRoomAuth<User = unknown, Rec = unknown>(
  opts: CreateCollabRoomAuthOptions<User, Rec>,
): NonNullable<SyncConfig['onAuth']> {
  const parseRoom = opts.parseRoom ?? ((docName: string) => defaultParseCollabRoom(docName, opts.separator))

  return async (req: SyncAuthRequest, docName: string): Promise<boolean> => {
    const parsed = parseRoom(docName)
    if (!parsed) return false

    let resource: CollabResource<User, Rec> | null | undefined
    try {
      resource = await resolveResource(opts.resources, parsed.resource, {
        recordId: parsed.recordId,
        docName,
      })
    } catch {
      return false // resolver threw — deny
    }
    if (!isCollabResource(resource)) return false
    const res = resource as CollabResource<User, Rec>

    let record: Rec | null | undefined
    try {
      record = await res.find(parsed.recordId)
    } catch {
      return false // record lookup threw — deny
    }
    if (record === null || record === undefined) return false

    let user: User | null | undefined
    try {
      user = await opts.resolveUser(req)
    } catch {
      return false // user resolution threw — deny
    }

    if (user === null || user === undefined) {
      // Anonymous socket. Per-resource stance wins; the builder-wide option is
      // the fallback. Only an explicit `true` admits the guest.
      const guestsAllowed = res.allowGuests ?? (opts.allowGuests === true)
      if (guestsAllowed !== true) return false
      user = null // normalize undefined → null for the policy call
    }

    try {
      return (await Promise.resolve(res.canView(user ?? null, record))) === true
    } catch {
      return false // policy threw — deny
    }
  }
}
