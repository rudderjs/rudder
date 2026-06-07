// --with-test end-to-end through the REAL command wiring (commander action),
// against a tmp project dir: the companion test file lands in tests/, shaped
// by the generator's testKind (feature for controllers, unit elsewhere), and
// an existing test is never clobbered without --force.
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { makeController } from './controller.js'
import { makeModel } from './model.js'
import { makeTest } from './test.js'

async function runMake(cwd: string, register: (p: Command) => void, argv: string[]): Promise<void> {
  const prevCwd = process.cwd()
  // Silence the generator's success/warning lines — raw writes during a test
  // pollute the runner's output stream (see the module:publish flake).
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

describe('make:* --with-test (real command wiring)', () => {
  let cwd: string

  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), 'rudder-with-test-')) })
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }) })

  it('make:controller --with-test writes a feature test pointing at the controller', async () => {
    await runMake(cwd, makeController, ['make:controller', 'User', '--with-test'])

    assert.ok(existsSync(join(cwd, 'app', 'Http', 'Controllers', 'UserController.ts')))
    const test = readFileSync(join(cwd, 'tests', 'UserController.test.ts'), 'utf8')
    assert.match(test, /AppTestCase\.create\(\)/)
    assert.match(test, /\/\/ Covers app\/Http\/Controllers\/UserController\.ts/)
    assert.match(test, /describe\('UserController',/)
  })

  it('make:model --with-test writes a unit test (no app boot)', async () => {
    await runMake(cwd, makeModel, ['make:model', 'Post', '--with-test'])

    assert.ok(existsSync(join(cwd, 'app', 'Models', 'Post.ts')))
    const test = readFileSync(join(cwd, 'tests', 'Post.test.ts'), 'utf8')
    assert.match(test, /import assert from 'node:assert\/strict'/)
    assert.match(test, /\/\/ Covers app\/Models\/Post\.ts/)
    assert.doesNotMatch(test, /AppTestCase/)
  })

  it('without --with-test no test file is written', async () => {
    await runMake(cwd, makeModel, ['make:model', 'Post'])

    assert.ok(existsSync(join(cwd, 'app', 'Models', 'Post.ts')))
    assert.ok(!existsSync(join(cwd, 'tests')))
  })

  it('an existing test survives --with-test without --force', async () => {
    mkdirSync(join(cwd, 'tests'), { recursive: true })
    writeFileSync(join(cwd, 'tests', 'Post.test.ts'), '// hand-written\n')

    await runMake(cwd, makeModel, ['make:model', 'Post', '--with-test'])

    // The model still lands; the hand-written test is untouched.
    assert.ok(existsSync(join(cwd, 'app', 'Models', 'Post.ts')))
    assert.equal(readFileSync(join(cwd, 'tests', 'Post.test.ts'), 'utf8'), '// hand-written\n')
  })

  it('--force overwrites an existing test', async () => {
    mkdirSync(join(cwd, 'tests'), { recursive: true })
    writeFileSync(join(cwd, 'tests', 'Post.test.ts'), '// hand-written\n')

    await runMake(cwd, makeModel, ['make:model', 'Post', '--with-test', '--force'])

    assert.match(readFileSync(join(cwd, 'tests', 'Post.test.ts'), 'utf8'), /describe\('Post',/)
  })

  it('make:test itself does not offer --with-test', () => {
    const program = new Command()
    makeTest(program)
    makeController(program)

    const flagsOf = (name: string) =>
      program.commands.find(c => c.name() === name)!.options.map(o => o.long)
    assert.ok(!flagsOf('make:test').includes('--with-test'))
    assert.ok(flagsOf('make:controller').includes('--with-test'))
  })
})
