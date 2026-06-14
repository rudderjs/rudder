import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { queueObservers } from '@rudderjs/queue/observers'
import { MemoryStorage } from '../storage.js'
import { JobCollector } from './job.js'
import type { TelescopeEntry } from '../types.js'

const baseEvent = {
  name:         'SendWelcomeEmail',
  queue:        'mail',
  jobId:        'job-1',
  payload:      { userId: 42 },
  attempts:     1,
  dispatchedAt: new Date('2026-05-13T17:00:00Z'),
}

describe('JobCollector', () => {
  beforeEach(() => {
    queueObservers.reset()
  })

  it('records a job.dispatched event', async () => {
    const storage   = new MemoryStorage()
    const collector = new JobCollector(storage)
    await collector.register()

    queueObservers.emit({ kind: 'job.dispatched', ...baseEvent })

    const entries = storage.list({ type: 'job' }) as TelescopeEntry[]
    assert.equal(entries.length, 1)
    const entry = entries[0]!
    assert.equal(entry.content['class'],  'SendWelcomeEmail')
    assert.equal(entry.content['queue'],  'mail')
    assert.equal(entry.content['jobId'],  'job-1')
    assert.equal(entry.content['status'], 'dispatched')
    assert.deepEqual((entry.content['payload'] as Record<string, unknown>)['userId'], 42)
    assert.ok(entry.tags.includes('job:SendWelcomeEmail'))
    assert.ok(entry.tags.includes('queue:mail'))
    assert.ok(entry.tags.includes('status:dispatched'))
  })

  it('records a job.completed event with duration and attempts', async () => {
    const storage   = new MemoryStorage()
    const collector = new JobCollector(storage)
    await collector.register()

    queueObservers.emit({
      kind:        'job.completed',
      ...baseEvent,
      name:        'SyncContacts',
      queue:       'default',
      jobId:       'job-2',
      startedAt:   new Date(),
      completedAt: new Date(),
      duration:    1234,
    })

    const entries = storage.list({ type: 'job' }) as TelescopeEntry[]
    assert.equal(entries.length, 1)
    assert.equal(entries[0]!.content['status'],   'completed')
    assert.equal(entries[0]!.content['duration'], 1234)
    assert.equal(entries[0]!.content['attempts'], 1)
    assert.ok(entries[0]!.tags.includes('status:completed'))
  })

  it('records a job.failed event with error and skips duration if absent', async () => {
    const storage   = new MemoryStorage()
    const collector = new JobCollector(storage)
    await collector.register()

    queueObservers.emit({
      kind:        'job.failed',
      ...baseEvent,
      name:        'Broken',
      queue:       'default',
      jobId:       'job-3',
      attempts:    3,
      completedAt: new Date(),
      error:       'boom',
    })

    const entries = storage.list({ type: 'job' }) as TelescopeEntry[]
    assert.equal(entries.length, 1)
    assert.equal(entries[0]!.content['status'],    'failed')
    assert.equal(entries[0]!.content['attempts'],  3)
    assert.equal(entries[0]!.content['exception'], 'boom')
    assert.equal(entries[0]!.content['duration'],  undefined)
    assert.ok(entries[0]!.tags.includes('status:failed'))
  })

  it('does NOT record job.active events (deliberate — would double row count)', async () => {
    const storage   = new MemoryStorage()
    const collector = new JobCollector(storage)
    await collector.register()

    queueObservers.emit({
      kind:      'job.active',
      ...baseEvent,
      startedAt: new Date(),
    })

    assert.equal(storage.count('job'), 0)
  })

  it('observer errors do not propagate (queue layer must not crash on telescope failure)', async () => {
    const storage   = new MemoryStorage()
    const collector = new JobCollector(storage)
    await collector.register()

    // Replace storage.store with a thrower; emit must not propagate.
    storage.store = () => { throw new Error('storage offline') }
    assert.doesNotThrow(() => queueObservers.emit({ kind: 'job.dispatched', ...baseEvent }))
  })

  it('unregister() stops further recording', async () => {
    const storage   = new MemoryStorage()
    const collector = new JobCollector(storage)
    await collector.register()

    queueObservers.emit({ kind: 'job.dispatched', ...baseEvent })
    assert.equal(storage.count('job'), 1)

    collector.unregister()
    queueObservers.emit({ kind: 'job.dispatched', ...baseEvent, jobId: 'job-2' })
    assert.equal(storage.count('job'), 1)
  })
})
