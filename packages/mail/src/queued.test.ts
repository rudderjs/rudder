import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { QueueRegistry, type QueueAdapter, type DispatchOptions } from '@rudderjs/queue'
import { Mail, MailRegistry, type MailAdapter, type SendOptions } from './index.js'
import { Mailable } from './mailable.js'
import { FakeMailAdapter } from './fake.js'
import { dispatchMailJob } from './queued.js'

class TestMail extends Mailable {
  build() { return this.subject('Hi').text('Body') }
}

interface DispatchedJob {
  handle: () => Promise<void>
}

class RecordingQueueAdapter implements QueueAdapter {
  public dispatches: Array<{ job: DispatchedJob; opts: DispatchOptions | undefined }> = []
  async dispatch(job: unknown, opts?: DispatchOptions): Promise<void> {
    this.dispatches.push({ job: job as DispatchedJob, opts })
  }
}

class RecordingMailAdapter implements MailAdapter {
  public sent: Array<{ mailable: Mailable; options: SendOptions }> = []
  async send(mailable: Mailable, options: SendOptions): Promise<void> {
    this.sent.push({ mailable, options })
  }
}

const opts: SendOptions = { to: ['x@example.com'], from: { address: 'from@example.com' } }

describe('dispatchMailJob()', () => {
  let queue: RecordingQueueAdapter

  beforeEach(() => {
    QueueRegistry.reset()
    MailRegistry.reset()
    queue = new RecordingQueueAdapter()
    QueueRegistry.set(queue)
  })

  afterEach(() => {
    QueueRegistry.reset()
    MailRegistry.reset()
  })

  it('dispatches a single job to the registered queue adapter', async () => {
    await dispatchMailJob(new TestMail(), opts)
    assert.equal(queue.dispatches.length, 1)
  })

  it('passes through queue + delay options when provided', async () => {
    await dispatchMailJob(new TestMail(), opts, { queue: 'mail', delay: 5000 })
    const [d] = queue.dispatches
    assert.deepEqual(d?.opts, { queue: 'mail', delay: 5000 })
  })

  it('omits queue + delay from opts when not supplied', async () => {
    await dispatchMailJob(new TestMail(), opts)
    const [d] = queue.dispatches
    // queued.ts only sets keys when truthy; an empty opts object is expected.
    assert.deepEqual(d?.opts, {})
  })

  it('omits delay when only queue is supplied', async () => {
    await dispatchMailJob(new TestMail(), opts, { queue: 'mail' })
    const [d] = queue.dispatches
    assert.deepEqual(d?.opts, { queue: 'mail' })
  })

  it('the dispatched job.handle() calls the registered mail adapter with the same options', async () => {
    const mailAdapter = new RecordingMailAdapter()
    MailRegistry.set(mailAdapter)

    await dispatchMailJob(new TestMail(), opts, { queue: 'mail' })
    const [d] = queue.dispatches
    assert.ok(d, 'a dispatch should have been recorded')

    await d.job.handle()

    assert.equal(mailAdapter.sent.length, 1)
    assert.deepEqual(mailAdapter.sent[0]?.options, opts)
  })

  it('the job.handle() throws when no mail adapter is registered at execution time', async () => {
    // Queue is set but mail isn't — common test-isolation pitfall.
    await dispatchMailJob(new TestMail(), opts)
    const [d] = queue.dispatches
    assert.ok(d)

    MailRegistry.reset()
    await assert.rejects(
      () => d.job.handle(),
      /No mail adapter registered/,
    )
  })

  it('throws "No queue adapter registered" when QueueRegistry is empty', async () => {
    QueueRegistry.reset()
    await assert.rejects(
      () => dispatchMailJob(new TestMail(), opts),
      /No queue adapter registered/,
    )
  })

  it('records to the active mail fake instead of dispatching a real job', async () => {
    const fake = FakeMailAdapter.fake() // installs itself on MailRegistry
    try {
      // No queue adapter is registered for this test — the fake path must not
      // touch QueueRegistry at all.
      QueueRegistry.reset()
      await dispatchMailJob(new TestMail(), opts)
      assert.equal(queue.dispatches.length, 0, 'must NOT dispatch a real queue job under a fake')
      fake.assertQueued(TestMail)
      assert.equal(fake.queued().length, 1)
    } finally {
      fake.restore()
    }
  })

  it('Mail.to(...).queue() is visible to fake.assertQueued() end-to-end', async () => {
    const fake = FakeMailAdapter.fake()
    try {
      QueueRegistry.reset() // queue package not required when faked
      await Mail.to('x@example.com').queue(new TestMail())
      fake.assertQueued(TestMail)
      fake.assertNothingSent()
    } finally {
      fake.restore()
    }
  })
})
