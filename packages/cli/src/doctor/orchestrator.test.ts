import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { registerDoctorCheck, resetDoctorRegistry } from '@rudderjs/console'
import { runChecks } from './orchestrator.js'

beforeEach(() => resetDoctorRegistry())

describe('runChecks', () => {
  it('runs all registered checks and reports counts', async () => {
    registerDoctorCheck({ id: 'a', category: 'env',       title: 'A', run: () => ({ status: 'ok',    message: 'a' }) })
    registerDoctorCheck({ id: 'b', category: 'env',       title: 'B', run: () => ({ status: 'warn',  message: 'b', fix: 'do x' }) })
    registerDoctorCheck({ id: 'c', category: 'structure', title: 'C', run: () => ({ status: 'error', message: 'c' }) })

    const result = await runChecks()
    assert.strictEqual(result.outcomes.length, 3)
    assert.deepStrictEqual(result.counts, { ok: 1, warn: 1, error: 1 })
  })

  it('wraps thrown checks as red outcomes (does not crash the run)', async () => {
    registerDoctorCheck({
      id: 'throws', category: 'env', title: 'Throws',
      run: () => { throw new Error('boom') },
    })
    const result = await runChecks()
    assert.strictEqual(result.outcomes.length, 1)
    assert.strictEqual(result.outcomes[0]!.status,  'error')
    assert.ok(result.outcomes[0]!.message.includes('unhandled exception'))
    assert.ok(result.outcomes[0]!.message.includes('boom'))
  })

  it('await-resolves async checks', async () => {
    registerDoctorCheck({
      id: 'async', category: 'env', title: 'async',
      run: async () => {
        await new Promise(r => setTimeout(r, 1))
        return { status: 'ok', message: 'resolved' }
      },
    })
    const result = await runChecks()
    assert.strictEqual(result.outcomes[0]!.status, 'ok')
    assert.strictEqual(result.outcomes[0]!.message, 'resolved')
  })

  it('skips needsBoot:true checks unless deep is set', async () => {
    registerDoctorCheck({ id: 'fast', category: 'env', title: 'fast', run: () => ({ status: 'ok', message: '' }) })
    registerDoctorCheck({ id: 'deep', category: 'runtime', title: 'deep', needsBoot: true, run: () => ({ status: 'ok', message: '' }) })

    const shallow = await runChecks()
    assert.deepStrictEqual(shallow.outcomes.map(o => o.id), ['fast'])

    const deep = await runChecks({ deep: true })
    assert.deepStrictEqual(deep.outcomes.map(o => o.id).sort(), ['deep', 'fast'])
  })

  it('filter narrows by id substring', async () => {
    registerDoctorCheck({ id: 'env:node',       category: 'env', title: '', run: () => ({ status: 'ok', message: '' }) })
    registerDoctorCheck({ id: 'env:app-key',    category: 'env', title: '', run: () => ({ status: 'ok', message: '' }) })
    registerDoctorCheck({ id: 'structure:web',  category: 'structure', title: '', run: () => ({ status: 'ok', message: '' }) })

    const result = await runChecks({ filter: 'env:' })
    assert.deepStrictEqual(result.outcomes.map(o => o.id).sort(), ['env:app-key', 'env:node'])
  })

  it('empty registry produces zero counts', async () => {
    const result = await runChecks()
    assert.strictEqual(result.outcomes.length, 0)
    assert.deepStrictEqual(result.counts, { ok: 0, warn: 0, error: 0 })
  })

  it('groups checks by category in declared order', async () => {
    registerDoctorCheck({ id: '1', category: 'env',       title: '', run: () => ({ status: 'ok', message: '' }) })
    registerDoctorCheck({ id: '2', category: 'structure', title: '', run: () => ({ status: 'ok', message: '' }) })
    registerDoctorCheck({ id: '3', category: 'env',       title: '', run: () => ({ status: 'ok', message: '' }) })
    const result = await runChecks()
    // env outcomes come before structure (first-seen category order)
    assert.deepStrictEqual(result.outcomes.map(o => o.id), ['1', '3', '2'])
  })
})
