import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { FailoverAdapter } from './failover.js'
import { Mailable } from './mailable.js'
import type { MailAdapter, SendOptions } from './index.js'

class TestMail extends Mailable {
  build() { return this.subject('Hi').text('Body') }
}

class RecordingAdapter implements MailAdapter {
  public calls = 0
  constructor(private readonly _fail = false, private readonly _msg = 'boom') {}
  async send(_mailable: Mailable, _options: SendOptions): Promise<void> {
    this.calls++
    if (this._fail) throw new Error(this._msg)
  }
}

const opts: SendOptions = { to: ['x@example.com'], from: { address: 'from@example.com' } }

describe('FailoverAdapter', () => {
  it('returns on first successful adapter without trying later ones', async () => {
    const a = new RecordingAdapter(false)
    const b = new RecordingAdapter(false)
    const failover = new FailoverAdapter([a, b])
    await failover.send(new TestMail(), opts)
    assert.equal(a.calls, 1)
    assert.equal(b.calls, 0)
  })

  it('falls through to the next adapter when the first throws', async () => {
    const a = new RecordingAdapter(true, 'first failed')
    const b = new RecordingAdapter(false)
    const failover = new FailoverAdapter([a, b])
    await failover.send(new TestMail(), opts)
    assert.equal(a.calls, 1)
    assert.equal(b.calls, 1)
  })

  it('throws an aggregated error when every adapter fails', async () => {
    const a = new RecordingAdapter(true, 'smtp down')
    const b = new RecordingAdapter(true, 'ses down')
    const failover = new FailoverAdapter([a, b])
    await assert.rejects(
      () => failover.send(new TestMail(), opts),
      (err: Error) => {
        assert.match(err.message, /All mailers failed/)
        assert.match(err.message, /smtp down/)
        assert.match(err.message, /ses down/)
        return true
      },
    )
  })

  it('skips a mailer that failed within the retryAfter window', async () => {
    const a = new RecordingAdapter(true, 'first failed')
    const b = new RecordingAdapter(false)
    const failover = new FailoverAdapter([a, b], 60)
    await failover.send(new TestMail(), opts) // first fails, b serves
    await failover.send(new TestMail(), opts) // a still in cooldown, only b called

    assert.equal(a.calls, 1, 'a should not retry within the window')
    assert.equal(b.calls, 2)
  })

  it('retries a previously failed mailer after the retryAfter window elapses', async () => {
    let now = 1_000_000
    const realNow = Date.now
    Date.now = () => now
    try {
      const a = new RecordingAdapter(true, 'transient')
      const b = new RecordingAdapter(false)
      const failover = new FailoverAdapter([a, b], 1) // 1-second window

      await failover.send(new TestMail(), opts)  // a fails, b succeeds
      assert.equal(a.calls, 1)

      now += 2_000  // advance past the retry window
      await failover.send(new TestMail(), opts)
      assert.equal(a.calls, 2, 'a should be retried after the window')
    } finally {
      Date.now = realNow
    }
  })

  it('throws when the adapter list is empty (no mailers to try)', async () => {
    const failover = new FailoverAdapter([])
    await assert.rejects(
      () => failover.send(new TestMail(), opts),
      /All mailers failed/,
    )
  })
})
