import 'reflect-metadata'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { Mcp, McpServer, McpTool, McpResource, McpPrompt, McpResponse } from '../index.js'
import type { McpToolProgress, McpToolResult } from '../McpTool.js'
import {
  listServers, resolveServer, describeServer,
  callTool, readResource, getPrompt,
  type ServerEntry,
} from './inspector.js'

// ─── Fixtures ────────────────────────────────────────────

class EchoTool extends McpTool {
  schema() { return z.object({ message: z.string() }) }
  async handle(input: Record<string, unknown>) {
    return McpResponse.text(String(input['message']))
  }
}

class CountTool extends McpTool {
  schema() { return z.object({ n: z.number() }) }
  async *handle(input: Record<string, unknown>): AsyncGenerator<McpToolProgress, McpToolResult> {
    const n = Number(input['n'])
    for (let i = 1; i <= n; i++) yield { progress: i, total: n }
    return McpResponse.text(`done: ${n}`)
  }
}

class StaticResource extends McpResource {
  uri() { return 'info://version' }
  async handle() { return '1.0.0' }
}

class WeatherResource extends McpResource {
  uri() { return 'weather://location/{city}' }
  async handle(params?: Record<string, string>) {
    return `Weather in ${params?.['city'] ?? 'unknown'}: sunny`
  }
}

class GreetPrompt extends McpPrompt {
  async handle(args: Record<string, unknown>) {
    return [{ role: 'user' as const, content: `Hello ${String(args['name'])}` }]
  }
}

class TestServer extends McpServer {
  protected tools = [EchoTool, CountTool]
  protected resources = [StaticResource, WeatherResource]
  protected prompts = [GreetPrompt]
}

function makeEntry(): ServerEntry {
  return { key: 'web:/mcp', kind: 'web', label: 'TestServer (/mcp)', Server: TestServer }
}

// ─── listServers / resolveServer ─────────────────────────

describe('inspector — listServers / resolveServer', () => {
  beforeEach(() => {
    Mcp.getWebServers().clear()
    Mcp.getLocalServers().clear()
  })

  it('listServers returns web + local entries with Server stripped', () => {
    Mcp.web('/mcp', TestServer)
    Mcp.local('cli', TestServer)
    const out = listServers()
    assert.equal(out.web.length, 1)
    assert.equal(out.web[0]!.key, 'web:/mcp')
    assert.equal(out.web[0]!.kind, 'web')
    // Server constructor reference is stripped from the response — we don't
    // want to leak class identities over the wire.
    assert.equal(out.web[0]!.Server, undefined)

    assert.equal(out.local.length, 1)
    assert.equal(out.local[0]!.key, 'local:cli')
    assert.equal(out.local[0]!.Server, undefined)
  })

  it('resolveServer returns the entry for a known web key', () => {
    Mcp.web('/mcp', TestServer)
    const e = resolveServer('web:/mcp')
    assert.ok(e)
    assert.equal(e.key, 'web:/mcp')
    assert.equal(e.kind, 'web')
    assert.equal(e.Server, TestServer)
  })

  it('resolveServer returns the entry for a known local key', () => {
    Mcp.local('cli', TestServer)
    const e = resolveServer('local:cli')
    assert.ok(e)
    assert.equal(e.kind, 'local')
    assert.equal(e.Server, TestServer)
  })

  it('resolveServer returns undefined for unknown keys', () => {
    assert.equal(resolveServer('web:/missing'), undefined)
    assert.equal(resolveServer('local:missing'), undefined)
    assert.equal(resolveServer('garbage'), undefined)
  })
})

// ─── describeServer ──────────────────────────────────────

describe('inspector — describeServer', () => {
  it('includes metadata + tool/resource/prompt summaries', () => {
    const out = describeServer(makeEntry()) as {
      metadata: { name: string; version: string }
      tools: Array<{ name: string; inputSchema: unknown }>
      resources: Array<{ uri: string; template: boolean }>
      prompts: Array<{ name: string }>
    }

    assert.equal(out.metadata.name, 'TestServer')
    assert.equal(out.metadata.version, '1.0.0')

    assert.equal(out.tools.length, 2)
    const echo = out.tools.find((t) => t.name === 'echo')!
    assert.ok(echo.inputSchema)
    const inputSchema = echo.inputSchema as { properties: { message: unknown } }
    assert.ok(inputSchema.properties.message)

    assert.equal(out.resources.length, 2)
    const tmpl = out.resources.find((r) => r.uri === 'weather://location/{city}')!
    assert.equal(tmpl.template, true)
    const stat = out.resources.find((r) => r.uri === 'info://version')!
    assert.equal(stat.template, false)

    assert.equal(out.prompts.length, 1)
    assert.equal(out.prompts[0]!.name, 'greet')
  })
})

// ─── callTool ────────────────────────────────────────────

describe('inspector — callTool', () => {
  it('returns McpToolResult for a plain async tool', async () => {
    const out = await callTool(makeEntry(), 'echo', { message: 'hi' }) as McpToolResult
    assert.equal((out.content[0] as { text: string }).text, 'hi')
  })

  // Regression test for PR A's streaming-tool fix (#424). Without consumeToolReturn,
  // this would return the AsyncGenerator iterator which JSON-serializes as `{}`.
  it('drains streaming tools to the final result (PR #424 regression test)', async () => {
    const out = await callTool(makeEntry(), 'count', { n: 3 }) as McpToolResult
    assert.equal((out.content[0] as { text: string }).text, 'done: 3')
  })

  it('throws on unknown tool', async () => {
    await assert.rejects(
      () => callTool(makeEntry(), 'missing', {}),
      /not found/,
    )
  })
})

// ─── readResource ────────────────────────────────────────

describe('inspector — readResource', () => {
  it('returns content for an exact static URI', async () => {
    const out = await readResource(makeEntry(), 'info://version') as {
      uri: string; content: string; mimeType: string
    }
    assert.equal(out.uri, 'info://version')
    assert.equal(out.content, '1.0.0')
    assert.equal(out.mimeType, 'text/plain')
  })

  it('matches a template URI and passes extracted params to handle()', async () => {
    const out = await readResource(makeEntry(), 'weather://location/london') as {
      uri: string; content: string
    }
    assert.equal(out.uri, 'weather://location/london')
    assert.equal(out.content, 'Weather in london: sunny')
  })

  it('throws when no static or template URI matches', async () => {
    await assert.rejects(
      () => readResource(makeEntry(), 'missing://x'),
      /not found/,
    )
  })
})

// ─── getPrompt ───────────────────────────────────────────

describe('inspector — getPrompt', () => {
  it('returns { messages } for a known prompt', async () => {
    const out = await getPrompt(makeEntry(), 'greet', { name: 'World' }) as {
      messages: Array<{ role: string; content: string }>
    }
    assert.equal(out.messages.length, 1)
    assert.equal(out.messages[0]!.content, 'Hello World')
  })

  it('throws on unknown prompt', async () => {
    await assert.rejects(
      () => getPrompt(makeEntry(), 'missing', {}),
      /not found/,
    )
  })
})
