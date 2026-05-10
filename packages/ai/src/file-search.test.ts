/**
 * `fileSearch` agent-tool tests (#B8 Phase 2).
 *
 * - Factory shape (providerHint, marker, schema).
 * - `normalizeWhere` sugar → typed filter shape.
 * - `toOpenAITools` substitutes the native `file_search` block when the
 *   tool's providerHint matches.
 * - Agent-loop integration via AiFake (hosted path: model produces the
 *   final reply directly; no tool round-trip).
 * - Computer-use providerHint propagation through `toolToSchema` (latent
 *   bug fix bundled with this phase).
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'

import { Agent } from './agent.js'
import { AiFake } from './fake.js'
import {
  fileSearch,
  isFileSearchTool,
  normalizeWhere,
  FILE_SEARCH_MARKER,
  FILE_SEARCH_TOOL_NAME,
  type FileSearchTool,
} from './file-search.js'
import { toOpenAITools } from './providers/openai.js'
import { toolToSchema } from './tool.js'
import type { ToolDefinitionSchema } from './types.js'

// ─── Factory shape ────────────────────────────────────────

describe('fileSearch — factory', () => {
  it('produces a Tool with FILE_SEARCH_MARKER + default name', () => {
    const tool = fileSearch({ stores: ['vs_abc123'] })

    assert.equal(tool[FILE_SEARCH_MARKER], true)
    assert.equal(isFileSearchTool(tool), true)
    assert.equal(tool.definition.name, FILE_SEARCH_TOOL_NAME)
    assert.equal(tool.definition.name, 'file_search')
    assert.ok(tool.definition.description)
  })

  it('accepts custom name + description', () => {
    const tool = fileSearch({
      stores:      ['vs_abc123'],
      name:        'search_docs',
      description: 'Search the docs corpus.',
    })

    assert.equal(tool.definition.name,        'search_docs')
    assert.equal(tool.definition.description, 'Search the docs corpus.')
  })

  it('sets providerHint with vector_store_ids', () => {
    const tool = fileSearch({ stores: ['vs_1', 'vs_2'] })

    assert.equal(tool.definition.providerHint?.type, 'file-search')
    assert.deepEqual(tool.definition.providerHint?.['vector_store_ids'], ['vs_1', 'vs_2'])
    // No filters/max_num_results when unspecified.
    assert.equal(tool.definition.providerHint?.['filters'],         undefined)
    assert.equal(tool.definition.providerHint?.['max_num_results'], undefined)
  })

  it('sets max_num_results when provided', () => {
    const tool = fileSearch({ stores: ['vs_1'], maxResults: 20 })
    assert.equal(tool.definition.providerHint?.['max_num_results'], 20)
  })

  it('lowers sugar `where` into typed filter shape', () => {
    const tool = fileSearch({
      stores: ['vs_1'],
      where:  { author: 'Alice', year: 2026 },
    })

    assert.deepEqual(tool.definition.providerHint?.['filters'], {
      type: 'and',
      filters: [
        { type: 'eq', key: 'author', value: 'Alice' },
        { type: 'eq', key: 'year',   value: 2026    },
      ],
    })
  })

  it('passes typed `where` through unchanged', () => {
    const tool = fileSearch({
      stores: ['vs_1'],
      where:  { type: 'or', filters: [{ type: 'eq', key: 'tag', value: 'a' }, { type: 'eq', key: 'tag', value: 'b' }] },
    })

    assert.deepEqual(tool.definition.providerHint?.['filters'], {
      type: 'or',
      filters: [{ type: 'eq', key: 'tag', value: 'a' }, { type: 'eq', key: 'tag', value: 'b' }],
    })
  })

  it('rejects empty stores array', () => {
    assert.throws(
      () => fileSearch({ stores: [] }),
      /requires at least one vector-store id/,
    )
  })

  it('rejects empty `where` object', () => {
    assert.throws(
      () => fileSearch({ stores: ['vs_1'], where: {} }),
      /must contain at least one key/,
    )
  })

  it('execute is intentionally absent — provider runs the search natively', () => {
    const tool = fileSearch({ stores: ['vs_1'] })
    assert.equal((tool as unknown as { execute?: unknown }).execute, undefined)
  })

  it('placeholder inputSchema accepts { query }', () => {
    const tool = fileSearch({ stores: ['vs_1'] })
    // The placeholder is a zod object; parsing should succeed for { query }
    // and surface as the JSON Schema visible to non-OpenAI providers.
    const parsed = tool.definition.inputSchema.parse({ query: 'hello' })
    assert.deepEqual(parsed, { query: 'hello' })
  })
})

// ─── normalizeWhere ────────────────────────────────────────

describe('normalizeWhere', () => {
  it('single-key sugar short-circuits to bare eq (no and wrapper)', () => {
    assert.deepEqual(normalizeWhere({ author: 'Alice' }), {
      type: 'eq', key: 'author', value: 'Alice',
    })
  })

  it('multi-key sugar wraps in an `and` of `eq`', () => {
    assert.deepEqual(normalizeWhere({ a: 'x', b: 2, c: true }), {
      type: 'and',
      filters: [
        { type: 'eq', key: 'a', value: 'x'  },
        { type: 'eq', key: 'b', value: 2    },
        { type: 'eq', key: 'c', value: true },
      ],
    })
  })

  it('passes typed eq/ne/gt/lt/gte/lte through', () => {
    for (const type of ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'] as const) {
      assert.deepEqual(
        normalizeWhere({ type, key: 'year', value: 2026 }),
        { type, key: 'year', value: 2026 },
      )
    }
  })

  it('passes typed and/or through', () => {
    const filter = {
      type: 'and' as const,
      filters: [
        { type: 'gt' as const, key: 'year', value: 2020 },
        { type: 'lt' as const, key: 'year', value: 2027 },
      ],
    }
    assert.deepEqual(normalizeWhere(filter), filter)
  })

  it('throws on empty sugar object', () => {
    assert.throws(() => normalizeWhere({}), /must contain at least one key/)
  })
})

// ─── OpenAI adapter — toOpenAITools substitution ──────────

describe('toOpenAITools — providerHint: file-search', () => {
  it('emits the native file_search block with vector_store_ids', () => {
    const schemas: ToolDefinitionSchema[] = [{
      name:        'file_search',
      description: 'search docs',
      parameters:  { type: 'object', properties: {} },
      providerHint: {
        type:              'file-search',
        vector_store_ids:  ['vs_abc', 'vs_def'],
      },
    }]

    const out = toOpenAITools(schemas)
    assert.deepEqual(out, [{
      type:             'file_search',
      vector_store_ids: ['vs_abc', 'vs_def'],
    }])
  })

  it('forwards filters + max_num_results when set', () => {
    const filters = {
      type: 'and',
      filters: [{ type: 'eq', key: 'author', value: 'Alice' }],
    }
    const schemas: ToolDefinitionSchema[] = [{
      name:        'file_search',
      description: 'search docs',
      parameters:  { type: 'object', properties: {} },
      providerHint: {
        type:              'file-search',
        vector_store_ids:  ['vs_1'],
        filters,
        max_num_results:   10,
      },
    }]

    const out = toOpenAITools(schemas) as Array<{ filters: unknown; max_num_results: number }>
    assert.deepEqual(out[0]!.filters,         filters)
    assert.equal(out[0]!.max_num_results,     10)
  })

  it('omits filters / max_num_results when absent from the hint', () => {
    const schemas: ToolDefinitionSchema[] = [{
      name:        'file_search',
      description: 'search docs',
      parameters:  { type: 'object', properties: {} },
      providerHint: { type: 'file-search', vector_store_ids: ['vs_1'] },
    }]

    const out = toOpenAITools(schemas) as Array<Record<string, unknown>>
    assert.equal('filters'         in out[0]!, false)
    assert.equal('max_num_results' in out[0]!, false)
  })

  it('falls back to function-call shape when no providerHint', () => {
    const schemas: ToolDefinitionSchema[] = [{
      name:        'get_weather',
      description: 'fetch the current weather',
      parameters:  { type: 'object', properties: { city: { type: 'string' } } },
    }]

    const out = toOpenAITools(schemas)
    assert.deepEqual(out, [{
      type: 'function',
      function: {
        name:        'get_weather',
        description: 'fetch the current weather',
        parameters:  { type: 'object', properties: { city: { type: 'string' } } },
      },
    }])
  })

  it('does NOT substitute when providerHint.type is unrecognized', () => {
    const schemas: ToolDefinitionSchema[] = [{
      name:        'mystery',
      description: '???',
      parameters:  {},
      providerHint: { type: 'unknown-hint' },
    }]

    const out = toOpenAITools(schemas) as Array<{ type: string }>
    assert.equal(out[0]!.type, 'function')
  })
})

// ─── End-to-end: providerHint reaches the adapter via toolToSchema ─

describe('fileSearch — toolToSchema propagates providerHint', () => {
  it('agent loop tool-serialization path includes the hint', () => {
    const tool = fileSearch({ stores: ['vs_1'], maxResults: 5 })
    const schema = toolToSchema(tool)

    assert.equal(schema.name,                            'file_search')
    assert.equal(schema.providerHint?.type,              'file-search')
    assert.deepEqual(schema.providerHint?.['vector_store_ids'], ['vs_1'])
    assert.equal(schema.providerHint?.['max_num_results'], 5)
  })

  it('emits the native block end-to-end through toOpenAITools(toolToSchema(...))', () => {
    const tool = fileSearch({ stores: ['vs_abc'], where: { dept: 'eng' }, maxResults: 3 })
    const out  = toOpenAITools([toolToSchema(tool)]) as Array<{ type: string; vector_store_ids: string[]; filters: unknown; max_num_results: number }>

    assert.equal(out[0]!.type,                  'file_search')
    assert.deepEqual(out[0]!.vector_store_ids,  ['vs_abc'])
    assert.deepEqual(out[0]!.filters,           { type: 'eq', key: 'dept', value: 'eng' })
    assert.equal(out[0]!.max_num_results,       3)
  })
})

// ─── AiFake.respondWithFileSearchResults ──────────────────

describe('AiFake.respondWithFileSearchResults', () => {
  it('returns the supplied text verbatim through an agent', async () => {
    const fake = AiFake.fake()
    fake.respondWithFileSearchResults({ text: 'The policy expires on 2027-03-01.' })

    class KnowledgeAgent extends Agent {
      instructions() { return 'Answer from the docs.' }
      tools(): FileSearchTool[] {
        return [fileSearch({ stores: ['vs_kb'] })]
      }
    }

    const response = await new KnowledgeAgent().prompt('When does the policy expire?')
    assert.equal(response.text, 'The policy expires on 2027-03-01.')

    fake.restore()
  })

  it('formats hits into a readable assistant reply', async () => {
    const fake = AiFake.fake()
    fake.respondWithFileSearchResults({
      hits: [
        { text: 'Policies renew annually.', source: 'policy.pdf', score: 0.92 },
        { text: 'Renewal happens in March.', source: 'renewal.pdf' },
      ],
    })

    class KbAgent extends Agent {
      instructions() { return 'Answer from the docs.' }
      tools(): FileSearchTool[] {
        return [fileSearch({ stores: ['vs_kb'] })]
      }
    }

    const response = await new KbAgent().prompt('How do renewals work?')
    assert.match(response.text, /Policies renew annually/)
    assert.match(response.text, /Renewal happens in March/)
    assert.match(response.text, /\(0\.92\)/)
    assert.match(response.text, /policy\.pdf/)

    fake.restore()
  })

  it('returns a no-results message when hits is empty', async () => {
    const fake = AiFake.fake()
    fake.respondWithFileSearchResults({ hits: [] })

    class KbAgent extends Agent {
      instructions() { return 'Answer from the docs.' }
      tools(): FileSearchTool[] {
        return [fileSearch({ stores: ['vs_kb'] })]
      }
    }

    const response = await new KbAgent().prompt('Anything on quantum widgets?')
    assert.equal(response.text, 'No relevant documents found.')

    fake.restore()
  })

  it('flows token usage to the AgentResponse when provided', async () => {
    const fake = AiFake.fake()
    fake.respondWithFileSearchResults({
      text:  'Result.',
      usage: { promptTokens: 100, completionTokens: 5, totalTokens: 105 },
    })

    class KbAgent extends Agent {
      instructions() { return 'Answer.' }
      tools(): FileSearchTool[] {
        return [fileSearch({ stores: ['vs_kb'] })]
      }
    }

    const response = await new KbAgent().prompt('x')
    assert.equal(response.usage.totalTokens, 105)

    fake.restore()
  })
})

// ─── Latent bug fix bundled with B8 P2: computer-use providerHint
//     now propagates through the agent loop via toolToSchema. ───────

describe('toolToSchema — propagates definition.providerHint generally', () => {
  it('copies providerHint from definition onto the emitted schema', () => {
    const stubTool = {
      definition: {
        name:         'x',
        description:  'y',
        inputSchema:  z.object({}),
        providerHint: { type: 'file-search', vector_store_ids: ['vs_x'] },
      },
    }
    const schema = toolToSchema(stubTool as unknown as { definition: import('./types.js').ToolDefinitionOptions })
    assert.equal(schema.providerHint?.type, 'file-search')
    assert.deepEqual(schema.providerHint?.['vector_store_ids'], ['vs_x'])
  })

  it('omits providerHint when definition has none', () => {
    const stubTool = {
      definition: {
        name:        'x',
        description: 'y',
        inputSchema: z.object({}),
      },
    }
    const schema = toolToSchema(stubTool as unknown as { definition: import('./types.js').ToolDefinitionOptions })
    assert.equal(schema.providerHint, undefined)
  })
})
