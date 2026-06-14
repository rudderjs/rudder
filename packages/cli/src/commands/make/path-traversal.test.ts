// The make:* scaffolders must not write outside their target directory when
// given an untrusted name. Drives the real commander action against a tmp dir.
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Command } from 'commander'
import { makeModel } from './model.js'

async function runMake(cwd: string, register: (p: Command) => void, argv: string[]): Promise<void> {
  const prevCwd = process.cwd()
  const prevLog = console.log
  const prevError = console.error
  console.log = () => {}
  console.error = () => {}
  process.chdir(cwd)
  try {
    const program = new Command()
    program.exitOverride()
    register(program)
    await program.parseAsync(argv, { from: 'user' })
  } finally {
    process.chdir(prevCwd)
    console.log = prevLog
    console.error = prevError
  }
}

describe('make:* path-traversal guard', () => {
  let cwd: string

  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), 'rudder-make-trav-')) })
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }) })

  it('rejects a name that escapes the target directory', async () => {
    await runMake(cwd, makeModel, ['make:model', '../../../pwned'])
    assert.ok(!existsSync(resolve(cwd, '..', '..', '..', 'pwned.ts')), 'must not write outside the app root')
    assert.ok(!existsSync(join(cwd, 'app', 'Models', 'pwned.ts')))
  })

  it('still writes a normal model name', async () => {
    await runMake(cwd, makeModel, ['make:model', 'Post'])
    assert.ok(existsSync(join(cwd, 'app', 'Models', 'Post.ts')))
  })

  it('allows a nested name within the target directory', async () => {
    await runMake(cwd, makeModel, ['make:model', 'Admin/Audit'])
    assert.ok(existsSync(join(cwd, 'app', 'Models', 'Admin', 'Audit.ts')))
  })
})
