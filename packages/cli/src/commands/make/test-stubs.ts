/**
 * Test-file stubs shared by `make:test` and the `--with-test` flag on the
 * other `make:*` generators. Kept import-free so `_shared.ts` (the generator
 * harness) and `test.ts` (the make:test command) can both use them without a
 * module cycle.
 */

/**
 * Feature test — boots the app via `AppTestCase` and exercises HTTP / DB /
 * services. The convention assumed here matches `docs/guide/testing.md`:
 * apps export `class AppTestCase extends TestCase` from `tests/TestCase.ts`.
 * The generated file uses Node's built-in `node:test` runner (the documented
 * runner — runs via `tsx --test tests/**\/*.test.ts`).
 *
 * @param sourceRel — when set (the `--with-test` flow), a `// Covers …`
 * comment points the test back at the file it was generated alongside.
 */
export function featureStub(testName: string, sourceRel?: string): string {
  return `import { describe, it, before, after } from 'node:test'
import { AppTestCase } from './TestCase.js'
${sourceRel ? `\n// Covers ${sourceRel}` : ''}
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
export function unitStub(testName: string, sourceRel?: string): string {
  return `import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
${sourceRel ? `\n// Covers ${sourceRel}` : ''}
describe('${testName}', () => {
  it('does something', () => {
    assert.equal(1 + 1, 2)
  })
})
`
}
