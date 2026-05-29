import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { _internal } from './test.js'

const { findTsx, buildTestArgs } = _internal

// ── buildTestArgs ─────────────────────────────────────────────

describe('test — buildTestArgs', () => {
  it('no positional, no flags → discovers under tests/', () => {
    assert.deepEqual(buildTestArgs(undefined, {}), ['--test', 'tests'])
  })

  it('treats a .ts positional as a file path', () => {
    assert.deepEqual(
      buildTestArgs('tests/User.test.ts', {}),
      ['--test', 'tests/User.test.ts'],
    )
  })

  it('treats a non-.ts positional as a test-name-pattern, keeps tests/ discovery', () => {
    assert.deepEqual(
      buildTestArgs('User', {}),
      ['--test', '--test-name-pattern=User', 'tests'],
    )
  })

  it('honors --watch / --bail / --coverage / --only', () => {
    const out = buildTestArgs(undefined, { watch: true, bail: true, coverage: true, only: true })
    assert.ok(out.includes('--watch'))
    assert.ok(out.includes('--experimental-test-coverage'))
    assert.ok(out.includes('--test-only'))
    assert.ok(out.includes('--test-force-exit'))
  })

  it('--filter overrides a non-.ts positional when both are passed', () => {
    const out = buildTestArgs('IgnoreMe', { filter: 'RealPattern' })
    assert.ok(out.includes('--test-name-pattern=RealPattern'))
    assert.ok(!out.includes('--test-name-pattern=IgnoreMe'))
  })

  it('--filter alongside a .ts positional keeps both (file + pattern)', () => {
    const out = buildTestArgs('tests/User.test.ts', { filter: 'creates' })
    assert.ok(out.includes('tests/User.test.ts'))
    assert.ok(out.includes('--test-name-pattern=creates'))
  })

  it('passes --reporter through verbatim', () => {
    const out = buildTestArgs(undefined, { reporter: 'spec' })
    assert.ok(out.includes('--test-reporter=spec'))
  })

  it('places the path arg LAST (Node positional convention)', () => {
    const out = buildTestArgs(undefined, { coverage: true, only: true })
    assert.equal(out[out.length - 1], 'tests')
  })
})

// ── findTsx ───────────────────────────────────────────────────

describe('test — findTsx', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rudder-test-cmd-'))
  })
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('finds tsx in cwd/node_modules/.bin', async () => {
    await fs.mkdir(path.join(tmp, 'node_modules', '.bin'), { recursive: true })
    const bin = path.join(tmp, 'node_modules', '.bin', 'tsx')
    await fs.writeFile(bin, '#!/bin/sh\n')
    assert.equal(findTsx(tmp), bin)
  })

  it('walks up the directory tree (monorepo hoist)', async () => {
    // Hoist tsx to the root, run from a nested package dir.
    await fs.mkdir(path.join(tmp, 'node_modules', '.bin'), { recursive: true })
    await fs.mkdir(path.join(tmp, 'apps', 'web'),         { recursive: true })
    const bin = path.join(tmp, 'node_modules', '.bin', 'tsx')
    await fs.writeFile(bin, '#!/bin/sh\n')
    assert.equal(findTsx(path.join(tmp, 'apps', 'web')), bin)
  })

  it('returns null when tsx is nowhere on the path', () => {
    assert.equal(findTsx(tmp), null)
  })
})
