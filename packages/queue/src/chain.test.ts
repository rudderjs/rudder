import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Job, QueueRegistry, SyncAdapter } from './index.js'
import { Chain, getChainState } from './chain.js'

class StatefulJob extends Job {
  ran = false
  observedState: Record<string, unknown> | null = null
  constructor(private readonly _writeKey?: string, private readonly _writeValue?: unknown) { super() }
  async handle(): Promise<void> {
    this.ran = true
    const state = getChainState(this)
    this.observedState = { ...state }
    if (this._writeKey !== undefined) state[this._writeKey] = this._writeValue
  }
}

class FailingJob extends Job {
  async handle(): Promise<void> {
    throw new Error('chain-boom')
  }
}

describe('Chain', () => {
  beforeEach(() => {
    QueueRegistry.reset()
    QueueRegistry.set(new SyncAdapter())
  })

  it('dispatches jobs sequentially', async () => {
    const a = new StatefulJob()
    const b = new StatefulJob()
    const c = new StatefulJob()

    await Chain.of([a, b, c]).dispatch()

    assert.strictEqual(a.ran, true)
    assert.strictEqual(b.ran, true)
    assert.strictEqual(c.ran, true)
  })

  it('shares state between chained jobs', async () => {
    const a = new StatefulJob('value', 42)
    const b = new StatefulJob() // observes state without writing

    await Chain.of([a, b]).dispatch()

    assert.deepStrictEqual(a.observedState, {})
    assert.deepStrictEqual(b.observedState, { value: 42 })
  })

  it('stops at first failure and fires onFailure', async () => {
    const a = new StatefulJob()
    const b = new FailingJob()
    const c = new StatefulJob()

    let caughtError: unknown = null
    let caughtJob: Job | null = null

    await assert.rejects(async () =>
      await Chain.of([a, b, c])
        .onFailure((err, job) => { caughtError = err; caughtJob = job })
        .dispatch()
    )

    assert.strictEqual(a.ran, true)
    assert.strictEqual(c.ran, false, 'jobs after failure should not run')
    assert.ok(caughtError instanceof Error)
    assert.match((caughtError as Error).message, /chain-boom/)
    assert.strictEqual(caughtJob, b)
  })

  it('getChainState returns empty for jobs not in a chain', () => {
    const orphan = new StatefulJob()
    assert.deepStrictEqual(getChainState(orphan), {})
  })
})
