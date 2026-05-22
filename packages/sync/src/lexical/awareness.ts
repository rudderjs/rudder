/**
 * Synthetic AI awareness — places a non-Yjs cursor/presence on the
 * document and broadcasts it to every connected WebSocket client. The
 * cursor uses a synthetic client ID that won't collide with real Yjs
 * client IDs (which are random 30-bit integers).
 *
 * These functions need access to the WebSocket clients connected to the
 * doc. Rather than threading the room handle through the public API,
 * we do a reverse lookup against the global rooms registry maintained
 * by `@rudderjs/sync`'s WebSocket layer. If no room is found (e.g. the
 * Sync provider hasn't booted), the call is a silent no-op.
 */

import * as Y from 'yjs'
import { writeVarUint } from './internal.js'
import { SYNC_KEYS } from '../globals.js'

// Yjs awareness message type byte (matches y-protocols)
const messageAwareness = 1

/** Synthetic client ID for AI awareness — won't collide with real Yjs
 *  client IDs (random 30-bit integers). */
const AI_CLIENT_ID = 999_999_999

/**
 * y-protocols requires monotonically increasing clocks per `clientID`. A
 * module-level counter would reset to 0 on Vite SSR re-eval / HMR / process
 * restart, and lib0/y-protocols filters older clocks — silently dropping
 * AI awareness updates on every reboot. Lives on `globalThis` so the
 * counter survives module re-evaluation.
 */
function nextAiClock(): number {
  const g = globalThis as Record<string, unknown>
  const slot = SYNC_KEYS.aiAwarenessClock
  const next = ((g[slot] as number | undefined) ?? 0) + 1
  g[slot] = next
  return next
}

/**
 * Encode an awareness update message for the AI cursor.
 *
 * Wire format (matches y-websocket client → server → client):
 *   [messageAwareness=1 (varint)]
 *   [payloadLength (varint)]       ← VarUint8Array wrapper
 *     [numberOfClients (varint)]
 *     [clientID (varint)]
 *     [clock (varint)]
 *     [stateJSON (varString = len + utf8)]
 */
export function encodeAiAwareness(state: Record<string, unknown> | null): Uint8Array {
  const json      = state ? JSON.stringify(state) : 'null'
  const jsonBytes = new TextEncoder().encode(json)

  // Build the inner awareness payload
  const innerParts: Uint8Array[] = [
    writeVarUint(1),                  // numberOfClients = 1
    writeVarUint(AI_CLIENT_ID),       // clientID
    writeVarUint(nextAiClock()),      // clock (incrementing, survives HMR/restart)
    writeVarUint(jsonBytes.length),   // stateJSON length (varString encoding)
    jsonBytes,                        // stateJSON utf8 bytes
  ]

  let innerLen = 0
  for (const p of innerParts) innerLen += p.length

  // Wrap: [messageAwareness] [innerLen (VarUint8Array)] [inner bytes]
  const innerLenBytes = writeVarUint(innerLen)
  const msg = new Uint8Array(1 + innerLenBytes.length + innerLen)
  msg[0] = messageAwareness
  msg.set(innerLenBytes, 1)
  let pos = 1 + innerLenBytes.length
  for (const p of innerParts) { msg.set(p, pos); pos += p.length }
  return msg
}

// ─── Room lookup ─────────────────────────────────────────────
//
// The Sync WebSocket layer stores rooms on the `rooms` slot in
// `SYNC_KEYS` (see `../globals.ts`) keyed by docName. Each room has a
// `doc`, a `clients` set, and an optional `aiAwarenessMsg` snapshot used
// to send AI presence to newly-connecting clients. We reverse-lookup by
// Y.Doc identity here so the lexical adapter stays free of any
// room-manager wiring on the public API.

interface RoomLike {
  doc:             Y.Doc
  clients:         Set<{ readyState: number; send(data: Uint8Array): void }>
  aiAwarenessMsg?: Uint8Array
  aiAwarenessAt?:  number
}

function findRoomByDoc(doc: Y.Doc): RoomLike | null {
  const rooms = (globalThis as Record<string, unknown>)[SYNC_KEYS.rooms] as
    | Map<string, RoomLike>
    | undefined
  if (!rooms) return null
  for (const room of rooms.values()) {
    if (room.doc === doc) return room
  }
  return null
}

/**
 * Set AI awareness state on a doc — shows an AI cursor/presence to all connected clients.
 * Uses a synthetic client ID (999_999_999) that won't collide with real Yjs clients.
 *
 * If `cursorTarget` is provided, the cursor is placed at that Y.XmlText offset
 * (visible as a colored cursor line in the Lexical editor).
 *
 * @example
 * setAiAwareness(doc, { name: 'AI: SEO Agent', color: '#8b5cf6' })
 */
export function setAiAwareness(
  doc:           Y.Doc,
  state:         { name: string; color: string },
  cursorTarget?: { target: Y.XmlText; offset: number; length?: number },
): void {
  // Build awareness state matching Lexical CollaborationPlugin format:
  // { name, color, focusing, anchorPos, focusPos }
  const awarenessState: Record<string, unknown> = {
    name:     state.name,
    color:    state.color,
    focusing: true,
  }

  if (cursorTarget) {
    const anchorPos   = Y.createRelativePositionFromTypeIndex(cursorTarget.target, cursorTarget.offset)
    // If length is provided, set focusPos at end of selection (shows as highlight)
    // Otherwise, anchor === focus (shows as cursor line)
    const focusOffset = cursorTarget.offset + (cursorTarget.length ?? 0)
    const focusPos    = Y.createRelativePositionFromTypeIndex(cursorTarget.target, focusOffset)
    awarenessState.anchorPos = anchorPos
    awarenessState.focusPos  = focusPos
  }

  const msg  = encodeAiAwareness(awarenessState)
  const room = findRoomByDoc(doc)
  if (!room) return

  for (const client of room.clients) {
    if (client.readyState === 1 /* OPEN */) client.send(msg)
  }
  room.aiAwarenessMsg = msg
  room.aiAwarenessAt  = Date.now()
}

/**
 * Clear AI awareness state — removes the AI cursor from all connected clients.
 */
export function clearAiAwareness(doc: Y.Doc): void {
  const msg  = encodeAiAwareness(null)
  const room = findRoomByDoc(doc)
  if (!room) return

  for (const client of room.clients) {
    if (client.readyState === 1 /* OPEN */) client.send(msg)
  }
  delete room.aiAwarenessMsg
  delete room.aiAwarenessAt
}
