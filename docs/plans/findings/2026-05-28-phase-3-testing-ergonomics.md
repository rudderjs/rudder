# Phase 3 Findings — `@rudderjs/testing` ergonomics

> Audit of RudderJS's test-helper surface against Laravel 12's `TestCase` parity matrix. Part of the [Framework Quality + DX Sweep](../2026-05-28-quality-dx-sweep.md).

**Date:** 2026-05-28
**Scope:** `@rudderjs/testing` + every package that ships a `*.fake()` test helper for app-author tests
**Reference:** Laravel 12.x docs (`/testing`, `/http-tests`, `/database-testing`, `/mocking`) — fetched live, not from training data

---

## Current surface

### `@rudderjs/testing` (the package)

| Symbol | File | Purpose |
|---|---|---|
| `TestCase` | `TestCase.ts:51` | Base class — HTTP helpers, DB assertions, `actingAs`, trait runner |
| `TestResponse` | `TestResponse.ts:12` | Wraps the fetch `Response` with fluent status/JSON/header assertions |
| `RefreshDatabase` | `traits/RefreshDatabase.ts:11` | Trait — truncates tables between tests |
| `WithFaker` | `traits/WithFaker.ts:16` | Trait — injects `@faker-js/faker` onto the case |
| `withTestConfig` | `withTestConfig.ts:17` | Swap global config repo for a callback |
| `TestTrait`, `TestTraitClass` | `TestCase.ts:9,15` | Trait interface types |

### Test-helpers shipped by OTHER packages

| Package | Helper | Install | Assertions |
|---|---|---|---|
| `@rudderjs/orm` | `ModelFactory`, `sequence()` | `factory(Model)` | factory DSL: `.state().with().make()/.create()` |
| `@rudderjs/mail` | `FakeMailAdapter` | `Mail.fake()` | `assertSent / assertSentCount / assertNotSent / assertNothingSent / assertQueued / assertNotQueued / assertNothingQueued` |
| `@rudderjs/queue` | `FakeQueueAdapter` | `Queue.fake()` | `assertPushed / assertPushedOn / assertPushedTimes / assertNotPushed / assertNothingPushed` |
| `@rudderjs/notification` | `NotificationFake` | `NotificationFake.fake()` | `assertSentTo / assertNotSentTo / assertSentToTimes / assertNothingSent / assertCount` |
| `@rudderjs/cache` | `FakeCacheAdapter` | `Cache.fake()` | `assertSet / assertGet / assertForgotten / assertFlushed / assertMissing / assertHas / assertLockAcquired / assertLockReleased` |
| `@rudderjs/storage` | `FakeAdapter` | `Storage.fake(disk?)` | `assertExists / assertMissing / assertCount / assertDirectoryEmpty` |
| `@rudderjs/core` | `EventFake` | `EventFake.fake()` | `assertDispatched / assertDispatchedTimes / assertNotDispatched / assertNothingDispatched` |
| `@rudderjs/ai` | `AiFake` | `AiFake.fake()` | `assertPrompted / assertGeneratedImage / assertGeneratedAudio / assertTranscribed` + call-log access |
| `@rudderjs/http` | `FakeManager` | `Http.fake()` | `assertSent / assertNotSent / assertSentCount / assertNothingSent / preventStrayRequests` |

### Test runner

`node --test` via `tsx` (no Jest, no Vitest). `--experimental-test-module-mocks` for ESM mocking (per CLAUDE.md). No documented `pnpm test` convention for app tests; users wire it themselves.

---

## Laravel 12 parity matrix

✓ = shipped · ⚠ = partial · ✗ = missing

### Auth

| Laravel | RudderJS | State | Notes |
|---|---|---|---|
| `$this->actingAs($user, $guard?)` | `TestCase.actingAs(user)` | ⚠ | No `guard` param; uses `x-testing-user` header convention |
| `$this->actingAsGuest()` | — | ✗ | |
| `$this->assertAuthenticated($guard?)` | — | ✗ | No assertion that *some* user is authed |
| `$this->assertGuest($guard?)` | — | ✗ | |
| `$this->assertAuthenticatedAs($user, $guard?)` | — | ✗ | |

### HTTP request

| Laravel | RudderJS | State | Notes |
|---|---|---|---|
| `get / post / put / patch / delete` | `TestCase.get/post/put/patch/delete` | ✓ | |
| `json / getJson / postJson / …` | — | ⚠ | Default content-type IS `application/json`; explicit `getJson` helpers absent (covered by `get`) |
| `withHeaders(arr) / withHeader(k,v)` | — | ✗ | Per-request `headers` arg only; no fluent setup |
| `withCookies / withCookie` | — | ✗ | |
| `withSession(arr)` | — | ✗ | |
| `from(url)` | — | ✗ | |
| `withoutMiddleware(class?)` | — | ✗ | Escape hatch for CSRF/auth in tests |
| `withoutExceptionHandling()` | — | ✗ | Surface raw exceptions (vs error responses) |

### HTTP response assertions

| Laravel | RudderJS | State |
|---|---|---|
| `assertStatus / assertOk / assertCreated / assertNoContent / assertNotFound / assertForbidden / assertUnauthorized / assertUnprocessable / assertSuccessful / assertServerError` | `TestResponse` | ✓ |
| `assertAccepted / assertBadRequest / assertConflict / assertGone / assertTooManyRequests` etc. | — | ✗ |
| `assertSee / assertSeeText / assertDontSee / assertDontSeeText / assertSeeInOrder` | — | ✗ |
| `assertContent / assertDownload` | — | ✗ |
| `assertHeader / assertHeaderMissing` | `TestResponse.assertHeader/assertHeaderMissing` | ✓ |
| `assertCookie / assertCookieMissing / assertCookieExpired` | — | ✗ |
| `assertRedirect` | `TestResponse.assertRedirect` | ✓ |
| `assertRedirectToRoute(name, params)` | — | ✗ | Pairs with typed-routes registry |
| `assertJson(arr or fn)` | `TestResponse.assertJson(arr)` | ⚠ | No fluent (`AssertableJson`) form |
| `assertExactJson / assertJsonFragment / assertJsonMissingExact / assertJsonIsArray / assertJsonIsObject` | — | ✗ |
| `assertJsonStructure / assertJsonPath / assertJsonCount / assertJsonMissing` | `TestResponse` | ✓ |
| `assertJsonValidationErrors / assertJsonValidationErrorFor` | — | ✗ |
| `assertSessionHas / assertSessionMissing / assertSessionHasErrors` | — | ✗ |
| `assertValid() / assertInvalid(keys)` | — | ✗ |
| `assertViewIs / assertViewHas` | — | ✗ | Relevant for SSR view() responses |
| `dump / dd / dumpHeaders / dumpJson` | — | ✗ | Debug niceties |

### Database

| Laravel | RudderJS | State |
|---|---|---|
| `RefreshDatabase` trait | `RefreshDatabase` (TRUNCATE) | ⚠ | Laravel default is per-test transaction; truncate is heavier |
| `DatabaseTransactions` / `DatabaseMigrations` / `LazilyRefreshDatabase` | — | ✗ |
| `assertDatabaseHas / assertDatabaseMissing / assertDatabaseCount / assertDatabaseEmpty` | `TestCase` | ✓ |
| `assertSoftDeleted / assertNotSoftDeleted` | — | ✗ |
| `assertModelExists / assertModelMissing` | — | ✗ | Model-instance variants |
| `expectsDatabaseQueryCount(n)` | — | ✗ | N+1 regression guard |
| `seed() / $seed / $seeder` properties | — | ✗ | No first-class TestCase seed integration |
| Factories | `factory()` / `ModelFactory` (#569) | ✓ | All core verbs covered (`state`, `with`, `make`, `create`, `sequence`); relationship helpers (`for`, `has`, `recycle`) — needs spot-check |

### Fakes

| Laravel | RudderJS | State |
|---|---|---|
| `Mail::fake()` + assertions | `Mail.fake()` | ✓ |
| `Mail::assertOutgoingCount / assertNothingOutgoing` (combined) | — | ✗ |
| Mailable-instance assertions (`assertFrom/To/Subject/Cc/Bcc/Reply-to/Tag/Metadata/SeeInHtml/SeeInText/Attachment`) | — | ✗ | Currently only top-level fake-level assertions |
| `Bus::fake() / Queue::fake()` | `Queue.fake()` | ⚠ | No separate `Bus.fake()`; queue is the bus |
| `assertChained / assertBatched / assertDispatchedSync / assertDispatchedAfterResponse` | — | ✗ | If `@rudderjs/queue` supports chains/batches; verify |
| `Notification::fake()` + `assertSentOnDemand` | `NotificationFake.fake()` (no on-demand) | ⚠ |
| `Event::fake([only])` / `Event::fake()->except([...])` / `Event::fakeFor(fn)` | `EventFake.fake()` | ⚠ | No per-event filter or scope-fn forms |
| `Event::assertListening(event, listener)` | — | ✗ |
| `Storage::fake / persistentFake` | `Storage.fake()` (no persistentFake) | ⚠ |
| `UploadedFile::fake()->image() / ->create()` | — | ✗ |
| `Http::fake() / preventStrayRequests / assertSent*` | `Http.fake()` | ✓ |
| `Http::sequence() / fakeSequence()` | — | ✗ | Sequenced fake responses |
| `Exceptions::fake() + assertReported` | — | ✗ | |
| `Process::fake()` | — | ✗ | Niche in Node; defer |

### Time

| Laravel | RudderJS | State |
|---|---|---|
| `travel(n).seconds/minutes/hours/days/weeks/years()` | — | ✗ |
| `travelTo(time) / travelBack()` | — | ✗ |
| `freezeTime(fn) / freezeSecond(fn)` | — | ✗ |

### Lifecycle / TestCase machinery

| Laravel | RudderJS | State |
|---|---|---|
| Trait system (per-test `setUp / tearDown`) | `TestTrait` + `use = [...]` | ✓ |
| `$this->mock / spy / partialMock` (Mockery) | — | ✗ | Node has built-in `mock` — design differently |
| `Bus::fake([only])` partial-fake | — | ✗ | Most RudderJS fakes are all-or-nothing |
| `ParallelTesting / WithCachedConfig / WithCachedRoutes` | — | ✗ | Defer |
| `php artisan test` runner | — | ✗ | `node --test` directly; no wrapper command |

---

## Categorized gaps

### 🔴 High value, low cost — recommend SHIP

**A. Auth assertions** — `assertAuthenticated`, `assertGuest`, `assertAuthenticatedAs` on TestCase. Currently you can `actingAs(user)` but can't assert the session resolved them back. Three tiny methods.

**B. Time travel** — `travel(n).seconds/.minutes/.hours/.days()`, `travelTo(date)`, `freezeTime(fn)`, `travelBack()`. Node 22 ships `MockTimers` (`import { mock } from 'node:test'` → `mock.timers.enable(...)`). Wrap with a Laravel-style fluent API.

**C. Database assertions** — `assertSoftDeleted(model)`, `assertNotSoftDeleted(model)`, `assertModelExists(model)`, `assertModelMissing(model)`. Model-instance variants of what we already have. `expectsDatabaseQueryCount(n)` — pairs with `@rudderjs/orm`'s existing query observer (memory: `EventDispatcher.inspect()` ships).

**D. TestResponse content + session + cookies + view + validation assertions** — biggest bang for buck. Specifically:
   - `assertSee/Text(s)`, `assertDontSee/Text(s)`, `assertSeeInOrder(arr)` — for SSR view() responses
   - `assertCookie(name, value?)`, `assertCookieMissing(name)`, `assertCookieExpired(name)`
   - `assertSessionHas(key, value?)`, `assertSessionMissing(key)`, `assertSessionHasErrors(keys, format?)`
   - `assertViewIs(id)`, `assertViewHas(key, value?)` — for `view('id', props)` responses
   - `assertValid()`, `assertInvalid(keys)` — quick validation status check
   - `assertJsonValidationErrors(keys)` — for API validation responses
   - `assertJsonFragment / assertExactJson / assertJsonMissingExact`
   - `assertRedirectToRoute(name, params)` — leverages typed-routes `RouteRegistry`
   - More status helpers: `assertAccepted`, `assertBadRequest`, `assertConflict`, `assertGone`, `assertTooManyRequests`

**E. Request setup fluent chain** — `withHeaders(obj)`, `withCookies(obj)`, `withSession(obj)`, `withoutMiddleware(Class?)`, `withoutExceptionHandling()`. Currently every request needs headers passed inline; fluent chain matches Laravel.

**F. Mail outgoing assertions + Mailable-instance assertions** — `Mail.assertOutgoingCount(n)`, `Mail.assertNothingOutgoing()` (combined sent+queued). Mailable-instance helpers (`assertTo`, `assertSubject`, `assertSeeInHtml`) — these are the bulk of what Laravel ships and we have none.

**G. Documentation drift sweep** — pure docs PR:
   - `traits()` method documented but actual API is `use` field (`docs/guide/testing.md:107`)
   - `sequence()` helper not documented
   - `ModelFactory` walkthrough missing from testing.md
   - `AiFake.respondWithSequence/respondWithImage/respondWithAudio/respondWithTranscription/failOnStep` undocumented
   - `Storage.fake(disk?)` multi-disk pattern undocumented
   - `Storage.restoreFakes()` cleanup undocumented
   - TestResponse fluent chaining (every `assert*` returns `this`) not stated
   - Database-assertion ORM-adapter requirement not documented

### 🟡 Useful, moderate cost

**H. AssertableJson fluent API** — `assertJson(j => j.has('user').where('user.name', 'X').etc())`. Laravel's canonical JSON assertion in 12.x. Bigger design lift (mini-DSL); pure additive.

**I. Sequenced HTTP fake** — `Http.fake().sequence().push(...).push(...).whenEmpty(...)`. Useful for testing retry logic and pagination. `@rudderjs/http`-only.

**J. Bus.fake() vs Queue.fake() separation** + `assertChained` / `assertBatched` — only worth doing if `@rudderjs/queue` supports chains/batches. Needs verification before designing.

**K. Exceptions.fake() + assertReported** — for testing exception reporters. Useful only if apps register custom reporters.

**L. UploadedFile.fake().image()/create()** — file upload testing. Useful but moderately complex (Blob/File polyfill semantics, multipart bodies).

**M. Event.fake([only]) / fakeFor(fn) / assertListening** — partial-fakes and scoped fakes. Mostly ergonomics.

### 🟢 Defer

- `Process.fake()` — Node apps rarely shell out; low ROI
- Mockery-style `mock/spy/partialMock` — Node has `node:test`'s built-in `mock` API; designing a Mockery clone would conflict, not augment. Document the Node-native pattern instead.
- `ParallelTesting`, `WithCachedConfig`, `WithCachedRoutes` — Laravel-specific perf
- `dump/dd/dumpHeaders` debugging — nice but not load-bearing
- `expectsEvents` legacy — deprecated in Laravel 12 itself
- `from(url)` — almost never used; HTTP-Referer-based redirects are niche
- `php artisan test` wrapper — `node --test` is the convention; not worth wrapping

---

## Design sketches (🔴 items)

### A. Auth assertions

```ts
// TestCase additions
assertAuthenticated(guard?: string): this {
  const user = this._resolveCurrentUser(guard)  // reads from session/token guard
  assert.ok(user, `Expected a user to be authenticated${guard ? ` (guard: ${guard})` : ''}`)
  return this
}

assertGuest(guard?: string): this {
  const user = this._resolveCurrentUser(guard)
  assert.ok(!user, `Expected no authenticated user${guard ? ` (guard: ${guard})` : ''}, got ${user?.id}`)
  return this
}

assertAuthenticatedAs(expected: { id: unknown }, guard?: string): this {
  const user = this._resolveCurrentUser(guard)
  assert.ok(user, 'Expected a user to be authenticated')
  assert.equal(user.id, expected.id, `Expected authenticated user ${expected.id}, got ${user.id}`)
  return this
}
```

Open question: where's "current user" resolved from in a TestCase? Today `actingAs` only sets `x-testing-user`. Needs to plug into the SessionGuard / AuthManager. **Probably the implementation lives in `@rudderjs/auth`, exported back into testing as a trait.**

### B. Time travel

```ts
// @rudderjs/testing - new file: src/time.ts
import { mock } from 'node:test'

export class TimeTravel {
  private static _baseline: number | null = null

  static travel(amount: number) {
    return new TravelBuilder(amount)
  }

  static travelTo(date: Date | number): void {
    mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: +date })
  }

  static travelBack(): void {
    mock.timers.reset()
  }

  static freezeTime<T>(fn: () => T): T {
    const now = Date.now()
    mock.timers.enable({ apis: ['Date'], now })
    try { return fn() } finally { mock.timers.reset() }
  }
}

class TravelBuilder {
  constructor(private amount: number) {}
  seconds() { this._tick(this.amount * 1_000) }
  minutes() { this._tick(this.amount * 60_000) }
  hours()   { this._tick(this.amount * 3_600_000) }
  days()    { this._tick(this.amount * 86_400_000) }
  weeks()   { this._tick(this.amount * 7 * 86_400_000) }
  private _tick(ms: number) { mock.timers.tick(ms) }
}
```

Expose as `TestCase.travel/travelTo/freezeTime/travelBack` (methods) AND as standalone `travel(n).days()` for non-TestCase usage. Pairs with `--experimental-test-module-mocks` script flag.

### C. Database assertions

```ts
// TestCase additions
async assertSoftDeleted(model: { constructor: { table: string }, id: unknown }): Promise<void> {
  const record = await this._findRecord(model.constructor.table, { id: model.id })
  assert.ok(record?.deletedAt, `Expected ${model.constructor.name}#${model.id} to be soft-deleted`)
}
async assertNotSoftDeleted(model: { ... }): Promise<void> { /* mirror */ }
async assertModelExists(model: { ... }): Promise<void> { await this.assertDatabaseHas(model.constructor.table, { id: model.id }) }
async assertModelMissing(model: { ... }): Promise<void> { await this.assertDatabaseMissing(model.constructor.table, { id: model.id }) }

async expectsDatabaseQueryCount(expected: number): Promise<void> {
  // pre-hook a counter; assert in afterEach
}
```

`expectsDatabaseQueryCount` needs an ORM event hook — verify `@rudderjs/orm` emits `query.executed` (memory: EventDispatcher.inspect() exists — probably yes).

### D. TestResponse expansion

Each is small. Group by surface:

```ts
// Content
assertSee(text: string): this
assertDontSee(text: string): this
assertSeeInOrder(texts: string[]): this
assertSeeText(text: string): this       // strips HTML
assertDontSeeText(text: string): this

// Cookies
assertCookie(name: string, value?: string): this
assertCookieMissing(name: string): this
assertCookieExpired(name: string): this

// Session (requires session response capture — needs server-hono coordination)
assertSessionHas(key: string, value?: unknown): this
assertSessionMissing(key: string): this
assertSessionHasErrors(keys: string[] | Record<string, string>): this

// View (capture from view() response — needs @rudderjs/view marker on Response)
assertViewIs(id: string): this
assertViewHas(key: string, value?: unknown): this

// Validation (HTTP)
assertValid(): this
assertInvalid(keys: string[]): this
assertJsonValidationErrors(keys: string[]): this

// JSON expansion
assertJsonFragment(arr: Record<string, unknown>): this
assertExactJson(arr: Record<string, unknown>): this
assertJsonMissingExact(arr: Record<string, unknown>): this

// Status (additive)
assertAccepted(): this        // 202
assertBadRequest(): this      // 400
assertConflict(): this        // 409
assertGone(): this            // 410
assertTooManyRequests(): this // 429

// Redirect
assertRedirectToRoute(name: keyof RouteRegistry, params?: Record<string, unknown>): this
```

Session + view + validation assertions need cross-package coordination: server-hono needs to expose session payload + view id back through the test client. Cleanest: include `x-test-session`, `x-test-view-id`, `x-test-view-props` headers in test mode (or a side channel).

### E. Request setup fluent chain

```ts
// TestCase additions — every method returns `this` and accumulates state cleared in teardown
withHeaders(headers: Record<string, string>): this
withHeader(name: string, value: string): this
withCookies(cookies: Record<string, string>): this
withCookie(name: string, value: string): this
withSession(session: Record<string, unknown>): this
withoutMiddleware(middleware?: Function | Function[]): this  // disables one or all middleware
withoutExceptionHandling(): this  // re-throws instead of rendering error responses
```

Maintain accumulated state in private fields; merge into `_request()` on next call. `teardown()` clears.

### F. Mail extras

```ts
// @rudderjs/mail FakeMailAdapter additions
assertOutgoingCount(count: number): void  // sent + queued combined
assertNothingOutgoing(): void
assertNotOutgoing(predicate: (msg) => boolean): void

// Mailable-instance assertion helpers — exported from the package
assertTo(mailable, recipient): void
assertFrom(mailable, sender): void
assertSubject(mailable, subject): void
assertHasCc / Bcc / ReplyTo / Tag / Metadata / Attachment
assertSeeInHtml(mailable, text): void
assertDontSeeInHtml(mailable, text): void
assertSeeInText / assertDontSeeInText
```

### G. Documentation drift sweep

Pure-docs PR: rewrite `docs/guide/testing.md` to match the actual surface. Add a `Factories` section pulling from `ModelFactory` source. Document every `*.fake()` install pattern with the exact assertion list. **No code changes.**

---

## Recommended fix clusters

One PR per cluster. Branch names suggested; not prescriptive.

| # | Cluster | Pkg(s) | Effort | Bump | Branch |
|---|---|---|---|---|---|
| 1 | **G. Docs drift** | `@rudderjs/testing` docs only | XS | — (no changeset) | `docs/testing-guide-sweep` |
| 2 | **A. Auth assertions** | `@rudderjs/testing` + tiny `@rudderjs/auth` hook | S | minor | `feat/test-auth-assertions` |
| 3 | **C. Database assertions** | `@rudderjs/testing` (+ optionally `@rudderjs/orm` query-count hook) | S | minor | `feat/test-database-assertions` |
| 4 | **E. Request setup chain** | `@rudderjs/testing` | S | minor | `feat/test-request-setup-chain` |
| 5 | **D. TestResponse expansion** | `@rudderjs/testing` (+ `@rudderjs/server-hono` for session/view headers) | M | minor | `feat/test-response-assertions` |
| 6 | **B. Time travel** | `@rudderjs/testing` | M | minor | `feat/test-time-travel` |
| 7 | **F. Mail extras** | `@rudderjs/mail` (+ docs in testing) | M | minor | `feat/mail-test-assertions` |
| 8 | **H. AssertableJson** (🟡) | `@rudderjs/testing` | M | minor | `feat/assertable-json` |
| 9 | **I. Sequenced HTTP fake** (🟡) | `@rudderjs/http` | S | minor | `feat/http-fake-sequence` |

Tight scope for one session = clusters **1, 2, 3, 4** (Docs + Auth + DB + RequestChain). All small, all in `@rudderjs/testing` (with one auth hook). Clusters 5–7 add real surface area and are better as a second wave.

---

## Out-of-scope / deferred

- 🟢 items: Process.fake, Mockery clone, ParallelTesting, dump/dd debug helpers, expectsEvents legacy, `php artisan test` wrapper, `from(url)`
- 🟡 items (J, K, L, M): Bus separation + assertChained/Batched, Exceptions.fake, UploadedFile.fake, Event partial-fakes — useful but not blocking; queue for a third-wave PR after first/second-wave ships
- **Transaction-based `DatabaseTransactions` trait** — Laravel default is transaction-rollback (faster than TRUNCATE). Considered but skipped: our adapters don't all support nested transactions uniformly (Prisma + Drizzle differ), and the truncation approach works today.

---

## Documentation drift detail

These are the source-vs-docs mismatches caught during inventory. All fold into Cluster G:

| Doc claim | Actual API | Location |
|---|---|---|
| `traits() { return [...] }` method | `use: TestTraitClass[] = []` field | `docs/guide/testing.md:107` |
| `Storage.fake()` | `Storage.fake(diskName?)` (multi-disk aware) | `packages/storage/src/index.ts:97` |
| (none) | `Storage.restoreFakes()` cleanup pattern | `packages/storage/src/index.ts:118` |
| `AiFake.respondWith(text)` only | Also `.respondWithSequence / .respondWithImage / .respondWithAudio / .respondWithTranscription / .failOnStep` | `packages/ai/src/fake.ts:83+` |
| (none) | `sequence()` helper from `@rudderjs/orm` | `packages/orm/src/factory.ts:14` |
| (none) | `ModelFactory` walkthrough — how to write a factory | `packages/orm/src/factory.ts:63` |
| (none) | Database assertions require an ORM adapter bound to `'orm'` | `packages/testing/src/TestCase.ts:240+` |
| (none) | TestResponse assertions all return `this` (chainable) | `packages/testing/src/TestResponse.ts:33+` |

---

## Overall assessment

**The surface is in much better shape than the audit hypothesis assumed.** Eight `*.fake()` packages already ship (Mail/Queue/Notification/Cache/Storage/Event/Ai/Http), plus a working `TestCase` with HTTP + DB assertions, plus factories. The big-rock items Laravel ships and we don't are: **auth assertions (3 methods)**, **time travel (4 methods)**, and **TestResponse content/session/cookie/view/validation assertions (~15 methods)**. The biggest pure-quality win is the **docs drift sweep** — multiple documented APIs don't match source, and several useful exports (factories, AiFake's full surface, Storage multi-disk) are undocumented entirely.

**Recommendation:** Ship Clusters 1–4 this wave (Docs + Auth + DB + RequestChain). All small, all `@rudderjs/testing`-centric, all `feat:` minor bumps except Cluster 1 (pure docs). Defer Clusters 5–7 (TestResponse expansion, Time travel, Mail extras) to a second wave once 1–4 are validated. Defer 🟡 clusters (8, 9) until apps actually need them.
