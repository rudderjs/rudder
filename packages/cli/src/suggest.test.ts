import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { levenshtein, suggestCommands } from './suggest.js'

// ── levenshtein ────────────────────────────────────────────────

describe('levenshtein', () => {
  it('is 0 for identical strings', () => assert.equal(levenshtein('migrate', 'migrate'), 0))
  it('is the length against an empty string', () => {
    assert.equal(levenshtein('', 'abc'), 3)
    assert.equal(levenshtein('abc', ''), 3)
  })
  it('counts single edits', () => {
    assert.equal(levenshtein('tinkr', 'tinker'), 1)   // insertion
    assert.equal(levenshtein('migrate', 'migrata'), 1) // substitution
    assert.equal(levenshtein('makes', 'make'), 1)      // deletion
  })
  it('counts a transposition as two edits', () => {
    assert.equal(levenshtein('mgirate', 'migrate'), 2)
  })
})

// ── suggestCommands ────────────────────────────────────────────

const CMDS = [
  'about', 'add', 'migrate', 'migrate:fresh', 'migrate:status',
  'make:model', 'make:controller', 'make:migration', 'tinker',
  'queue:work', 'queue:status', 'db:push', 'db:seed', 'route:list',
]

describe('suggestCommands', () => {
  it('corrects a one-edit typo', () => {
    assert.deepEqual(suggestCommands('tinkr', CMDS), ['tinker'])
    assert.deepEqual(suggestCommands('queue:wrok', CMDS), ['queue:work'])
  })

  it('corrects a transposed namespaced command', () => {
    assert.deepEqual(suggestCommands('migrate:froesh', CMDS), ['migrate:fresh'])
  })

  it('corrects a missing colon', () => {
    assert.deepEqual(suggestCommands('dbpush', CMDS), ['db:push'])
  })

  it('returns nothing when the input is not close to any command', () => {
    assert.deepEqual(suggestCommands('xyzzy', CMDS), [])
    assert.deepEqual(suggestCommands('completelyoffbase', CMDS), [])
  })

  it('prefers a same-namespace command on ties', () => {
    // Both migrate:fresh and migrate:status are one namespace away; a typo of
    // one should not jump namespaces.
    const r = suggestCommands('migrate:statuz', CMDS)
    assert.equal(r[0], 'migrate:status')
  })

  it('respects the result limit', () => {
    const many = ['cmd1', 'cmd2', 'cmd3', 'cmd4', 'cmd5']
    assert.ok(suggestCommands('cmd', many, { limit: 2 }).length <= 2)
  })

  it('ranks closer matches first', () => {
    const r = suggestCommands('migrat', CMDS)
    assert.equal(r[0], 'migrate') // distance 1, beats migrate:fresh etc.
  })
})
