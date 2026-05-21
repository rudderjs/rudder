// Regression tests for the 2026-05-21 AI protocol/runtime fixes:
//   - Phase 1: Gemini `functionResponse.name` carries the function name, not the call id
//   - Phase 3: `contentTo*Parts` paths work without `Buffer` (browser/RN/Electron renderer)
//   - Phase 4: `AI.embed({ cache: true })` actually caches across calls

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { toGeminiContents } from './providers/google.js'
import { toAnthropicMessages } from './providers/anthropic.js'
import { toOpenAIMessages } from './providers/openai.js'
import { base64ToUtf8 } from './base64.js'
import { AI } from './facade.js'
import { AiRegistry } from './registry.js'
import type { AiMessage, EmbeddingAdapter, EmbeddingResult, ProviderFactory } from './types.js'

// ─── Phase 1: Gemini functionResponse.name ─────────────────

describe('Gemini protocol — functionResponse.name', () => {
  it('uses the originating function name, not the synthetic call id', () => {
    const messages: AiMessage[] = [
      { role: 'user', content: 'find rust crates' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_1234_abc', name: 'search', arguments: { q: 'rust' } }],
      },
      { role: 'tool', toolCallId: 'call_1234_abc', content: '[results]' },
    ]
    const { contents } = toGeminiContents(messages)
    const toolPart = (contents[contents.length - 1] as { parts: { functionResponse: { name: string } }[] }).parts[0]!
    assert.strictEqual(toolPart.functionResponse.name, 'search')
  })

  it('routes results back to the right function when multiple parallel tools were called', () => {
    const messages: AiMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'call_a', name: 'search', arguments: { q: 'x' } },
          { id: 'call_b', name: 'fetch',  arguments: { url: 'y' } },
        ],
      },
      { role: 'tool', toolCallId: 'call_b', content: '[fetched]' },
      { role: 'tool', toolCallId: 'call_a', content: '[searched]' },
    ]
    const { contents } = toGeminiContents(messages)
    const toolParts = (contents.slice(-2) as { parts: { functionResponse: { name: string; response: unknown } }[] }[])
      .map(c => c.parts[0]!.functionResponse)
    assert.strictEqual(toolParts[0]!.name, 'fetch')
    assert.strictEqual(toolParts[1]!.name, 'search')
  })

  it('falls back to "unknown" when no prior assistant message carries the call id', () => {
    // Defensive — if the host hands us a tool message in isolation (e.g. a
    // replayed fixture missing the assistant turn) we still emit a well-formed
    // functionResponse rather than crashing.
    const messages: AiMessage[] = [
      { role: 'tool', toolCallId: 'orphan', content: 'x' },
    ]
    const { contents } = toGeminiContents(messages)
    const toolPart = (contents[0] as { parts: { functionResponse: { name: string } }[] }).parts[0]!
    assert.strictEqual(toolPart.functionResponse.name, 'unknown')
  })
})

// ─── Phase 3: contentTo*Parts paths run without Buffer ─────

describe('Buffer-free runtime — contentTo*Parts text-document decoding', () => {
  // `\u{1F44B}` (waving hand) is multi-byte UTF-8 — exercises the TextDecoder
  // path beyond ASCII and would silently corrupt under a naive
  // `String.fromCharCode` chain.
  const utf8Sample = 'hi \u{1F44B} world'
  const base64 = (() => {
    if (typeof Buffer !== 'undefined') return Buffer.from(utf8Sample, 'utf8').toString('base64')
    const bytes = new TextEncoder().encode(utf8Sample)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
    return btoa(binary)
  })()

  // Stash `Buffer` for the suite — restore after, so other tests still get it.
  let savedBuffer: unknown
  beforeEach(() => {
    savedBuffer = (globalThis as { Buffer?: unknown }).Buffer
    delete (globalThis as { Buffer?: unknown }).Buffer
  })
  afterEach(() => {
    if (savedBuffer !== undefined) (globalThis as Record<string, unknown>)['Buffer'] = savedBuffer
  })

  it('base64ToUtf8 round-trips without a Buffer global', () => {
    assert.strictEqual(base64ToUtf8(base64), utf8Sample)
  })

  it('Gemini text-document part decodes without Buffer', () => {
    const messages: AiMessage[] = [{
      role: 'user',
      content: [{ type: 'document', data: base64, mimeType: 'text/plain' }],
    }]
    const { contents } = toGeminiContents(messages)
    const part = (contents[0] as { parts: { text: string }[] }).parts[0]!
    assert.strictEqual(part.text, utf8Sample)
  })

  it('Anthropic text-document part decodes without Buffer', () => {
    const messages: AiMessage[] = [{
      role: 'user',
      content: [{ type: 'document', data: base64, mimeType: 'text/plain' }],
    }]
    const result = toAnthropicMessages(messages) as { content: { type: string; text: string }[] }[]
    const part = result[0]!.content[0]!
    assert.strictEqual(part.type, 'text')
    assert.strictEqual(part.text, utf8Sample)
  })

  it('OpenAI text-document part decodes without Buffer', () => {
    const messages: AiMessage[] = [{
      role: 'user',
      content: [{ type: 'document', data: base64, mimeType: 'text/plain' }],
    }]
    const result = toOpenAIMessages(messages) as { content: { type: string; text: string }[] }[]
    const part = result[0]!.content[0]!
    assert.strictEqual(part.type, 'text')
    assert.strictEqual(part.text, utf8Sample)
  })
})

// ─── Phase 4: AI.embed({ cache: true }) actually caches ────

describe('AI.embed cache keying', () => {
  let networkCalls: number
  let factory: ProviderFactory

  beforeEach(() => {
    AiRegistry.reset()
    networkCalls = 0
    const adapter: EmbeddingAdapter = {
      async embed(input: string | string[]): Promise<EmbeddingResult> {
        networkCalls++
        const items = Array.isArray(input) ? input : [input]
        return {
          embeddings: items.map(() => [0.1, 0.2, 0.3]),
          usage: { promptTokens: items.length, totalTokens: items.length },
        }
      },
    }
    factory = {
      name: 'fake-embed',
      create: () => { throw new Error('not implemented for embedding tests') },
      // A fresh inner adapter on every call — the bug we're fixing.
      createEmbedding: () => ({ ...adapter }),
    }
    AiRegistry.register(factory)
  })

  afterEach(() => AiRegistry.reset())

  it('cache: true hits the cache on the second identical call', async () => {
    const a = await AI.embed('hello', { model: 'fake-embed/m1', cache: true })
    const b = await AI.embed('hello', { model: 'fake-embed/m1', cache: true })
    assert.deepStrictEqual(a.embeddings, b.embeddings)
    assert.strictEqual(networkCalls, 1, 'second call should hit cache, not the wire')
  })

  it('cache: false makes a fresh wire call every time', async () => {
    await AI.embed('hello', { model: 'fake-embed/m1' })
    await AI.embed('hello', { model: 'fake-embed/m1' })
    assert.strictEqual(networkCalls, 2)
  })

  it('different models do not share cache state', async () => {
    await AI.embed('hello', { model: 'fake-embed/m1', cache: true })
    await AI.embed('hello', { model: 'fake-embed/m2', cache: true })
    assert.strictEqual(networkCalls, 2)
  })

  it('AiRegistry.reset() clears the embedding cache so stale fakes do not leak', async () => {
    await AI.embed('hello', { model: 'fake-embed/m1', cache: true })
    assert.strictEqual(networkCalls, 1)

    AiRegistry.reset()
    AiRegistry.register(factory)
    networkCalls = 0

    await AI.embed('hello', { model: 'fake-embed/m1', cache: true })
    assert.strictEqual(networkCalls, 1, 'post-reset call must hit the new adapter, not the cached one')
  })
})
