import 'reflect-metadata'
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { McpServer, McpTool, McpResponse, Handle, McpTestClient } from '@gemstack/mcp'
import { rudderContainerResolver } from './resolver.js'
import { makePassportVerifier, _setPassportForTest, type PassportModule } from './auth/passport-verifier.js'

// ─── re-export smoke ─────────────────────────────────────

describe('@rudderjs/mcp binding re-exports the @gemstack/mcp core', () => {
  it('surfaces the authoring API through the binding entry', async () => {
    const mod = await import('./index.js')
    for (const name of ['McpServer', 'McpTool', 'McpResource', 'McpPrompt', 'McpResponse', 'Mcp', 'McpProvider', 'createResolver', 'oauth2McpMiddleware']) {
      assert.ok((mod as Record<string, unknown>)[name], `expected @rudderjs/mcp to export ${name}`)
    }
  })
})

// ─── rudderContainerResolver ─────────────────────────────

describe('rudderContainerResolver', () => {
  class Logger { tag = 'real' }
  const g = globalThis as Record<string, unknown>

  afterEach(() => { delete g['__rudderjs_app__']; delete g['__rudderjs_instance__'] })

  it('delegates to the Rudder container .make() when one is on globalThis', () => {
    const logger = new Logger()
    g['__rudderjs_app__'] = { make: (T: unknown) => (T === Logger ? logger : new (T as new () => unknown)()) }
    assert.equal(rudderContainerResolver().resolve(Logger), logger)
  })

  it('falls back to new Ctor() for a class token when no container is present', () => {
    const out = rudderContainerResolver().resolve(Logger)
    assert.ok(out instanceof Logger)
  })

  it('throws for a string/symbol token when no container is present', () => {
    assert.throws(() => rudderContainerResolver().resolve('Logger'), /no Rudder container/)
  })
})

// ─── end-to-end: container resolver + @Handle DI (the binding's reason to exist) ──

describe('rudderContainerResolver composes with @Handle through McpTestClient', () => {
  class Greeter { greet(name: string): string { return `Hi ${name}` } }
  class GreetTool extends McpTool {
    schema() { return z.object({ name: z.string() }) }
    @Handle(Greeter)
    async handle(input: Record<string, unknown>, greeter: Greeter) {
      return McpResponse.text(greeter.greet(String(input['name'])))
    }
  }
  class GreetServer extends McpServer { protected tools = [GreetTool] }

  const g = globalThis as Record<string, unknown>
  afterEach(() => { delete g['__rudderjs_app__'] })

  it('injects a container-resolved dependency into a @Handle tool (mirrors playground EchoTool)', async () => {
    const greeter = new Greeter()
    g['__rudderjs_app__'] = { make: (T: unknown) => (T === Greeter ? greeter : new (T as new () => unknown)()) }
    const client = new McpTestClient(GreetServer, { resolver: rudderContainerResolver() })
    const result = await client.callTool('greet', { name: 'Ada' })
    assert.equal((result.content[0] as { text: string }).text, 'Hi Ada')
  })
})

// ─── makePassportVerifier ────────────────────────────────

describe('makePassportVerifier', () => {
  function fakePassport(opts: { scopes?: string[]; revoked?: boolean; sub?: string } = {}): PassportModule {
    return {
      verifyToken: async () => ({ jti: 'tok-1', sub: opts.sub ?? 'user-1', ...(opts.scopes ? { scopes: opts.scopes } : {}) }),
      AccessToken: {
        query: () => ({ where: () => ({ first: async () => ({ id: 'tok-1', revoked: opts.revoked ?? false }) }) }),
      },
    }
  }

  let restore: (() => void) | null = null
  beforeEach(() => { if (restore) { restore(); restore = null } })
  afterEach(() => { if (restore) { restore(); restore = null } })

  it('returns claims (sub + scopes) for a valid, unrevoked token', async () => {
    restore = _setPassportForTest(fakePassport({ scopes: ['mcp.read'] }))
    const claims = await makePassportVerifier()('jwt')
    assert.deepEqual(claims, { sub: 'user-1', scopes: ['mcp.read'] })
  })

  it('throws "revoked" when the token is revoked', async () => {
    restore = _setPassportForTest(fakePassport({ revoked: true }))
    await assert.rejects(() => Promise.resolve(makePassportVerifier()('jwt')), /revoked/)
  })

  it('throws when passport is not installed', async () => {
    restore = _setPassportForTest(null)
    await assert.rejects(() => Promise.resolve(makePassportVerifier()('jwt')), /not configured/)
  })
})
