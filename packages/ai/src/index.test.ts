import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { AiRegistry } from './registry.js'
import type { ProviderFactory, ProviderAdapter, ProviderRequestOptions, ProviderResponse, StreamChunk } from './types.js'

// ─── Shared Mock Provider ─────────────────────────────────

function createMockAdapter(responseText = 'mock response'): ProviderAdapter {
  return {
    async generate(_opts: ProviderRequestOptions): Promise<ProviderResponse> {
      return {
        message: { role: 'assistant', content: responseText },
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        finishReason: 'stop',
      }
    },
    async *stream(_opts: ProviderRequestOptions): AsyncIterable<StreamChunk> {
      yield { type: 'text-delta', text: responseText }
      yield { type: 'finish', finishReason: 'stop', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } }
    },
  }
}

const mockFactory: ProviderFactory = {
  name: 'mock',
  create: () => createMockAdapter(),
}

// ─── AiRegistry ───────────────────────────────────────────

describe('AiRegistry', () => {
  beforeEach(() => AiRegistry.reset())

  it('registers and retrieves a provider factory', () => {
    AiRegistry.register(mockFactory)
    assert.strictEqual(AiRegistry.getFactory('mock'), mockFactory)
  })

  it('throws for unknown provider', () => {
    assert.throws(
      () => AiRegistry.getFactory('unknown'),
      /Unknown AI provider "unknown"/,
    )
  })

  it('resolves provider/model string', () => {
    AiRegistry.register(mockFactory)
    const adapter = AiRegistry.resolve('mock/test-model')
    assert.ok(adapter)
    assert.ok(typeof adapter.generate === 'function')
    assert.ok(typeof adapter.stream === 'function')
  })

  it('parseModelString splits correctly', () => {
    const [provider, model] = AiRegistry.parseModelString('anthropic/claude-sonnet-4-5')
    assert.strictEqual(provider, 'anthropic')
    assert.strictEqual(model, 'claude-sonnet-4-5')
  })

  it('parseModelString throws on invalid format', () => {
    assert.throws(
      () => AiRegistry.parseModelString('no-slash'),
      /Invalid model string/,
    )
  })

  it('setDefault / getDefault', () => {
    AiRegistry.setDefault('mock/default-model')
    assert.strictEqual(AiRegistry.getDefault(), 'mock/default-model')
  })

  it('getDefault throws when not set', () => {
    assert.throws(
      () => AiRegistry.getDefault(),
      /No default model set/,
    )
  })

  it('reset clears everything', () => {
    AiRegistry.register(mockFactory)
    AiRegistry.setDefault('mock/test')
    AiRegistry.reset()
    assert.throws(() => AiRegistry.getFactory('mock'))
    assert.throws(() => AiRegistry.getDefault())
  })
})

// ─── Provider Constructors ────────────────────────────────

import { AnthropicProvider } from './providers/anthropic.js'
import { OpenAIProvider } from './providers/openai.js'
import { GoogleProvider } from './providers/google.js'
import { OllamaProvider } from './providers/ollama.js'

describe('AnthropicProvider', () => {
  it('has name "anthropic"', () => {
    const p = new AnthropicProvider({ apiKey: 'test-key' })
    assert.strictEqual(p.name, 'anthropic')
  })
  it('creates an adapter', () => {
    const adapter = new AnthropicProvider({ apiKey: 'test-key' }).create('claude-sonnet-4-5')
    assert.ok(typeof adapter.generate === 'function')
    assert.ok(typeof adapter.stream === 'function')
  })
})

describe('OpenAIProvider', () => {
  it('has name "openai"', () => {
    const p = new OpenAIProvider({ apiKey: 'test-key' })
    assert.strictEqual(p.name, 'openai')
  })
  it('creates an adapter', () => {
    const adapter = new OpenAIProvider({ apiKey: 'test-key' }).create('gpt-4o')
    assert.ok(typeof adapter.generate === 'function')
    assert.ok(typeof adapter.stream === 'function')
  })
})

describe('GoogleProvider', () => {
  it('has name "google"', () => {
    const p = new GoogleProvider({ apiKey: 'test-key' })
    assert.strictEqual(p.name, 'google')
  })
  it('creates an adapter', () => {
    const adapter = new GoogleProvider({ apiKey: 'test-key' }).create('gemini-2.5-pro')
    assert.ok(typeof adapter.generate === 'function')
    assert.ok(typeof adapter.stream === 'function')
  })
})

describe('OllamaProvider', () => {
  it('has name "ollama"', () => {
    const p = new OllamaProvider()
    assert.strictEqual(p.name, 'ollama')
  })
  it('creates an adapter with default baseUrl', () => {
    const adapter = new OllamaProvider().create('llama3')
    assert.ok(typeof adapter.generate === 'function')
    assert.ok(typeof adapter.stream === 'function')
  })
  it('accepts custom baseUrl', () => {
    const adapter = new OllamaProvider({ baseUrl: 'http://myserver:11434/v1' }).create('llama3')
    assert.ok(adapter)
  })
})

// ─── Tool System ──────────────────────────────────────────

import { toolDefinition } from './tool.js'
import { z } from 'zod'

describe('toolDefinition', () => {
  it('creates a server tool', () => {
    const tool = toolDefinition({
      name: 'get_weather',
      description: 'Get weather for a location',
      inputSchema: z.object({ location: z.string() }),
    }).server(async ({ location }) => ({ temp: 72 }))

    assert.strictEqual(tool.definition.name, 'get_weather')
    assert.strictEqual(tool.type, 'server')
    assert.ok(typeof tool.execute === 'function')
  })

  it('creates a client tool', () => {
    const tool = toolDefinition({
      name: 'apply_theme',
      description: 'Apply a UI theme',
      inputSchema: z.object({ theme: z.string() }),
    }).client(async ({ theme }) => ({ applied: true }))

    assert.strictEqual(tool.type, 'client')
  })

  it('supports needsApproval', () => {
    const builder = toolDefinition({
      name: 'delete_file',
      description: 'Delete a file',
      inputSchema: z.object({ path: z.string() }),
      needsApproval: true,
    })
    assert.strictEqual(builder.options.needsApproval, true)
  })

  it('supports lazy flag', () => {
    const builder = toolDefinition({
      name: 'rare_tool',
      description: 'Rarely used',
      inputSchema: z.object({ q: z.string() }),
      lazy: true,
    })
    assert.strictEqual(builder.options.lazy, true)
  })

  it('converts to JSON Schema', () => {
    const builder = toolDefinition({
      name: 'search',
      description: 'Search items',
      inputSchema: z.object({ query: z.string(), limit: z.number().optional() }),
    })
    const schema = builder.toSchema()
    assert.strictEqual(schema.name, 'search')
    assert.strictEqual(schema.description, 'Search items')
    assert.strictEqual((schema.parameters as any).type, 'object')
    assert.ok((schema.parameters as any).properties.query)
    assert.ok((schema.parameters as any).properties.limit)
    assert.deepStrictEqual((schema.parameters as any).required, ['query'])
  })

  it('handles nested objects in schema', () => {
    const builder = toolDefinition({
      name: 'complex',
      description: 'Complex tool',
      inputSchema: z.object({
        name: z.string(),
        tags: z.array(z.string()),
        meta: z.object({ key: z.string() }),
      }),
    })
    const schema = builder.toSchema()
    const props = (schema.parameters as any).properties
    assert.strictEqual(props.tags.type, 'array')
    assert.strictEqual(props.tags.items.type, 'string')
    assert.strictEqual(props.meta.type, 'object')
  })

  it('executes server tool', async () => {
    const tool = toolDefinition({
      name: 'add',
      description: 'Add numbers',
      inputSchema: z.object({ a: z.number(), b: z.number() }),
    }).server(async ({ a, b }) => a + b)

    const result = await tool.execute({ a: 2, b: 3 })
    assert.strictEqual(result, 5)
  })
})

// ─── Agent ────────────────────────────────────────────────

import { Agent, agent, stepCountIs, hasToolCall } from './agent.js'

describe('Agent', () => {
  beforeEach(() => {
    AiRegistry.reset()
    AiRegistry.register(mockFactory)
    AiRegistry.setDefault('mock/test-model')
  })

  it('creates agent with instructions', () => {
    class MyAgent extends Agent {
      instructions() { return 'You are a helpful assistant.' }
    }
    const a = new MyAgent()
    assert.strictEqual(a.instructions(), 'You are a helpful assistant.')
  })

  it('prompt() returns AgentResponse', async () => {
    class MyAgent extends Agent {
      instructions() { return 'Test agent' }
    }
    const response = await new MyAgent().prompt('Hello')
    assert.strictEqual(response.text, 'mock response')
    assert.strictEqual(response.steps.length, 1)
    assert.ok(response.usage)
    assert.strictEqual(response.usage.totalTokens, 15)
  })

  it('anonymous agent() helper works', async () => {
    const response = await agent('You are helpful.').prompt('Hello')
    assert.strictEqual(response.text, 'mock response')
  })

  it('supports model override', () => {
    class MyAgent extends Agent {
      instructions() { return 'Test' }
      model() { return 'mock/custom-model' }
    }
    assert.strictEqual(new MyAgent().model(), 'mock/custom-model')
  })

  it('supports failover array', () => {
    class MyAgent extends Agent {
      instructions() { return 'Test' }
      failover() { return ['openai/gpt-4o', 'google/gemini-2.5-pro'] }
    }
    assert.deepStrictEqual(new MyAgent().failover(), ['openai/gpt-4o', 'google/gemini-2.5-pro'])
  })

  it('executes tools in the loop', async () => {
    let toolCallCount = 0
    const calls: string[] = []

    // Mock a provider that calls a tool on first request, then stops
    const toolAdapter: import('./types.js').ProviderAdapter = {
      async generate(opts) {
        toolCallCount++
        if (toolCallCount === 1) {
          return {
            message: {
              role: 'assistant',
              content: '',
              toolCalls: [{ id: 'tc1', name: 'greet', arguments: { name: 'World' } }],
            },
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
            finishReason: 'tool_calls',
          }
        }
        return {
          message: { role: 'assistant', content: 'Done! I greeted World.' },
          usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
          finishReason: 'stop',
        }
      },
      async *stream() { yield { type: 'finish', finishReason: 'stop' } },
    }

    AiRegistry.reset()
    AiRegistry.register({ name: 'toolmock', create: () => toolAdapter })
    AiRegistry.setDefault('toolmock/v1')

    const greetTool = toolDefinition({
      name: 'greet',
      description: 'Greet someone',
      inputSchema: z.object({ name: z.string() }),
    }).server(async ({ name }) => {
      calls.push(name)
      return `Hello, ${name}!`
    })

    const response = await agent({
      instructions: 'You greet people.',
      tools: [greetTool],
    }).prompt('Greet the world')

    assert.strictEqual(response.text, 'Done! I greeted World.')
    assert.strictEqual(response.steps.length, 2)
    assert.deepStrictEqual(calls, ['World'])
    assert.strictEqual(response.usage.totalTokens, 45)
  })

  it('stream() yields chunks and resolves response', async () => {
    const { stream, response } = agent('Test.').stream('Hello')
    const chunks: StreamChunk[] = []
    for await (const chunk of stream) {
      chunks.push(chunk)
    }
    assert.ok(chunks.length > 0)
    assert.strictEqual(chunks[0]!.type, 'text-delta')

    const final = await response
    assert.strictEqual(final.text, 'mock response')
  })
})

describe('stopWhen combinators', () => {
  it('stepCountIs stops at N steps', () => {
    const stop = stepCountIs(3)
    const fakeStep = { message: { role: 'assistant' as const, content: '' }, toolCalls: [], toolResults: [], usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, finishReason: 'stop' as const }
    assert.strictEqual(stop({ steps: [fakeStep, fakeStep, fakeStep], iteration: 2, lastMessage: fakeStep.message }), true)
    assert.strictEqual(stop({ steps: [fakeStep], iteration: 0, lastMessage: fakeStep.message }), false)
  })

  it('hasToolCall stops on specific tool', () => {
    const stop = hasToolCall('done')
    const step = {
      message: { role: 'assistant' as const, content: '' },
      toolCalls: [{ id: '1', name: 'done', arguments: {} }],
      toolResults: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: 'tool_calls' as const,
    }
    assert.strictEqual(stop({ steps: [step], iteration: 0, lastMessage: step.message }), true)
  })

  it('hasToolCall returns false when tool not called', () => {
    const stop = hasToolCall('done')
    const step = {
      message: { role: 'assistant' as const, content: '' },
      toolCalls: [{ id: '1', name: 'search', arguments: {} }],
      toolResults: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: 'tool_calls' as const,
    }
    assert.strictEqual(stop({ steps: [step], iteration: 0, lastMessage: step.message }), false)
  })
})

// ─── Middleware ────────────────────────────────────────────

import { runOnConfig, runOnChunk, runOnBeforeToolCall } from './middleware.js'
import type { AiMiddleware, MiddlewareContext, MiddlewareConfigResult } from './types.js'

describe('Middleware', () => {
  const baseCtx: MiddlewareContext = {
    requestId: 'test',
    iteration: 0,
    chunkIndex: 0,
    messages: [],
    model: 'mock/test',
    provider: 'mock',
    toolNames: [],
    abort() {},
  }

  it('onConfig pipes transforms', () => {
    const mw1: AiMiddleware = {
      name: 'mw1',
      onConfig(_ctx, config) {
        return { ...config, temperature: 0.5 }
      },
    }
    const mw2: AiMiddleware = {
      name: 'mw2',
      onConfig(_ctx, config) {
        return { ...config, maxTokens: 1000 }
      },
    }
    const result = runOnConfig([mw1, mw2], baseCtx, {}, 'init')
    assert.strictEqual(result.temperature, 0.5)
    assert.strictEqual(result.maxTokens, 1000)
  })

  it('onChunk transforms chunks', () => {
    const mw: AiMiddleware = {
      name: 'upper',
      onChunk(_ctx, chunk) {
        if (chunk.type === 'text-delta' && chunk.text) {
          return { ...chunk, text: chunk.text.toUpperCase() }
        }
        return chunk
      },
    }
    const result = runOnChunk([mw], baseCtx, { type: 'text-delta', text: 'hello' })
    assert.strictEqual(result?.text, 'HELLO')
  })

  it('onChunk drops chunks when returning null', () => {
    const mw: AiMiddleware = {
      name: 'dropper',
      onChunk() { return null },
    }
    const result = runOnChunk([mw], baseCtx, { type: 'text-delta', text: 'hello' })
    assert.strictEqual(result, null)
  })

  it('onBeforeToolCall can skip with cached result', async () => {
    const mw: AiMiddleware = {
      name: 'cache',
      async onBeforeToolCall(_ctx, toolName) {
        if (toolName === 'weather') return { type: 'skip', result: { temp: 72 } }
      },
    }
    const result = await runOnBeforeToolCall([mw], baseCtx, 'weather', {})
    assert.deepStrictEqual(result, { type: 'skip', result: { temp: 72 } })
  })

  it('onBeforeToolCall can transform args', async () => {
    const mw: AiMiddleware = {
      name: 'transform',
      async onBeforeToolCall(_ctx, _name, args) {
        return { type: 'transformArgs', args: { ...args, extra: true } }
      },
    }
    const result = await runOnBeforeToolCall([mw], baseCtx, 'search', { q: 'test' })
    assert.deepStrictEqual(result, { type: 'transformArgs', args: { q: 'test', extra: true } })
  })

  it('onBeforeToolCall can abort', async () => {
    const mw: AiMiddleware = {
      name: 'guard',
      async onBeforeToolCall(_ctx, toolName) {
        if (toolName === 'dangerous') return { type: 'abort', reason: 'Blocked' }
      },
    }
    const result = await runOnBeforeToolCall([mw], baseCtx, 'dangerous', {})
    assert.deepStrictEqual(result, { type: 'abort', reason: 'Blocked' })
  })
})

// ─── Output ───────────────────────────────────────────────

import { Output } from './output.js'

describe('Output', () => {
  it('Output.object() parses valid JSON', () => {
    const output = Output.object({ schema: z.object({ name: z.string() }) })
    assert.strictEqual(output.type, 'object')
    const result = output.parse('{"name": "test"}')
    assert.deepStrictEqual(result, { name: 'test' })
  })

  it('Output.object() strips markdown fences', () => {
    const output = Output.object({ schema: z.object({ x: z.number() }) })
    const result = output.parse('```json\n{"x": 42}\n```')
    assert.deepStrictEqual(result, { x: 42 })
  })

  it('Output.object() throws on invalid', () => {
    const output = Output.object({ schema: z.object({ name: z.string() }) })
    assert.throws(() => output.parse('{"name": 123}'))
  })

  it('Output.array() parses array', () => {
    const output = Output.array({ element: z.object({ id: z.number() }) })
    assert.strictEqual(output.type, 'array')
    const result = output.parse('[{"id": 1}, {"id": 2}]')
    assert.deepStrictEqual(result, [{ id: 1 }, { id: 2 }])
  })

  it('Output.choice() picks from options', () => {
    const output = Output.choice({ options: ['sunny', 'rainy', 'snowy'] as const })
    assert.strictEqual(output.type, 'choice')
    assert.strictEqual(output.parse('sunny'), 'sunny')
    assert.strictEqual(output.parse('  rainy  '), 'rainy')
  })

  it('Output.choice() throws on invalid option', () => {
    const output = Output.choice({ options: ['a', 'b'] as const })
    assert.throws(() => output.parse('c'))
  })

  it('toSystemPrompt() returns instruction string', () => {
    const output = Output.object({ schema: z.object({ x: z.number() }) })
    const prompt = output.toSystemPrompt()
    assert.ok(prompt.includes('JSON'))
    assert.ok(prompt.includes('object'))
  })
})

// ─── Conversation ─────────────────────────────────────────

import { MemoryConversationStore } from './conversation.js'

describe('MemoryConversationStore', () => {
  it('creates a conversation and returns an ID', async () => {
    const store = new MemoryConversationStore()
    const id = await store.create('Test')
    assert.ok(id)
    assert.ok(typeof id === 'string')
  })

  it('appends and loads messages', async () => {
    const store = new MemoryConversationStore()
    const id = await store.create()
    await store.append(id, [{ role: 'user', content: 'Hello' }])
    await store.append(id, [{ role: 'assistant', content: 'Hi!' }])
    const messages = await store.load(id)
    assert.strictEqual(messages.length, 2)
    assert.strictEqual(messages[0]!.content, 'Hello')
    assert.strictEqual(messages[1]!.content, 'Hi!')
  })

  it('lists conversations', async () => {
    const store = new MemoryConversationStore()
    await store.create('Chat 1')
    await store.create('Chat 2')
    const list = await store.list()
    assert.strictEqual(list.length, 2)
  })

  it('setTitle updates title', async () => {
    const store = new MemoryConversationStore()
    const id = await store.create('Old')
    await store.setTitle(id, 'New Title')
    const list = await store.list()
    assert.strictEqual(list.find(c => c.id === id)?.title, 'New Title')
  })

  it('throws for unknown conversation', async () => {
    const store = new MemoryConversationStore()
    await assert.rejects(() => store.load('nonexistent'), /not found/)
  })
})

// ─── AI Facade ────────────────────────────────────────────

import { AI } from './facade.js'

describe('AI facade', () => {
  beforeEach(() => {
    AiRegistry.reset()
    AiRegistry.register(mockFactory)
    AiRegistry.setDefault('mock/test')
  })

  it('AI.prompt() uses default model', async () => {
    const response = await AI.prompt('Hello')
    assert.strictEqual(response.text, 'mock response')
  })

  it('AI.agent() creates an agent', async () => {
    const a = AI.agent('You are helpful.')
    const response = await a.prompt('Hi')
    assert.strictEqual(response.text, 'mock response')
  })
})

// ─── AiFake ───────────────────────────────────────────────

import { AiFake } from './fake.js'

describe('AiFake', () => {
  it('fake() intercepts prompt calls', async () => {
    const fake = AiFake.fake()
    fake.respondWith('Mocked!')

    const response = await AI.prompt('Hello')
    assert.strictEqual(response.text, 'Mocked!')
    fake.restore()
  })

  it('assertPrompted() verifies a prompt was sent', async () => {
    const fake = AiFake.fake()
    fake.respondWith('Ok')

    await AI.prompt('Test prompt')
    fake.assertPrompted(input => input.includes('Test'))
    fake.restore()
  })

  it('assertPrompted() throws when no prompts', () => {
    const fake = AiFake.fake()
    assert.throws(() => fake.assertPrompted(), /Expected at least one prompt/)
    fake.restore()
  })

  it('assertNothingPrompted() passes when no prompts', () => {
    const fake = AiFake.fake()
    fake.assertNothingPrompted()
    fake.restore()
  })

  it('assertNothingPrompted() throws when prompts exist', async () => {
    const fake = AiFake.fake()
    await AI.prompt('Hi')
    assert.throws(() => fake.assertNothingPrompted(), /Expected no prompts/)
    fake.restore()
  })

  it('getCalls() returns recorded calls', async () => {
    const fake = AiFake.fake()
    await AI.prompt('Hello world')
    const calls = fake.getCalls()
    assert.strictEqual(calls.length, 1)
    assert.ok(calls[0]!.messages.some(m => m.content === 'Hello world'))
    fake.restore()
  })
})

// ─── ai() ServiceProvider factory ─────────────────────────

import { ai } from './provider.js'

describe('ai() factory', () => {
  it('returns a ServiceProvider class', () => {
    const Provider = ai({
      default: 'mock/test',
      providers: { mock: { driver: 'mock' } },
    })
    assert.ok(typeof Provider === 'function')
    assert.ok(Provider.prototype)
  })
})
