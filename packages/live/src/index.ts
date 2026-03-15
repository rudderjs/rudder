import { ServiceProvider, artisan, type Application } from '@boostkit/core'
import { WebSocketServer, type WebSocket as WsSocket } from 'ws'
import * as Y                                          from 'yjs'

// ─── Persistence Contract ───────────────────────────────────

/**
 * Interface all persistence adapters must implement.
 * Matches the y-leveldb LeveldbPersistence API so adapters are
 * interchangeable with the broader Yjs ecosystem.
 */
export interface LivePersistence {
  getYDoc(docName: string): Promise<Y.Doc>
  storeUpdate(docName: string, update: Uint8Array): Promise<void>
  getStateVector(docName: string): Promise<Uint8Array>
  getDiff(docName: string, stateVector: Uint8Array): Promise<Uint8Array>
  clearDocument(docName: string): Promise<void>
  destroy(): Promise<void>
}

// ─── Config ─────────────────────────────────────────────────

/** Client-side Y.js providers. */
export type LiveClientProvider = 'websocket' | 'indexeddb'

export interface LiveConfig {
  /** URL path for the Live WebSocket endpoint. Default: `/ws-live` */
  path?: string
  /** Server-side persistence adapter. Default: in-memory (resets on restart). */
  persistence?: LivePersistence
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
  providers?: LiveClientProvider[]
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
}

// ─── Memory Persistence (built-in) ──────────────────────────

export class MemoryPersistence implements LivePersistence {
  private docs = new Map<string, Y.Doc>()

  async getYDoc(docName: string): Promise<Y.Doc> {
    if (!this.docs.has(docName)) this.docs.set(docName, new Y.Doc())
    return this.docs.get(docName)!
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
   * Default: 'liveDocument'
   */
  model?: string
  /** Pass an existing PrismaClient to avoid creating a new one per operation. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client?: any
}

export function livePrisma(config: PrismaPersistenceConfig = {}): LivePersistence {
  const modelName = config.model ?? 'liveDocument'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cachedClient: any = config.client ?? null

  async function getClient() {
    if (cachedClient) return cachedClient
    const { PrismaClient } = await import('@prisma/client') as any
    cachedClient = new PrismaClient()
    return cachedClient
  }

  return {
    async getYDoc(docName: string): Promise<Y.Doc> {
      const prisma = await getClient()
      const doc    = new Y.Doc()
      const rows   = await prisma[modelName].findMany({ where: { docName } })
      for (const row of rows) Y.applyUpdate(doc, row.update)
      return doc
    },

    async storeUpdate(docName: string, update: Uint8Array): Promise<void> {
      const prisma = await getClient()
      await prisma[modelName].create({ data: { docName, update } })
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
      await prisma[modelName].deleteMany({ where: { docName } })
    },

    async destroy(): Promise<void> {
      if (!config.client && cachedClient) {
        await cachedClient.$disconnect?.()
      }
    },
  }
}

// ─── Redis Persistence (optional dep: ioredis) ───────────────

export interface RedisLivePersistenceConfig {
  url?:      string
  host?:     string
  port?:     number
  password?: string
  /** Key prefix. Default: 'boostkit:live:' */
  prefix?:   string
}

export function liveRedis(config: RedisLivePersistenceConfig = {}): LivePersistence {
  const prefix = config.prefix ?? 'boostkit:live:'
  let   client: unknown

  async function getClient() {
    if (!client) {
      const { Redis } = await import('ioredis') as any
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

// ─── Live room manager ───────────────────────────────────────

interface Room {
  doc:     Y.Doc
  clients: Set<import('ws').WebSocket>
  /** Resolves when persisted state has been loaded into the doc. */
  ready:   Promise<void>
  /** Latest awareness message per client — sent to newly connected clients. */
  awarenessMap: Map<import('ws').WebSocket, Uint8Array>
}

const g       = globalThis as Record<string, unknown>
const KEY     = '__boostkit_live__'
const PERSIST_KEY = '__boostkit_live_persistence__'

function getOrCreateRoom(docName: string, persistence: LivePersistence): Room {
  const rooms = g[KEY] as Map<string, Room> ?? new Map<string, Room>()
  g[KEY] = rooms
  if (!rooms.has(docName)) {
    const doc = new Y.Doc()
    const ready = persistence.getYDoc(docName).then(persisted => {
      const sv     = Y.encodeStateVector(doc)
      const update = Y.encodeStateAsUpdate(persisted, sv)
      if (update.length > 2) Y.applyUpdate(doc, update)
    }).catch(() => {})
    rooms.set(docName, { doc, clients: new Set(), ready, awarenessMap: new Map() })
  }
  return rooms.get(docName)!
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

/** Encode a sync sub-message: [messageSync, subType, dataLen, ...data] */
function encodeSyncMsg(subType: number, data: Uint8Array): Uint8Array {
  const lenBytes = writeVarUint(data.length)
  const out      = new Uint8Array(2 + lenBytes.length + data.length)
  out[0] = messageSync
  out[1] = subType
  out.set(lenBytes, 2)
  out.set(data, 2 + lenBytes.length)
  return out
}

async function handleConnection(
  ws:          WsSocket,
  req:         IncomingMessage,
  persistence: LivePersistence,
  onChange?:   LiveConfig['onChange'],
): Promise<void> {
  // Extract document name from URL path: /ws-live/my-doc → my-doc
  const docName = (req.url ?? '/').split('?')[0]!.split('/').filter(Boolean).pop() ?? 'default'
  const room    = getOrCreateRoom(docName, persistence)
  room.clients.add(ws)

  // ── Step 1: send server state vector ──────────────────────
  ws.send(encodeSyncMsg(syncStep1, Y.encodeStateVector(room.doc)))

  // ── Step 2: send existing awareness states to the new client ─
  for (const [client, buf] of room.awarenessMap) {
    if (client !== ws && client.readyState === 1 /* OPEN */) {
      ws.send(buf)
    }
  }

  // ── Message handler ───────────────────────────────────────
  ws.on('message', async (raw: Buffer) => {
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
        for (const client of room.clients) {
          if (client !== ws && client.readyState === 1 /* OPEN */) {
            client.send(fwd)
          }
        }

        await persistence.storeUpdate(docName, data)
        onChange?.(docName, data)
      }

    } else if (type === messageAwareness) {
      // Store latest awareness message for this client
      room.awarenessMap.set(ws, new Uint8Array(buf))
      // Broadcast awareness (presence/cursors) to all other clients
      for (const client of room.clients) {
        if (client !== ws && client.readyState === 1) {
          client.send(buf)
        }
      }
    }
  })

  ws.on('close', () => {
    room.clients.delete(ws)
    room.awarenessMap.delete(ws)
  })
}

// ─── globalThis key for upgrade handler ─────────────────────

export const LIVE_UPGRADE_KEY = '__boostkit_live_upgrade__'

// ─── Factory ────────────────────────────────────────────────

/**
 * Live — real-time collaborative document sync via Yjs CRDT.
 *
 * Same port as HTTP and @boostkit/ws — no separate server needed.
 *
 * Built-in persistence drivers: memory (default), prisma, redis.
 *
 * @example
 * // bootstrap/providers.ts
 * import { live, liveRedis } from '@boostkit/live'
 * export default [
 *   broadcasting(),
 *   live(),                              // memory (dev)
 *   live({ persistence: liveRedis() }),  // redis (production)
 * ]
 */
export function live(config: LiveConfig = {}): new (app: Application) => ServiceProvider {
  const path        = config.path        ?? '/ws-live'
  const persistence = config.persistence ?? new MemoryPersistence()

  return class LiveServiceProvider extends ServiceProvider {
    register(): void {
      this.app.bind('live.persistence', () => persistence)
    }

    async boot(): Promise<void> {
      g[PERSIST_KEY] = persistence

      const wss = new WebSocketServer({ noServer: true })

      wss.on('connection', (ws, req) => {
        void handleConnection(ws as WsSocket, req, persistence, config.onChange)
      })

      // Chain into the existing upgrade handler (works alongside @boostkit/ws)
      const prev = g['__boostkit_ws_upgrade__'] as
        | ((req: unknown, socket: unknown, head: unknown) => void)
        | undefined

      g[LIVE_UPGRADE_KEY] = (req: IncomingMessage, socket: unknown, head: unknown) => {
        const pathname = (req.url ?? '/').split('?')[0]!
        if (pathname.startsWith(path)) {
          wss.handleUpgrade(req, socket as import('net').Socket, head as Buffer, (ws) => {
            wss.emit('connection', ws, req)
          })
        } else {
          prev?.(req, socket, head)
        }
      }

      // Register as the active upgrade handler
      g['__boostkit_ws_upgrade__'] = g[LIVE_UPGRADE_KEY]

      artisan.command('live:docs', async () => {
        const rooms = g[KEY] as Map<string, Room> | undefined
        if (!rooms || rooms.size === 0) {
          console.log('\n  No active documents.\n')
          return
        }
        console.log(`\n  Active documents: ${rooms.size}\n`)
        for (const [name, room] of rooms) {
          console.log(`    ${name}  —  ${room.clients.size} client(s)`)
        }
        console.log()
      }).description('List active Live documents and connected clients')

      artisan.command('live:clear <doc>', async (args) => {
        const docName = (args as unknown as Record<string, unknown>)['doc'] as string
        await persistence.clearDocument(docName)
        const rooms = g[KEY] as Map<string, Room> | undefined
        rooms?.delete(docName)
        console.log(`\n  Cleared document: ${docName}\n`)
      }).description('Clear a Live document from persistence')
    }
  }
}

// ─── Live facade ──────────────────────────────────────────

/**
 * Live facade — programmatic access to Yjs documents from server-side code.
 *
 * Mirrors @boostkit/broadcast's `Broadcast` facade pattern.
 * Resolves persistence automatically — no manual threading required.
 *
 * @example
 * import { Live } from '@boostkit/live'
 *
 * await Live.seed('panel:articles:42', { title: 'Hello', body: '' })
 * const snapshot = Live.snapshot('panel:articles:42')
 * const fields   = Live.readMap('panel:articles:42', 'fields')
 */
export const Live = {
  /** Get the configured persistence adapter. */
  persistence(): LivePersistence {
    const p = g[PERSIST_KEY] as LivePersistence | undefined
    if (!p) throw new Error('[Live] Not initialised — register live() in providers.')
    return p
  },

  /**
   * Seed a ydoc with initial data (e.g. from a DB record).
   * Safe to call multiple times — only seeds when the ydoc is empty.
   */
  async seed(docName: string, data: Record<string, unknown>): Promise<void> {
    const persistence = this.persistence()
    const room = getOrCreateRoom(docName, persistence)
    await room.ready  // wait for persisted state to load

    const sv = Y.encodeStateVector(room.doc)
    if (sv.length > 1) return  // already has content

    const fields = room.doc.getMap('fields')
    room.doc.transact(() => {
      for (const [key, val] of Object.entries(data)) {
        fields.set(key, val ?? null)
      }
    })
  },

  /**
   * Return the current full state of a ydoc as a snapshot (Uint8Array).
   * Purely a read operation — does not modify persistence.
   */
  snapshot(docName: string): Uint8Array {
    const persistence = this.persistence()
    const room = getOrCreateRoom(docName, persistence)
    return Y.encodeStateAsUpdate(room.doc)
  },

  /**
   * Read a Y.Map from a ydoc as a plain JS object.
   *
   * @example
   * const fields = Live.readMap('panel:articles:42', 'fields')
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
   * Orphan a Y.Doc room and clear its persistence.
   * The room is removed from the map but connections stay open on the orphaned
   * room object (no auto-reconnect race). New connections via getOrCreateRoom()
   * get a fresh empty room. Old connections die when clients navigate/unmount.
   */
  async clearDocument(docName: string): Promise<void> {
    const persistence = this.persistence()
    await persistence.clearDocument(docName)
    const rooms = g[KEY] as Map<string, Room> | undefined
    rooms?.delete(docName)
  },
}
