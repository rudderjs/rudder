import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { detailViews } from './views.js'
import type { TelescopeEntry } from '../../../types.js'

/**
 * Smoke + regression coverage for the three largest detail views — the
 * ones extracted into siblings by PR #433 (`request-views.ts`,
 * `ai-views.ts`). Uses substring assertions over deterministic fixtures
 * rather than full snapshots so cosmetic Tailwind class tweaks don't
 * churn the test file.
 *
 * The goal isn't to pin every detail of the rendered HTML — it's to
 * pin the *contracts*: which content keys flow into which UI region,
 * and what badges/tabs the user sees for the canonical states.
 */

function entry<T extends TelescopeEntry['type']>(
  type:    T,
  content: Record<string, unknown>,
  extra?:  Partial<Pick<TelescopeEntry, 'tags' | 'batchId'>>,
): TelescopeEntry {
  return {
    id:         'test-id',
    batchId:    extra?.batchId ?? null,
    type:       type as TelescopeEntry['type'],
    content,
    tags:       extra?.tags ?? [],
    familyHash: null,
    createdAt:  new Date('2026-05-13T17:00:00.000Z'),
  }
}

describe('RequestView', () => {
  it('renders method/path/status table + Payload tab even when empty', () => {
    const out = detailViews['request']!(entry('request', {
      method:  'GET',
      path:    '/api/users',
      status:  200,
      duration: 12,
    })).value

    assert.match(out, /Request Details/)
    assert.match(out, /\bGET\b/)
    assert.match(out, /\/api\/users/)
    assert.match(out, />200</)             // status badge
    assert.match(out, />12ms</)            // duration
    assert.match(out, /Payload/)           // always-on tab
  })

  it('renders the Authenticated User card when content.user is present', () => {
    const out = detailViews['request']!(entry('request', {
      method: 'GET',
      path:   '/dashboard',
      status: 200,
      user:   { id: 1, name: 'Suleiman', email: 's@example.com' },
    })).value

    assert.match(out, /Authenticated User/)
    assert.match(out, /Suleiman/)
    assert.match(out, /s@example\.com/)
  })

  it('renders Session tab when content.session has keys', () => {
    const out = detailViews['request']!(entry('request', {
      method:  'GET',
      path:    '/x',
      status:  200,
      session: { user_id: 1, csrf: 'abc' },
    })).value

    assert.match(out, /Session/)
    assert.match(out, /user_id/)
  })

  it('renders tag pills when entry has tags', () => {
    const out = detailViews['request']!(entry('request', {
      method: 'GET', path: '/x', status: 500,
    }, { tags: ['slow', 'error'] })).value

    assert.match(out, />slow</)
    assert.match(out, />error</)
  })
})

describe('HttpView', () => {
  it('renders method/URL/status for outbound HTTP requests', () => {
    const out = detailViews['http']!(entry('http', {
      method:   'POST',
      url:      'https://api.example.com/users',
      status:   201,
      duration: 234,
      resSize:  512,
    })).value

    assert.match(out, /\bPOST\b/)
    assert.match(out, /https:\/\/api\.example\.com\/users/)
    assert.match(out, />201</)
    assert.match(out, />234ms</)
    assert.match(out, /512 bytes/)
    assert.match(out, /Payload/)
    assert.match(out, /Headers/)
  })

  it('renders FAILED badge + Error card on request.failed entries', () => {
    const out = detailViews['http']!(entry('http', {
      method: 'GET',
      url:    'https://timeout.example/',
      kind:   'request.failed',
      error:  'ETIMEDOUT after 5000ms',
    })).value

    assert.match(out, /FAILED/)
    assert.match(out, /Error/)
    assert.match(out, /ETIMEDOUT/)
  })
})

describe('AiView', () => {
  it('renders agent/model/duration with Completed badge', () => {
    const out = detailViews['ai']!(entry('ai', {
      status:    'completed',
      agentName: 'ResearchAgent',
      model:     'anthropic/claude-opus-4-7',
      provider:  'anthropic',
      duration:  1840,
      input:     'What is Rust?',
      output:    'Rust is a systems programming language...',
    })).value

    assert.match(out, /Completed/)
    assert.match(out, /ResearchAgent/)
    assert.match(out, /claude-opus-4-7/)
    assert.match(out, /anthropic/)
    assert.match(out, />1840ms</)
    assert.match(out, /Output/)
    assert.match(out, /Input/)
  })

  it('renders Failed badge + Error card when status is failed', () => {
    const out = detailViews['ai']!(entry('ai', {
      status:   'failed',
      agentName: 'BrokenAgent',
      provider:  'openai',
      model:     'openai/gpt-5',
      error:     'rate_limit_exceeded',
    })).value

    assert.match(out, /Failed/)
    assert.match(out, /Error/)
    assert.match(out, /rate_limit_exceeded/)
  })

  it('renders Tool Calls + Steps tabs (pins the renderToolCalls/renderSteps refactor)', () => {
    const out = detailViews['ai']!(entry('ai', {
      status:    'completed',
      agentName: 'A',
      model:     'x/y',
      provider:  'x',
      input:     'q',
      output:    'a',
      toolCalls: [
        { name: 'search',   args: { q: 'rust' },   result: { hits: 3 }, duration: 45 },
        { name: 'fetch_url', args: { url: '/r' }, result: 'ok',         duration: 12 },
      ],
      steps: [
        { finishReason: 'tool_use', toolCalls: [1, 2], usage: { totalTokens: 100 } },
        { finishReason: 'stop',     toolCalls: [],      usage: { totalTokens: 50 } },
      ],
    })).value

    assert.match(out, /Tool Calls \(2\)/)
    assert.match(out, /Steps \(2\)/)
    assert.match(out, />search</)
    assert.match(out, />fetch_url</)
    // Pin: tool-call render uses the html`${arr.map(...)}` pattern from PR #432.
    // If anyone regresses to .map().join(''), the SafeString[] gets re-escaped
    // and Badge HTML appears as literal "&lt;span..." in the output. Asserting
    // a plain Badge span survives proves the SafeString[] path still works.
    assert.match(out, /<span class="[^"]*inline-flex/)
  })

  it('renders Token Usage card when content.usage is present', () => {
    const out = detailViews['ai']!(entry('ai', {
      status:    'completed',
      agentName: 'A',
      model:     'x/y',
      provider:  'x',
      input:     'q',
      output:    'a',
      usage:     { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    })).value

    assert.match(out, /Token Usage/)
    assert.match(out, />100</)
    assert.match(out, />50</)
    assert.match(out, />150</)
  })
})
