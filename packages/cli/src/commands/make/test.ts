import { existsSync } from 'node:fs'
import path from 'node:path'
import type { Command } from 'commander'
import chalk from 'chalk'
import { registerMake } from './_shared.js'

// ── Stubs ─────────────────────────────────────────────────────

/**
 * Feature test — boots the app via `AppTestCase` and exercises HTTP / DB /
 * services. The convention assumed here matches `docs/guide/testing.md`:
 * apps export `class AppTestCase extends TestCase` from `tests/TestCase.ts`.
 * The generated file uses Node's built-in `node:test` runner (the documented
 * runner — runs via `tsx --test tests/**\/*.test.ts`).
 */
export function featureStub(testName: string): string {
  return `import { describe, it, before, after } from 'node:test'
import { AppTestCase } from './TestCase.js'

describe('${testName}', () => {
  let t: AppTestCase

  before(async () => { t = await AppTestCase.create() })
  after (async () => { await t.teardown() })

  it('does something', async () => {
    const res = await t.get('/')
    res.assertOk()
  })
})
`
}

/**
 * Unit test — plain `node:test` + `assert`. No app boot, no TestCase,
 * no `@rudderjs/testing`. The right shape for pure functions, validators,
 * domain logic, or anything that shouldn't pay the boot cost.
 */
export function unitStub(testName: string): string {
  return `import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

describe('${testName}', () => {
  it('does something', () => {
    assert.equal(1 + 1, 2)
  })
})
`
}

// ── Helpers ───────────────────────────────────────────────────

/**
 * Trim a trailing `.test` so `make:test User` produces a `describe('User', …)`
 * label even though the file lives at `tests/User.test.ts`. The `.test`
 * suffix is forced into the filename via `MakeSpec.suffix` so the
 * generated file matches the documented `tests/**\/*.test.ts` glob.
 */
function stripTestSuffix(name: string): string {
  return name.endsWith('.test') ? name.slice(0, -'.test'.length) : name
}

function pickStub(className: string, opts: Record<string, unknown>): string {
  const testName = stripTestSuffix(className)
  return opts['unit'] ? unitStub(testName) : featureStub(testName)
}

// ── Command ───────────────────────────────────────────────────

export function makeTest(program: Command): void {
  registerMake(program, {
    command:     'make:test',
    description: 'Create a new test file (feature by default; --unit for plain node:test without app boot)',
    label:       'Test created',
    // `suffix: '.test'` produces `<name>.test.ts` so the file matches the
    // documented `tsx --test tests/**\/*.test.ts` glob. registerMake's
    // existing logic appends the suffix when not already present.
    suffix:      '.test',
    directory:   'tests',
    stub:        pickStub,
    extraOptions: [
      { flags: '-u, --unit', description: 'Generate a unit test (plain node:test, no app boot, no TestCase)' },
    ],
    afterCreate: async (_className, _relPath, opts) => {
      // Hint when feature-test convention isn't set up yet. Unit tests don't
      // need TestCase.ts — only the default (feature) flow does.
      if (opts['unit']) return
      const testCasePath = path.resolve(process.cwd(), 'tests', 'TestCase.ts')
      if (!existsSync(testCasePath)) {
        console.log(chalk.yellow('    ! tests/TestCase.ts is missing — see docs/guide/testing.md for the setup snippet.'))
      }
    },
  })
}

/** @internal — exposed for unit tests */
export const _internal = {
  featureStub,
  unitStub,
  stripTestSuffix,
  pickStub,
}
