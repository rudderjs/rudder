import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TestResponse } from './TestResponse.js'
import { TestCase } from './TestCase.js'

// ─── TestResponse: Status assertions ──────────────────────

describe('TestResponse — status assertions', () => {
  it('assertOk passes for 200', () => {
    const res = new TestResponse(200, {}, {}, '{}')
    res.assertOk()
  })

  it('assertOk throws for non-200', () => {
    const res = new TestResponse(404, {}, {}, '')
    assert.throws(() => res.assertOk(), /Expected status 200/)
  })

  it('assertCreated passes for 201', () => {
    new TestResponse(201, {}, {}, '').assertCreated()
  })

  it('assertNoContent passes for 204', () => {
    new TestResponse(204, {}, null, '').assertNoContent()
  })

  it('assertNotFound passes for 404', () => {
    new TestResponse(404, {}, {}, '').assertNotFound()
  })

  it('assertForbidden passes for 403', () => {
    new TestResponse(403, {}, {}, '').assertForbidden()
  })

  it('assertUnauthorized passes for 401', () => {
    new TestResponse(401, {}, {}, '').assertUnauthorized()
  })

  it('assertUnprocessable passes for 422', () => {
    new TestResponse(422, {}, {}, '').assertUnprocessable()
  })

  it('assertSuccessful passes for 2xx range', () => {
    new TestResponse(200, {}, {}, '').assertSuccessful()
    new TestResponse(201, {}, {}, '').assertSuccessful()
    new TestResponse(204, {}, {}, '').assertSuccessful()
  })

  it('assertSuccessful throws for non-2xx', () => {
    assert.throws(() => new TestResponse(400, {}, {}, '').assertSuccessful(), /Expected successful/)
  })

  it('assertServerError passes for 5xx', () => {
    new TestResponse(500, {}, {}, '').assertServerError()
    new TestResponse(503, {}, {}, '').assertServerError()
  })

  it('assertServerError throws for non-5xx', () => {
    assert.throws(() => new TestResponse(200, {}, {}, '').assertServerError(), /Expected server error/)
  })

  it('assertStatus passes for exact match', () => {
    new TestResponse(302, {}, null, '').assertStatus(302)
  })

  it('assertStatus throws for mismatch', () => {
    assert.throws(() => new TestResponse(200, {}, {}, '').assertStatus(201), /Expected status 201/)
  })
})

// ─── TestResponse: JSON assertions ────────────────────────

describe('TestResponse — JSON assertions', () => {
  const body = { name: 'Alice', age: 30, tags: ['admin'] }
  const makeRes = () => new TestResponse(200, {}, body, JSON.stringify(body))

  it('assertJson partial matches', () => {
    makeRes().assertJson({ name: 'Alice' })
  })

  it('assertJson throws on mismatch', () => {
    assert.throws(() => makeRes().assertJson({ name: 'Bob' }), /does not match/)
  })

  it('assertJsonPath matches dot-separated paths', () => {
    const nested = { data: { users: [{ name: 'Alice' }] } }
    const res = new TestResponse(200, {}, nested, JSON.stringify(nested))
    res.assertJsonPath('data.users.0.name', 'Alice')
  })

  it('assertJsonCount checks array length', () => {
    const data = { items: [1, 2, 3] }
    const res = new TestResponse(200, {}, data, JSON.stringify(data))
    res.assertJsonCount(3, 'items')
  })

  it('assertJsonCount at root', () => {
    const data = [1, 2]
    const res = new TestResponse(200, {}, data, JSON.stringify(data))
    res.assertJsonCount(2)
  })

  it('assertJsonStructure checks keys exist', () => {
    makeRes().assertJsonStructure(['name', 'age', 'tags'])
  })

  it('assertJsonStructure throws for missing keys', () => {
    assert.throws(() => makeRes().assertJsonStructure(['missing']), /Expected JSON to have key/)
  })

  it('assertJsonMissing passes when key absent', () => {
    makeRes().assertJsonMissing({ email: 'alice@test.com' })
  })

  it('assertJsonMissing throws when value matches', () => {
    assert.throws(() => makeRes().assertJsonMissing({ name: 'Alice' }), /should not match/)
  })
})

// ─── TestResponse: Header assertions ──────────────────────

describe('TestResponse — header assertions', () => {
  const headers = { 'content-type': 'application/json', 'x-request-id': 'abc123' }
  const makeRes = () => new TestResponse(200, headers, {}, '{}')

  it('assertHeader passes when present', () => {
    makeRes().assertHeader('content-type')
  })

  it('assertHeader with value check', () => {
    makeRes().assertHeader('content-type', 'json')
  })

  it('assertHeader throws when absent', () => {
    assert.throws(() => makeRes().assertHeader('x-missing'), /to be present/)
  })

  it('assertHeaderMissing passes when absent', () => {
    makeRes().assertHeaderMissing('x-missing')
  })

  it('assertHeaderMissing throws when present', () => {
    assert.throws(() => makeRes().assertHeaderMissing('content-type'), /to be absent/)
  })
})

// ─── TestResponse: Redirect assertions ────────────────────

describe('TestResponse — redirect assertions', () => {
  it('assertRedirect passes for 3xx with location', () => {
    const res = new TestResponse(302, { location: '/dashboard' }, null, '')
    res.assertRedirect('/dashboard')
  })

  it('assertRedirect without location check', () => {
    const res = new TestResponse(301, { location: '/new' }, null, '')
    res.assertRedirect()
  })

  it('assertRedirect throws for non-3xx', () => {
    const res = new TestResponse(200, {}, {}, '')
    assert.throws(() => res.assertRedirect(), /Expected redirect/)
  })
})

// ─── TestResponse: chaining ───────────────────────────────

describe('TestResponse — chaining', () => {
  it('assertions return this for chaining', () => {
    const res = new TestResponse(200, { 'x-id': '1' }, { ok: true }, '{"ok":true}')
    const result = res
      .assertOk()
      .assertSuccessful()
      .assertStatus(200)
      .assertJson({ ok: true })
      .assertHeader('x-id', '1')
      .assertJsonStructure(['ok'])

    assert.strictEqual(result, res)
  })
})

// ─── TestCase: Model assertions ───────────────────────────

describe('TestCase — model assertions', () => {
  // Build a TestCase pre-wired to a stubbed orm with a fixed row set.
  function caseWithRows(rows: Array<Record<string, unknown>>): TestCase {
    const tc = Object.create(TestCase.prototype) as TestCase
    let lastFiltered: Array<Record<string, unknown>> = rows
    const orm = {
      query(_table: string) {
        let filtered = rows
        const qb = {
          where(col: string, val: unknown) {
            filtered = filtered.filter((r) => r[col] === val)
            lastFiltered = filtered
            return qb
          },
          first() { return Promise.resolve(filtered[0] ?? null) },
          get() { return Promise.resolve(lastFiltered) },
        }
        return qb
      },
    }
    ;(tc as unknown as { app: { make: (key: string) => unknown } }).app = {
      make: (key: string) => key === 'orm' ? orm : null,
    }
    return tc
  }

  class User {
    static table = 'user'
    static primaryKey = 'id'
    constructor(public id: number, public deletedAt: Date | null = null) {}
  }

  it('assertModelExists passes when the row is found', async () => {
    const tc = caseWithRows([{ id: 42, deletedAt: null }])
    await tc.assertModelExists(new User(42))
  })

  it('assertModelExists throws when the row is missing', async () => {
    const tc = caseWithRows([])
    await assert.rejects(
      () => tc.assertModelExists(new User(42)),
      /Expected User#42 to exist/,
    )
  })

  it('assertModelMissing passes when no row is found', async () => {
    const tc = caseWithRows([])
    await tc.assertModelMissing(new User(42))
  })

  it('assertModelMissing throws when a row exists', async () => {
    const tc = caseWithRows([{ id: 42, deletedAt: null }])
    await assert.rejects(
      () => tc.assertModelMissing(new User(42)),
      /Expected User#42 to be missing/,
    )
  })

  it('assertSoftDeleted passes when row exists with deletedAt set', async () => {
    const tc = caseWithRows([{ id: 42, deletedAt: new Date() }])
    await tc.assertSoftDeleted(new User(42))
  })

  it('assertSoftDeleted throws when row exists but deletedAt is null', async () => {
    const tc = caseWithRows([{ id: 42, deletedAt: null }])
    await assert.rejects(
      () => tc.assertSoftDeleted(new User(42)),
      /deletedAt is null/,
    )
  })

  it('assertSoftDeleted throws when no row exists', async () => {
    const tc = caseWithRows([])
    await assert.rejects(
      () => tc.assertSoftDeleted(new User(42)),
      /no row exists/,
    )
  })

  it('assertNotSoftDeleted passes when row exists with deletedAt null', async () => {
    const tc = caseWithRows([{ id: 42, deletedAt: null }])
    await tc.assertNotSoftDeleted(new User(42))
  })

  it('assertNotSoftDeleted throws when row exists with deletedAt set', async () => {
    const tc = caseWithRows([{ id: 42, deletedAt: new Date() }])
    await assert.rejects(
      () => tc.assertNotSoftDeleted(new User(42)),
      /to NOT be soft-deleted/,
    )
  })

  it('throws a clear error when the model has no static table', async () => {
    class Anon { id = 1 }
    const tc = caseWithRows([])
    await assert.rejects(
      () => tc.assertModelExists(new Anon() as never),
      /Model has no static `table`/,
    )
  })

  it('throws a clear error when the model has no primary-key value', async () => {
    const tc = caseWithRows([])
    const unsaved = new User(undefined as unknown as number)
    await assert.rejects(
      () => tc.assertModelExists(unsaved),
      /Model has no value for primary key/,
    )
  })
})

// ─── TestCase: Time travel ────────────────────────────────

describe('TestCase — time travel', () => {
  // Build a bare TestCase instance — no app needed for the time-travel paths.
  function bareCase(): TestCase {
    const tc = Object.create(TestCase.prototype) as TestCase
    ;(tc as unknown as Record<string, unknown>)['_timersMocked'] = false
    return tc
  }

  // Always restore real time, even when an assertion fails mid-test.
  function restore(tc: TestCase): void { tc.travelBack() }

  it('travel(N).seconds advances Date.now by N * 1000', () => {
    const tc = bareCase()
    try {
      const start = Date.now()
      tc.travel(5).seconds()
      assert.equal(Date.now(), start + 5_000)
    } finally { restore(tc) }
  })

  it('travel(N).minutes advances by N * 60_000', () => {
    const tc = bareCase()
    try {
      const start = Date.now()
      tc.travel(2).minutes()
      assert.equal(Date.now(), start + 120_000)
    } finally { restore(tc) }
  })

  it('travel(N).hours advances by N * 3_600_000', () => {
    const tc = bareCase()
    try {
      const start = Date.now()
      tc.travel(3).hours()
      assert.equal(Date.now(), start + 10_800_000)
    } finally { restore(tc) }
  })

  it('travel(N).days advances by N * 86_400_000', () => {
    const tc = bareCase()
    try {
      const start = Date.now()
      tc.travel(7).days()
      assert.equal(Date.now(), start + 7 * 86_400_000)
    } finally { restore(tc) }
  })

  it('travelTo sets the clock to an absolute Date', () => {
    const tc = bareCase()
    try {
      const target = new Date('2030-06-15T12:00:00.000Z')
      tc.travelTo(target)
      assert.equal(Date.now(), +target)
    } finally { restore(tc) }
  })

  it('travelTo accepts a numeric timestamp', () => {
    const tc = bareCase()
    try {
      const target = Date.UTC(2030, 0, 1)
      tc.travelTo(target)
      assert.equal(Date.now(), target)
    } finally { restore(tc) }
  })

  it('travelBack restores real time', () => {
    const tc = bareCase()
    tc.travelTo(new Date('2030-01-01T00:00:00.000Z'))
    tc.travelBack()
    const realNow = Date.now()
    // After reset, Date.now() should be close to wall-clock time, not 2030.
    assert.ok(realNow < +new Date('2029-01-01'), `Expected real time after travelBack, got ${new Date(realNow).toISOString()}`)
  })

  it('travelBack is a no-op when time was not mocked', () => {
    const tc = bareCase()
    // Should not throw even though mock.timers was never enabled.
    tc.travelBack()
  })

  it('freezeTime pins Date.now across multiple reads', async () => {
    const tc = bareCase()
    try {
      let captured: number[] = []
      await tc.freezeTime(async () => {
        captured.push(Date.now())
        await new Promise((r) => setImmediate(r))
        captured.push(Date.now())
      })
      assert.equal(captured[0], captured[1], 'Date.now() should be stable inside freezeTime')
    } finally { restore(tc) }
  })

  it('freezeTime restores real time after fn returns (when not previously mocked)', async () => {
    const tc = bareCase()
    await tc.freezeTime(async () => {
      // do nothing
    })
    // Timers should be restored — Date.now() should be a real wall-clock value.
    const realNow = Date.now()
    assert.ok(realNow > +new Date('2025-01-01'), `Expected real time after freezeTime, got ${new Date(realNow).toISOString()}`)
  })

  it('freezeTime leaves an existing mock in place', async () => {
    const tc = bareCase()
    try {
      tc.travelTo(new Date('2030-06-15T00:00:00.000Z'))
      const before = Date.now()
      await tc.freezeTime(async () => { /* no-op */ })
      // Still mocked at 2030 (freezeTime didn't reset on exit since we were already mocked).
      assert.equal(Date.now(), before)
    } finally { restore(tc) }
  })
})

// ─── TestCase: Request setup chain ────────────────────────

describe('TestCase — request setup chain', () => {
  // Build a TestCase pre-wired with a stub fetchHandler that echoes the
  // observed request headers/body back to the test.
  type EchoSeen = { headers: Record<string, string>, body: string | undefined }
  function caseWithEchoHandler(): { tc: TestCase, lastReq: EchoSeen } {
    const tc = Object.create(TestCase.prototype) as TestCase
    const tcAny = tc as unknown as Record<string, unknown>
    tcAny['_pendingHeaders'] = {}
    tcAny['_pendingCookies'] = {}
    const lastReq: EchoSeen = { headers: {}, body: undefined }
    const handler = async (req: Request) => {
      const headers: Record<string, string> = {}
      req.headers.forEach((v, k) => { headers[k] = v })
      lastReq.headers = headers
      lastReq.body = req.body ? await req.text() : undefined
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    tcAny['_handler'] = handler
    return { tc, lastReq }
  }

  it('withHeader sets a single header on the next request', async () => {
    const { tc, lastReq } = caseWithEchoHandler()
    await tc.withHeader('x-test', 'one').get('/anywhere')
    assert.equal(lastReq.headers['x-test'], 'one')
  })

  it('withHeaders merges multiple headers', async () => {
    const { tc, lastReq } = caseWithEchoHandler()
    await tc.withHeaders({ 'x-a': '1', 'x-b': '2' }).get('/anywhere')
    assert.equal(lastReq.headers['x-a'], '1')
    assert.equal(lastReq.headers['x-b'], '2')
  })

  it('withHeaders persists across multiple requests until flushed', async () => {
    const { tc, lastReq } = caseWithEchoHandler()
    tc.withHeader('x-trace', 'abc')
    await tc.get('/one')
    assert.equal(lastReq.headers['x-trace'], 'abc')
    await tc.get('/two')
    assert.equal(lastReq.headers['x-trace'], 'abc')
    tc.flushHeaders()
    await tc.get('/three')
    assert.equal(lastReq.headers['x-trace'], undefined)
  })

  it('per-request headers arg overrides accumulated headers', async () => {
    const { tc, lastReq } = caseWithEchoHandler()
    tc.withHeader('x-app', 'global')
    await tc.get('/path', { 'x-app': 'local' })
    assert.equal(lastReq.headers['x-app'], 'local')
  })

  it('withCookies sets a single Cookie header', async () => {
    const { tc, lastReq } = caseWithEchoHandler()
    await tc.withCookies({ session: 'abc', csrf: 'def' }).get('/anywhere')
    assert.ok(lastReq.headers['cookie']?.includes('session=abc'))
    assert.ok(lastReq.headers['cookie']?.includes('csrf=def'))
  })

  it('withCookie encodes name and value', async () => {
    const { tc, lastReq } = caseWithEchoHandler()
    await tc.withCookie('weird name', 'a=b;c').get('/anywhere')
    assert.ok(lastReq.headers['cookie']?.includes('weird%20name=a%3Db%3Bc'))
  })

  it('per-request cookie header wins over accumulated', async () => {
    const { tc, lastReq } = caseWithEchoHandler()
    tc.withCookie('session', 'global')
    await tc.get('/path', { cookie: 'session=local' })
    assert.equal(lastReq.headers['cookie'], 'session=local')
  })

  it('flushCookies clears accumulated cookies', async () => {
    const { tc, lastReq } = caseWithEchoHandler()
    tc.withCookie('session', 'abc')
    tc.flushCookies()
    await tc.get('/anywhere')
    assert.equal(lastReq.headers['cookie'], undefined)
  })

  it('all setup methods return this for chaining', () => {
    const { tc } = caseWithEchoHandler()
    const result = tc
      .withHeader('x-a', '1')
      .withHeaders({ 'x-b': '2' })
      .withCookie('s', 'x')
      .withCookies({ csrf: 'y' })

    assert.strictEqual(result, tc)
  })
})

// ─── TestResponse: text() and json() ──────────────────────

describe('TestResponse — accessors', () => {
  it('text() returns raw response text', () => {
    const res = new TestResponse(200, {}, {}, 'raw text')
    assert.equal(res.text(), 'raw text')
  })

  it('json() returns parsed body', () => {
    const body = { a: 1 }
    const res = new TestResponse(200, {}, body, '{"a":1}')
    assert.deepStrictEqual(res.json(), { a: 1 })
  })
})
