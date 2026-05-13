import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mcpObservers } from '@rudderjs/mcp/observers'
import { MemoryStorage } from '../storage.js'
import { McpCollector } from './mcp.js'
import type { TelescopeEntry } from '../types.js'

describe('McpCollector', () => {
  beforeEach(() => {
    mcpObservers.reset()
  })

  it('records a tool.called event with server/type/name tags', async () => {
    const storage   = new MemoryStorage()
    const collector = new McpCollector(storage, {})
    await collector.register()

    mcpObservers.emit({
      kind:       'tool.called',
      serverName: 'echo',
      name:       'reverse',
      input:      { text: 'hello' },
      output:     { text: 'olleh' },
      duration:   5,
    })

    const entries = storage.list({ type: 'mcp' }) as TelescopeEntry[]
    assert.equal(entries.length, 1)
    const entry = entries[0]!
    assert.equal(entry.content['kind'],       'tool.called')
    assert.equal(entry.content['serverName'], 'echo')
    assert.equal(entry.content['name'],       'reverse')
    assert.equal(entry.content['duration'],   5)
    assert.ok(entry.tags.includes('server:echo'))
    assert.ok(entry.tags.includes('type:tool'))
    assert.ok(entry.tags.includes('name:reverse'))
  })

  it('tags slow MCP ops above slowMcpThreshold (default 1000ms)', async () => {
    const storage   = new MemoryStorage()
    const collector = new McpCollector(storage, {})
    await collector.register()

    mcpObservers.emit({
      kind:       'tool.called',
      serverName: 's',
      name:       'long_running',
      input:      {},
      output:     {},
      duration:   1500,
    })

    const entry = (storage.list({ type: 'mcp' }) as TelescopeEntry[])[0]!
    assert.ok(entry.tags.includes('slow'))
  })

  it('respects a custom slowMcpThreshold', async () => {
    const storage   = new MemoryStorage()
    const collector = new McpCollector(storage, { slowMcpThreshold: 100 })
    await collector.register()

    mcpObservers.emit({
      kind:       'tool.called',
      serverName: 's',
      name:       't',
      input:      {},
      output:     {},
      duration:   150,
    })

    const entry = (storage.list({ type: 'mcp' }) as TelescopeEntry[])[0]!
    assert.ok(entry.tags.includes('slow'))
  })

  it('records resource.read + prompt.rendered with correct type tag', async () => {
    const storage   = new MemoryStorage()
    const collector = new McpCollector(storage, {})
    await collector.register()

    mcpObservers.emit({
      kind:       'resource.read',
      serverName: 'docs',
      name:       'README',
      input:      {},
      output:     'contents',
      duration:   3,
    })
    mcpObservers.emit({
      kind:       'prompt.rendered',
      serverName: 'agent',
      name:       'summarize',
      input:      { topic: 'rust' },
      output:     'Summary…',
      duration:   8,
    })

    const all = storage.list({ type: 'mcp' }) as TelescopeEntry[]
    assert.equal(all.length, 2)
    const types = all.flatMap(e => e.tags.filter(t => t.startsWith('type:')))
    assert.ok(types.includes('type:resource'))
    assert.ok(types.includes('type:prompt'))
  })

  it('tags *.failed events with error', async () => {
    const storage   = new MemoryStorage()
    const collector = new McpCollector(storage, {})
    await collector.register()

    mcpObservers.emit({
      kind:       'tool.failed',
      serverName: 'broken',
      name:       'do_thing',
      input:      {},
      output:     null,
      duration:   12,
      error:      'tool not found',
    })

    const entry = (storage.list({ type: 'mcp' }) as TelescopeEntry[])[0]!
    assert.equal(entry.content['error'], 'tool not found')
    assert.ok(entry.tags.includes('error'))
  })
})
