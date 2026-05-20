import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { registerDoctorCheck, resetDoctorRegistry } from '@rudderjs/console'
import { applyFixes } from './fixer.js'
import type { CheckOutcome } from './orchestrator.js'

function outcome(o: Partial<CheckOutcome> & Pick<CheckOutcome, 'id' | 'status'>): CheckOutcome {
  return {
    category:   'env',
    title:      o.id,
    message:    '',
    durationMs: 0,
    ...o,
  } as CheckOutcome
}

beforeEach(() => resetDoctorRegistry())

describe('applyFixes', () => {
  it('returns zero-eligible when no outcomes are failing', async () => {
    registerDoctorCheck({
      id: 'a', category: 'env', title: 'A',
      run:   () => ({ status: 'ok', message: 'ok' }),
      fixer: () => ({ status: 'ok', message: 'should not run' }),
    })
    const result = await applyFixes([outcome({ id: 'a', status: 'ok' })])
    assert.strictEqual(result.eligible, 0)
    assert.strictEqual(result.applied,  0)
    assert.strictEqual(result.outcomes.length, 0)
  })

  it('returns zero-eligible when failing checks have no fixer', async () => {
    registerDoctorCheck({
      id: 'a', category: 'env', title: 'A',
      run:   () => ({ status: 'error', message: 'broken' }),
      // no fixer
    })
    const result = await applyFixes([outcome({ id: 'a', status: 'error' })])
    assert.strictEqual(result.eligible, 0)
  })

  it('runs the fixer when accepted and reports the new status', async () => {
    registerDoctorCheck({
      id: 'a', category: 'env', title: 'A',
      run:   () => ({ status: 'error', message: 'broken' }),
      fixer: () => ({ status: 'ok', message: 'regenerated' }),
    })
    const result = await applyFixes([outcome({ id: 'a', status: 'error' })], { yes: true })
    assert.strictEqual(result.eligible, 1)
    assert.strictEqual(result.applied,  1)
    assert.strictEqual(result.outcomes[0]!.after, 'ok')
    assert.strictEqual(result.outcomes[0]!.before, 'error')
    assert.strictEqual(result.outcomes[0]!.message, 'regenerated')
    assert.strictEqual(result.outcomes[0]!.skipped, false)
  })

  it('skips when the prompt returns false (no fixer call)', async () => {
    let called = 0
    registerDoctorCheck({
      id: 'a', category: 'env', title: 'A',
      run:   () => ({ status: 'error', message: 'broken' }),
      fixer: () => { called++; return { status: 'ok', message: 'ran' } },
    })
    const result = await applyFixes([outcome({ id: 'a', status: 'error' })], { prompt: () => false })
    assert.strictEqual(called, 0)
    assert.strictEqual(result.applied, 0)
    assert.strictEqual(result.outcomes[0]!.skipped, true)
    assert.strictEqual(result.outcomes[0]!.after, 'error', 'before-status should carry through when skipped')
  })

  it('captures fixer-thrown errors as red results without crashing', async () => {
    registerDoctorCheck({
      id: 'a', category: 'env', title: 'A',
      run:   () => ({ status: 'error', message: 'broken' }),
      fixer: () => { throw new Error('boom') },
    })
    const result = await applyFixes([outcome({ id: 'a', status: 'error' })], { yes: true })
    assert.strictEqual(result.outcomes[0]!.after, 'error')
    assert.ok(result.outcomes[0]!.error?.includes('boom'))
    assert.ok(result.outcomes[0]!.message.includes('fixer threw'))
  })

  it('handles a mix of fixable, unfixable, and ok outcomes', async () => {
    registerDoctorCheck({
      id: 'fixable',  category: 'env', title: 'fixable',
      run:   () => ({ status: 'error', message: 'x' }),
      fixer: () => ({ status: 'ok', message: 'fixed' }),
    })
    registerDoctorCheck({
      id: 'unfixable', category: 'env', title: 'unfixable',
      run:   () => ({ status: 'error', message: 'y' }),
    })
    registerDoctorCheck({
      id: 'passing', category: 'env', title: 'passing',
      run:   () => ({ status: 'ok', message: 'z' }),
      // has fixer, but check is passing, so not eligible
      fixer: () => ({ status: 'ok', message: 'wont run' }),
    })

    const result = await applyFixes([
      outcome({ id: 'fixable',   status: 'error' }),
      outcome({ id: 'unfixable', status: 'error' }),
      outcome({ id: 'passing',   status: 'ok'    }),
    ], { yes: true })

    assert.strictEqual(result.eligible, 1)
    assert.strictEqual(result.applied,  1)
    assert.strictEqual(result.outcomes.length, 1)
    assert.strictEqual(result.outcomes[0]!.id, 'fixable')
  })

  it('fires fixers for warn-status failures too (not just error)', async () => {
    registerDoctorCheck({
      id: 'stale', category: 'deps', title: 'stale manifest',
      run:   () => ({ status: 'warn', message: 'old' }),
      fixer: () => ({ status: 'ok',   message: 'refreshed' }),
    })
    const result = await applyFixes([outcome({ id: 'stale', status: 'warn' })], { yes: true })
    assert.strictEqual(result.applied, 1)
    assert.strictEqual(result.outcomes[0]!.before, 'warn')
    assert.strictEqual(result.outcomes[0]!.after,  'ok')
  })

  it('passes the check + outcome to the prompt callback', async () => {
    registerDoctorCheck({
      id: 'a', category: 'env', title: 'Pretty Title',
      run:   () => ({ status: 'error', message: 'msg' }),
      fixer: () => ({ status: 'ok', message: '' }),
    })
    let seenCheck: { id: string; title: string } | undefined
    let seenOutcome: { status: string; message: string } | undefined
    await applyFixes(
      [outcome({ id: 'a', status: 'error', message: 'msg' })],
      { prompt: (check, oc) => {
        seenCheck   = { id: check.id, title: check.title }
        seenOutcome = { status: oc.status, message: oc.message }
        return true
      } },
    )
    assert.deepStrictEqual(seenCheck,   { id: 'a',   title: 'Pretty Title' })
    assert.deepStrictEqual(seenOutcome, { status: 'error', message: 'msg' })
  })
})
