import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { Mail, MailRegistry } from './index.js'
import { FakeMailAdapter } from './fake.js'
import { Mailable } from './mailable.js'

class WelcomeMail extends Mailable {
  public userId?: number
  build() { return this.subject('Welcome').text('Body') }
}

function welcomeFor(userId: number): WelcomeMail {
  const m = new WelcomeMail()
  m.userId = userId
  return m
}

class GoodbyeMail extends Mailable {
  build() { return this.subject('Goodbye').text('Body') }
}

describe('FakeMailAdapter', () => {
  let fake: FakeMailAdapter

  beforeEach(() => { fake = FakeMailAdapter.fake() })
  afterEach(() => { fake.restore() })

  describe('sent recording', () => {
    it('records every send through Mail.to(...).send()', async () => {
      await Mail.to('a@example.com').send(new WelcomeMail())
      await Mail.to('b@example.com').send(new WelcomeMail())
      assert.equal(fake.sent().length, 2)
    })

    it('filters by mailable class', async () => {
      await Mail.to('a@example.com').send(new WelcomeMail())
      await Mail.to('b@example.com').send(new GoodbyeMail())
      assert.equal(fake.sent(WelcomeMail).length, 1)
      assert.equal(fake.sent(GoodbyeMail).length, 1)
    })

    it('preserves recipient options on the recorded entry', async () => {
      await Mail.to('to@example.com').cc('cc@example.com').send(new WelcomeMail())
      const [entry] = fake.sent()
      assert.deepEqual(entry?.options.to, ['to@example.com'])
      assert.deepEqual(entry?.options.cc, ['cc@example.com'])
    })
  })

  describe('assertSent', () => {
    it('passes when the mailable was sent', async () => {
      await Mail.to('a@example.com').send(new WelcomeMail())
      fake.assertSent(WelcomeMail)
    })

    it('throws when the mailable was NOT sent', async () => {
      assert.throws(() => fake.assertSent(WelcomeMail), /Expected "WelcomeMail" to be sent/)
    })

    it('honors the predicate filter — passes when at least one matches', async () => {
      await Mail.to('a@example.com').send(welcomeFor(1))
      await Mail.to('b@example.com').send(welcomeFor(2))
      fake.assertSent(WelcomeMail, ({ mailable }) =>
        (mailable as WelcomeMail).userId === 2,
      )
    })

    it('throws when the predicate matches nothing', async () => {
      await Mail.to('a@example.com').send(welcomeFor(1))
      assert.throws(
        () => fake.assertSent(WelcomeMail, ({ mailable }) =>
          (mailable as WelcomeMail).userId === 99,
        ),
        /Expected "WelcomeMail" to be sent/,
      )
    })
  })

  describe('assertNotSent / assertNothingSent', () => {
    it('assertNotSent passes when the class never went through', async () => {
      await Mail.to('a@example.com').send(new WelcomeMail())
      fake.assertNotSent(GoodbyeMail)
    })

    it('assertNotSent throws when the class WAS sent', async () => {
      await Mail.to('a@example.com').send(new WelcomeMail())
      assert.throws(() => fake.assertNotSent(WelcomeMail), /Expected "WelcomeMail" not to be sent/)
    })

    it('assertNothingSent passes when no sends happened', () => {
      fake.assertNothingSent()
    })

    it('assertNothingSent throws after any send', async () => {
      await Mail.to('a@example.com').send(new WelcomeMail())
      assert.throws(() => fake.assertNothingSent(), /Expected no mail to be sent/)
    })
  })

  describe('assertSentCount', () => {
    it('matches the exact total across classes', async () => {
      await Mail.to('a@example.com').send(new WelcomeMail())
      await Mail.to('b@example.com').send(new GoodbyeMail())
      fake.assertSentCount(2)
    })

    it('throws on mismatch', async () => {
      await Mail.to('a@example.com').send(new WelcomeMail())
      assert.throws(() => fake.assertSentCount(2))
    })
  })

  describe('queued tracking via recordQueued', () => {
    it('assertQueued passes when recordQueued was invoked for the class', () => {
      fake.recordQueued(new WelcomeMail(), { to: ['x@example.com'], from: { address: 'f@x' } })
      fake.assertQueued(WelcomeMail)
    })

    it('assertNotQueued passes when nothing was queued', () => {
      fake.assertNotQueued(WelcomeMail)
    })

    it('assertNothingQueued passes when nothing was queued', () => {
      fake.assertNothingQueued()
    })

    it('queued() returns the recorded entries', () => {
      fake.recordQueued(welcomeFor(7), { to: ['x@example.com'], from: { address: 'f@x' } })
      const entries = fake.queued(WelcomeMail)
      assert.equal(entries.length, 1)
      assert.equal((entries[0]?.mailable as WelcomeMail).userId, 7)
    })
  })

  describe('install + restore', () => {
    it('replaces the registered adapter on fake() and restores on restore()', () => {
      assert.strictEqual(MailRegistry.get(), fake)
      fake.restore()
      assert.strictEqual(MailRegistry.get(), null)
    })
  })

  describe('assertSentTimes / assertQueuedTimes', () => {
    it('assertSentTimes passes for the exact count', async () => {
      await Mail.to('a@example.com').send(new WelcomeMail())
      await Mail.to('b@example.com').send(new WelcomeMail())
      fake.assertSentTimes(WelcomeMail, 2)
    })

    it('assertSentTimes throws when off by one', async () => {
      await Mail.to('a@example.com').send(new WelcomeMail())
      assert.throws(
        () => fake.assertSentTimes(WelcomeMail, 2),
        /to be sent 2 time\(s\), but it was sent 1 time/,
      )
    })

    it('assertQueuedTimes passes for the exact count', () => {
      fake.recordQueued(new WelcomeMail(), { to: ['a@example.com'], from: { address: 'f@x' } })
      fake.recordQueued(new WelcomeMail(), { to: ['b@example.com'], from: { address: 'f@x' } })
      fake.assertQueuedTimes(WelcomeMail, 2)
    })

    it('assertQueuedTimes throws on mismatch', () => {
      assert.throws(
        () => fake.assertQueuedTimes(WelcomeMail, 1),
        /to be queued 1 time\(s\), but it was queued 0 time/,
      )
    })
  })

  describe('combined outgoing assertions', () => {
    it('assertOutgoingCount counts sent + queued together', async () => {
      await Mail.to('a@example.com').send(new WelcomeMail())
      fake.recordQueued(new GoodbyeMail(), { to: ['b@example.com'], from: { address: 'f@x' } })
      fake.recordQueued(new GoodbyeMail(), { to: ['c@example.com'], from: { address: 'f@x' } })
      fake.assertOutgoingCount(3)
    })

    it('assertOutgoingCount throws on mismatch with a breakdown in the message', async () => {
      await Mail.to('a@example.com').send(new WelcomeMail())
      assert.throws(
        () => fake.assertOutgoingCount(2),
        /Expected 2 outgoing mail.*1 went out \(1 sent, 0 queued\)/,
      )
    })

    it('assertNothingOutgoing passes on a clean fake', () => {
      fake.assertNothingOutgoing()
    })

    it('assertNothingOutgoing throws when mail was sent', async () => {
      await Mail.to('a@example.com').send(new WelcomeMail())
      assert.throws(
        () => fake.assertNothingOutgoing(),
        /Expected no outgoing mail.*1 went out \(1 sent, 0 queued\)/,
      )
    })

    it('assertNothingOutgoing throws when mail was queued', () => {
      fake.recordQueued(new WelcomeMail(), { to: ['a@example.com'], from: { address: 'f@x' } })
      assert.throws(
        () => fake.assertNothingOutgoing(),
        /Expected no outgoing mail.*1 went out \(0 sent, 1 queued\)/,
      )
    })

    it('assertOutgoing matches either sent or queued', async () => {
      fake.recordQueued(new WelcomeMail(), { to: ['a@example.com'], from: { address: 'f@x' } })
      fake.assertOutgoing(WelcomeMail)            // matches via queued
      fake.restore()
      fake = FakeMailAdapter.fake()
      await Mail.to('a@example.com').send(new WelcomeMail())
      fake.assertOutgoing(WelcomeMail)            // matches via sent
    })

    it('assertOutgoing honors a predicate filter', () => {
      fake.recordQueued(welcomeFor(1), { to: ['a@example.com'], from: { address: 'f@x' } })
      fake.recordQueued(welcomeFor(2), { to: ['b@example.com'], from: { address: 'f@x' } })
      fake.assertOutgoing(WelcomeMail, ({ mailable }) => (mailable as WelcomeMail).userId === 2)
    })

    it('assertOutgoing throws when nothing matches', () => {
      assert.throws(
        () => fake.assertOutgoing(WelcomeMail),
        /to be sent or queued/,
      )
    })

    it('outgoing() returns every entry across both channels', async () => {
      await Mail.to('a@example.com').send(new WelcomeMail())
      fake.recordQueued(new GoodbyeMail(), { to: ['b@example.com'], from: { address: 'f@x' } })
      assert.equal(fake.outgoing().length, 2)
      assert.equal(fake.outgoing(WelcomeMail).length, 1)
      assert.equal(fake.outgoing(GoodbyeMail).length, 1)
    })
  })
})
