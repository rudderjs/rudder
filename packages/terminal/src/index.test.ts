import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { executeMakeSpec } from '@rudderjs/console'
import { idToPath, resolveComponent } from './resolve.js'
import { makeTerminalSpec } from './commands/make-terminal.js'
import { guardTTY } from './terminal.js'

describe('idToPath()', () => {
  it('single segment — capitalises the id', () => {
    assert.equal(idToPath('dashboard'), 'app/Terminal/Dashboard')
  })

  it('dot notation — nested directory + capitalised filename', () => {
    assert.equal(idToPath('admin.users'), 'app/Terminal/Admin/Users')
  })

  it('three segments', () => {
    assert.equal(idToPath('admin.auth.login'), 'app/Terminal/Admin/Auth/Login')
  })

  it('already-capitalised id passes through unchanged', () => {
    assert.equal(idToPath('Dashboard'), 'app/Terminal/Dashboard')
  })
})

describe('guardTTY()', () => {
  it('throws when isTTY is false', () => {
    assert.throws(
      () => guardTTY(false),
      (e: unknown) => e instanceof Error && /TTY/.test((e as Error).message),
    )
  })

  it('throws when isTTY is undefined', () => {
    assert.throws(
      () => guardTTY(undefined),
      (e: unknown) => e instanceof Error && /TTY/.test((e as Error).message),
    )
  })

  it('does not throw when isTTY is true', () => {
    assert.doesNotThrow(() => guardTTY(true))
  })
})

describe('resolveComponent()', () => {
  // Each test creates fixture files under a /tmp app root and exercises
  // resolveComponent's `import()` call. Node can only natively import
  // `.js` / `.mjs` — `.tsx` / `.ts` extension precedence is covered by
  // resolve.ts's EXTENSIONS constant + its JSDoc; runtime verification
  // would require a TypeScript loader the test runner does not own.
  let appRoot: string
  let terminalDir: string

  before(() => {
    appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rudder-terminal-test-'))
    terminalDir = path.join(appRoot, 'app', 'Terminal')
    fs.mkdirSync(terminalDir, { recursive: true })
  })

  after(() => {
    fs.rmSync(appRoot, { recursive: true, force: true })
  })

  function writeFixture(relName: string, body: string): void {
    const abs = path.join(terminalDir, relName)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, body)
  }

  it('resolves a .js file by id', async () => {
    writeFixture('JsOnly.js',
      "export default function JsOnly() { return 'js' }\n",
    )
    const c = await resolveComponent('jsOnly', appRoot)
    assert.equal((c as () => unknown)(), 'js')
  })

  it('resolves a .mjs file by id', async () => {
    writeFixture('MjsOnly.mjs',
      "export default function MjsOnly() { return 'mjs' }\n",
    )
    const c = await resolveComponent('mjsOnly', appRoot)
    assert.equal((c as () => unknown)(), 'mjs')
  })

  it('prefers .js over .mjs when both exist', async () => {
    writeFixture('Both.js',
      "export default function Both() { return 'from-js' }\n",
    )
    writeFixture('Both.mjs',
      "export default function Both() { return 'from-mjs' }\n",
    )
    const c = await resolveComponent('both', appRoot)
    assert.equal((c as () => unknown)(), 'from-js')
  })

  it('throws a clear error when no file matches', async () => {
    await assert.rejects(
      () => resolveComponent('does.not.exist', appRoot),
      (e: Error) => /not found/.test(e.message) && /app\/Terminal\/Does\/Not\/Exist/.test(e.message),
    )
  })

  it('throws when the file exists but has no default export', async () => {
    writeFixture('Empty.js',
      "export const named = 1\n",
    )
    await assert.rejects(
      () => resolveComponent('empty', appRoot),
      /has no default export/,
    )
  })

  it('resolves nested dot-notation ids into nested directories', async () => {
    writeFixture(path.join('Admin', 'Users.js'),
      "export default function Users() { return 'nested' }\n",
    )
    const c = await resolveComponent('admin.users', appRoot)
    assert.equal((c as () => unknown)(), 'nested')
  })
})

describe('make:terminal spec', () => {
  it('writes a .tsx file (the stub is JSX — a .ts file would not compile)', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudder-make-terminal-'))
    const cwd = process.cwd()
    try {
      process.chdir(root)
      const res = await executeMakeSpec(makeTerminalSpec, 'Dashboard', {})
      assert.equal(res.relPath, 'app/Terminal/Dashboard.tsx')
      assert.ok(fs.existsSync(path.join(root, res.relPath)))
    } finally {
      process.chdir(cwd)
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('produces a file that terminal(\'id\') can resolve (no spurious suffix)', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudder-make-terminal-'))
    const cwd = process.cwd()
    try {
      process.chdir(root)
      const { className, relPath } = await executeMakeSpec(makeTerminalSpec, 'Dashboard', {})
      // No 'Terminal' suffix — otherwise the file would be DashboardTerminal.tsx
      // and `terminal('dashboard')` → app/Terminal/Dashboard could never find it.
      assert.equal(className, 'Dashboard')
      assert.equal(relPath, `${idToPath('dashboard')}.tsx`)
    } finally {
      process.chdir(cwd)
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
