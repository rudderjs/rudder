/**
 * `pnpm rudder ai:eval` CLI handler tests (#A5 Phase 2).
 *
 * Covers:
 *  - parseArgs: positional name filter + --bail / --json flags
 *  - discoverSuiteFiles: pattern parsing + recursive walk
 *  - runEvalCli: name-filter exclusion, --bail short-circuit, --json shape
 *
 * Real provider calls are stubbed via AiFake so suites complete in
 * milliseconds without API keys.
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { Agent } from './agent.js'
import { AiFake } from './fake.js'
import { evalSuite, exactMatch, type EvalSuite } from './eval/index.js'
import {
  parseArgs,
  discoverSuiteFiles,
  runEvalCli,
} from './commands/ai-eval.js'

class StubAgent extends Agent {
  instructions() { return 'stub' }
}

// ─── parseArgs ──────────────────────────────────────────────

describe('parseArgs', () => {
  it('parses --bail and --json flags', () => {
    const o = parseArgs(['--bail', '--json'])
    assert.equal(o.bail, true)
    assert.equal(o.json, true)
    assert.equal(o.filter, undefined)
  })

  it('treats the first positional as a name filter', () => {
    const o = parseArgs(['support', '--json'])
    assert.equal(o.filter, 'support')
    assert.equal(o.json, true)
    assert.equal(o.bail, false)
  })

  it('returns false flags when omitted', () => {
    const o = parseArgs([])
    assert.equal(o.bail, false)
    assert.equal(o.json, false)
  })
})

// ─── discoverSuiteFiles ─────────────────────────────────────

describe('discoverSuiteFiles', () => {
  let dir: string
  beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), 'ai-eval-disco-')) })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

  it('walks evals/**/*.eval.ts by default', async () => {
    await mkdir(path.join(dir, 'evals', 'agents'), { recursive: true })
    await writeFile(path.join(dir, 'evals', 'a.eval.ts'),         'export {}\n')
    await writeFile(path.join(dir, 'evals', 'agents', 'b.eval.ts'), 'export {}\n')
    await writeFile(path.join(dir, 'evals', 'helper.ts'),          'export {}\n')   // wrong suffix
    await writeFile(path.join(dir, 'unrelated.eval.ts'),           'export {}\n')   // outside root

    const files = await discoverSuiteFiles(dir, 'evals/**/*.eval.ts')
    const rels  = files.map(f => path.relative(dir, f))
    assert.deepEqual(rels, [
      path.join('evals', 'a.eval.ts'),
      path.join('evals', 'agents', 'b.eval.ts'),
    ])
  })

  it('skips node_modules and dotfile dirs', async () => {
    await mkdir(path.join(dir, 'evals', 'node_modules', 'pkg'), { recursive: true })
    await mkdir(path.join(dir, 'evals', '.cache'),               { recursive: true })
    await writeFile(path.join(dir, 'evals', 'a.eval.ts'),                                 'export {}\n')
    await writeFile(path.join(dir, 'evals', 'node_modules', 'pkg', 'fake.eval.ts'),       'export {}\n')
    await writeFile(path.join(dir, 'evals', '.cache', 'cached.eval.ts'),                  'export {}\n')

    const files = await discoverSuiteFiles(dir, 'evals/**/*.eval.ts')
    assert.equal(files.length, 1)
    assert.match(files[0]!, /a\.eval\.ts$/)
  })

  it('returns [] when the root dir does not exist', async () => {
    const files = await discoverSuiteFiles(dir, 'evals/**/*.eval.ts')
    assert.deepEqual(files, [])
  })

  it('honors a custom <dir>/**/*<suffix> pattern', async () => {
    await mkdir(path.join(dir, 'tests', 'agents'), { recursive: true })
    await writeFile(path.join(dir, 'tests', 'agents', 'one.spec.ts'), 'export {}\n')
    const files = await discoverSuiteFiles(dir, 'tests/**/*.spec.ts')
    assert.equal(files.length, 1)
  })

  it('throws on patterns that aren\'t <dir>/**/*<suffix>-shaped', async () => {
    await assert.rejects(
      () => discoverSuiteFiles(dir, 'evals/[abc]/file.ts'),
      /Unsupported eval pattern/,
    )
  })
})

// ─── runEvalCli ─────────────────────────────────────────────

interface CapturedStream {
  write(s: string): boolean
  read(): string
}
function capture(): CapturedStream {
  const chunks: string[] = []
  return {
    write(s: string): boolean { chunks.push(s); return true },
    read(): string { return chunks.join('') },
  }
}

function makePassingSuite(name: string): EvalSuite {
  return evalSuite(name, {
    agent: () => new StubAgent(),
    cases: [{ name: 'c1', input: 'hi', assert: exactMatch('hi') }],
  })
}

function makeFailingSuite(name: string): EvalSuite {
  return evalSuite(name, {
    agent: () => new StubAgent(),
    cases: [{ name: 'c1', input: 'hi', assert: exactMatch('not-hi') }],
  })
}

describe('runEvalCli', () => {
  let fake: AiFake
  beforeEach(() => { fake = AiFake.fake() })

  it('runs matching suites in console mode and returns 0 when all pass', async () => {
    fake.respondWith('hi')
    const stdout = capture()
    const stderr = capture()
    const code = await runEvalCli(
      { bail: false, json: false },
      {
        cwd:           '/virtual',
        stdout,
        stderr,
        configPattern: () => null,
        discover:      async () => ['/virtual/evals/a.eval.ts'],
        loadSuite:     async () => makePassingSuite('A'),
      },
    )
    assert.equal(code, 0)
    assert.match(stdout.read(), /1 passed, 0 failed/)
  })

  it('returns 1 and prints failure when a case fails', async () => {
    fake.respondWith('something else')
    const stdout = capture()
    const stderr = capture()
    const code = await runEvalCli(
      { bail: false, json: false },
      {
        cwd:           '/virtual',
        stdout,
        stderr,
        configPattern: () => null,
        discover:      async () => ['/virtual/evals/a.eval.ts'],
        loadSuite:     async () => makeFailingSuite('A'),
      },
    )
    assert.equal(code, 1)
    assert.match(stdout.read(), /0 passed, 1 failed/)
  })

  it('--bail stops on the first failing suite', async () => {
    fake.respondWith('wrong')

    const seen: string[] = []
    const code = await runEvalCli(
      { bail: true, json: false },
      {
        cwd:           '/virtual',
        stdout:        capture(),
        stderr:        capture(),
        configPattern: () => null,
        discover:      async () => ['/virtual/evals/a.eval.ts', '/virtual/evals/b.eval.ts'],
        loadSuite:     async (file: string) => {
          seen.push(path.basename(file))
          if (file.endsWith('a.eval.ts')) return makeFailingSuite('A')
          if (file.endsWith('b.eval.ts')) return makePassingSuite('B')
          return null
        },
      },
    )
    assert.equal(code, 1)
    assert.deepEqual(seen, ['a.eval.ts'])  // never reaches b.eval.ts
  })

  it('--json emits a {suites: [...]} envelope and skips console output', async () => {
    fake.respondWith('hi')
    const stdout = capture()
    const stderr = capture()
    const code = await runEvalCli(
      { bail: false, json: true },
      {
        cwd:           '/virtual',
        stdout,
        stderr,
        configPattern: () => null,
        discover:      async () => ['/virtual/evals/a.eval.ts'],
        loadSuite:     async () => makePassingSuite('A'),
      },
    )
    assert.equal(code, 0)
    const out = stdout.read()
    // Console reporter would print "passed, failed" lines — JSON mode must not.
    assert.doesNotMatch(out, /passed, .* failed/)
    const parsed = JSON.parse(out) as { suites: Array<{ suite: string; passed: number; failed: number; cases: unknown[] }> }
    assert.equal(parsed.suites.length, 1)
    assert.equal(parsed.suites[0]!.suite, 'A')
    assert.equal(parsed.suites[0]!.passed, 1)
    assert.equal(parsed.suites[0]!.failed, 0)
    assert.equal(parsed.suites[0]!.cases.length, 1)
  })

  it('positional filter excludes non-matching suite names (case-insensitive substring)', async () => {
    fake.respondWith('hi')
    const stdout = capture()
    const stderr = capture()
    const code = await runEvalCli(
      { filter: 'support', bail: false, json: true },
      {
        cwd:           '/virtual',
        stdout,
        stderr,
        configPattern: () => null,
        discover:      async () => ['/virtual/evals/a.eval.ts', '/virtual/evals/b.eval.ts'],
        loadSuite:     async (file: string) => {
          if (file.endsWith('a.eval.ts')) return makePassingSuite('SupportAgent')
          if (file.endsWith('b.eval.ts')) return makePassingSuite('BillingAgent')
          return null
        },
      },
    )
    assert.equal(code, 0)
    const parsed = JSON.parse(stdout.read()) as { suites: Array<{ suite: string }> }
    assert.deepEqual(parsed.suites.map(s => s.suite), ['SupportAgent'])
  })

  it('emits an empty envelope (exit 0) in --json mode when no suites match', async () => {
    const stdout = capture()
    const stderr = capture()
    const code = await runEvalCli(
      { bail: false, json: true },
      {
        cwd:           '/no-suites',
        stdout,
        stderr,
        configPattern: () => null,
        discover:      async () => [],
        loadSuite:     async () => null,
      },
    )
    assert.equal(code, 0)
    const parsed = JSON.parse(stdout.read()) as { suites: unknown[] }
    assert.deepEqual(parsed.suites, [])
    assert.match(stderr.read(), /no suites found/)
  })
})
