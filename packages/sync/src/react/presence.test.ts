import { describe, it } from 'node:test'
import assert            from 'node:assert/strict'

import { collabColorFromSeed, computeAwarenessPeers } from './presence.js'

describe('collabColorFromSeed', () => {
  it('returns a #rrggbb hex string', () => {
    const color = collabColorFromSeed('alice@example.com')
    assert.match(color, /^#[0-9a-f]{6}$/)
  })

  it('is deterministic for the same seed', () => {
    assert.equal(collabColorFromSeed('bob'), collabColorFromSeed('bob'))
  })

  it('differs across distinct seeds', () => {
    assert.notEqual(collabColorFromSeed('alice'), collabColorFromSeed('bob'))
  })

  it('handles an empty seed without throwing', () => {
    assert.match(collabColorFromSeed(''), /^#[0-9a-f]{6}$/)
  })
})

describe('computeAwarenessPeers', () => {
  const states = (entries: [number, Record<string, unknown>][]) =>
    new Map<number, Record<string, unknown>>(entries)

  it('returns peers that have a non-null value for the key', () => {
    const peers = computeAwarenessPeers(states([
      [1, { focusField: 'title', user: { name: 'Ann', color: '#abc123' } }],
      [2, { focusField: 'body',  user: { name: 'Bo',  color: '#def456' } }],
    ]), 99, 'focusField')

    assert.equal(peers.length, 2)
    assert.deepStrictEqual(peers[0], { clientId: 1, value: 'title', user: { name: 'Ann', color: '#abc123' } })
  })

  it('excludes the local client', () => {
    const peers = computeAwarenessPeers(states([
      [7, { focusField: 'title' }],
      [8, { focusField: 'body' }],
    ]), 7, 'focusField')
    assert.deepStrictEqual(peers.map(p => p.clientId), [8])
  })

  it('skips peers with a null/absent value for the key', () => {
    const peers = computeAwarenessPeers(states([
      [1, { focusField: null }],
      [2, { user: { name: 'X' } }],          // no focusField at all
      [3, { focusField: 'title' }],
    ]), 99, 'focusField')
    assert.deepStrictEqual(peers.map(p => p.clientId), [3])
  })

  it('fills user defaults when name/color are missing or non-string', () => {
    const peers = computeAwarenessPeers(states([
      [1, { focusField: 'title' }],                            // no user
      [2, { focusField: 'title', user: { name: 42 } }],        // non-string name
    ]), 99, 'focusField')
    assert.deepStrictEqual(peers[0]!.user, { name: 'Anonymous', color: '#888888' })
    assert.deepStrictEqual(peers[1]!.user, { name: 'Anonymous', color: '#888888' })
  })

  it('returns an empty list when no peer matches', () => {
    assert.deepStrictEqual(computeAwarenessPeers(states([]), 1, 'focusField'), [])
  })
})
