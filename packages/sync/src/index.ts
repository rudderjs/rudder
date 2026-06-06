import { fileURLToPath } from 'node:url'
import { ServiceProvider, rudder, config } from '@rudderjs/core'
import { WebSocketServer, type WebSocket as WsSocket } from 'ws'
import * as Y                                          from 'yjs'
import { syncObservers }                               from './observers.js'
import { syncGlobal, readSyncGlobal }   from './globals.js'

// ─── Per-WebSocket client id ────────────────────────────────
//
// Yjs clients are identified by stable ids in the awareness map, but at the
// transport layer we just have raw WebSockets. We stamp a short id on each
// connecting socket so observers (e.g. telescope's SyncCollector) can group
// events by client and present a coherent timeline per connection.

const CLIENT_ID_KEY = '__syncClientId'
const TEXT_ENCODER = new TextEncoder()
const NULL_JSON = TEXT_ENCODER.encode('null')

/** Read the id we stamped on this socket; undefined on a fresh connection. */
function readTaggedId(ws: import('ws').WebSocket): string | undefined {
  return (ws as unknown as Record<string, string | undefined>)[CLIENT_ID_KEY]
}

/** Stamp a generated id on the socket so subsequent reads stay stable. */
function writeTaggedId(ws: import('ws').WebSocket, id: string): void {
  ;(ws as unknown as Record<string, string>)[CLIENT_ID_KEY] = id
}

let _clientCounter = 0
function nextClientId(): string {
  return `lv${++_clientCounter}${Math.random().toString(36).slice(2, 6)}`
}

/** Shared map of docName -> in-flight first-connect promise (survives HMR). */
function firstConnectInFlight(): Map<string, Promise<void>> {
  const key = '__syncFirstConnectInFlight'
  const g = globalThis as unknown as Record<string, unknown>
  if (!(g[key] instanceof Map)) g[key] = new Map<string, Promise<void>>()
  return g[key] as Map<string, Promise<void>>
}
function getClientId(ws: import('ws').WebSocket): string {
  const tagged = readTaggedId(ws)
  if (tagged) return tagged
  const id = nextClientId()
  writeTaggedId(ws, id)
  return id
}

// ─── Persistence Contract ───────────────────────────────────

/**
 * Interface all persistence adapters must implement.
 * Matches the y-leveldb LeveldbPersistence API so adapters are
 * interchangeable with the broader Yjs ecosystem.
 */
export interface SyncPersistence {
  getYDoc(docName: string): Promise<Y.Doc>
  storeUpdate(docName: string, update: Uint8Array): Promise<void>
  getStateVector(docName: string): Promise<Uint8Array>
  getDiff(docName: string, stateVector: Uint8Array): Promise<Uint8Array>
  clearDocument(docName: string): Promise<void>
  destroy(): Promise<void>
}

// ─── Config ─────────────────────────────────────────────────

/** Client-side Y.js providers. */
export type SyncClientProvider = 'websocket' | 'indexeddb'

export interface SyncConfig {
  /**
   * URL path prefix for the Sync WebSocket endpoint. Default: `/ws-sync`.
   *
   * **docName URL contract:** the room key (`docName`) is extracted as the
   * **last non-empty path segment** of the connection URL, after stripping
   * the query string. Examples:
   *
   * - `/ws-sync/myroom` → `docName = 'myroom'`
   * - `/ws-sync/myroom?token=xyz` → `docName = 'myroom'`
   * - `/ws-sync/a/b/c` → `docName = 'c'` *(only the last segment)*
   * - `/ws-sync` → `docName = 'default'`
   *
   * **If your application uses composite room ids** (e.g. `panel/resource/id`)
   * you must flatten them with a non-slash separator before mounting —
   * otherwise distinct logical rooms with the same trailing segment will
   * collide into one shared `Y.Doc`. For example, `panel-posts-42` rather
   * than `panel/posts/42`.
   */
  path?: string
  /** Server-side persistence adapter. Default: in-memory (resets on restart). */
  persistence?: SyncPersistence
  /**
   * Client-side Y.js providers. Default: `['websocket']`.
   *
   * - `'websocket'` — sync with server via y-websocket (real-time collaboration)
   * - `'indexeddb'` — cache Y.Doc in browser IndexedDB (survives refresh/restart)
   *
   * Multiple providers can coexist:
   * ```ts
   * providers: ['websocket', 'indexeddb']
   * ```
   */
  providers?: SyncClientProvider[]
  /**
   * Auth callback — return true to allow, false to deny.
   * Receives the upgrade request and the document name.
   */
  onAuth?: (req: { headers: Record<string, string | string[] | undefined>; url: string; token?: string }, docName: string) => boolean | Promise<boolean>
  /**
   * Called (debounced) whenever a document is updated.
   * Useful for indexing, webhooks, or audit logs.
   */
  onChange?: (docName: string, update: Uint8Array) => void | Promise<void>
  /**
   * Fires once per docName per process, after the first WebSocket client
   * attaches AND the persistence layer has hydrated the room. Use for
   * server-side seeding of empty Y.Texts / Y.Maps from a database of record
   * without racing against client-side seeding.
   *
   * The hook still fires when the doc is already populated from persistence —
   * the consumer is responsible for guarding (typically:
   * `if (doc.getText('title').length === 0) doc.getText('title').insert(0, dbRow.title)`).
   *
   * Wrap seed mutations in `doc.transact(() => { ... })` so partial writes
   * aren't visible to a second concurrent client mid-handshake.
   *
   * On throw the docName remains unfired so the next connection retries —
   * does NOT kill the WebSocket. Errors surface via `syncObservers.emit({
   * kind: 'sync.error', ... })`.
   */
  onFirstConnect?: (
    docName: string,
    doc:     Y.Doc,
    ctx:     { firstClient: WsSocket; persistence: SyncPersistence },
  ) => void | Promise<void>
}

// ─── Memory Persistence (built-in) ──────────────────────────

export class MemoryPersistence implements SyncPersistence {
  private docs = new Map<string, Y.Doc>()

  async getYDoc(docName: string): Promise<Y.Doc> {
    if (!this.docs.has(docName)) this.docs.set(docName, new Y.Doc())
    return this.docs.get(docName) ?? new Y.Doc()
  }

  async storeUpdate(docName: string, update: Uint8Array): Promise<void> {
    const doc = await this.getYDoc(docName)
    Y.applyUpdate(doc, update)
  }

  async getStateVector(docName: string): Promise<Uint8Array> {
    const doc = await this.getYDoc(docName)
    return Y.encodeStateVector(doc)
  }

  async getDiff(docName: string, stateVector: Uint8Array): Promise<Uint8Array> {
    const doc = await this.getYDoc(docName)
    return Y.encodeStateAsUpdate(doc, stateVector)
  }

  async clearDocument(docName: string): Promise<void> {
    this.docs.delete(docName)
  }

  async destroy(): Promise<void> {
    this.docs.clear()
  }
}

// ─── Prisma Persistence (optional dep: @prisma/client) ───────

export interface PrismaPersistenceConfig {
  /**
   * Prisma model name for storing documents.
   * The model must have: id (String), update (Bytes), updatedAt (DateTime).
   * Default: 'syncDocument'
   */
  model?: string
  /** Pass an existing PrismaClient to avoid creating a new one per operation. */
  client?: unknown
}

type PrismaDelegate = {
  findMany(args: unknown): Promise<Array<{ update: Uint8Array }>>
  create(args: unknown): Promise<unknown>
  deleteMany(args: unknown): Promise<unknown>
}

type PrismaLikeClient = Record<string, PrismaDelegate> & { $disconnect?: () => Promise<void> }

export function syncPrisma(config: PrismaPersistenceConfig = {}): SyncPersistence {
  // Bound in-memory retention: this cache is a hot-path replay optimization,
  // not an unbounded mirror of every doc ever touched in the process.
  const PRISMA_DOC_CACHE_MAX_ENTRIES = 256
  const modelName = config.model ?? 'syncDocument'
  let cachedClient: PrismaLikeClient | null = (config.client as PrismaLikeClient | undefined) ?? null
  const docCache = new Map<string, Y.Doc>()

  function cacheDoc(docName: string, doc: Y.Doc): void {
    if (docCache.has(docName)) docCache.delete(docName)
    docCache.set(docName, doc)
    while (docCache.size > PRISMA_DOC_CACHE_MAX_ENTRIES) {
      const oldest = docCache.keys().next().value as string | undefined
      if (oldest === undefined) break
      docCache.delete(oldest)
    }
  }

  async function getClient(): Promise<PrismaLikeClient> {
    if (cachedClient) return cachedClient
    // Try to resolve PrismaClient from DI container first (already configured)
    try {
      const core = await import(/* @vite-ignore */ '@rudderjs/core') as { app(): { make(k: string): unknown } }
      const prisma = core.app().make('prisma') as PrismaLikeClient
      if (prisma) { cachedClient = prisma; return cachedClient }
    } catch { /* DI not available — fall back to direct instantiation */ }
    // Fall back to creating a new PrismaClient
    const mod = await import(/* @vite-ignore */ '@prisma/client') as unknown as Record<string, unknown>
    const PrismaClient = (mod['PrismaClient'] ?? (mod['default'] as Record<string, unknown>)?.['PrismaClient'] ?? mod['default']) as new () => unknown
    cachedClient = new PrismaClient() as unknown as PrismaLikeClient
    return cachedClient
  }

  function getDelegate(prisma: PrismaLikeClient): PrismaDelegate {
    const d = prisma[modelName]
    if (!d) throw new Error(`[Sync] Prisma model "${modelName}" not found.`)
    return d
  }

  return {
    async getYDoc(docName: string): Promise<Y.Doc> {
      const cachedDoc = docCache.get(docName)
      if (cachedDoc) {
        cacheDoc(docName, cachedDoc)
        return cachedDoc
      }

      const prisma = await getClient()
      const doc    = new Y.Doc()
      const rows   = await getDelegate(prisma).findMany({ where: { docName } })
      for (const row of rows) Y.applyUpdate(doc, row.update)
      cacheDoc(docName, doc)
      return doc
    },

    async storeUpdate(docName: string, update: Uint8Array): Promise<void> {
      const prisma = await getClient()
      await getDelegate(prisma).create({ data: { docName, update } })
      const cachedDoc = docCache.get(docName)
      if (cachedDoc) {
        try {
          Y.applyUpdate(cachedDoc, update)
        } catch (err) {
          docCache.delete(docName)
          syncObservers.emit({
            kind:    'sync.error',
            op:      'storeUpdate',
            docName,
            error:   err instanceof Error ? err.message : String(err),
          })
        }
      }
    },

    async getStateVector(docName: string): Promise<Uint8Array> {
      const doc = await this.getYDoc(docName)
      return Y.encodeStateVector(doc)
    },

    async getDiff(docName: string, stateVector: Uint8Array): Promise<Uint8Array> {
      const doc = await this.getYDoc(docName)
      return Y.encodeStateAsUpdate(doc, stateVector)
    },

    async clearDocument(docName: string): Promise<void> {
      const prisma = await getClient()
      await getDelegate(prisma).deleteMany({ where: { docName } })
      docCache.delete(docName)
    },

    async destroy(): Promise<void> {
      docCache.clear()
      if (!config.client && cachedClient) {
        await cachedClient.$disconnect?.()
      }
    },
  }
}

// ─── Redis Persistence (optional dep: ioredis) ───────────────

export interface RedisSyncPersistenceConfig {
  url?:      string
  host?:     string
  port?:     number
  password?: string
  /** Key prefix. Default: 'rudderjs:sync:' */
  prefix?:   string
}

export function syncRedis(config: RedisSyncPersistenceConfig = {}): SyncPersistence {
  const prefix = config.prefix ?? 'rudderjs:sync:'
  let   client: unknown

  async function getClient() {
    if (!client) {
      const ioredisModule = await import('ioredis') as unknown as { Redis?: typeof import('ioredis').Redis; default?: { Redis?: typeof import('ioredis').Redis } }
      const Redis = ioredisModule.Redis ?? ioredisModule.default?.Redis ?? (ioredisModule.default as unknown as typeof import('ioredis').Redis)
      client = config.url
        ? new Redis(config.url)
        : new Redis({ host: config.host ?? '127.0.0.1', port: config.port ?? 6379, password: config.password })
    }
    return client as {
      lrange(key: string, start: number, stop: number): Promise<Buffer[]>
      rpush(key: string, ...values: Buffer[]): Promise<number>
      del(key: string): Promise<number>
      quit(): Promise<void>
    }
  }

  function key(docName: string) { return `${prefix}${docName}` }

  return {
    async getYDoc(docName: string): Promise<Y.Doc> {
      const r       = await getClient()
      const updates = await r.lrange(key(docName), 0, -1)
      const doc     = new Y.Doc()
      for (const u of updates) Y.applyUpdate(doc, new Uint8Array(u))
      return doc
    },

    async storeUpdate(docName: string, update: Uint8Array): Promise<void> {
      const r = await getClient()
      await r.rpush(key(docName), Buffer.from(update))
    },

    async getStateVector(docName: string): Promise<Uint8Array> {
      const doc = await this.getYDoc(docName)
      return Y.encodeStateVector(doc)
    },

    async getDiff(docName: string, stateVector: Uint8Array): Promise<Uint8Array> {
      const doc = await this.getYDoc(docName)
      return Y.encodeStateAsUpdate(doc, stateVector)
    },

    async clearDocument(docName: string): Promise<void> {
      const r = await getClient()
      await r.del(key(docName))
    },

    async destroy(): Promise<void> {
      const r = await getClient()
      await r.quit()
    },
  }
}

// ─── Sync room manager ───────────────────────────────────────

interface Room {
  doc:     Y.Doc
  clients: Set<import('ws').WebSocket>
  /** Resolves when persisted state has been loaded into the doc. */
  ready:   Promise<void>
  /** Latest awareness message per client — sent to newly connected clients. */
  awarenessMap: Map<import('ws').WebSocket, Uint8Array>
  /**
   * Per-socket Y.js awareness clientIDs + their highest observed clock.
   * Populated on each incoming awareness frame; consumed on socket close to
   * synthesize an awareness-removal message so other peers drop the user
   * from their `Awareness.getStates()` immediately instead of waiting on the
   * 30s y-protocols outdated-timeout (or never, if the page never reloads).
   */
  awarenessClients: Map<import('ws').WebSocket, Map<number, number>>
  /** Stored AI awareness message — sent to newly connecting clients. */
  aiAwarenessMsg?: Uint8Array
  /** Wall-clock timestamp when `aiAwarenessMsg` was set; replay skips if stale. */
  aiAwarenessAt?:  number
}

/**
 * TTL in ms for stored AI awareness replay. If an AI agent crashes without
 * calling `clearAiAwareness`, the stored cursor would be replayed to every
 * new joiner forever; the TTL bounds the staleness window so the ghost
 * cursor disappears on its own.
 */
const AI_AWARENESS_REPLAY_TTL_MS = 60_000

/**
 * docNames whose `onFirstConnect` hook has already fired in this process.
 * Lives on globalThis so it survives Vite SSR module re-evaluation in dev —
 * without that, the hook would re-fire on every HMR reload even though the
 * room's persisted state is unchanged. Process restart clears it (the in-memory
 * map is fresh), which is correct: persistence may have been cleared too.
 */
function firstConnectFired(): Set<string> {
  return syncGlobal('firstConnect', () => new Set<string>())
}

/** Transaction origin used by server-side mutations (Sync.updateMap, etc.) */
const SERVER_ORIGIN = 'rudderjs:server'

/** Read-only access to the rooms map; undefined when no room has ever been
 *  created in this process. Centralizes the structural cast so individual
 *  callers don't repeat it. */
function getRoomsMap(): Map<string, Room> | undefined {
  return readSyncGlobal<Map<string, Room>>('rooms')
}

/** Shape returned by `Y.XmlText.toDelta()` — yjs types the return as
 *  `Array<any>`, so call sites that need to walk the delta cast to this. */
interface DeltaItem { insert: unknown; attributes?: Record<string, unknown> }

/** Commander-style command args are typed as `unknown`; reach into the
 *  positional `<doc>` slot in one place so the structural cast doesn't
 *  repeat across every sync:* command. */
function readDocArg(args: unknown): string {
  return (args as unknown as Record<string, unknown>)['doc'] as string
}

/** Get-or-create variant — guarantees a Map is present on globalThis. */
function ensureRoomsMap(): Map<string, Room> {
  return syncGlobal('rooms', () => new Map<string, Room>())
}

function getOrCreateRoom(docName: string, persistence: SyncPersistence): Room {
  const rooms   = ensureRoomsMap()
  const cached  = rooms.get(docName)
  if (cached) return cached

  const doc       = new Y.Doc()
  const loadStart = Date.now()
  // Persistence load can fail (DB transient, Redis hiccup, etc.). Two design
  // points worth knowing:
  // (1) The room is evicted from the rooms map on failure so the *next*
  //     call recreates a fresh room and retries — without this, a single
  //     blip caches a broken in-memory doc forever and updates routed
  //     through storeUpdate silently fail downstream.
  // (2) The `ready` promise REJECTS on failure (it used to .catch +
  //     resolve, which masked errors). Callers that await ready and don't
  //     wrap in try/catch will surface the failure loudly — that's the
  //     point. handleConnection wraps + closes the socket cleanly; the
  //     public Sync.* helpers let the rejection propagate to user code.
  const ready = persistence.getYDoc(docName).then(persisted => {
    const sv     = Y.encodeStateVector(doc)
    const update = Y.encodeStateAsUpdate(persisted, sv)
    if (update.length > 2) Y.applyUpdate(doc, update)
    syncObservers.emit({
      kind:       'persistence.load',
      docName,
      durationMs: Date.now() - loadStart,
      byteSize:   update.length,
    })
  }, (e: unknown) => {
    // Evict the broken room so subsequent calls retry from scratch.
    if (rooms.get(docName) === room) rooms.delete(docName)
    syncObservers.emit({
      kind:    'sync.error',
      op:      'getYDoc',
      docName,
      error:   e instanceof Error ? e.message : String(e),
    })
    throw e
  })
  const room: Room = {
    doc,
    clients:         new Set(),
    ready,
    awarenessMap:    new Map(),
    awarenessClients: new Map(),
  }
  rooms.set(docName, room)

  // Observe server-side mutations and broadcast to all connected WebSocket clients.
  // Client-originated updates are already forwarded by the message handler,
  // so we only broadcast updates with the SERVER_ORIGIN transaction origin.
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === SERVER_ORIGIN) {
      const fwd = encodeSyncMsg(syncUpdate, update)
      for (const client of room.clients) {
        if (client.readyState === 1 /* OPEN */) {
          client.send(fwd)
        }
      }
      // Fire-and-forget by design (server-side mutation already applied
      // in-memory and broadcast to clients), but failures need to surface
      // somewhere — otherwise a Redis outage silently desyncs disk from
      // memory across every server-originated write.
      persistence.storeUpdate(docName, update).catch((err: unknown) => {
        syncObservers.emit({
          kind:    'sync.error',
          op:      'storeUpdate',
          docName,
          error:   err instanceof Error ? err.message : String(err),
        })
      })
    }
  })
  return room
}

// ─── WebSocket connection handler ────────────────────────────

import type { IncomingMessage } from 'node:http'

// Yjs sync message types (y-protocols)
const messageSync        = 0
const messageAwareness   = 1
const syncStep1          = 0
const syncStep2          = 1
const syncUpdate         = 2

// ── y-protocols binary format ──────────────────────────────
// Messages follow the y-websocket wire format used by lib0/y-protocols:
//   sync:      [msgType(varint), subType(varint), dataLen(varint), ...data]
//   awareness: [msgType(varint), dataLen(varint), ...data]
// There is NO extra outer length field — WebSocket frames provide their own framing.

function readVarUint(buf: Uint8Array, pos: number): [number, number] {
  let result = 0, shift = 0
  while (true) {
    const byte = buf[pos++] ?? 0
    result |= (byte & 0x7f) << shift
    shift  += 7
    if ((byte & 0x80) === 0) break
  }
  return [result, pos]
}

function writeVarUint(val: number): Uint8Array {
  const buf: number[] = []
  while (val > 0x7f) { buf.push((val & 0x7f) | 0x80); val >>>= 7 }
  buf.push(val)
  return new Uint8Array(buf)
}

/** Encode a sync sub-message: [messageSync, subType(varint), dataLen, ...data] */
function encodeSyncMsg(subType: number, data: Uint8Array): Uint8Array {
  const subTypeBytes = writeVarUint(subType)
  const lenBytes     = writeVarUint(data.length)
  const out          = new Uint8Array(1 + subTypeBytes.length + lenBytes.length + data.length)
  out[0] = messageSync
  out.set(subTypeBytes, 1)
  out.set(lenBytes, 1 + subTypeBytes.length)
  out.set(data, 1 + subTypeBytes.length + lenBytes.length)
  return out
}

/**
 * Parse the clientID → clock entries an awareness frame announces. Mirrors
 * the y-protocols wire format documented at `lexical/awareness.ts` —
 * [messageAwareness][innerLen][numberOfClients][...{clientID, clock, jsonLen, json}].
 *
 * Returns an empty array on any decode failure. The caller silently degrades
 * to "no removal broadcast on disconnect for this socket", which is just the
 * pre-fix behavior — never throws into the message hot path.
 */
function decodeAwarenessClientEntries(buf: Uint8Array): Array<{ clientID: number; clock: number }> {
  try {
    if (buf[0] !== messageAwareness) return []
    let pos = 1
    const [innerLen, p0] = readVarUint(buf, pos)
    pos = p0
    const innerEnd = pos + innerLen
    const [count, p1] = readVarUint(buf, pos)
    pos = p1
    const out: Array<{ clientID: number; clock: number }> = []
    for (let i = 0; i < count && pos < innerEnd; i++) {
      const [clientID, q1] = readVarUint(buf, pos);  pos = q1
      const [clock,    q2] = readVarUint(buf, pos);  pos = q2
      const [jsonLen,  q3] = readVarUint(buf, pos);  pos = q3 + jsonLen
      out.push({ clientID, clock })
    }
    return out
  } catch {
    return []
  }
}

/**
 * Encode an awareness "removal" frame — entries with state = literal `null`.
 * Y.js's `applyAwarenessUpdate` interprets a null state as "this client left"
 * and drops the clientID from `awareness.getStates()`. Clock is incremented
 * past the last observed value so the receiver doesn't filter it as stale.
 */
function encodeAwarenessRemoval(entries: Array<{ clientID: number; clock: number }>): Uint8Array | null {
  if (entries.length === 0) return null
  const innerParts: Uint8Array[] = [writeVarUint(entries.length)]
  for (const { clientID, clock } of entries) {
    innerParts.push(writeVarUint(clientID))
    innerParts.push(writeVarUint(clock + 1))
    innerParts.push(writeVarUint(NULL_JSON.length))
    innerParts.push(NULL_JSON)
  }
  let innerLen = 0
  for (const p of innerParts) innerLen += p.length
  const innerLenBytes = writeVarUint(innerLen)
  const out = new Uint8Array(1 + innerLenBytes.length + innerLen)
  out[0] = messageAwareness
  out.set(innerLenBytes, 1)
  let pos = 1 + innerLenBytes.length
  for (const p of innerParts) { out.set(p, pos); pos += p.length }
  return out
}

async function handleConnection(
  ws:              WsSocket,
  req:             IncomingMessage,
  persistence:     SyncPersistence,
  onChange?:       SyncConfig['onChange'],
  onFirstConnect?: SyncConfig['onFirstConnect'],
): Promise<void> {
  // Extract docName from URL path: /ws-sync/my-doc → my-doc.
  // Strips the query string, then takes the LAST non-empty path segment.
  // Composite room ids must be flattened with a non-slash separator before
  // mounting (see SyncConfig.path JSDoc). Multi-segment paths only honor the
  // final segment, so distinct logical rooms with the same trailing segment
  // would otherwise collide into one Y.Doc.
  const docName  = ((req.url ?? '/').split('?')[0] ?? '/').split('/').filter(Boolean).pop() ?? 'default'
  const clientId = getClientId(ws)
  const room     = getOrCreateRoom(docName, persistence)
  room.clients.add(ws)

  syncObservers.emit({
    kind:        'doc.opened',
    docName,
    clientId,
    clientCount: room.clients.size,
  })

  // Wait for persistence load before running the first-connect hook or
  // sending the initial state vector. Otherwise the hook would see an empty
  // doc (since persistence is async) and the client would receive an
  // up-front state vector that doesn't include hook-written seed data.
  //
  // `room.ready` now rejects on persistence load failure (see getOrCreateRoom).
  // Close the socket cleanly so the client retries rather than silently
  // operating against an empty in-memory doc.
  try {
    await room.ready
  } catch {
    try { ws.close(1011, 'persistence load failed') } catch { /* already closing */ }
    return
  }

  // Fire the first-connect hook exactly once per docName per process. The
  // Set is shared across the function via globalThis (survives HMR). A
  // same-doc concurrent join awaits any in-flight hook promise instead of
  // re-entering. On throw the doc remains unfired so the next connection
  // retries — the hook is best-effort and shouldn't kill the WebSocket.
  if (onFirstConnect) {
    const fired = firstConnectFired()
    const inFlight = firstConnectInFlight()

    if (!fired.has(docName)) {
      let hookPromise = inFlight.get(docName)

      if (!hookPromise) {
        hookPromise = Promise.resolve()
          .then(async () => {
            await onFirstConnect(docName, room.doc, { firstClient: ws, persistence })
            fired.add(docName)
          })
          .catch((err: unknown) => {
            syncObservers.emit({
              kind:    'sync.error',
              docName,
              clientId,
              error:   err instanceof Error ? err.message : String(err),
            })
          })
          .finally(() => {
            inFlight.delete(docName)
          })

        inFlight.set(docName, hookPromise)
      }

      await hookPromise
    }
  }

  // ── Step 1: send server state vector ──────────────────────
  ws.send(encodeSyncMsg(syncStep1, Y.encodeStateVector(room.doc)))

  // ── Step 2: send existing awareness states to the new client ─
  // Force-killed sockets (proxy timeout, tab kill) never fire `close`, so
  // their `awarenessMap` entry would linger and replay ghost cursors to
  // every late joiner. Prune dead entries inline.
  for (const [client, buf] of room.awarenessMap) {
    if (client.readyState !== 1 /* OPEN */) {
      room.awarenessMap.delete(client)
      continue
    }
    if (client !== ws) ws.send(buf)
  }
  // Send stored AI awareness (if an AI agent is currently editing) —
  // unless it's older than the replay TTL, in which case the AI likely
  // crashed without calling `clearAiAwareness` and the cursor is stale.
  if (room.aiAwarenessMsg && room.aiAwarenessAt !== undefined) {
    if (Date.now() - room.aiAwarenessAt <= AI_AWARENESS_REPLAY_TTL_MS) {
      ws.send(room.aiAwarenessMsg)
    } else {
      delete room.aiAwarenessMsg
      delete room.aiAwarenessAt
    }
  }

  // ── Message handler ───────────────────────────────────────
  // The outer try/catch keeps a malformed frame (truncated varuint, bogus
  // Y.applyUpdate input, etc.) from becoming an unhandled promise rejection
  // — the async handler attached to `ws.on('message', ...)` returns its
  // rejection into Node's `unhandledRejection` event with no socket-level
  // recovery. Surface the failure through the observer so telescope sees
  // it, and keep the room operating against the in-memory doc.
  ws.on('message', async (raw: Buffer) => {
   try {
    const buf = new Uint8Array(raw)
    let   pos = 0

    const [type, pos1] = readVarUint(buf, pos)
    pos = pos1

    if (type === messageSync) {
      const [subType, pos2] = readVarUint(buf, pos)
      const [dataLen, pos3] = readVarUint(buf, pos2)
      const data = buf.slice(pos3, pos3 + dataLen)

      if (subType === syncStep1) {
        // Client sent its state vector — reply with diff
        const diff = Y.encodeStateAsUpdate(room.doc, data)
        ws.send(encodeSyncMsg(syncStep2, diff))

      } else if (subType === syncStep2 || subType === syncUpdate) {
        // Client sent an update — apply + broadcast + persist
        Y.applyUpdate(room.doc, data)

        const fwd = encodeSyncMsg(syncUpdate, data)
        let recipientCount = 0
        for (const client of room.clients) {
          if (client !== ws && client.readyState === 1 /* OPEN */) {
            client.send(fwd)
            recipientCount++
          }
        }

        try {
          await persistence.storeUpdate(docName, data)
          syncObservers.emit({
            kind:     'persistence.save',
            docName,
            byteSize: data.byteLength,
          })
        } catch (err) {
          syncObservers.emit({
            kind:    'sync.error',
            op:      'storeUpdate',
            docName,
            clientId,
            error:   err instanceof Error ? err.message : String(err),
          })
        }
        try {
          await onChange?.(docName, data)
        } catch (err) {
          syncObservers.emit({
            kind:    'sync.error',
            op:      'onChange',
            docName,
            clientId,
            error:   err instanceof Error ? err.message : String(err),
          })
        }

        syncObservers.emit({
          kind:           'update.applied',
          docName,
          clientId,
          byteSize:       data.byteLength,
          recipientCount,
        })
      }

    } else if (type === messageAwareness) {
      // Store latest awareness message for this client
      room.awarenessMap.set(ws, new Uint8Array(buf))
      // Record clientIDs + clocks this socket announces — consumed on close
      // to synthesize an awareness-removal so other peers drop the user
      // from `awareness.getStates()` instantly. Without this, ghost users
      // linger until the y-protocols 30s outdated-timeout (or forever if
      // the client never refreshes their awareness clock again).
      const entries = decodeAwarenessClientEntries(buf)
      if (entries.length > 0) {
        let perSocket = room.awarenessClients.get(ws)
        if (!perSocket) { perSocket = new Map(); room.awarenessClients.set(ws, perSocket) }
        for (const { clientID, clock } of entries) {
          const prev = perSocket.get(clientID) ?? -1
          if (clock > prev) perSocket.set(clientID, clock)
        }
      }
      // Broadcast awareness (presence/cursors) to all other clients
      for (const client of room.clients) {
        if (client !== ws && client.readyState === 1) {
          client.send(buf)
        }
      }
      // Awareness is high-rate (every cursor/keystroke). Producers emit
      // every event; the SyncCollector throttles in the consumer with a
      // configurable per-(docName, clientId) sample window.
      syncObservers.emit({
        kind:     'awareness.changed',
        docName,
        clientId,
        byteSize: buf.byteLength,
      })
    }
   } catch (err) {
    syncObservers.emit({
      kind:    'sync.error',
      op:      'message',
      docName,
      clientId,
      error:   err instanceof Error ? err.message : String(err),
    })
   }
  })

  ws.on('close', () => {
    room.clients.delete(ws)
    room.awarenessMap.delete(ws)

    // Tell remaining peers this socket's clientIDs are gone. Y.js's
    // `applyAwarenessUpdate` interprets the null state as a removal and
    // drops the entries from `Awareness.getStates()` — the user vanishes
    // from peer presence lists immediately instead of lingering until the
    // y-protocols outdated-timeout (or forever, in the demo's case).
    const perSocket = room.awarenessClients.get(ws)
    if (perSocket && perSocket.size > 0) {
      const entries  = [...perSocket.entries()].map(([clientID, clock]) => ({ clientID, clock }))
      const removal  = encodeAwarenessRemoval(entries)
      if (removal) {
        for (const client of room.clients) {
          if (client.readyState === 1 /* OPEN */) {
            try { client.send(removal) } catch { /* socket may already be closing */ }
          }
        }
      }
    }
    room.awarenessClients.delete(ws)

    syncObservers.emit({
      kind:        'doc.closed',
      docName,
      clientId,
      clientCount: room.clients.size,
    })
  })
}

// ─── globalThis key for upgrade handler ─────────────────────

export const SYNC_UPGRADE_KEY = '__rudderjs_sync_upgrade__'

/** @internal — exposed for tests; do not use in application code. */
export const _handleConnection = handleConnection
/** @internal — exposed for tests; clears the `firstConnectFired` Set so each
 *  test case starts with a fresh process-wide "no hook has fired" state. */
export function _resetFirstConnectFired(): void {
  firstConnectFired().clear()
  firstConnectInFlight().clear()
}

export { syncObservers, SyncObserverRegistry }      from './observers.js'
export type { SyncEvent, SyncObserver }             from './observers.js'

/** Re-export of `Y.Doc` so editor adapters (e.g. `@rudderjs/sync/lexical`)
 *  can type their parameters without taking a direct `yjs` peer dep. */
export type { Doc as YDoc } from 'yjs'

// ─── Factory ────────────────────────────────────────────────

/**
 * Sync — real-time collaborative document sync via Yjs CRDT.
 *
 * Shares the same port as `@rudderjs/broadcast` and the HTTP server — no
 * separate process required. Auto-discovered via `defaultProviders()`.
 *
 * Built-in persistence drivers: memory (default), prisma, redis. Configure
 * via `config/sync.ts`.
 *
 * @example
 * // config/sync.ts
 * import { syncRedis } from '@rudderjs/sync'
 * import type { SyncConfig } from '@rudderjs/sync'
 *
 * export default {
 *   path:        '/ws-sync',
 *   persistence: syncRedis({ url: process.env.REDIS_URL }),
 * } satisfies SyncConfig
 */
export class SyncProvider extends ServiceProvider {
  private _persistence!: SyncPersistence
  private _path!:        string

  register(): void {
    const cfg         = config<SyncConfig>('sync', {})
    this._path        = cfg.path        ?? '/ws-sync'
    // Init-once across dev HMR re-boots: `register()` re-runs on every `app/`
    // edit and `cfg.persistence` (e.g. `syncRedis()`) is rebuilt each time as
    // the config module re-evaluates. Without reuse the new persistence's lazy
    // ioredis client opens a fresh connection on the next doc op and leaks the
    // previous one. `syncGlobal` get-or-creates, so the FIRST persistence wins
    // and later per-boot instances stay inert (never connect). Mirrors the
    // connection-reuse fixes in the orm adapters / cache / session.
    this._persistence = syncGlobal('persistence', () => cfg.persistence ?? new MemoryPersistence())
    const persistence = this._persistence
    this.app.bind('sync.persistence', () => persistence)

    // Publishable persistence schema — `pnpm rudder vendor:publish
    // --tag=sync-schema` drops the SyncDocument model into prisma/schema/.
    // The model name is load-bearing: the Prisma delegate must be
    // `syncDocument`, syncPrisma()'s default. Prisma-only — syncRedis and
    // in-memory need no schema, and there is no drizzle persistence adapter.
    // fileURLToPath, NOT URL.pathname — pathname yields `/D:/...` on Windows
    // (leading slash + percent-encoding), which breaks the copy. Caught by the
    // asset-on-disk test on Windows CI.
    const schemaDir = fileURLToPath(new URL(/* @vite-ignore */ '../schema', import.meta.url))
    this.publishes([
      { from: `${schemaDir}/sync.prisma`, to: 'prisma/schema', tag: 'sync-schema', orm: 'prisma' as const },
    ])
  }

  async boot(): Promise<void> {
    const path        = this._path
    // Reuse the same persistence the first boot stored (see register()).
    const persistence = syncGlobal('persistence', () => this._persistence)
    const cfg         = config<SyncConfig>('sync', {})

      const wss = new WebSocketServer({ noServer: true })

      wss.on('connection', (ws, req) => {
        void handleConnection(ws as WsSocket, req, persistence, cfg.onChange, cfg.onFirstConnect)
      })

      // Cross-package WebSocket upgrade chain — these key names are part of
      // the contract with `@rudderjs/broadcast` and server-hono. Owned outside
      // sync, so they don't live in `globals.ts` / `SYNC_KEYS`.
      const wsGlobals = globalThis as Record<string, unknown>
      const prev = (wsGlobals['__rudderjs_ws_broadcast_upgrade__'] ?? wsGlobals['__rudderjs_ws_upgrade__']) as
        | ((req: unknown, socket: unknown, head: unknown) => void)
        | undefined

      wsGlobals[SYNC_UPGRADE_KEY] = (req: IncomingMessage, socket: unknown, head: unknown) => {
        const pathname = (req.url ?? '/').split('?')[0] ?? '/'
        if (pathname.startsWith(path)) {
          wss.handleUpgrade(req, socket as import('net').Socket, head as Buffer, (ws) => {
            wss.emit('connection', ws, req)
          })
        } else {
          prev?.(req, socket, head)
        }
      }

      // Register as the active upgrade handler
      wsGlobals['__rudderjs_ws_upgrade__'] = wsGlobals[SYNC_UPGRADE_KEY]

      rudder.command('sync:docs', async () => {
        const rooms = getRoomsMap()
        if (!rooms || rooms.size === 0) {
          console.log('\n  No active documents.\n')
          return
        }
        console.log(`\n  Active documents: ${rooms.size}\n`)
        for (const [name, room] of rooms) {
          console.log(`    ${name}  —  ${room.clients.size} client(s)`)
        }
        console.log()
      }).description('List active Sync documents and connected clients')

      rudder.command('sync:clear <doc>', async (args) => {
        const docName = readDocArg(args)
        await persistence.clearDocument(docName)
        getRoomsMap()?.delete(docName)
        console.log(`\n  Cleared document: ${docName}\n`)
      }).description('Clear a Sync document from persistence')

      rudder.command('sync:inspect <doc>', async (args) => {
        const docName = readDocArg(args)
        const room = getOrCreateRoom(docName, persistence)
        await room.ready

        const root = room.doc.get('root', Y.XmlText)
        console.log(`\n  Document: ${docName}`)
        console.log(`  Clients:  ${room.clients.size}`)
        console.log(`  Root type: ${root.constructor.name}  length: ${root.length}\n`)

        // Dump the Y.Map fields (form data)
        const fields = room.doc.getMap('fields')
        if (fields.size > 0) {
          console.log('  ── Y.Map "fields" ──')
          fields.forEach((val, key) => {
            const display = typeof val === 'string' && val.length > 80 ? val.slice(0, 80) + '…' : val
            console.log(`    ${key}: ${JSON.stringify(display)}`)
          })
          console.log()
        }

        // Dump the Y.XmlText tree structure
        if (root.length > 0) {
          console.log('  ── Y.XmlText "root" tree ──')
          const delta = root.toDelta() as DeltaItem[]
          for (const [i, entry] of delta.entries()) {
            if (typeof entry.insert === 'string') {
              console.log(`    [${i}] text: ${JSON.stringify(entry.insert.slice(0, 100))}`)
            } else if (entry.insert instanceof Y.XmlElement) {
              const elem = entry.insert
              const attrs = elem.getAttributes()
              const text = elem.toString()
              console.log(`    [${i}] XmlElement <${elem.nodeName}>`)
              if (Object.keys(attrs).length > 0) {
                for (const [k, v] of Object.entries(attrs)) {
                  const display = typeof v === 'string' && v.length > 80 ? v.slice(0, 80) + '…' : v
                  console.log(`          attr ${k} = ${JSON.stringify(display)}`)
                }
              }
              if (text) console.log(`          text: ${JSON.stringify(text.slice(0, 100))}`)
              // Dump inner delta for text elements
              if (elem.length > 0) {
                try {
                  const innerDelta = (elem as unknown as Y.XmlText).toDelta() as DeltaItem[]
                  for (const [j, inner] of innerDelta.entries()) {
                    if (typeof inner.insert === 'string') {
                      console.log(`          [${j}] inner text: ${JSON.stringify(inner.insert.slice(0, 80))}${inner.attributes ? ` attrs=${JSON.stringify(inner.attributes)}` : ''}`)
                    } else {
                      console.log(`          [${j}] inner ${inner.insert?.constructor?.name ?? typeof inner.insert}`)
                    }
                  }
                } catch { /* not a text-like element */ }
              }
            } else if (entry.insert instanceof Y.XmlText) {
              // Lexical paragraph-level node (paragraph, heading, list, quote, code).
              const child = entry.insert as Y.XmlText
              const childAttrs = (child as unknown as { getAttributes(): Record<string, unknown> }).getAttributes?.() ?? {}
              const attrParts = Object.entries(childAttrs)
                .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                .join(' ')
              console.log(`    [${i}] YXmlText ${attrParts}`)
              try {
                const innerDelta = child.toDelta() as DeltaItem[]
                for (const [j, inner] of innerDelta.entries()) {
                  if (typeof inner.insert === 'string') {
                    console.log(`          [${j}] text: ${JSON.stringify(inner.insert.slice(0, 80))}${inner.attributes ? ` attrs=${JSON.stringify(inner.attributes)}` : ''}`)
                  } else if (inner.insert instanceof Y.XmlElement) {
                    const elem = inner.insert
                    const innerAttrs = elem.getAttributes()
                    console.log(`          [${j}] <${elem.nodeName}> ${Object.entries(innerAttrs).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : JSON.stringify(String(v).slice(0, 60))}`).join(' ')}`)
                  } else {
                    console.log(`          [${j}] ${inner.insert?.constructor?.name ?? typeof inner.insert}`)
                  }
                }
              } catch { /* */ }
            } else {
              console.log(`    [${i}] ${entry.insert?.constructor?.name ?? typeof entry.insert}`)
            }
          }
          console.log()
        } else {
          console.log('  (root is empty)\n')
        }
    }).description('Inspect the Y.Doc tree structure of a Sync document')
  }
}

// ─── Lexical adapter ────────────────────────────────────────
//
// Lexical-shaped block / text / awareness helpers used to live on the
// `Sync` facade as instance methods. They moved to `@rudderjs/sync/lexical`
// (a separate subpath export) so the core stays editor-agnostic — Yjs binds
// to many editors (Lexical, Tiptap, ProseMirror, Monaco, CodeMirror) and the
// core surface should not assume any one tree shape. Use `sync.document(name)`
// to get the underlying `Y.Doc`, then pass it to the adapter functions.

// ─── Sync facade ──────────────────────────────────────────

/**
 * Sync facade — programmatic access to Yjs documents from server-side code.
 *
 * Mirrors @rudderjs/broadcast's `Broadcast` facade pattern.
 * Resolves persistence automatically — no manual threading required.
 *
 * Editor-shaped helpers (Lexical block / text / awareness) live in the
 * `@rudderjs/sync/lexical` subpath and operate on the underlying `Y.Doc`
 * returned by `Sync.document(name)`.
 *
 * @example
 * import { Sync } from '@rudderjs/sync'
 * import { insertBlock } from '@rudderjs/sync/lexical'
 *
 * await Sync.seed('panel:articles:42', { title: 'Hello', body: '' })
 * const snapshot = Sync.snapshot('panel:articles:42')
 * const fields   = Sync.readMap('panel:articles:42', 'fields')
 *
 * const doc = Sync.document('panel:articles:42:richcontent:body')
 * insertBlock(doc, 'callToAction', { title: 'Subscribe' })
 */
export const Sync = {
  /** Get the configured persistence adapter. */
  persistence(): SyncPersistence {
    const p = readSyncGlobal<SyncPersistence>('persistence')
    if (!p) throw new Error('[Sync] Not initialised — register sync() in providers.')
    return p
  },

  /**
   * Seed a ydoc with initial data (e.g. from a DB record).
   *
   * **Atomicity:** the empty-doc check happens *inside* `transact`, against
   * the actual `fields` map size. Two key consequences:
   * - The old `encodeStateVector(...).length > 1` gate falsely reported
   *   "already seeded" for any doc that had ever been opened by a client
   *   (state vector grows on first connect, before any data is written).
   * - Two concurrent `seed()` callers serialise on Yjs's per-doc transact
   *   queue — the second transact sees `fields.size > 0` and skips.
   *
   * Returns `true` if this call wrote the seed data, `false` if the doc
   * already had `fields` and the seed was skipped.
   */
  async seed(docName: string, data: Record<string, unknown>): Promise<boolean> {
    const persistence = this.persistence()
    const room = getOrCreateRoom(docName, persistence)
    await room.ready  // wait for persisted state to load — may reject

    const fields = room.doc.getMap('fields')
    let didSeed = false
    room.doc.transact(() => {
      if (fields.size > 0) return  // already seeded
      for (const [key, val] of Object.entries(data)) {
        fields.set(key, val ?? null)
      }
      didSeed = true
    })
    return didSeed
  },

  /**
   * Return the current full state of a ydoc as a snapshot (Uint8Array).
   * Purely a read operation — does not modify persistence.
   *
   * **Sync read; does NOT await persistence load.** Suitable when the doc is
   * already warm (post-first-connect) — first call after a cold start returns
   * an empty snapshot because `getYDoc()` is still resolving. For SSR-from-DB
   * style reads (where the caller needs the persisted state), use
   * `snapshotAsync()` instead.
   */
  snapshot(docName: string): Uint8Array {
    const persistence = this.persistence()
    const room = getOrCreateRoom(docName, persistence)
    return Y.encodeStateAsUpdate(room.doc)
  },

  /**
   * Async sibling of `snapshot()` — awaits `room.ready` before encoding so
   * the snapshot reflects persisted state on cold reads. Use during SSR to
   * eliminate the DB → Y.Doc value flicker on hydration.
   */
  async snapshotAsync(docName: string): Promise<Uint8Array> {
    const persistence = this.persistence()
    const room = getOrCreateRoom(docName, persistence)
    await room.ready
    return Y.encodeStateAsUpdate(room.doc)
  },

  /**
   * Read a Y.Map from a ydoc as a plain JS object.
   *
   * **Sync read; does NOT await persistence load.** See `snapshot()` caveat
   * about cold reads. For SSR use `readMapAsync()`.
   *
   * @example
   * const fields = Sync.readMap('panel:articles:42', 'fields')
   * // { title: 'Hello', body: 'World' }
   */
  readMap(docName: string, mapName: string): Record<string, unknown> {
    const persistence = this.persistence()
    const room   = getOrCreateRoom(docName, persistence)
    const ymap   = room.doc.getMap(mapName)
    const result: Record<string, unknown> = {}
    ymap.forEach((val, key) => { result[key] = val })
    return result
  },

  /**
   * Async sibling of `readMap()` — awaits `room.ready` so the map reflects
   * persisted state on cold reads. SSR-safe.
   */
  async readMapAsync(docName: string, mapName: string): Promise<Record<string, unknown>> {
    const persistence = this.persistence()
    const room   = getOrCreateRoom(docName, persistence)
    await room.ready
    const ymap   = room.doc.getMap(mapName)
    const result: Record<string, unknown> = {}
    ymap.forEach((val, key) => { result[key] = val })
    return result
  },

  /**
   * Read a `Y.Text` from a ydoc as a plain string. SSR-safe — awaits
   * `room.ready` so the returned string reflects persisted state on cold
   * reads. Returns `''` if the named text has never been written.
   *
   * Symmetric to `readMapAsync()` for the text type used by rich-text fields
   * (Lexical, Tiptap, etc.) where the editor binds to a `Y.Text` rather than
   * a `Y.Map` entry.
   *
   * @example
   * const body = await Sync.readText('panel:articles:42:richcontent:body', 'body')
   */
  async readText(docName: string, textName: string): Promise<string> {
    const persistence = this.persistence()
    const room = getOrCreateRoom(docName, persistence)
    await room.ready
    return room.doc.getText(textName).toString()
  },

  /**
   * Return the underlying `Y.Doc` AFTER `room.ready` resolves. Escape hatch
   * for consumers that need to materialize multiple fields off one doc in
   * one await, or want direct access to the doc post-hydration.
   *
   * Server-originated mutations on the returned doc should run inside
   * `doc.transact(() => { ... }, 'rudderjs:server')` so the WS layer
   * broadcasts them to connected clients — same convention as
   * `document()` (which is sync and does not await).
   */
  async load(docName: string): Promise<Y.Doc> {
    const persistence = this.persistence()
    const room = getOrCreateRoom(docName, persistence)
    await room.ready
    return room.doc
  },

  /**
   * Clear a Y.Doc room: close all WebSocket clients, remove from memory, clear persistence.
   * Clients will reconnect and get a fresh empty room.
   */
  async clearDocument(docName: string): Promise<void> {
    const persistence = this.persistence()
    await persistence.clearDocument(docName)
    const rooms = getRoomsMap()
    const room = rooms?.get(docName)
    if (room) {
      // Close all connected WebSocket clients — prevents stale Y.Doc re-sync
      for (const client of room.clients) {
        try { client.close(4000, 'room-cleared') } catch { /* ignore */ }
      }
      room.clients.clear()
      room.awarenessMap.clear()
    }
    rooms?.delete(docName)
  },

  /** Get the number of active WebSocket clients for a document room. Returns 0 if the room doesn't exist. */
  getClientCount(docName: string): number {
    return getRoomsMap()?.get(docName)?.clients.size ?? 0
  },

  /**
   * Update a single field in a Y.Map. Creates room if needed.
   * Connected WebSocket clients receive the update in real-time.
   *
   * @example
   * await Sync.updateMap('panel:articles:42', 'fields', 'title', 'New Title')
   */
  async updateMap(docName: string, mapName: string, field: string, value: unknown): Promise<void> {
    const persistence = this.persistence()
    const room = getOrCreateRoom(docName, persistence)
    await room.ready
    room.doc.transact(() => {
      room.doc.getMap(mapName).set(field, value)
    }, SERVER_ORIGIN)
  },

  /**
   * Update multiple fields in a Y.Map in a single transaction.
   * Connected WebSocket clients receive the update in real-time.
   *
   * @example
   * await Sync.updateMapBatch('panel:articles:42', 'fields', {
   *   title: 'Better Title',
   *   slug: 'better-title',
   * })
   */
  async updateMapBatch(docName: string, mapName: string, fields: Record<string, unknown>): Promise<void> {
    const persistence = this.persistence()
    const room = getOrCreateRoom(docName, persistence)
    await room.ready
    room.doc.transact(() => {
      const map = room.doc.getMap(mapName)
      for (const [key, val] of Object.entries(fields)) {
        map.set(key, val)
      }
    }, SERVER_ORIGIN)
  },

  /**
   * Get the underlying `Y.Doc` for a document name.
   *
   * Returned doc is mutated in place — pass it to `@rudderjs/sync/lexical`
   * helpers (or any Yjs binding) to make edits. Server-originated mutations
   * should run inside `doc.transact(() => { ... }, 'rudderjs:server')` so the
   * WS layer broadcasts them to connected clients.
   *
   * @example
   * import { Sync } from '@rudderjs/sync'
   * import { insertBlock } from '@rudderjs/sync/lexical'
   *
   * const doc = Sync.document('panel:articles:42:richcontent:body')
   * insertBlock(doc, 'callToAction', { title: 'Subscribe' })
   */
  document(docName: string): Y.Doc {
    const persistence = this.persistence()
    return getOrCreateRoom(docName, persistence).doc
  },

  /**
   * Drop the stored AI awareness replay buffer for a doc — future joiners
   * won't see a ghost AI cursor. Use as a recovery path by `docName` when
   * an AI agent crashes without calling its own `clearAiAwareness(doc)`.
   *
   * The replay buffer also auto-expires after 60s, so this is only needed
   * for *immediate* cleanup. To also clear the cursor on currently
   * connected clients, use the lexical-side `clearAiAwareness(doc)` —
   * that helper broadcasts a null awareness frame as well.
   */
  clearAiAwareness(docName: string): void {
    const room = getRoomsMap()?.get(docName)
    if (!room) return
    delete room.aiAwarenessMsg
    delete room.aiAwarenessAt
  },
}
