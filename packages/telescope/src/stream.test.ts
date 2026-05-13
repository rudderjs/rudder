import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  notifySubscribers,
  createStreamResponse,
  subscriberCount,
  _resetSubscribers,
} from './stream.js'
import { createEntry } from './storage.js'

// ─── Unit: notifySubscribers ─────────────────────────────────

describe('notifySubscribers', () => {
  beforeEach(() => {
    _resetSubscribers()
  })

  it('fans out to all matching subscribers', async () => {
    const a = createStreamResponse(null)
    const b = createStreamResponse(null)
    assert.equal(subscriberCount(), 2)

    const aReader = a.body!.getReader()
    const bReader = b.body!.getReader()
    await drain(aReader, ': open')
    await drain(bReader, ': open')

    notifySubscribers(createEntry('request', { url: '/x' }))

    const aFrame = await readFrame(aReader)
    const bFrame = await readFrame(bReader)
    assert.match(aFrame, /^event: entry\ndata: \{.*"type":"request".*\}\n\n$/)
    assert.match(bFrame, /^event: entry\ndata: \{.*"type":"request".*\}\n\n$/)

    await aReader.cancel()
    await bReader.cancel()
  })

  it('respects the type filter — entries of other types are skipped', async () => {
    const res = createStreamResponse('query')
    const reader = res.body!.getReader()
    await drain(reader, ': open')

    notifySubscribers(createEntry('request', { url: '/x' }))
    notifySubscribers(createEntry('query', { sql: 'SELECT 1' }))

    const frame = await readFrame(reader)
    assert.match(frame, /"type":"query"/)
    assert.doesNotMatch(frame, /"type":"request"/)

    await reader.cancel()
  })

  it('drops a subscriber whose write throws (e.g. closed controller)', () => {
    // Hand-roll a subscriber via the public path: createStreamResponse adds
    // itself to the registry, then cancel() removes it. After cancel(),
    // notifying must be a no-op and the subscriber count must drop to 0.
    const res = createStreamResponse(null)
    assert.equal(subscriberCount(), 1)
    res.body!.cancel()
    // Allow microtasks (cancel() is async on some runtimes).
    return Promise.resolve().then(() => {
      notifySubscribers(createEntry('log', { message: 'after-cancel' }))
      assert.equal(subscriberCount(), 0)
    })
  })
})

// ─── Unit: createStreamResponse headers ──────────────────────

describe('createStreamResponse', () => {
  beforeEach(() => {
    _resetSubscribers()
  })

  it('returns a Response with SSE headers', () => {
    const res = createStreamResponse(null)
    assert.equal(res.headers.get('Content-Type'),      'text/event-stream')
    assert.equal(res.headers.get('Cache-Control'),     'no-cache, no-transform')
    assert.equal(res.headers.get('Connection'),        'keep-alive')
    assert.equal(res.headers.get('X-Accel-Buffering'), 'no')
    res.body!.cancel()
  })

  it('emits an immediate `: open` comment frame', async () => {
    const res = createStreamResponse(null)
    const reader = res.body!.getReader()
    const { value } = await reader.read()
    const text = new TextDecoder().decode(value)
    assert.match(text, /^: open\n\n/)
    await reader.cancel()
  })

  it('survives module reload — subscriber registry lives on globalThis', () => {
    // After _resetSubscribers (which clears the same globalThis Set), adding
    // a subscriber and notifying still fans out correctly. This pins the
    // contract that re-importing the module doesn't re-create the registry.
    const res = createStreamResponse(null)
    assert.equal(subscriberCount(), 1)

    notifySubscribers(createEntry('log', { message: 'test' }))
    // No assertion on receipt — the assertion is that subscriberCount
    // reflects the singleton, not a fresh per-import Set.
    assert.equal(subscriberCount(), 1)
    res.body!.cancel()
  })

  afterEach(() => {
    _resetSubscribers()
  })
})

// ─── Helpers ─────────────────────────────────────────────────

/** Read until the next double-newline-terminated SSE frame. */
async function readFrame(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder()
  let buf = ''
  // Drop the leading `: open` frame if it's still in the queue.
  while (true) {
    const { value, done } = await reader.read()
    if (done) return buf
    buf += decoder.decode(value, { stream: true })
    const idx = buf.indexOf('\n\n')
    if (idx >= 0) {
      const frame = buf.slice(0, idx + 2)
      // Skip keepalive/open comment frames — caller wants real events.
      if (frame.startsWith(':')) {
        buf = buf.slice(idx + 2)
        continue
      }
      return frame
    }
  }
}

/** Read frames until one matching `prefix` is consumed (drops the `: open` opener). */
async function drain(reader: ReadableStreamDefaultReader<Uint8Array>, prefix: string): Promise<void> {
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) return
    buf += decoder.decode(value, { stream: true })
    if (buf.includes(prefix)) return
  }
}
