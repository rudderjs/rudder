import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import type { AiMessage, AgentResponse } from '@rudderjs/ai'
import { persistConversation } from '../handlers/chat/persistence.js'
import type { ConversationStoreLike } from '../handlers/chat/types.js'

// ─── Fake store ─────────────────────────────────────────────

interface AppendCall {
  conversationId: string
  messages:       AiMessage[]
}

function makeFakeStore(): ConversationStoreLike & { _appends: AppendCall[]; _titles: Array<{ id: string; title: string }> } {
  const _appends: AppendCall[] = []
  const _titles: Array<{ id: string; title: string }> = []
  return {
    _appends,
    _titles,
    create: async () => 'id',
    load:   async () => [],
    append: async (conversationId, messages) => { _appends.push({ conversationId, messages }) },
    setTitle: async (conversationId, title) => { _titles.push({ id: conversationId, title }) },
    list:   async () => [],
  }
}

// ─── Helpers to build fake AgentResponse ────────────────────

function makeResult(steps: AgentResponse['steps']): AgentResponse {
  return {
    text: '',
    steps,
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  }
}

// ─── Tests ──────────────────────────────────────────────────

describe('persistConversation', () => {
  it('appends [user, assistant] for a turn with no tool calls', async () => {
    const store = makeFakeStore()
    const result = makeResult([
      {
        message:     { role: 'assistant', content: 'Hello there.' },
        toolCalls:   [],
        toolResults: [],
        usage:       { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        finishReason: 'stop',
      },
    ])

    await persistConversation(store, 'conv-1', 'hi', result, false)

    assert.equal(store._appends.length, 1)
    const msgs = store._appends[0]!.messages
    assert.equal(msgs.length, 2)
    assert.equal(msgs[0]!.role, 'user')
    assert.equal(msgs[0]!.content, 'hi')
    assert.equal(msgs[1]!.role, 'assistant')
    assert.equal(msgs[1]!.content, 'Hello there.')
  })

  it('preserves the full graph when tool calls and tool results occur', async () => {
    const store = makeFakeStore()
    const result = makeResult([
      {
        message: {
          role:      'assistant',
          content:   '',
          toolCalls: [{ id: 'call-1', name: 'edit_text', arguments: { op: 'rewrite', text: 'new' } }],
        },
        toolCalls: [{ id: 'call-1', name: 'edit_text', arguments: { op: 'rewrite', text: 'new' } }],
        toolResults: [{ toolCallId: 'call-1', result: { ok: true } }],
        usage:       { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        finishReason: 'tool_calls',
      },
      {
        message:     { role: 'assistant', content: 'Done.' },
        toolCalls:   [],
        toolResults: [],
        usage:       { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        finishReason: 'stop',
      },
    ])

    await persistConversation(store, 'conv-1', 'rewrite this', result, false)

    const msgs = store._appends[0]!.messages
    // [user, assistant{toolCalls}, tool, assistant]
    assert.equal(msgs.length, 4)
    assert.equal(msgs[0]!.role, 'user')
    assert.equal(msgs[1]!.role, 'assistant')
    assert.deepEqual(msgs[1]!.toolCalls?.[0]?.id, 'call-1')
    assert.equal(msgs[2]!.role, 'tool')
    assert.equal(msgs[2]!.toolCallId, 'call-1')
    assert.equal(msgs[2]!.content, JSON.stringify({ ok: true }))
    assert.equal(msgs[3]!.role, 'assistant')
    assert.equal(msgs[3]!.content, 'Done.')
  })

  it('serializes string tool results as-is (not JSON-stringified)', async () => {
    const store = makeFakeStore()
    const result = makeResult([
      {
        message:     { role: 'assistant', content: '', toolCalls: [{ id: 'c', name: 't', arguments: {} }] },
        toolCalls:   [{ id: 'c', name: 't', arguments: {} }],
        toolResults: [{ toolCallId: 'c', result: 'plain string' }],
        usage:       { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        finishReason: 'tool_calls',
      },
    ])
    await persistConversation(store, 'c1', 'hi', result, false)
    const msgs = store._appends[0]!.messages
    assert.equal(msgs[2]!.content, 'plain string')
  })

  it('persists the original user input, not any transformed version', async () => {
    const store = makeFakeStore()
    const result = makeResult([
      {
        message: { role: 'assistant', content: 'ok' },
        toolCalls: [], toolResults: [],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        finishReason: 'stop',
      },
    ])
    await persistConversation(store, 'c1', 'original input', result, false)
    assert.equal(store._appends[0]!.messages[0]!.content, 'original input')
  })
})
