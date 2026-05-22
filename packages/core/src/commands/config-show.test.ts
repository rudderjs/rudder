import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { ConfigRepository, setConfigRepository } from '@rudderjs/support'
import { registerConfigShowCommand } from './config-show.js'

interface Handler {
  (args: string[]): void | Promise<void>
}

class FakeRudder {
  handler: Handler | null = null
  command(_name: string, handler: Handler): { description(text: string): unknown } {
    this.handler = handler
    return { description: () => undefined }
  }
}

const realLog = console.log
const realErr = console.error
let captured: string[] = []
let capturedErr: string[] = []
let exitCode: number | string | undefined

beforeEach(() => {
  captured = []
  capturedErr = []
  exitCode = undefined
  console.log = (...args: unknown[]) => { captured.push(args.map(String).join(' ')) }
  console.error = (...args: unknown[]) => { capturedErr.push(args.map(String).join(' ')) }
})

afterEach(() => {
  console.log = realLog
  console.error = realErr
  process.exitCode = 0
})

function loadConfig(data: Record<string, unknown>): void {
  setConfigRepository(new ConfigRepository(data))
}

async function runCommand(args: string[] = []): Promise<void> {
  const fake = new FakeRudder()
  registerConfigShowCommand(fake)
  assert.ok(fake.handler, 'handler should be registered')
  await fake.handler(args)
  exitCode = process.exitCode
}

function joined(): string {
  return captured.join('\n')
}

function joinedErr(): string {
  return capturedErr.join('\n')
}

describe('config:show command', () => {
  it('summary view lists section names and per-section key counts', async () => {
    loadConfig({
      app:      { name: 'TestApp', env: 'production' },
      cache:    { default: 'redis', stores: { redis: { driver: 'redis' } } },
      database: { default: 'sqlite' },
    })

    await runCommand([])

    const out = joined()
    assert.match(out, /SECTION/)
    assert.match(out, /app/)
    assert.match(out, /cache/)
    assert.match(out, /database/)
    assert.match(out, /3 sections/)
  })

  it('prints the section tree when given a positional section arg', async () => {
    loadConfig({
      cache: { default: 'redis', prefix: 'rudderjs_cache_' },
    })

    await runCommand(['cache'])

    const out = joined()
    // ANSI bold codes wrap section labels, so match the bare tokens.
    assert.match(out, /cache/)
    assert.match(out, /default/)
    assert.match(out, /redis/)
    assert.match(out, /prefix/)
    assert.match(out, /rudderjs_cache_/)
  })

  it('resolves dotted keys to a leaf value', async () => {
    loadConfig({
      cache: { stores: { redis: { driver: 'redis', url: 'redis://localhost' } } },
    })

    await runCommand(['cache.stores.redis.driver'])

    assert.match(joined(), /redis/)
  })

  it('exits 1 and reports an error when the key does not exist', async () => {
    loadConfig({ app: { name: 'X' } })

    await runCommand(['nope.totally.missing'])

    assert.match(joinedErr(), /Key not found/)
    assert.strictEqual(exitCode, 1)
  })

  it('redacts leaf values whose key name matches the sensitive pattern', async () => {
    loadConfig({
      app:   { name: 'TestApp', signingKey: 'secret-value-here' },
      auth:  { providers: { github: { clientId: 'abc', clientSecret: 'should-be-hidden' } } },
      cache: { url: 'redis://x' }, // 'url' is NOT sensitive — passes through
    })

    await runCommand(['--json'])

    const parsed = JSON.parse(captured[0]!) as Record<string, Record<string, unknown>>
    assert.strictEqual(parsed.app!.signingKey, '***')
    const githubProvider = (
      parsed.auth!.providers as Record<string, Record<string, unknown>>
    ).github
    assert.ok(githubProvider, 'github provider should be present')
    assert.strictEqual(githubProvider.clientSecret, '***')
    // Non-sensitive values pass through
    assert.strictEqual((parsed.app as Record<string, unknown>).name, 'TestApp')
    assert.strictEqual((parsed.cache as Record<string, unknown>).url, 'redis://x')
  })

  it('--raw disables redaction and emits a stderr warning', async () => {
    loadConfig({ app: { signingKey: 'secret-value-here' } })

    await runCommand(['--raw', '--json'])

    const parsed = JSON.parse(captured[0]!) as Record<string, Record<string, unknown>>
    assert.strictEqual(parsed.app!.signingKey, 'secret-value-here')
    assert.match(joinedErr(), /redaction disabled/)
  })

  it('--json round-trips the structure (redacted by default)', async () => {
    loadConfig({
      app: { name: 'TestApp', env: 'test' },
    })

    await runCommand(['app', '--json'])

    const parsed = JSON.parse(captured[0]!) as { name: string; env: string }
    assert.deepStrictEqual(parsed, { name: 'TestApp', env: 'test' })
  })

  it('errors clearly when no config repository is registered', async () => {
    setConfigRepository(null as unknown as ConfigRepository)
    // Clear the globalThis fallback too
    delete (globalThis as Record<string, unknown>)['__rudderjs_config__']

    await runCommand([])

    assert.match(joinedErr(), /No config repository/)
    assert.strictEqual(exitCode, 1)
  })
})
