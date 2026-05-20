import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { renderReport, renderFixReport, exitCodeFor } from './reporter.js'
import type { RunResult } from './orchestrator.js'
import type { FixResult } from './fixer.js'

function makeResult(partial: Partial<RunResult> & { outcomes: RunResult['outcomes'] }): RunResult {
  const counts = { ok: 0, warn: 0, error: 0 }
  for (const o of partial.outcomes) counts[o.status]++
  return {
    outcomes: partial.outcomes,
    totalMs:  partial.totalMs ?? 0,
    counts,
  }
}

describe('renderReport', () => {
  it('renders the empty state cleanly', () => {
    const out = renderReport(makeResult({ outcomes: [] }), { plain: true })
    assert.ok(out.includes('Rudder Doctor'))
    assert.ok(out.includes('No checks registered'))
    assert.ok(out.includes('0 checks'))
  })

  it('renders icons for ok / warn / error', () => {
    const out = renderReport(makeResult({
      outcomes: [
        { id: 'a', category: 'env', title: 'A', status: 'ok',    message: 'fine',     durationMs: 1 },
        { id: 'b', category: 'env', title: 'B', status: 'warn',  message: 'maybe',    durationMs: 1 },
        { id: 'c', category: 'env', title: 'C', status: 'error', message: 'broken',   durationMs: 1 },
      ],
    }), { plain: true })
    assert.ok(out.includes('✓ A'))
    assert.ok(out.includes('⚠ B'))
    assert.ok(out.includes('✗ C'))
  })

  it('prints fix line under failing checks', () => {
    const out = renderReport(makeResult({
      outcomes: [
        { id: 'a', category: 'env', title: 'A', status: 'error', message: 'broken',
          fix: 'pnpm rudder providers:discover', durationMs: 1 },
      ],
    }), { plain: true })
    assert.ok(out.includes('fix: pnpm rudder providers:discover'))
  })

  it('renders one category header per category', () => {
    const out = renderReport(makeResult({
      outcomes: [
        { id: 'a', category: 'env',       title: 'A', status: 'ok', message: '', durationMs: 1 },
        { id: 'b', category: 'structure', title: 'B', status: 'ok', message: '', durationMs: 1 },
      ],
    }), { plain: true })
    const envCount = (out.match(/^env$/gm) ?? []).length
    const strCount = (out.match(/^structure$/gm) ?? []).length
    assert.strictEqual(envCount, 1)
    assert.strictEqual(strCount, 1)
  })

  it('shows detail under failures by default but not under ok', () => {
    const out = renderReport(makeResult({
      outcomes: [
        { id: 'a', category: 'env', title: 'A', status: 'ok',    message: 'fine',
          detail: 'verbose-only', durationMs: 1 },
        { id: 'b', category: 'env', title: 'B', status: 'error', message: 'broken',
          detail: 'shown-on-error', durationMs: 1 },
      ],
    }), { plain: true })
    assert.ok(!out.includes('verbose-only'))
    assert.ok(out.includes('shown-on-error'))
  })

  it('--verbose shows detail under ok checks too', () => {
    const out = renderReport(makeResult({
      outcomes: [
        { id: 'a', category: 'env', title: 'A', status: 'ok', message: 'fine',
          detail: 'verbose-only', durationMs: 1 },
      ],
    }), { plain: true, verbose: true })
    assert.ok(out.includes('verbose-only'))
  })

  it('footer includes total counts + timing', () => {
    const out = renderReport(makeResult({
      outcomes: [
        { id: 'a', category: 'env', title: 'A', status: 'ok',    message: '', durationMs: 1 },
        { id: 'b', category: 'env', title: 'B', status: 'warn',  message: '', durationMs: 1 },
        { id: 'c', category: 'env', title: 'C', status: 'error', message: '', durationMs: 1 },
      ],
      totalMs: 42,
    }), { plain: true })
    assert.ok(out.includes('3 checks'))
    assert.ok(out.includes('1 ok'))
    assert.ok(out.includes('1 warn'))
    assert.ok(out.includes('1 errors'))
    assert.ok(out.includes('42ms'))
  })
})

describe('renderFixReport', () => {
  it('renders empty state cleanly when nothing was fixable', () => {
    const out = renderFixReport({ outcomes: [], eligible: 0, applied: 0 }, { plain: true })
    assert.ok(out.includes('Fixes'))
    assert.ok(out.includes('No fixable failures'))
  })

  it('shows before → after status per outcome', () => {
    const fix: FixResult = {
      outcomes: [
        { id: 'a', title: 'Manifest', before: 'error', after: 'ok', skipped: false,
          message: 'regenerated', durationMs: 5 },
      ],
      eligible: 1, applied: 1,
    }
    const out = renderFixReport(fix, { plain: true })
    assert.ok(out.includes('✗') && out.includes('→') && out.includes('✓'))
    assert.ok(out.includes('Manifest'))
    assert.ok(out.includes('regenerated'))
  })

  it('marks skipped outcomes with a dash and "skipped" label', () => {
    const fix: FixResult = {
      outcomes: [
        { id: 'a', title: 'Manifest', before: 'error', after: 'error', skipped: true,
          message: 'skipped', durationMs: 0 },
      ],
      eligible: 1, applied: 0,
    }
    const out = renderFixReport(fix, { plain: true })
    assert.ok(out.includes('skipped'))
    assert.ok(out.includes('Manifest'))
  })

  it('summary counts fixed / failed / skipped', () => {
    const fix: FixResult = {
      outcomes: [
        { id: 'a', title: 'A', before: 'error', after: 'ok',    skipped: false, message: '', durationMs: 1 },
        { id: 'b', title: 'B', before: 'error', after: 'error', skipped: false, message: '', durationMs: 1, error: 'oops' },
        { id: 'c', title: 'C', before: 'warn',  after: 'warn',  skipped: true,  message: 'skipped', durationMs: 0 },
      ],
      eligible: 3, applied: 2,
    }
    const out = renderFixReport(fix, { plain: true })
    assert.ok(out.includes('3 fixable'))
    assert.ok(out.includes('1 fixed'))
    assert.ok(out.includes('1 failed'))
    assert.ok(out.includes('1 skipped'))
  })

  it('renders fixer error block under failed outcomes', () => {
    const fix: FixResult = {
      outcomes: [
        { id: 'a', title: 'A', before: 'error', after: 'error', skipped: false,
          message: 'fixer threw: boom', error: 'boom', durationMs: 1 },
      ],
      eligible: 1, applied: 1,
    }
    const out = renderFixReport(fix, { plain: true })
    assert.ok(out.includes('boom'))
  })
})

describe('exitCodeFor', () => {
  it('returns 0 with no errors', () => {
    assert.strictEqual(exitCodeFor(makeResult({
      outcomes: [
        { id: 'a', category: 'env', title: '', status: 'ok',   message: '', durationMs: 1 },
        { id: 'b', category: 'env', title: '', status: 'warn', message: '', durationMs: 1 },
      ],
    })), 0)
  })

  it('returns 1 with at least one error', () => {
    assert.strictEqual(exitCodeFor(makeResult({
      outcomes: [
        { id: 'a', category: 'env', title: '', status: 'error', message: '', durationMs: 1 },
      ],
    })), 1)
  })
})
