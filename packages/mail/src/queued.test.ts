import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { QueueRegistry, type QueueAdapter, type DispatchOptions } from '@rudderjs/queue'
import { MailRegistry, type MailAdapter, type SendOptions } from './index.js'
import { Mailable } from './mailable.js'
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
})
