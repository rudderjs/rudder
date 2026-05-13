import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { aiObservers } from '@rudderjs/ai/observers'
import { MemoryStorage } from '../storage.js'
import { AiCollector } from './ai.js'
import type { TelescopeEntry } from '../types.js'

const baseAgentEvent = {
  agentName:        'ResearchAgent',
  model:            'anthropic/claude-opus-4-7',
  provider:         'anthropic',
  input:            'What is Rust?',
  output:           'Rust is a systems language…',
  steps:            [],
  tokens:           { prompt: 100, completion: 50, total: 150 },
  duration:         1500,
  finishReason:     'stop',
  streaming:        false,
  conversationId:   null,
  failoverAttempts: 0,
}

describe('AiCollector', () => {
  beforeEach(() => {
    aiObservers.reset()
  })

  it('records an agent.completed event with provider/model/agent tags', async () => {
    const storage   = new MemoryStorage()
    const collector = new AiCollector(storage, {})
    await collector.register()

    aiObservers.emit({ kind: 'agent.completed', ...baseAgentEvent })

    const entries = storage.list({ type: 'ai' }) as TelescopeEntry[]
    assert.equal(entries.length, 1)
    const entry = entries[0]!
    assert.equal(entry.content['kind'],      'agent.completed')
    assert.equal(entry.content['agentName'], 'ResearchAgent')
    assert.equal(entry.content['model'],     'anthropic/claude-opus-4-7')
    assert.ok(entry.tags.includes('agent:ResearchAgent'))
    assert.ok(entry.tags.includes('provider:anthropic'))
    assert.ok(entry.tags.includes('model:anthropic/claude-opus-4-7'))
  })

  it('tags slow runs above slowAiThreshold (default 5000ms)', async () => {
    const storage   = new MemoryStorage()
    const collector = new AiCollector(storage, {})
    await collector.register()

    aiObservers.emit({ kind: 'agent.completed', ...baseAgentEvent, duration: 6000 })

    const entry = (storage.list({ type: 'ai' }) as TelescopeEntry[])[0]!
    assert.ok(entry.tags.includes('slow'))
  })

  it('respects a custom slowAiThreshold', async () => {
    const storage   = new MemoryStorage()
    const collector = new AiCollector(storage, { slowAiThreshold: 500 })
    await collector.register()

    aiObservers.emit({ kind: 'agent.completed', ...baseAgentEvent, duration: 600 })

    const entry = (storage.list({ type: 'ai' }) as TelescopeEntry[])[0]!
    assert.ok(entry.tags.includes('slow'))
  })

  it('tags streaming + has_tools when appropriate', async () => {
    const storage   = new MemoryStorage()
    const collector = new AiCollector(storage, {})
    await collector.register()

    aiObservers.emit({
      kind: 'agent.completed',
      ...baseAgentEvent,
      streaming: true,
      steps: [{
        iteration:    1,
        model:        'x',
        tokens:       { prompt: 0, completion: 0, total: 0 },
        finishReason: 'tool_use',
        toolCalls:    [{ id: '1', name: 'search', args: {}, result: {}, duration: 10, needsApproval: false }],
      }],
    })

    const entry = (storage.list({ type: 'ai' }) as TelescopeEntry[])[0]!
    assert.ok(entry.tags.includes('streaming'))
    assert.ok(entry.tags.includes('has_tools'))
    assert.equal(entry.content['toolCallCount'], 1)
  })

  it('records agent.failed events with error + error tag', async () => {
    const storage   = new MemoryStorage()
    const collector = new AiCollector(storage, {})
    await collector.register()

    aiObservers.emit({
      kind: 'agent.failed',
      ...baseAgentEvent,
      error: 'rate_limit_exceeded',
    })

    const entry = (storage.list({ type: 'ai' }) as TelescopeEntry[])[0]!
    assert.equal(entry.content['kind'],  'agent.failed')
    assert.equal(entry.content['error'], 'rate_limit_exceeded')
    assert.ok(entry.tags.includes('error'))
  })

  it('skips agent.step.completed events (per-step progress would double the row count)', async () => {
    const storage   = new MemoryStorage()
    const collector = new AiCollector(storage, {})
    await collector.register()

    aiObservers.emit({
      kind:           'agent.step.completed',
      agentName:      'R',
      model:          'x',
      provider:       'y',
      iteration:      1,
      step:           {
        iteration:    1,
        model:        'x',
        tokens:       { prompt: 0, completion: 0, total: 0 },
        finishReason: 'stop',
        toolCalls:    [],
      },
      tokens:         { prompt: 0, completion: 0, total: 0 },
      duration:       100,
      streaming:      false,
      conversationId: null,
    })

    assert.equal(storage.count('ai'), 0)
  })
})
