import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

import { MemoryPersistence, _handleConnection } from './index.js'

// Minimal socket double: records everything the server sends, and lets the
// test inject inbound frames + a close event.
class MockWsSocket extends EventEmitter {
  readyState = 1 // OPEN
  sent: Uint8Array[] = []
  send(data: Uint8Array | Buffer): void {
    this.sent.push(data instanceof Buffer ? new Uint8Array(data) : data)
  }
  close(): void { this.readyState = 3 }
  receive(buf: Uint8Array): void { this.emit('message', Buffer.from(buf)) }
}

const messageAwareness = 1

// Correct (arithmetic) varint codec for building/parsing frames in the test -
// independent of the implementation under test.
function writeVarUint(val: number): number[] {
  const out: number[] = []
  while (val > 0x7f) { out.push((val % 128) | 0x80); val = Math.floor(val / 128) }
  out.push(val)
  return out
}
function readVarUint(buf: Uint8Array, pos: number): [number, number] {
  let result = 0, shift = 0
  while (true) {
    const byte = buf[pos++] ?? 0
    result += (byte & 0x7f) * 2 ** shift
    shift += 7
    if ((byte & 0x80) === 0) break
  }
  return [result, pos]
}

/** Build a y-protocols awareness frame announcing one client's state. */
function awarenessFrame(clientID: number, clock: number, state: unknown): Uint8Array {
  const json  = [...Buffer.from(JSON.stringify(state), 'utf8')]
  const inner = [...writeVarUint(1), ...writeVarUint(clientID), ...writeVarUint(clock), ...writeVarUint(json.length), ...json]
  return new Uint8Array([messageAwareness, ...writeVarUint(inner.length), ...inner])
}

/** Parse the first client entry of an awareness frame: { clientID, state }. */
function parseAwareness(frame: Uint8Array): { clientID: number; state: unknown } | null {
  if (frame[0] !== messageAwareness) return null
  let pos = 1
  ;[, pos] = readVarUint(frame, pos)            // innerLen
  const [count, p1] = readVarUint(frame, pos);  pos = p1
  if (count < 1) return null
  const [clientID, p2] = readVarUint(frame, pos); pos = p2
  ;[, pos] = readVarUint(frame, pos)            // clock
  const [jsonLen, p3] = readVarUint(frame, pos); pos = p3
  const json = Buffer.from(frame.slice(pos, pos + jsonLen)).toString('utf8')
  return { clientID, state: JSON.parse(json) }
}

describe('awareness removal on disconnect (32-bit clientID)', () => {
  it('sends a removal frame carrying the uncorrupted uint32 clientID', async () => {
    const persistence = new MemoryPersistence()
    const url = `/ws-sync/ghost-${Date.now()}`

    const peerA = new MockWsSocket()
    const peerB = new MockWsSocket()
    await _handleConnection(peerA as never, { url } as never, persistence)
    await _handleConnection(peerB as never, { url } as never, persistence)

    // A large client id: bit 31 set, so a 32-bit-signed bitwise reader corrupts
    // it (this is exactly what Yjs's random.uint32() produces most of the time).
    const BIG_ID = 3_000_000_000
    const baseline = peerB.sent.length
    peerA.receive(awarenessFrame(BIG_ID, 1, { user: { name: 'A' } }))

    peerA.readyState = 3
    peerA.emit('close')

    // Among everything peerB received after the baseline, find the awareness
    // frame whose state is null - the removal.
    const removal = peerB.sent
      .slice(baseline)
      .map(parseAwareness)
      .find((p): p is { clientID: number; state: null } => p !== null && p.state === null)

    assert.ok(removal, 'peer B must receive an awareness-removal frame on A disconnect')
    assert.equal(removal.clientID, BIG_ID, 'removal must target the real (uncorrupted) clientID')
  })

  it('round-trips a small clientID too (no regression for sub-2^28 ids)', async () => {
    const persistence = new MemoryPersistence()
    const url = `/ws-sync/small-${Date.now()}`
    const peerA = new MockWsSocket()
    const peerB = new MockWsSocket()
    await _handleConnection(peerA as never, { url } as never, persistence)
    await _handleConnection(peerB as never, { url } as never, persistence)

    const SMALL_ID = 42
    const baseline = peerB.sent.length
    peerA.receive(awarenessFrame(SMALL_ID, 1, { user: { name: 'A' } }))
    peerA.readyState = 3
    peerA.emit('close')

    const removal = peerB.sent.slice(baseline).map(parseAwareness)
      .find((p): p is { clientID: number; state: null } => p !== null && p.state === null)
    assert.ok(removal)
    assert.equal(removal.clientID, SMALL_ID)
  })
})
