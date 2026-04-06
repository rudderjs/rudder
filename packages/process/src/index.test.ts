import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { Process, PendingProcess, FakeProcess, ProcessFailedException } from './index.js'

// ─── Process.run() ────────────────────────────────────────

describe('Process.run()', () => {
  it('runs a command and returns stdout', async () => {
    const result = await Process.run('echo hello')
    assert.ok(result.successful())
    assert.strictEqual(result.stdout.trim(), 'hello')
    assert.strictEqual(result.exitCode, 0)
  })

  it('captures stderr on failure', async () => {
    const result = await Process.run('echo err >&2 && exit 1')
    assert.ok(result.failed())
    assert.strictEqual(result.exitCode, 1)
    assert.ok(result.errorOutput().includes('err'))
  })

  it('output() is an alias for stdout', async () => {
    const result = await Process.run('echo test')
    assert.strictEqual(result.output(), result.stdout)
  })
})

// ─── ProcessResult.throw() ────────────────────────────────

describe('ProcessResult.throw()', () => {
  it('throws ProcessFailedException on failure', async () => {
    const result = await Process.run('exit 42')
    assert.throws(() => result.throw(), ProcessFailedException)
  })

  it('returns this on success', async () => {
    const result = await Process.run('echo ok')
    assert.strictEqual(result.throw(), result)
  })
})

// ─── PendingProcess builder ───────────────────────────────

describe('PendingProcess', () => {
  it('supports env vars', async () => {
    const result = await Process.command('echo $MY_VAR')
      .env({ MY_VAR: 'hello-env' })
      .run()
    assert.strictEqual(result.stdout.trim(), 'hello-env')
  })

  it('supports working directory', async () => {
    const result = await Process.command('pwd')
      .path('/tmp')
      .run()
    // /tmp might resolve to /private/tmp on macOS
    assert.ok(result.stdout.trim().endsWith('/tmp'))
  })

  it('supports stdin input', async () => {
    const result = await Process.command('cat')
      .input('hello-stdin')
      .run()
    assert.strictEqual(result.stdout.trim(), 'hello-stdin')
  })

  it('supports timeout', async () => {
    const result = await Process.command('sleep 10')
      .timeout(0.1)
      .run()
    assert.ok(result.failed())
  })

  it('supports onOutput callback', async () => {
    const chunks: string[] = []
    const result = await Process.command('echo line1 && echo line2')
      .onOutput((_type, data) => chunks.push(data))
      .run()
    assert.ok(result.successful())
    assert.ok(chunks.length > 0)
  })
})

// ─── Process.start() ──────────────────────────────────────

describe('Process.start()', () => {
  it('starts a background process and waits for it', async () => {
    const running = await Process.start('echo background')
    const result = await running.wait()
    assert.ok(result.successful())
    assert.ok(result.stdout.includes('background'))
  })

  it('reports running state', async () => {
    const running = await Process.start('sleep 0.5')
    assert.ok(running.pid > 0)
    // Process should be running initially
    assert.ok(running.running())
    running.kill()
    await running.wait()
    assert.ok(!running.running())
  })
})

// ─── Process.pool() ───────────────────────────────────────

describe('Process.pool()', () => {
  it('runs multiple commands in parallel', async () => {
    const result = await Process.pool(['echo a', 'echo b', 'echo c'])
    assert.ok(result.successful())
    assert.strictEqual(result.results.length, 3)
    assert.strictEqual(result.results[0]!.stdout.trim(), 'a')
    assert.strictEqual(result.results[1]!.stdout.trim(), 'b')
    assert.strictEqual(result.results[2]!.stdout.trim(), 'c')
  })

  it('reports unsuccessful when one fails', async () => {
    const result = await Process.pool(['echo ok', 'exit 1'])
    assert.ok(!result.successful())
  })
})

// ─── Process.pipe() ───────────────────────────────────────

describe('Process.pipe()', () => {
  it('pipes stdout from one command to stdin of next', async () => {
    const result = await Process.pipe([
      'echo hello world',
      'tr a-z A-Z',
    ])
    assert.ok(result.successful())
    assert.strictEqual(result.stdout.trim(), 'HELLO WORLD')
  })

  it('stops on first failure', async () => {
    const result = await Process.pipe(['exit 1', 'echo never'])
    assert.ok(result.failed())
    assert.strictEqual(result.stdout, '')
  })

  it('handles empty array', async () => {
    const result = await Process.pipe([])
    assert.ok(result.successful())
  })
})

// ─── Process.fake() ───────────────────────────────────────

describe('Process.fake()', () => {
  afterEach(() => {
    // Restore real process execution
    try { Process.fake().restore() } catch { /* already restored */ }
  })

  it('intercepts run() with registered fakes', async () => {
    const fake = Process.fake({
      'git status': { stdout: 'clean', exitCode: 0 },
    })

    const result = await Process.run('git status')
    assert.strictEqual(result.stdout, 'clean')
    assert.ok(result.successful())
    fake.assertRan('git status')
    fake.restore()
  })

  it('returns success for unregistered commands', async () => {
    const fake = Process.fake()
    const result = await Process.run('unknown-cmd')
    assert.ok(result.successful())
    fake.assertRan('unknown-cmd')
    fake.restore()
  })

  it('supports regex patterns', async () => {
    const fake = Process.fake()
    fake.register(/git.*/, { stdout: 'faked', exitCode: 0 })

    const result = await Process.run('git log --oneline')
    assert.strictEqual(result.stdout, 'faked')
    fake.assertRan(/git/)
    fake.restore()
  })

  it('assertNotRan() works', async () => {
    const fake = Process.fake()
    await Process.run('echo hi')
    fake.assertNotRan('ls')
    fake.restore()
  })

  it('assertRanTimes() counts executions', async () => {
    const fake = Process.fake()
    await Process.run('echo a')
    await Process.run('echo a')
    await Process.run('echo b')
    fake.assertRanTimes('echo a', 2)
    fake.assertRanTimes('echo b', 1)
    fake.restore()
  })

  it('assertNothingRan() passes when nothing ran', () => {
    const fake = Process.fake()
    fake.assertNothingRan()
    fake.restore()
  })

  it('assertNothingRan() throws when something ran', async () => {
    const fake = Process.fake()
    await Process.run('echo x')
    assert.throws(() => fake.assertNothingRan(), /Expected no commands/)
    fake.restore()
  })
})
