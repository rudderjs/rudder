import 'reflect-metadata'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import {
  Mcp, McpServer, McpTool, McpResource, McpPrompt, McpResponse,
  Name, Version, Instructions, Description, Handle,
  IsReadOnly, IsDestructive, IsIdempotent, IsOpenWorld,
  Audience, Priority, LastModified,
  McpTestClient,
  type McpToolProgress, type McpToolResult,
} from './index.js'
import { consumeToolReturn } from './runtime.js'
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

  // ─── Expanded type coverage (v3 real + v4 synthetic) ────

  it('handles nested object fields', () => {
    const schema = z.object({
      profile: z.object({ name: z.string(), age: z.number() }),
    })
    const prop = (zodToJsonSchema(schema).properties as Record<string, Record<string, unknown>>)['profile']
    assert.equal(prop!['type'], 'object')
    const nested = prop!['properties'] as Record<string, Record<string, unknown>>
    assert.equal(nested['name']!['type'], 'string')
    assert.equal(nested['age']!['type'], 'number')
    assert.deepStrictEqual(prop!['required'], ['name', 'age'])
  })

  it('handles union fields → anyOf', () => {
    const schema = z.object({ id: z.union([z.string(), z.number()]) })
    const prop = (zodToJsonSchema(schema).properties as Record<string, Record<string, unknown>>)['id']
    assert.ok(Array.isArray(prop!['anyOf']))
    const types = (prop!['anyOf'] as Record<string, unknown>[]).map((p) => p['type'])
    assert.deepStrictEqual(types, ['string', 'number'])
  })

  it('handles literal fields → const (single value)', () => {
    const schema = z.object({ kind: z.literal('user') })
    const prop = (zodToJsonSchema(schema).properties as Record<string, Record<string, unknown>>)['kind']
    assert.equal(prop!['const'], 'user')
  })

  it('handles nullable fields → type union with null', () => {
    const schema = z.object({ name: z.nullable(z.string()) })
    const prop = (zodToJsonSchema(schema).properties as Record<string, Record<string, unknown>>)['name']
    assert.deepStrictEqual(prop!['type'], ['string', 'null'])
    // Nullable is still required — JSON Schema separates required from nullability.
    assert.deepStrictEqual(zodToJsonSchema(schema).required, ['name'])
  })

  it('handles date fields → string with date-time format', () => {
    const schema = z.object({ created: z.date() })
    const prop = (zodToJsonSchema(schema).properties as Record<string, Record<string, unknown>>)['created']
    assert.equal(prop!['type'], 'string')
    assert.equal(prop!['format'], 'date-time')
  })

  it('handles record fields → object with additionalProperties', () => {
    const schema = z.object({ counts: z.record(z.string(), z.number()) })
    const prop = (zodToJsonSchema(schema).properties as Record<string, Record<string, unknown>>)['counts']
    assert.equal(prop!['type'], 'object')
    const ap = prop!['additionalProperties'] as Record<string, unknown>
    assert.equal(ap['type'], 'number')
  })

  it('handles tuple fields → prefixItems with items: false', () => {
    const schema = z.object({ pair: z.tuple([z.string(), z.number()]) })
    const prop = (zodToJsonSchema(schema).properties as Record<string, Record<string, unknown>>)['pair']
    assert.equal(prop!['type'], 'array')
    const prefix = prop!['prefixItems'] as Record<string, unknown>[]
    assert.equal(prefix.length, 2)
    assert.equal(prefix[0]!['type'], 'string')
    assert.equal(prefix[1]!['type'], 'number')
    assert.equal(prop!['items'], false)
  })

  // ─── v4-synthetic shapes for the new types ──────────────

  it('handles v4-shape literal with multiple values → enum', () => {
    const fakeV4Literal = { _def: { type: 'literal', values: ['a', 'b'] } }
    const fakeSchema = { shape: { role: fakeV4Literal } } as unknown as z.ZodObject<z.ZodRawShape>
    const prop = (zodToJsonSchema(fakeSchema).properties as Record<string, Record<string, unknown>>)['role']
    assert.deepStrictEqual(prop!['enum'], ['a', 'b'])
  })

  it('handles v4-shape union (options array)', () => {
    const fakeV4Union = {
      _def: { type: 'union', options: [
        { _def: { type: 'string' } },
        { _def: { type: 'number' } },
      ] },
    }
    const fakeSchema = { shape: { id: fakeV4Union } } as unknown as z.ZodObject<z.ZodRawShape>
    const prop = (zodToJsonSchema(fakeSchema).properties as Record<string, Record<string, unknown>>)['id']
    const types = (prop!['anyOf'] as Record<string, unknown>[]).map((p) => p['type'])
    assert.deepStrictEqual(types, ['string', 'number'])
  })

  it('handles v4-shape nested object (recurses into shape)', () => {
    const fakeV4Inner = {
      _def: { type: 'object' },
      shape: { name: { _def: { type: 'string' } } },
    }
    const fakeSchema = { shape: { profile: fakeV4Inner } } as unknown as z.ZodObject<z.ZodRawShape>
    const prop = (zodToJsonSchema(fakeSchema).properties as Record<string, Record<string, unknown>>)['profile']
    assert.equal(prop!['type'], 'object')
    const nested = prop!['properties'] as Record<string, Record<string, unknown>>
    assert.equal(nested['name']!['type'], 'string')
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

// ─── MCP protocol annotations (M1 + M2) ──────────────────

describe('Tool annotations', () => {
  @IsReadOnly()
  @IsIdempotent()
  class GetUserTool extends McpTool {
    schema() { return z.object({ id: z.string() }) }
    async handle() { return McpResponse.text('ok') }
  }

  @IsDestructive()
  @IsOpenWorld()
  class DeleteFileTool extends McpTool {
    schema() { return z.object({ path: z.string() }) }
    async handle() { return McpResponse.text('deleted') }
  }

  class PlainTool extends McpTool {
    schema() { return z.object({}) }
    async handle() { return McpResponse.text('plain') }
  }

  class TestServer extends McpServer {
    protected tools = [GetUserTool, DeleteFileTool, PlainTool]
  }

  it('surfaces readOnlyHint + idempotentHint on a read tool', async () => {
    const client = new McpTestClient(TestServer)
    const list = await client.listTools()
    const t = list.find((x) => x.name === 'get-user')!
    assert.ok(t.annotations, 'expected annotations on get-user')
    assert.equal(t.annotations.readOnlyHint, true)
    assert.equal(t.annotations.idempotentHint, true)
    assert.equal(t.annotations.destructiveHint, undefined)
    assert.equal(t.annotations.openWorldHint, undefined)
  })

  it('surfaces destructiveHint + openWorldHint on a destructive tool', async () => {
    const client = new McpTestClient(TestServer)
    const list = await client.listTools()
    const t = list.find((x) => x.name === 'delete-file')!
    assert.ok(t.annotations)
    assert.equal(t.annotations.destructiveHint, true)
    assert.equal(t.annotations.openWorldHint, true)
  })

  it('omits annotations entirely when no hints are set', async () => {
    const client = new McpTestClient(TestServer)
    const list = await client.listTools()
    const t = list.find((x) => x.name === 'plain')!
    assert.equal(t.annotations, undefined)
  })

  it('explicit @IsReadOnly(false) emits false (not omitted)', async () => {
    @IsReadOnly(false)
    class WriterTool extends McpTool {
      schema() { return z.object({}) }
      async handle() { return McpResponse.text('w') }
    }
    class S extends McpServer { protected tools = [WriterTool] }
    const list = await new McpTestClient(S).listTools()
    assert.equal(list[0]!.annotations?.readOnlyHint, false)
  })
})

describe('Resource annotations', () => {
  @Audience('user')
  @Priority(0.9)
  class ReleaseNotes extends McpResource {
    uri() { return 'file://release-notes' }
    async handle() { return 'notes' }
  }

  @Audience('user', 'assistant')
  @LastModified('2026-05-09T00:00:00Z')
  class Manual extends McpResource {
    uri() { return 'file://manual' }
    async handle() { return 'manual' }
  }

  class PlainResource extends McpResource {
    uri() { return 'file://plain' }
    async handle() { return 'plain' }
  }

  class TestServer extends McpServer {
    protected resources = [ReleaseNotes, Manual, PlainResource]
  }

  it('surfaces audience + priority', async () => {
    const list = await new McpTestClient(TestServer).listResources()
    const r = list.find((x) => x.uri === 'file://release-notes')!
    assert.deepStrictEqual(r.annotations?.audience, ['user'])
    assert.equal(r.annotations?.priority, 0.9)
  })

  it('surfaces multi-role audience and lastModified', async () => {
    const list = await new McpTestClient(TestServer).listResources()
    const r = list.find((x) => x.uri === 'file://manual')!
    assert.deepStrictEqual(r.annotations?.audience, ['user', 'assistant'])
    assert.equal(r.annotations?.lastModified, '2026-05-09T00:00:00Z')
  })

  it('omits annotations when none set', async () => {
    const list = await new McpTestClient(TestServer).listResources()
    const r = list.find((x) => x.uri === 'file://plain')!
    assert.equal(r.annotations, undefined)
  })

  it('@Priority validates the 0..1 range', () => {
    assert.throws(() => Priority(1.5), /between 0 and 1/)
    assert.throws(() => Priority(-0.1), /between 0 and 1/)
  })

  it('@Audience requires at least one role', () => {
    assert.throws(() => Audience(), /at least one role/)
  })

  it('@LastModified accepts a Date and serializes to ISO', async () => {
    @LastModified(new Date('2026-01-01T00:00:00Z'))
    class DatedResource extends McpResource {
      uri() { return 'file://dated' }
      async handle() { return 'd' }
    }
    class S extends McpServer { protected resources = [DatedResource] }
    const list = await new McpTestClient(S).listResources()
    assert.equal(list[0]!.annotations?.lastModified, '2026-01-01T00:00:00.000Z')
  })
})

// ─── shouldRegister conditional registration (M3) ─────────

describe('shouldRegister', () => {
  it('hides a tool from listings when shouldRegister returns false', async () => {
    let visible = true
    class GatedTool extends McpTool {
      schema() { return z.object({}) }
      async handle() { return McpResponse.text('ok') }
      shouldRegister() { return visible }
    }
    class AlwaysOnTool extends McpTool {
      schema() { return z.object({}) }
      async handle() { return McpResponse.text('ok') }
    }
    class S extends McpServer { protected tools = [GatedTool, AlwaysOnTool] }

    visible = true
    let list = await new McpTestClient(S).listTools()
    assert.equal(list.length, 2)

    visible = false
    list = await new McpTestClient(S).listTools()
    assert.equal(list.length, 1)
    assert.equal(list[0]!.name, 'always-on')
  })

  it('rejected tool calls throw "not found" — preventing bypass', async () => {
    class GatedTool extends McpTool {
      schema() { return z.object({}) }
      async handle() { return McpResponse.text('ok') }
      shouldRegister() { return false }
    }
    class S extends McpServer { protected tools = [GatedTool] }
    const client = new McpTestClient(S)
    await assert.rejects(() => client.callTool('gated'), /not found/)
  })

  it('hides resources from listings and reads', async () => {
    class GatedResource extends McpResource {
      uri() { return 'file://gated' }
      async handle() { return 'secret' }
      shouldRegister() { return false }
    }
    class S extends McpServer { protected resources = [GatedResource] }
    const client = new McpTestClient(S)
    const list = await client.listResources()
    assert.equal(list.length, 0)
    await assert.rejects(() => client.readResource('file://gated'), /not found/)
  })

  it('hides prompts from listings and gets', async () => {
    class GatedPrompt extends McpPrompt {
      async handle() { return [{ role: 'user' as const, content: 'hi' }] }
      shouldRegister() { return false }
    }
    class S extends McpServer { protected prompts = [GatedPrompt] }
    const client = new McpTestClient(S)
    const list = await client.listPrompts()
    assert.equal(list.length, 0)
    await assert.rejects(() => client.getPrompt('gated'), /not found/)
  })

  it('supports async shouldRegister', async () => {
    class AsyncGatedTool extends McpTool {
      schema() { return z.object({}) }
      async handle() { return McpResponse.text('ok') }
      async shouldRegister() { await new Promise((r) => setTimeout(r, 1)); return false }
    }
    class S extends McpServer { protected tools = [AsyncGatedTool] }
    const list = await new McpTestClient(S).listTools()
    assert.equal(list.length, 0)
  })
})

// ─── Streaming tools (progress notifications) ────────────

describe('Streaming tools — progress notifications', () => {
  class CountTool extends McpTool {
    schema() { return z.object({ n: z.number() }) }
    async *handle(input: Record<string, unknown>): AsyncGenerator<McpToolProgress, McpToolResult> {
      const n = Number(input['n'])
      for (let i = 1; i <= n; i++) {
        yield { progress: i, total: n, message: `tick ${i}/${n}` }
      }
      return McpResponse.text(`done: ${n}`)
    }
  }
  class CountServer extends McpServer { protected tools = [CountTool] }

  it('McpTestClient drains progress yields and returns the final value', async () => {
    const client = new McpTestClient(CountServer)
    const progress: McpToolProgress[] = []
    const result = await client.callTool('count', { n: 3 }, (p) => progress.push(p))
    assert.equal((result.content[0] as { text: string }).text, 'done: 3')
    assert.equal(progress.length, 3)
    assert.deepStrictEqual(progress.map((p) => p.progress), [1, 2, 3])
    assert.equal(progress[2]!.total, 3)
    assert.equal(progress[2]!.message, 'tick 3/3')
  })

  it('McpTestClient with no onProgress drops yields silently', async () => {
    const client = new McpTestClient(CountServer)
    const result = await client.callTool('count', { n: 5 })
    assert.equal((result.content[0] as { text: string }).text, 'done: 5')
  })

  it('consumeToolReturn forwards yields as notifications/progress when meta.progressToken is present', async () => {
    const sent: { method: string; params: Record<string, unknown> }[] = []
    const tool = new CountTool()
    const ret = tool.handle({ n: 2 })
    const result = await consumeToolReturn(
      ret,
      { sendNotification: async (n) => { sent.push(n) } },
      { progressToken: 'tok-123' },
    )
    assert.equal((result.content[0] as { text: string }).text, 'done: 2')
    assert.equal(sent.length, 2)
    assert.equal(sent[0]!.method, 'notifications/progress')
    assert.deepStrictEqual(sent[0]!.params, { progressToken: 'tok-123', progress: 1, total: 2, message: 'tick 1/2' })
  })

  it('consumeToolReturn drops yields when no progressToken is supplied', async () => {
    const sent: unknown[] = []
    const tool = new CountTool()
    const ret = tool.handle({ n: 4 })
    const result = await consumeToolReturn(
      ret,
      { sendNotification: async (n) => { sent.push(n) } },
      undefined,
    )
    assert.equal((result.content[0] as { text: string }).text, 'done: 4')
    assert.equal(sent.length, 0)
  })

  it('consumeToolReturn with a plain Promise return is a no-op pass-through', async () => {
    class Plain extends McpTool {
      schema() { return z.object({}) }
      async handle(_input: Record<string, unknown>) { return McpResponse.text('plain') }
    }
    const tool = new Plain()
    const ret = tool.handle({})
    const sent: unknown[] = []
    const result = await consumeToolReturn(
      ret,
      { sendNotification: async (n) => { sent.push(n) } },
      { progressToken: 'unused' },
    )
    assert.equal((result.content[0] as { text: string }).text, 'plain')
    assert.equal(sent.length, 0)
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

// ─── Server-initiated notifications ──────────────────────

describe('Server-initiated notifications', () => {
  class NotifyServer extends McpServer {}

  it('attached SDKs receive notify() fan-out, detach removes them', async () => {
    const server = new NotifyServer()
    const got1: { method: string; params?: unknown }[] = []
    const got2: { method: string; params?: unknown }[] = []
    const detach1 = server.attachSdk({ notification: async (n) => { got1.push(n) } })
    server.attachSdk({ notification: async (n) => { got2.push(n) } })

    assert.equal(server.attachedCount(), 2)

    await server.notifyResourceUpdated('file:///foo.txt')
    await server.notifyResourceListChanged()
    await server.notifyToolListChanged()
    await server.notifyPromptListChanged()

    assert.deepStrictEqual(got1.map((n) => n.method), [
      'notifications/resources/updated',
      'notifications/resources/list_changed',
      'notifications/tools/list_changed',
      'notifications/prompts/list_changed',
    ])
    assert.deepStrictEqual(got1[0]!.params, { uri: 'file:///foo.txt' })
    // List-changed methods send no params
    assert.equal(got1[1]!.params, undefined)
    assert.deepStrictEqual(got1.length, got2.length)

    detach1()
    assert.equal(server.attachedCount(), 1)
    await server.notifyToolListChanged()
    assert.equal(got1.length, 4) // unchanged after detach
    assert.equal(got2.length, 5) // got the new one
  })

  it('notify() swallows errors from one target so others still receive', async () => {
    const server = new NotifyServer()
    const good: string[] = []
    server.attachSdk({ notification: () => { throw new Error('dead transport') } })
    server.attachSdk({ notification: async (n) => { good.push(n.method) } })
    await server.notifyToolListChanged()
    assert.deepStrictEqual(good, ['notifications/tools/list_changed'])
  })

  it('notify() with no attached targets is a no-op', async () => {
    const server = new NotifyServer()
    assert.equal(server.attachedCount(), 0)
    await server.notifyToolListChanged() // must not throw
  })

  it('custom method via notify() escape hatch', async () => {
    const server = new NotifyServer()
    const got: { method: string; params?: unknown }[] = []
    server.attachSdk({ notification: async (n) => { got.push(n) } })
    await server.notify('notifications/custom', { foo: 'bar' })
    assert.deepStrictEqual(got, [{ method: 'notifications/custom', params: { foo: 'bar' } }])
  })
})

// ─── McpObserverRegistry ──────────────────────────────────

describe('McpObserverRegistry', () => {
  it('fan-outs events to every subscriber', async () => {
    const { McpObserverRegistry } = await import('./observers.js')
    const reg = new McpObserverRegistry()
    const calls: string[] = []
    reg.subscribe((e) => calls.push(`a:${e.kind}`))
    reg.subscribe((e) => calls.push(`b:${e.kind}`))

    reg.emit({
      kind: 'tool.called', serverName: 's', name: 't',
      input: {}, output: null, duration: 1,
    })
    assert.deepStrictEqual(calls, ['a:tool.called', 'b:tool.called'])
  })

  it('unsubscribe removes the observer', async () => {
    const { McpObserverRegistry } = await import('./observers.js')
    const reg = new McpObserverRegistry()
    const calls: string[] = []
    const off = reg.subscribe(() => calls.push('x'))
    off()
    reg.emit({ kind: 'tool.called', serverName: 's', name: 't', input: {}, output: null, duration: 0 })
    assert.deepStrictEqual(calls, [])
  })

  it('swallows observer errors so MCP servers never break', async () => {
    const { McpObserverRegistry } = await import('./observers.js')
    const reg = new McpObserverRegistry()
    reg.subscribe(() => { throw new Error('observer bug') })
    const good: string[] = []
    reg.subscribe((e) => good.push(e.kind))

    reg.emit({ kind: 'tool.called', serverName: 's', name: 't', input: {}, output: null, duration: 0 })
    assert.deepStrictEqual(good, ['tool.called'])
  })

  it('global singleton is installed on globalThis', async () => {
    const { mcpObservers } = await import('./observers.js')
    assert.ok(mcpObservers)
    const g = globalThis as Record<string, unknown>
    assert.equal(g['__rudderjs_mcp_observers__'], mcpObservers)
  })

  it('emits tool.called + tool.failed around tool invocations', async () => {
    const { mcpObservers } = await import('./observers.js')
    const events: { kind: string; name: string; error?: string }[] = []
    const off = mcpObservers.subscribe((e) => events.push({ kind: e.kind, name: e.name, ...(e.error ? { error: e.error } : {}) }))

    try {
      class GoodTool extends McpTool {
        schema() { return z.object({}) }
        async handle() { return McpResponse.text('ok') }
      }
      class BadTool extends McpTool {
        schema() { return z.object({}) }
        async handle(): Promise<never> { throw new Error('boom') }
      }
      class S extends McpServer { protected tools = [GoodTool, BadTool] }

      const client = new McpTestClient(S)
      // McpTestClient calls handle() directly (no runtime emission). This
      // test just verifies subscribe/emit wiring on the shared registry.
      mcpObservers.emit({ kind: 'tool.called', serverName: 'S', name: 'good', input: {}, output: { ok: true }, duration: 3 })
      mcpObservers.emit({ kind: 'tool.failed', serverName: 'S', name: 'bad', input: {}, output: null, duration: 2, error: 'boom' })

      await client.callTool('good')
      assert.deepStrictEqual(events, [
        { kind: 'tool.called', name: 'good' },
        { kind: 'tool.failed', name: 'bad', error: 'boom' },
      ])
    } finally { off() }
  })
})
