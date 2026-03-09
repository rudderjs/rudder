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

export interface LiveConfig {
  /** URL path for the Live WebSocket endpoint. Default: `/ws-live` */
  path?: string
  /** Persistence adapter. Default: in-memory (resets on restart). */
  persistence?: LivePersistence
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
}

export function livePrisma(config: PrismaPersistenceConfig = {}): LivePersistence {
  const modelName = config.model ?? 'liveDocument'

  return {
    async getYDoc(docName: string): Promise<Y.Doc> {
      const { PrismaClient } = await import('@prisma/client') as any
      const prisma = new PrismaClient()
      const doc    = new Y.Doc()
      const rows   = await (prisma[modelName] as any).findMany({ where: { docName } })
      for (const row of rows) Y.applyUpdate(doc, row.update)
      await prisma.$disconnect()
      return doc
    },

    async storeUpdate(docName: string, update: Uint8Array): Promise<void> {
      const { PrismaClient } = await import('@prisma/client') as any
      const prisma = new PrismaClient()
      await (prisma[modelName] as any).create({ data: { docName, update } })
      await prisma.$disconnect()
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
      const { PrismaClient } = await import('@prisma/client') as any
      const prisma = new PrismaClient()
      await (prisma[modelName] as any).deleteMany({ where: { docName } })
      await prisma.$disconnect()
    },

    async destroy(): Promise<void> {},
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
  doc:       Y.Doc
  clients:   Set<import('ws').WebSocket>
}

const g       = globalThis as Record<string, unknown>
const KEY     = '__boostkit_live__'

function getOrCreateRoom(docName: string, persistence: LivePersistence): Room {
  const rooms = g[KEY] as Map<string, Room> ?? new Map<string, Room>()
  g[KEY] = rooms
  if (!rooms.has(docName)) {
    const doc = new Y.Doc()
    // Load persisted state asynchronously
    persistence.getYDoc(docName).then(persisted => {
      const sv     = Y.encodeStateVector(doc)
      const update = Y.encodeStateAsUpdate(persisted, sv)
      if (update.length > 2) Y.applyUpdate(doc, update)
    }).catch(() => {})
    rooms.set(docName, { doc, clients: new Set() })
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

function encodeMessage(type: number, ...payloads: Uint8Array[]): Uint8Array {
  const totalLen = payloads.reduce((s, p) => s + p.length, 0)
  const lenBytes = writeVarUint(totalLen)
  const out      = new Uint8Array(1 + lenBytes.length + totalLen)
  out[0] = type
  out.set(lenBytes, 1)
  let offset = 1 + lenBytes.length
  for (const p of payloads) { out.set(p, offset); offset += p.length }
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
  const sv       = Y.encodeStateVector(room.doc)
  const svMsg    = new Uint8Array([syncStep1, ...sv])
  const svFrame  = encodeMessage(messageSync, svMsg)
  ws.send(svFrame)

  // ── Message handler ───────────────────────────────────────
  ws.on('message', async (raw: Buffer) => {
    const buf  = new Uint8Array(raw)
    const type = buf[0] ?? 255
    let   pos  = 1
    const [, newPos] = readVarUint(buf, pos)
    pos = newPos

    if (type === messageSync) {
      const subType = buf[pos++] ?? 255

      if (subType === syncStep1) {
        // Client sent its state vector — reply with diff
        const clientSv = buf.slice(pos)
        const diff     = Y.encodeStateAsUpdate(room.doc, clientSv)
        const reply    = new Uint8Array([syncStep2, ...diff])
        ws.send(encodeMessage(messageSync, reply))

      } else if (subType === syncStep2 || subType === syncUpdate) {
        // Client sent an update — apply + broadcast + persist
        const update = buf.slice(pos)
        Y.applyUpdate(room.doc, update)

        for (const client of room.clients) {
          if (client !== ws && client.readyState === 1 /* OPEN */) {
            const fwd = new Uint8Array([syncUpdate, ...update])
            client.send(encodeMessage(messageSync, fwd))
          }
        }

        await persistence.storeUpdate(docName, update)
        onChange?.(docName, update)
      }

    } else if (type === messageAwareness) {
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
    register(): void {}

    async boot(): Promise<void> {
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
