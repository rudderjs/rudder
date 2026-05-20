import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { renderReport, exitCodeFor } from './reporter.js'
import type { RunResult } from './orchestrator.js'

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
    assert.ok(out.includes('RudderJS Doctor'))
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
