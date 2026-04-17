import 'reflect-metadata'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import {
  Mcp, McpServer, McpTool, McpResource, McpPrompt, McpResponse,
  Name, Version, Instructions, Description, Handle,
  McpTestClient,
} from './index.js'
import { toKebabCase } from './utils.js'
import { zodToJsonSchema } from './zod-to-json-schema.js'

// ─── toKebabCase ──────────────────────────────────────────

describe('toKebabCase', () => {
  it('converts PascalCase to kebab-case', () => {
    assert.equal(toKebabCase('MyToolName'), 'my-tool-name')
  })

  it('converts camelCase to kebab-case', () => {
    assert.equal(toKebabCase('searchUsers'), 'search-users')
  })

  it('converts spaces and underscores', () => {
    assert.equal(toKebabCase('hello_world test'), 'hello-world-test')
  })

  it('handles single word', () => {
    assert.equal(toKebabCase('Hello'), 'hello')
  })
})

// ─── zodToJsonSchema ──────────────────────────────────────

describe('zodToJsonSchema', () => {
  it('converts string fields', () => {
    const schema = z.object({ name: z.string() })
    const result = zodToJsonSchema(schema)

    assert.deepStrictEqual(result, {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    })
  })

  it('converts number fields', () => {
    const schema = z.object({ count: z.number() })
    const result = zodToJsonSchema(schema)

    assert.deepStrictEqual(result.properties, { count: { type: 'number' } })
    assert.deepStrictEqual(result.required, ['count'])
  })

  it('converts boolean fields', () => {
    const schema = z.object({ active: z.boolean() })
    const result = zodToJsonSchema(schema)

    assert.deepStrictEqual(result.properties, { active: { type: 'boolean' } })
  })

  it('handles optional fields (not in required)', () => {
    const schema = z.object({ name: z.string(), bio: z.string().optional() })
    const result = zodToJsonSchema(schema)

    assert.deepStrictEqual(result.required, ['name'])
    assert.ok('bio' in (result.properties as Record<string, unknown>))
  })

  it('handles default fields (not in required)', () => {
    const schema = z.object({ limit: z.number().default(10) })
    const result = zodToJsonSchema(schema)

    assert.ok(!('required' in result) || (result.required as string[]).length === 0)
  })

  it('handles enum fields', () => {
    const schema = z.object({ role: z.enum(['admin', 'user']) })
    const result = zodToJsonSchema(schema)

    const prop = (result.properties as Record<string, Record<string, unknown>>)['role']
    assert.equal(prop!['type'], 'string')
    assert.deepStrictEqual(prop!['enum'], ['admin', 'user'])
  })

  it('handles array fields', () => {
    const schema = z.object({ tags: z.array(z.string()) })
    const result = zodToJsonSchema(schema)

    const prop = (result.properties as Record<string, Record<string, unknown>>)['tags']
    assert.equal(prop!['type'], 'array')
    assert.deepStrictEqual(prop!['items'], { type: 'string' })
  })

  it('handles description on fields', () => {
    const schema = z.object({ query: z.string().describe('Search query') })
    const result = zodToJsonSchema(schema)

    const prop = (result.properties as Record<string, Record<string, unknown>>)['query']
    assert.equal(prop!['description'], 'Search query')
  })

  // Zod v4 moved `.describe()` storage off `_def.description` and onto the schema
  // instance. The converter has to fall back to `schema.description` when v4 is
  // in use. Simulate by building the v4-shaped schema object directly — this
  // passes regardless of which Zod version the workspace installs.
  it('reads description from instance (Zod v4 shape)', () => {
    const fakeV4Field = {
      _def: { type: 'string' },
      description: 'The name to greet',
    }
    const fakeSchema = {
      shape: { name: fakeV4Field },
    } as unknown as z.ZodObject<z.ZodRawShape>
    const result = zodToJsonSchema(fakeSchema)
    const prop = (result.properties as Record<string, Record<string, unknown>>)['name']
    assert.equal(prop!['type'], 'string')
    assert.equal(prop!['description'], 'The name to greet')
  })

  it('handles v4-shape arrays (element field, not type)', () => {
    const fakeV4Array = {
      _def: { type: 'array', element: { _def: { type: 'string' } } },
    }
    const fakeSchema = {
      shape: { tags: fakeV4Array },
    } as unknown as z.ZodObject<z.ZodRawShape>
    const result = zodToJsonSchema(fakeSchema)
    const prop = (result.properties as Record<string, Record<string, unknown>>)['tags']
    assert.equal(prop!['type'], 'array')
    assert.deepStrictEqual(prop!['items'], { type: 'string' })
  })

  it('handles v4-shape enums (entries record)', () => {
    const fakeV4Enum = {
      _def: { type: 'enum', entries: { admin: 'admin', user: 'user' } },
    }
    const fakeSchema = {
      shape: { role: fakeV4Enum },
    } as unknown as z.ZodObject<z.ZodRawShape>
    const result = zodToJsonSchema(fakeSchema)
    const prop = (result.properties as Record<string, Record<string, unknown>>)['role']
    assert.equal(prop!['type'], 'string')
    assert.deepStrictEqual(prop!['enum'], ['admin', 'user'])
  })
})

// ─── McpResponse ──────────────────────────────────────────

describe('McpResponse', () => {
  it('text() returns text content', () => {
    const result = McpResponse.text('hello')
    assert.deepStrictEqual(result, {
      content: [{ type: 'text', text: 'hello' }],
    })
  })

  it('json() returns formatted JSON', () => {
    const result = McpResponse.json({ key: 'value' })
    assert.equal(result.content[0]!.type, 'text')
    assert.ok((result.content[0] as { text: string }).text.includes('"key"'))
  })

  it('error() returns error content', () => {
    const result = McpResponse.error('something broke')
    assert.equal(result.isError, true)
    assert.ok((result.content[0] as { text: string }).text.includes('Error:'))
  })
})

// ─── Decorators ───────────────────────────────────────────

describe('Decorators', () => {
  it('@Name sets server name', () => {
    @Name('my-server')
    @Version('2.0.0')
    class TestServer extends McpServer {}

    const server = new TestServer()
    const meta = server.metadata()
    assert.equal(meta.name, 'my-server')
    assert.equal(meta.version, '2.0.0')
  })

  it('@Instructions sets server instructions', () => {
    @Instructions('Be helpful')
    class TestServer extends McpServer {}

    const server = new TestServer()
    const meta = server.metadata()
    assert.equal(meta.instructions, 'Be helpful')
  })

  it('defaults to class name and 1.0.0 without decorators', () => {
    class PlainServer extends McpServer {}

    const server = new PlainServer()
    const meta = server.metadata()
    assert.equal(meta.name, 'PlainServer')
    assert.equal(meta.version, '1.0.0')
  })

  it('@Description sets tool/prompt/resource description', () => {
    @Description('Does something useful')
    class TestTool extends McpTool {
      schema() { return z.object({}) }
      async handle() { return McpResponse.text('done') }
    }

    const tool = new TestTool()
    assert.equal(tool.description(), 'Does something useful')
  })
})

// ─── McpTool ──────────────────────────────────────────────

describe('McpTool', () => {
  it('derives name from class name in kebab-case, removing Tool suffix', () => {
    class SearchUsersTool extends McpTool {
      schema() { return z.object({ query: z.string() }) }
      async handle() { return McpResponse.text('found') }
    }

    const tool = new SearchUsersTool()
    assert.equal(tool.name(), 'search-users')
  })

  it('description() returns empty string without @Description', () => {
    class PlainTool extends McpTool {
      schema() { return z.object({}) }
      async handle() { return McpResponse.text('ok') }
    }

    assert.equal(new PlainTool().description(), '')
  })
})

// ─── McpPrompt ────────────────────────────────────────────

describe('McpPrompt', () => {
  it('derives name from class name, removing Prompt suffix', () => {
    class CodeReviewPrompt extends McpPrompt {
      async handle() { return [{ role: 'user' as const, content: 'Review this' }] }
    }

    assert.equal(new CodeReviewPrompt().name(), 'code-review')
  })
})

// ─── McpResource ──────────────────────────────────────────

describe('McpResource', () => {
  it('defaults mimeType to text/plain', () => {
    class TestResource extends McpResource {
      uri() { return 'file:///test.txt' }
      async handle() { return 'content' }
    }

    assert.equal(new TestResource().mimeType(), 'text/plain')
  })
})

// ─── Mcp Registry ─────────────────────────────────────────

describe('Mcp', () => {
  beforeEach(() => {
    // Clear registries between tests
    Mcp.getWebServers().clear()
    Mcp.getLocalServers().clear()
  })

  it('registers and retrieves web servers', () => {
    class TestServer extends McpServer {}
    Mcp.web('/mcp', TestServer)

    const servers = Mcp.getWebServers()
    assert.equal(servers.size, 1)
    assert.ok(servers.has('/mcp'))
  })

  it('registers and retrieves local servers', () => {
    class TestServer extends McpServer {}
    Mcp.local('test', TestServer)

    const servers = Mcp.getLocalServers()
    assert.equal(servers.size, 1)
    assert.ok(servers.has('test'))
  })

  it('web servers include middleware', () => {
    class TestServer extends McpServer {}
    const middleware = [() => {}]
    Mcp.web('/mcp', TestServer, middleware)

    const entry = Mcp.getWebServers().get('/mcp')
    assert.ok(entry)
    assert.equal(entry.middleware.length, 1)
  })

  it('.oauth2() stores options on the entry', () => {
    class TestServer extends McpServer {}
    Mcp.web('/mcp', TestServer).oauth2({ scopes: ['mcp.read'] })

    const entry = Mcp.getWebServers().get('/mcp')
    assert.ok(entry)
    assert.ok(entry.oauth2)
    assert.deepStrictEqual(entry.oauth2.scopes, ['mcp.read'])
  })

  it('.oauth2() defaults to empty options when called without args', () => {
    class TestServer extends McpServer {}
    Mcp.web('/mcp', TestServer).oauth2()

    const entry = Mcp.getWebServers().get('/mcp')
    assert.ok(entry?.oauth2)
    assert.deepStrictEqual(entry.oauth2, {})
  })
})

// ─── oauth2McpMiddleware ──────────────────────────────────

describe('oauth2McpMiddleware', () => {
  function mockRes() {
    const calls: { status?: number; body?: unknown; headers: Record<string, string> } = { headers: {} }
    const res = {
      status(code: number) { calls.status = code; return res },
      header(key: string, value: string) { calls.headers[key.toLowerCase()] = value; return res },
      json(data: unknown) { calls.body = data },
      raw: {},
    }
    return { res, calls }
  }

  function mockReq(authHeader?: string) {
    return {
      headers: { ...(authHeader ? { authorization: authHeader } : {}), host: 'app.test' },
      raw: {},
    }
  }

  it('returns 401 with WWW-Authenticate when no bearer token', async () => {
    const { oauth2McpMiddleware } = await import('./auth/oauth2.js')
    const mw = oauth2McpMiddleware('/mcp/secure')
    const { res, calls } = mockRes()
    let nextCalled = false
    await mw(mockReq() as never, res as never, async () => { nextCalled = true })

    assert.equal(calls.status, 401)
    assert.ok(calls.headers['www-authenticate']?.includes('Bearer'))
    assert.ok(calls.headers['www-authenticate']?.includes('resource_metadata='))
    assert.ok(calls.headers['www-authenticate']?.includes('/.well-known/oauth-protected-resource/mcp/secure'))
    assert.equal(nextCalled, false)
  })

  it('returns 401 when passport is not installed', async () => {
    const { oauth2McpMiddleware } = await import('./auth/oauth2.js')
    const mw = oauth2McpMiddleware('/mcp/secure')
    const { res, calls } = mockRes()
    await mw(mockReq('Bearer does-not-matter') as never, res as never, async () => {})

    // @rudderjs/passport isn't installed in this test environment — expect 401
    assert.equal(calls.status, 401)
    assert.ok(calls.headers['www-authenticate'])
  })
})

// ─── McpTestClient ────────────────────────────────────────

describe('McpTestClient', () => {
  class EchoTool extends McpTool {
    schema() { return z.object({ message: z.string() }) }
    async handle(input: Record<string, unknown>) {
      return McpResponse.text(String(input['message']))
    }
  }

  class InfoResource extends McpResource {
    uri() { return 'info://version' }
    async handle() { return '1.0.0' }
  }

  class GreetPrompt extends McpPrompt {
    async handle(args: Record<string, unknown>) {
      return [{ role: 'user' as const, content: `Hello ${String(args['name'])}` }]
    }
  }

  class TestServer extends McpServer {
    protected tools = [EchoTool]
    protected resources = [InfoResource]
    protected prompts = [GreetPrompt]
  }

  it('lists tools', async () => {
    const client = new McpTestClient(TestServer)
    const tools = await client.listTools()
    assert.equal(tools.length, 1)
    assert.equal(tools[0]!.name, 'echo')
  })

  it('calls a tool', async () => {
    const client = new McpTestClient(TestServer)
    const result = await client.callTool('echo', { message: 'hi' })
    assert.equal(result.content[0]!.type, 'text')
    assert.equal((result.content[0] as { text: string }).text, 'hi')
  })

  it('throws on unknown tool', async () => {
    const client = new McpTestClient(TestServer)
    await assert.rejects(
      () => client.callTool('nonexistent'),
      { message: /not found/ },
    )
  })

  it('lists and reads resources', async () => {
    const client = new McpTestClient(TestServer)
    const resources = await client.listResources()
    assert.equal(resources.length, 1)
    assert.equal(resources[0]!.uri, 'info://version')

    const content = await client.readResource('info://version')
    assert.equal(content, '1.0.0')
  })

  it('throws on unknown resource', async () => {
    const client = new McpTestClient(TestServer)
    await assert.rejects(
      () => client.readResource('info://unknown'),
      { message: /not found/ },
    )
  })

  it('lists and gets prompts', async () => {
    const client = new McpTestClient(TestServer)
    const prompts = await client.listPrompts()
    assert.equal(prompts.length, 1)
    assert.equal(prompts[0]!.name, 'greet')

    const messages = await client.getPrompt('greet', { name: 'World' })
    assert.equal(messages.length, 1)
    assert.equal(messages[0]!.content, 'Hello World')
  })

  it('assertion helpers work', () => {
    const client = new McpTestClient(TestServer)
    client.assertToolExists('echo')
    client.assertToolCount(1)
    client.assertResourceExists('info://version')
    client.assertResourceCount(1)
    client.assertPromptExists('greet')
    client.assertPromptCount(1)
  })

  it('assertion helpers throw on mismatch', () => {
    const client = new McpTestClient(TestServer)
    assert.throws(() => client.assertToolExists('missing'), /not found/)
    assert.throws(() => client.assertToolCount(99), /Expected 99/)
    assert.throws(() => client.assertResourceExists('missing://x'), /not found/)
    assert.throws(() => client.assertPromptExists('missing'), /not found/)
  })
})

// ─── @Handle DI injection ─────────────────────────────────

describe('@Handle DI injection', () => {
  class Logger {
    entries: string[] = []
    info(msg: string) { this.entries.push(msg) }
  }

  const logger = new Logger()

  beforeEach(() => {
    logger.entries.length = 0
    ;(globalThis as Record<string, unknown>)['__rudderjs_instance__'] = {
      make: <T>(Ctor: new (...args: unknown[]) => T): T => {
        if (Ctor === (Logger as unknown)) return logger as unknown as T
        return new Ctor()
      },
    }
  })

  it('resolves extra method params from the container', async () => {
    class LogTool extends McpTool {
      schema() { return z.object({ message: z.string() }) }
      @Handle(Logger)
      async handle(input: Record<string, unknown>, log: Logger) {
        log.info(String(input['message']))
        return McpResponse.text('logged')
      }
    }
    class LogServer extends McpServer { protected tools = [LogTool] }

    const client = new McpTestClient(LogServer)
    const result = await client.callTool('log', { message: 'hi' })
    assert.equal((result.content[0] as { text: string }).text, 'logged')
    assert.deepStrictEqual(logger.entries, ['hi'])
  })

  it('supports implicit token resolution via design:paramtypes (plain tsc)', async () => {
    class PingTool extends McpTool {
      schema() { return z.object({}) }
      @Handle()
      async handle(_input: Record<string, unknown>, log: Logger) {
        log.info('ping')
        return McpResponse.text('pong')
      }
    }
    class PingServer extends McpServer { protected tools = [PingTool] }

    const client = new McpTestClient(PingServer)
    const result = await client.callTool('ping', {})
    assert.equal((result.content[0] as { text: string }).text, 'pong')
    assert.deepStrictEqual(logger.entries, ['ping'])
  })

  it('still calls handle(input) when the method is not decorated', async () => {
    class PlainTool extends McpTool {
      schema() { return z.object({ n: z.number() }) }
      async handle(input: Record<string, unknown>) {
        return McpResponse.text(`got ${input['n']}`)
      }
    }
    class PlainServer extends McpServer { protected tools = [PlainTool] }

    const client = new McpTestClient(PlainServer)
    const result = await client.callTool('plain', { n: 7 })
    assert.equal((result.content[0] as { text: string }).text, 'got 7')
  })
})
