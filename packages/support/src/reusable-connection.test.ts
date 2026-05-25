import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { reusableConnection } from './index.js'

// Pins the dev-HMR connection-reuse contract shared by @rudderjs/cache,
// @rudderjs/session, and the orm adapters: same signature reuses the live
// connection; a changed signature builds fresh + disposes the superseded one.

const KEY = '__test_reusable_conn__'
const G = globalThis as Record<string, unknown>
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 10))

describe('reusableConnection', () => {
  beforeEach(() => { delete G[KEY] })

  it('reuses the connection across calls with the same signature', async () => {
    let builds = 0
    const build = async (): Promise<{ id: number }> => { builds++; return { id: builds } }

    const a = await reusableConnection(KEY, 'sig1', build, () => {})
    const b = await reusableConnection(KEY, 'sig1', build, () => {})

    assert.equal(builds, 1, 'second call must not rebuild')
    assert.strictEqual(b, a, 'same live connection returned')
  })

  it('builds fresh and disposes the superseded one on a signature change', async () => {
    const disposed: number[] = []
    let builds = 0
    const build = async (): Promise<{ id: number }> => { builds++; return { id: builds } }
    const dispose = (v: { id: number }): void => { disposed.push(v.id) }

    const a = await reusableConnection(KEY, 'sig1', build, dispose)
    const b = await reusableConnection(KEY, 'sig2', build, dispose)
    await settle() // dispose is fire-and-forget on a microtask

    assert.equal(builds, 2, 'a changed signature rebuilds')
    assert.notStrictEqual(b, a)
    assert.deepEqual(disposed, [1], 'the old connection is disposed; the new one is kept')
  })

  it('dedupes concurrent first-callers onto a single build', async () => {
    let builds = 0
    const build = async (): Promise<{ id: number }> => { builds++; await settle(); return { id: builds } }

    const [a, b] = await Promise.all([
      reusableConnection(KEY, 'sig1', build, () => {}),
      reusableConnection(KEY, 'sig1', build, () => {}),
    ])

    assert.equal(builds, 1, 'concurrent callers share one build')
    assert.strictEqual(a, b)
  })

  it('does not cache a failed build (next call retries)', async () => {
    let attempts = 0
    const build = async (): Promise<{ id: number }> => {
      attempts++
      if (attempts === 1) throw new Error('boom')
      return { id: attempts }
    }

    await assert.rejects(reusableConnection(KEY, 'sig1', build, () => {}))
    await settle()
    const ok = await reusableConnection(KEY, 'sig1', build, () => {})

    assert.equal(attempts, 2, 'the failed build is not cached; the next call retries')
    assert.equal(ok.id, 2)
  })
})
