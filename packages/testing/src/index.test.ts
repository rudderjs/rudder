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

  it('additional status helpers (202, 400, 409, 410, 429)', () => {
    new TestResponse(202, {}, {}, '').assertAccepted()
    new TestResponse(400, {}, {}, '').assertBadRequest()
    new TestResponse(409, {}, {}, '').assertConflict()
    new TestResponse(410, {}, {}, '').assertGone()
    new TestResponse(429, {}, {}, '').assertTooManyRequests()
  })
})

// ─── TestResponse: JSON variants ──────────────────────────

describe('TestResponse — JSON variants', () => {
  it('assertExactJson passes on exact deep-equal', () => {
    const body = { name: 'Alice', age: 30 }
    new TestResponse(200, {}, body, JSON.stringify(body)).assertExactJson({ name: 'Alice', age: 30 })
  })

  it('assertExactJson throws on extra keys', () => {
    const body = { name: 'Alice', age: 30, extra: true }
    assert.throws(
      () => new TestResponse(200, {}, body, '').assertExactJson({ name: 'Alice', age: 30 }),
      /does not exactly match/,
    )
  })

  it('assertJsonMissingExact passes when body differs from expected', () => {
    const body = { name: 'Alice', age: 30 }
    new TestResponse(200, {}, body, '').assertJsonMissingExact({ name: 'Bob' })
  })

  it('assertJsonFragment finds fragment at top level', () => {
    const body = { name: 'Alice', email: 'a@x.com' }
    new TestResponse(200, {}, body, '').assertJsonFragment({ email: 'a@x.com' })
  })

  it('assertJsonFragment finds fragment in nested object', () => {
    const body = { data: { user: { name: 'Alice', role: 'admin' } } }
    new TestResponse(200, {}, body, '').assertJsonFragment({ name: 'Alice', role: 'admin' })
  })

  it('assertJsonFragment finds fragment inside an array', () => {
    const body = { items: [{ id: 1 }, { id: 2, tag: 'x' }, { id: 3 }] }
    new TestResponse(200, {}, body, '').assertJsonFragment({ id: 2, tag: 'x' })
  })

  it('assertJsonFragment throws when fragment is split across siblings', () => {
    // {a:1} on one object, {b:2} on another — the fragment {a:1,b:2} should NOT match
    const body = { items: [{ a: 1 }, { b: 2 }] }
    assert.throws(
      () => new TestResponse(200, {}, body, '').assertJsonFragment({ a: 1, b: 2 }),
      /does not contain fragment/,
    )
  })
})

// ─── TestResponse: Content assertions ─────────────────────

describe('TestResponse — content assertions', () => {
  it('assertContent passes on exact text match', () => {
    new TestResponse(200, {}, null, 'hello world').assertContent('hello world')
  })

  it('assertContent throws on mismatch', () => {
    assert.throws(
      () => new TestResponse(200, {}, null, 'hello world').assertContent('goodbye'),
      /Expected response body to equal/,
    )
  })

  it('assertSee passes on substring match', () => {
    new TestResponse(200, {}, null, '<p>Welcome, Alice!</p>').assertSee('Alice')
  })

  it('assertSee throws when text is absent', () => {
    assert.throws(
      () => new TestResponse(200, {}, null, '<p>Hello</p>').assertSee('Alice'),
      /to contain "Alice"/,
    )
  })

  it('assertDontSee passes when text is absent', () => {
    new TestResponse(200, {}, null, '<p>Hello</p>').assertDontSee('Alice')
  })

  it('assertSeeText strips HTML tags before matching', () => {
    new TestResponse(200, {}, null, '<div><span>Welcome</span> Alice</div>').assertSeeText('Welcome Alice')
  })

  it('assertDontSeeText strips HTML before NOT-matching', () => {
    new TestResponse(200, {}, null, '<div>Bob</div>').assertDontSeeText('Alice')
  })

  it('assertSeeInOrder finds substrings in order', () => {
    new TestResponse(200, {}, null, 'Alice, then Bob, then Carol').assertSeeInOrder(['Alice', 'Bob', 'Carol'])
  })

  it('assertSeeInOrder throws when out of order', () => {
    assert.throws(
      () => new TestResponse(200, {}, null, 'Carol, Alice').assertSeeInOrder(['Alice', 'Carol']),
      /missing or out of order/,
    )
  })
})

// ─── TestResponse: Cookie assertions ──────────────────────

describe('TestResponse — cookie assertions', () => {
  it('assertCookie passes when Set-Cookie has the named cookie', () => {
    const res = new TestResponse(200, {}, {}, '', ['session=abc123; Path=/; HttpOnly'])
    res.assertCookie('session')
  })

  it('assertCookie verifies a value substring', () => {
    const res = new TestResponse(200, {}, {}, '', ['session=abc123; Path=/'])
    res.assertCookie('session', 'abc')
  })

  it('assertCookie throws when cookie is missing', () => {
    const res = new TestResponse(200, {}, {}, '', ['session=abc123; Path=/'])
    assert.throws(() => res.assertCookie('csrf'), /Expected response to set cookie "csrf"/)
  })

  it('assertCookie throws when value substring does not match', () => {
    const res = new TestResponse(200, {}, {}, '', ['session=abc123; Path=/'])
    assert.throws(() => res.assertCookie('session', 'wrong'), /to contain "wrong"/)
  })

  it('assertCookieMissing passes when no Set-Cookie for the name', () => {
    const res = new TestResponse(200, {}, {}, '', ['session=abc; Path=/'])
    res.assertCookieMissing('csrf')
  })

  it('assertCookieMissing throws when the cookie IS set', () => {
    const res = new TestResponse(200, {}, {}, '', ['session=abc; Path=/'])
    assert.throws(() => res.assertCookieMissing('session'), /found one/)
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

// ─── TestCase: Auth assertions ────────────────────────────

describe('TestCase — auth assertions', () => {
  function bareCase(): TestCase {
    return Object.create(TestCase.prototype) as TestCase
  }

  it('assertAuthenticated passes after actingAs', () => {
    const tc = bareCase()
    tc.actingAs({ id: 1, name: 'Alice' })
    tc.assertAuthenticated()
  })

  it('assertAuthenticated throws when actingAs was not called', () => {
    const tc = bareCase()
    assert.throws(() => tc.assertAuthenticated(), /Expected a user to be authenticated/)
  })

  it('assertGuest passes when actingAs was not called', () => {
    const tc = bareCase()
    tc.assertGuest()
  })

  it('assertGuest throws after actingAs', () => {
    const tc = bareCase()
    tc.actingAs({ id: 7, name: 'Bob' })
    assert.throws(() => tc.assertGuest(), /Expected no actingAs.*id: 7/)
  })

  it('assertGuest passes after actingAsGuest clears the user', () => {
    const tc = bareCase()
    tc.actingAs({ id: 1 }).actingAsGuest().assertGuest()
  })

  it('assertAuthenticatedAs passes for matching id', () => {
    const tc = bareCase()
    tc.actingAs({ id: 42, name: 'Alice' })
    tc.assertAuthenticatedAs({ id: 42 })
  })

  it('assertAuthenticatedAs coerces ids to string for comparison', () => {
    const tc = bareCase()
    tc.actingAs({ id: 42 })
    tc.assertAuthenticatedAs({ id: '42' })   // numeric vs string still matches
  })

  it('assertAuthenticatedAs throws when ids differ', () => {
    const tc = bareCase()
    tc.actingAs({ id: 1 })
    assert.throws(
      () => tc.assertAuthenticatedAs({ id: 2 }),
      /Expected acting-as user id 2, got 1/,
    )
  })

  it('assertAuthenticatedAs throws when no user is set', () => {
    const tc = bareCase()
    assert.throws(
      () => tc.assertAuthenticatedAs({ id: 1 }),
      /Expected a user to be authenticated/,
    )
  })

  it('all auth helpers return this for chaining', () => {
    const tc = bareCase()
    const result = tc
      .actingAs({ id: 1 })
      .assertAuthenticated()
      .assertAuthenticatedAs({ id: 1 })
      .actingAsGuest()
      .assertGuest()
    assert.strictEqual(result, tc)
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

  // Anchor the mock at a fixed timestamp so `Date.now()` comparisons are
  // deterministic across platforms. Without this, Windows + Node 20 has
  // ~15ms wall-clock granularity — the test's `start = Date.now()` capture
  // can race ahead of the mock's internal `now: Date.now()` and break
  // strict-equality assertions.
  const ANCHOR = Date.UTC(2026, 0, 1)
  function anchor(tc: TestCase): void { tc.travelTo(ANCHOR) }

  it('travel(N).seconds advances Date.now by N * 1000', () => {
    const tc = bareCase()
    try {
      anchor(tc)
      tc.travel(5).seconds()
      assert.equal(Date.now(), ANCHOR + 5_000)
    } finally { restore(tc) }
  })

  it('travel(N).minutes advances by N * 60_000', () => {
    const tc = bareCase()
    try {
      anchor(tc)
      tc.travel(2).minutes()
      assert.equal(Date.now(), ANCHOR + 120_000)
    } finally { restore(tc) }
  })

  it('travel(N).hours advances by N * 3_600_000', () => {
    const tc = bareCase()
    try {
      anchor(tc)
      tc.travel(3).hours()
      assert.equal(Date.now(), ANCHOR + 10_800_000)
    } finally { restore(tc) }
  })

  it('travel(N).days advances by N * 86_400_000', () => {
    const tc = bareCase()
    try {
      anchor(tc)
      tc.travel(7).days()
      assert.equal(Date.now(), ANCHOR + 7 * 86_400_000)
    } finally { restore(tc) }
  })

  it('travelTo sets the clock to an absolute Date', () => {
    const tc = bareCase()
    try {
      const target = new Date('2030-06-15T12:00:00.000Z')
      tc.travelTo(target)
      assert.equal(Date.now(), target.getTime())
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
    assert.ok(realNow < new Date('2029-01-01').getTime(), `Expected real time after travelBack, got ${new Date(realNow).toISOString()}`)
  })

  it('travelBack is a no-op when time was not mocked', () => {
    const tc = bareCase()
    // Should not throw even though mock.timers was never enabled.
    tc.travelBack()
  })

  it('freezeTime pins Date.now across multiple reads', async () => {
    const tc = bareCase()
    try {
      const captured: number[] = []
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
    assert.ok(realNow > new Date('2025-01-01').getTime(), `Expected real time after freezeTime, got ${new Date(realNow).toISOString()}`)
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

// ─── TestCase: side-channel decoding ──────────────────────

describe('TestCase — side-channel decoding', () => {
  // Build a TestCase pre-wired with a stub fetchHandler that returns a fake
  // server-hono response carrying the x-rudderjs-test-* side channel.
  function caseWithSideChannel(payload: {
    session?: { data: Record<string, unknown>; flash: Record<string, unknown> }
    view?:    { id: string; props: Record<string, unknown> }
  }): TestCase {
    const tc = Object.create(TestCase.prototype) as TestCase
    const tcAny = tc as unknown as Record<string, unknown>
    tcAny['_pendingHeaders'] = {}
    tcAny['_pendingCookies'] = {}
    const headers = new Headers({ 'content-type': 'application/json' })
    if (payload.session) {
      headers.set(
        'x-rudderjs-test-session',
        Buffer.from(JSON.stringify(payload.session)).toString('base64'),
      )
    }
    if (payload.view) {
      headers.set(
        'x-rudderjs-test-view',
        Buffer.from(JSON.stringify(payload.view)).toString('base64'),
      )
    }
    tcAny['_handler'] = async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers,
    })
    return tc
  }

  it('decodes the session payload into TestResponse', async () => {
    const tc = caseWithSideChannel({
      session: { data: { user_id: 7 }, flash: { errors: { email: ['required'] } } },
    })
    const res = await tc.get('/anywhere')
    res.assertSessionHas('user_id', 7)
    res.assertSessionHasErrors(['email'])
  })

  it('decodes the view payload into TestResponse', async () => {
    const tc = caseWithSideChannel({
      view: { id: 'dashboard', props: { count: 3 } },
    })
    const res = await tc.get('/anywhere')
    res.assertViewIs('dashboard')
    res.assertViewHas('count', 3)
  })

  it('tolerates a missing side channel — assertions surface a clear error', async () => {
    const tc = caseWithSideChannel({})  // no headers attached
    const res = await tc.get('/anywhere')
    assert.throws(() => res.assertSessionHas('foo'), /response carries no session payload/)
    assert.throws(() => res.assertViewIs('home'), /response was not produced by view/)
  })

  it('ignores a malformed side-channel header without crashing', async () => {
    const tc = Object.create(TestCase.prototype) as TestCase
    const tcAny = tc as unknown as Record<string, unknown>
    tcAny['_pendingHeaders'] = {}
    tcAny['_pendingCookies'] = {}
    tcAny['_handler'] = async () => new Response('{}', {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-rudderjs-test-session': '!!!not-base64-json!!!',
      },
    })
    const res = await tc.get('/anywhere')
    // Decode silently dropped — assertSessionHas surfaces the no-session error
    assert.throws(() => res.assertSessionHas('foo'), /response carries no session payload/)
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

// ─── TestResponse: Session assertions ─────────────────────

describe('TestResponse — session assertions', () => {
  const sessionExtras = {
    session: {
      data:  { user_id: 42, theme: 'dark' },
      flash: { success: 'Saved!', errors: { email: ['required'] } },
    },
  }
  const makeRes = () => new TestResponse(200, {}, {}, '', [], sessionExtras)

  it('assertSessionHas passes for present key', () => {
    makeRes().assertSessionHas('user_id')
  })

  it('assertSessionHas with value compares deep-equal', () => {
    makeRes().assertSessionHas('user_id', 42)
  })

  it('assertSessionHas throws on missing key', () => {
    assert.throws(() => makeRes().assertSessionHas('missing'), /Expected session to have key "missing"/)
  })

  it('assertSessionHas throws on value mismatch', () => {
    assert.throws(() => makeRes().assertSessionHas('user_id', 99), /to deeply equal 99/)
  })

  it('assertSessionMissing passes for absent key', () => {
    makeRes().assertSessionMissing('missing')
  })

  it('assertSessionMissing throws when key is present', () => {
    assert.throws(() => makeRes().assertSessionMissing('user_id'), /but it was present/)
  })

  it('assertSessionHasErrors passes when all keys are in the errors bag', () => {
    makeRes().assertSessionHasErrors(['email'])
  })

  it('assertSessionHasErrors throws when a key is missing', () => {
    assert.throws(
      () => makeRes().assertSessionHasErrors(['email', 'name']),
      /to contain "name"/,
    )
  })

  it('session assertions fail clearly when no session payload is present', () => {
    const res = new TestResponse(200, {}, {}, '')
    assert.throws(
      () => res.assertSessionHas('foo'),
      /response carries no session payload/,
    )
  })
})

// ─── TestResponse: View assertions ────────────────────────

describe('TestResponse — view assertions', () => {
  const viewExtras = {
    view: {
      id:    'dashboard',
      props: { user: { id: 1, name: 'Alice' }, count: 3 },
    },
  }
  const makeRes = () => new TestResponse(200, {}, {}, '', [], viewExtras)

  it('assertViewIs matches the rendered view id', () => {
    makeRes().assertViewIs('dashboard')
  })

  it('assertViewIs throws on mismatch', () => {
    assert.throws(() => makeRes().assertViewIs('home'), /Expected view "home", got "dashboard"/)
  })

  it('assertViewHas passes for present prop', () => {
    makeRes().assertViewHas('count')
  })

  it('assertViewHas with value compares deep-equal', () => {
    makeRes().assertViewHas('user', { id: 1, name: 'Alice' })
  })

  it('assertViewHas throws on missing prop', () => {
    assert.throws(() => makeRes().assertViewHas('missing'), /to have prop "missing"/)
  })

  it('assertViewHas throws on value mismatch', () => {
    assert.throws(() => makeRes().assertViewHas('count', 5), /to deeply equal 5/)
  })

  it('view assertions fail clearly when the response was not a view', () => {
    const res = new TestResponse(200, {}, { ok: true }, '{"ok":true}')
    assert.throws(() => res.assertViewIs('home'), /response was not produced by view/)
  })
})

// ─── TestResponse: Validation assertions ──────────────────

describe('TestResponse — validation assertions', () => {
  it('assertValid passes when no JSON errors and no session errors', () => {
    new TestResponse(200, {}, { data: 'ok' }, '').assertValid()
    new TestResponse(200, {}, { data: 'ok' }, '', [], {
      session: { data: {}, flash: {} },
    }).assertValid()
  })

  it('assertValid throws when JSON body has errors', () => {
    const body = { errors: { email: ['required'] } }
    assert.throws(
      () => new TestResponse(422, {}, body, '').assertValid(),
      /got JSON errors for: \[email\]/,
    )
  })

  it('assertValid throws when session flash has errors', () => {
    const res = new TestResponse(302, {}, null, '', [], {
      session: { data: {}, flash: { errors: { name: ['required'] } } },
    })
    assert.throws(() => res.assertValid(), /got session errors for: \[name\]/)
  })

  it('assertInvalid passes when JSON body has errors', () => {
    const body = { errors: { email: ['required'] } }
    new TestResponse(422, {}, body, '').assertInvalid()
  })

  it('assertInvalid with keys passes when every key is present (JSON)', () => {
    const body = { errors: { email: ['required'], name: ['min'] } }
    new TestResponse(422, {}, body, '').assertInvalid(['email', 'name'])
  })

  it('assertInvalid with keys also reads from session flash errors', () => {
    const res = new TestResponse(302, {}, null, '', [], {
      session: { data: {}, flash: { errors: { name: ['required'] } } },
    })
    res.assertInvalid(['name'])
  })

  it('assertInvalid throws when no errors are present anywhere', () => {
    assert.throws(
      () => new TestResponse(200, {}, { ok: true }, '').assertInvalid(),
      /Expected validation errors/,
    )
  })

  it('assertInvalid throws when a requested key is missing', () => {
    const body = { errors: { email: ['required'] } }
    assert.throws(
      () => new TestResponse(422, {}, body, '').assertInvalid(['name']),
      /Expected validation error for "name"/,
    )
  })

  it('assertJsonValidationErrors checks the JSON body for the listed keys', () => {
    const body = { errors: { email: ['required'], name: ['min'] } }
    new TestResponse(422, {}, body, '').assertJsonValidationErrors(['email', 'name'])
  })

  it('assertJsonValidationErrors throws when the body has no errors object', () => {
    assert.throws(
      () => new TestResponse(200, {}, { ok: true }, '').assertJsonValidationErrors(['email']),
      /to have an "errors" object/,
    )
  })

  it('assertJsonValidationErrors throws when a listed key is missing', () => {
    const body = { errors: { email: ['required'] } }
    assert.throws(
      () => new TestResponse(422, {}, body, '').assertJsonValidationErrors(['name']),
      /Expected JSON validation error for "name"/,
    )
  })

  it('all validation assertions return this for chaining', () => {
    const body = { errors: { email: ['required'] } }
    const res = new TestResponse(422, {}, body, '')
    const result = res
      .assertInvalid(['email'])
      .assertJsonValidationErrors(['email'])
    assert.strictEqual(result, res)
  })
})
