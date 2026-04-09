import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { CacheRegistry, MemoryAdapter } from '@rudderjs/cache'
import {
  storeSubRun,
  loadSubRun,
  consumeSubRun,
  type SubRunState,
} from '../handlers/agentStream/runStore.js'

/**
 * Phase 1 verification for subagent-client-tools-plan: the runStore's new
 * sub-agent helpers round-trip a `SubRunState` through @rudderjs/cache.
 *
 * The runStore lazy-imports @rudderjs/cache via a dynamic import, so we
 * register a MemoryAdapter on the `CacheRegistry` before any helper runs.
 * No process-wide side effects — the registry is reset in `after`.
 */
describe('runStore — subagent helpers', () => {
  before(() => {
    CacheRegistry.set(new MemoryAdapter())
  })

  after(() => {
    CacheRegistry.reset()
  })

  beforeEach(() => {
    // Flush between tests so subRunIds don't bleed across cases.
    CacheRegistry.get()?.flush()
  })

  const baseState: SubRunState = {
    kind:             'subagent',
    subAgentSlug:     'improve-content',
    parentToolCallId: 'call_parent_run_agent_1',
    resourceSlug:     'articles',
    recordId:         'cmnpcasnj001o17y4a0oehx5s',
    fieldScope:       undefined,
    subMessages: [
      { role: 'user',      content: 'Run your task on this record.' },
      { role: 'assistant', content: '', toolCalls: [
        { id: 'call_ufs_1', name: 'update_form_state', arguments: { field: 'title', operations: [] } },
      ] },
    ],
    pendingToolCallIds: ['call_ufs_1'],
    stepsSoFar:         2,
    tokensSoFar:        150,
    userId:             'user-42',
  }

  it('storeSubRun → loadSubRun round-trips state verbatim', async () => {
    await storeSubRun('sub-run-abc', baseState)
    const loaded = await loadSubRun('sub-run-abc')
    assert.deepStrictEqual(loaded, baseState)
  })

  it('loadSubRun returns null for unknown id', async () => {
    const loaded = await loadSubRun('does-not-exist')
    assert.strictEqual(loaded, null)
  })

  it('consumeSubRun reads then deletes (atomic pull)', async () => {
    await storeSubRun('sub-run-pull', baseState)
    const first = await consumeSubRun('sub-run-pull')
    assert.deepStrictEqual(first, baseState)

    // Second consume MUST miss — the store entry is gone after pull.
    const second = await consumeSubRun('sub-run-pull')
    assert.strictEqual(second, null)

    // loadSubRun after a consume also misses.
    const third = await loadSubRun('sub-run-pull')
    assert.strictEqual(third, null)
  })

  it('preserves fieldScope when set', async () => {
    const scoped: SubRunState = { ...baseState, fieldScope: ['metaTitle', 'metaDescription'] }
    await storeSubRun('sub-run-scoped', scoped)
    const loaded = await loadSubRun('sub-run-scoped')
    assert.deepStrictEqual(loaded?.fieldScope, ['metaTitle', 'metaDescription'])
  })

  it('sub-run key prefix is disjoint from standalone run key prefix', async () => {
    // Store a sub-run and a would-be standalone run with the same id.
    // Because their cache keys have different prefixes, both coexist.
    await storeSubRun('shared-id', baseState)
    // Simulate a standalone run with the same id under its own prefix.
    await CacheRegistry.get()!.set('panels:agent-run:shared-id', { different: 'value' }, 300)

    const sub = await loadSubRun('shared-id')
    assert.deepStrictEqual(sub, baseState)
    // The standalone-prefix entry is untouched.
    const standalone = await CacheRegistry.get()!.get('panels:agent-run:shared-id')
    assert.deepStrictEqual(standalone, { different: 'value' })
  })
})
