import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { bootNotice, drainBootNotices, formatBootNotices } from './boot-notices.js'

// Build the ESC (\x1b) matcher via RegExp() so the control char isn't a literal
// in a regex literal (eslint no-control-regex).
const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g')
const stripAnsi = (s: string): string => s.replace(ANSI, '')

describe('boot notices', () => {
  beforeEach(() => { drainBootNotices() }) // clear the shared globalThis buffer between cases

  it('bootNotice appends; drainBootNotices reads in order then clears', () => {
    bootNotice('ai', 'google skipped')
    bootNotice('auth', 'dev secret')
    const drained = drainBootNotices()
    assert.deepEqual(
      drained.map(n => `${n.scope}:${n.message}`),
      ['ai:google skipped', 'auth:dev secret'],
      'returned in insertion order',
    )
    assert.deepEqual(drainBootNotices(), [], 'buffer is empty after a drain')
  })

  it('formatBootNotices returns no lines for an empty list', () => {
    assert.deepEqual(formatBootNotices([]), [])
  })

  it('groups notices under a count header with one scope-aligned row each', () => {
    const lines = formatBootNotices([
      { scope: 'ai',   message: 'google skipped' },
      { scope: 'auth', message: 'dev secret' },
    ]).map(stripAnsi)
    assert.equal(lines.length, 3, 'header + 2 rows')
    assert.match(lines[0]!, /▲ 2 notices/)
    assert.match(lines[1]!, /→ ai .*google skipped/)
    assert.match(lines[2]!, /→ auth .*dev secret/)
    // scope column is padded to the widest scope ('auth'), so the message
    // columns line up across rows.
    assert.equal(
      lines[1]!.indexOf('google skipped'),
      lines[2]!.indexOf('dev secret'),
      'messages start at the same column (scope-aligned)',
    )
  })

  it('uses a singular header for a single notice', () => {
    const lines = formatBootNotices([{ scope: 'ai', message: 'x' }]).map(stripAnsi)
    assert.match(lines[0]!, /▲ 1 notice\b/)
  })
})
