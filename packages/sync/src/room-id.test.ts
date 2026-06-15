import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { composeRoomId, parseRoomId, DEFAULT_ROOM_SEPARATOR } from './index.js'

describe('composeRoomId / parseRoomId', () => {
  it('round-trips a composite id with the default separator', () => {
    const room = composeRoomId(['default', 'posts', '42'])
    assert.equal(room, 'default:posts:42')
    assert.deepStrictEqual(parseRoomId(room), ['default', 'posts', '42'])
  })

  it('the default separator is a colon', () => {
    assert.equal(DEFAULT_ROOM_SEPARATOR, ':')
  })

  it('the composed id is a single URL path segment (no slash collapse)', () => {
    const room = composeRoomId(['default', 'posts', '42'])
    assert.equal(room.includes('/'), false)
    // The server takes the last `/`-segment; with no slash the whole id survives.
    assert.equal(room.split('/').filter(Boolean).pop(), room)
  })

  it('distinct resources sharing a record id produce distinct rooms', () => {
    assert.notEqual(
      composeRoomId(['default', 'posts', '42']),
      composeRoomId(['default', 'comments', '42']),
    )
  })

  it('supports a custom separator', () => {
    const room = composeRoomId(['a', 'b', 'c'], '|')
    assert.equal(room, 'a|b|c')
    assert.deepStrictEqual(parseRoomId(room, '|'), ['a', 'b', 'c'])
  })

  it('a single segment round-trips', () => {
    assert.equal(composeRoomId(['solo']), 'solo')
    assert.deepStrictEqual(parseRoomId('solo'), ['solo'])
  })

  it('throws when a segment contains a slash', () => {
    assert.throws(() => composeRoomId(['default', 'a/b', '42']), /contains "\/"/)
  })

  it('throws when a segment contains the separator', () => {
    assert.throws(() => composeRoomId(['default', 'a:b', '42']), /contains the separator/)
    // ...but the same value is fine under a separator it does not contain.
    assert.equal(composeRoomId(['default', 'a:b', '42'], '|'), 'default|a:b|42')
  })

  it('throws on an empty segment or empty list', () => {
    assert.throws(() => composeRoomId(['a', '', 'b']), /non-empty/)
    assert.throws(() => composeRoomId([]), /at least one segment/)
  })

  it('throws on a slash or multi-character separator', () => {
    assert.throws(() => composeRoomId(['a', 'b'], '/'), /cannot be '\/'/)
    assert.throws(() => composeRoomId(['a', 'b'], '::'), /single character/)
  })
})
