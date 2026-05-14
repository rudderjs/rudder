import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { QueueRegistry, type QueueAdapter, type DispatchOptions } from '@rudderjs/queue'
import {
  ChannelRegistry,
  Notification,
  Notifier,
  type Notifiable,
  type ShouldQueue,
} from './index.js'

interface DispatchedJob { handle: () => Promise<void> }

class RecordingQueueAdapter implements QueueAdapter {
  public dispatches: Array<{ job: DispatchedJob; opts: DispatchOptions | undefined }> = []
  async dispatch(job: unknown, opts?: DispatchOptions): Promise<void> {
    this.dispatches.push({ job: job as DispatchedJob, opts })
  }
}

class WelcomeQueued extends Notification implements ShouldQueue {
  readonly shouldQueue = true as const
  queueName?:  string
  queueDelay?: number
  public sentChannelCount = 0
  via(): string[] { return ['inmem'] }
}

const user: Notifiable = { id: 'u1' }

describe('Notifier._sendQueued (via Notifier.send w/ ShouldQueue)', () => {
  let queue: RecordingQueueAdapter

  beforeEach(() => {
    QueueRegistry.reset()
    ChannelRegistry.reset()
    queue = new RecordingQueueAdapter()
    QueueRegistry.set(queue)

    // Register a no-op channel so job.handle() can execute without
    // additional setup. The send-side channel resolution happens at
    // job-execution time, not dispatch time.
    ChannelRegistry.register('inmem', { send: async () => undefined })
  })

  afterEach(() => {
    QueueRegistry.reset()
    ChannelRegistry.reset()
  })

  it('dispatches a job when notification implements ShouldQueue', async () => {
    await Notifier.send(user, new WelcomeQueued())
    assert.equal(queue.dispatches.length, 1)
  })

  it('passes queueName through as opts.queue when supplied', async () => {
    const n = new WelcomeQueued()
    n.queueName = 'notifications'
    await Notifier.send(user, n)
    assert.equal(queue.dispatches[0]?.opts?.queue, 'notifications')
  })

  it('passes queueDelay through as opts.delay when supplied', async () => {
    const n = new WelcomeQueued()
    n.queueDelay = 5000
    await Notifier.send(user, n)
    assert.equal(queue.dispatches[0]?.opts?.delay, 5000)
  })

  it('omits queue + delay keys when neither is set', async () => {
    await Notifier.send(user, new WelcomeQueued())
    assert.deepEqual(queue.dispatches[0]?.opts, {})
  })

  it('the dispatched job.handle() executes the via-channel send path', async () => {
    let sendCount = 0
    ChannelRegistry.reset()
    ChannelRegistry.register('inmem', { send: async () => { sendCount++ } })

    await Notifier.send(user, new WelcomeQueued())
    const [d] = queue.dispatches
    assert.ok(d, 'dispatch should be recorded')

    await d.job.handle()
    assert.equal(sendCount, 1)
  })

  it('routes a single notifiable through the queue path (not array required)', async () => {
    await Notifier.send(user, new WelcomeQueued())
    assert.equal(queue.dispatches.length, 1)
  })

  it('throws "No queue adapter registered" when QueueRegistry is empty', async () => {
    QueueRegistry.reset()
    await assert.rejects(
      () => Notifier.send(user, new WelcomeQueued()),
      /No queue adapter registered/,
    )
  })
})
