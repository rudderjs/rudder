import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { Application } from '@rudderjs/core'
import type { ServiceProvider } from '@rudderjs/core'
import type { AppRequest } from '@rudderjs/contracts'
import { TestResponse } from './TestResponse.js'

// ─── Trait interface ──────────────────────────────────────

export interface TestTrait {
  setUp(testCase: TestCase): Promise<void>
  tearDown(testCase: TestCase): Promise<void>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TestTraitClass = new () => TestTrait

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ProviderClass = new (app: Application) => ServiceProvider

/**
 * Shape of a model instance accepted by the `assertModel*` / `assertSoftDeleted`
 * helpers. The constructor must carry `static table` (and ideally `static
 * primaryKey`, defaulting to `'id'`); the instance must have a populated
 * primary-key value (i.e. it must have been persisted).
 */
export interface TestModelLike {
  constructor: { table?: string, primaryKey?: string, name?: string }
}

/**
 * Returned by `TestCase.travel(amount)` to advance the mocked clock by `amount`
 * in the chosen unit. Each terminal method ticks the mock once and returns void.
 */
export class TravelBuilder {
  constructor(private readonly amount: number) {}
  milliseconds(): void { mock.timers.tick(this.amount) }
  seconds():      void { mock.timers.tick(this.amount * 1_000) }
  minutes():      void { mock.timers.tick(this.amount * 60_000) }
  hours():        void { mock.timers.tick(this.amount * 3_600_000) }
  days():         void { mock.timers.tick(this.amount * 86_400_000) }
  weeks():        void { mock.timers.tick(this.amount * 7 * 86_400_000) }
  years():        void { mock.timers.tick(this.amount * 365 * 86_400_000) }
}

// ─── TestCase ─────────────────────────────────────────────

/**
 * Base class for application integration tests.
 *
 * Subclass to configure providers, config, and traits. Use the static
 * `create()` method to bootstrap the application and run trait setUp.
 *
 * @example
 * ```ts
 * import { TestCase, RefreshDatabase } from '@rudderjs/testing'
 *
 * class UserTest extends TestCase {
 *   use = [RefreshDatabase]
 *
 *   protected providers() {
 *     return [DatabaseProvider, AuthProvider]
 *   }
 *
 *   protected config() {
 *     return { database: { url: 'file:./test.db' } }
 *   }
 * }
 *
 * // In test:
 * const t = await UserTest.create()
 * const response = await t.get('/api/users')
 * response.assertOk()
 * await t.teardown()
 * ```
 */
export class TestCase {
  /** Traits to apply — override in subclass. */
  use: TestTraitClass[] = []

  /** The bootstrapped application instance. */
  app!: Application

  /** Faker instance — available when WithFaker trait is used. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  faker: any

  /** User to act as for authenticated requests. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _actingAs: Record<string, unknown> | undefined

  /** Accumulated headers applied to every subsequent request until cleared. */
  private _pendingHeaders: Record<string, string> = {}

  /** Accumulated cookies applied to every subsequent request until cleared. */
  private _pendingCookies: Record<string, string> = {}

  /** True while this case is holding `mock.timers` enabled (for `travelBack` on teardown). */
  private _timersMocked = false

  /** Active trait instances (for teardown). */
  private _traits: TestTrait[] = []

  /** The fetch handler from the server adapter. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _handler: ((request: any) => Promise<any>) | undefined

  // ── Override points ─────────────────────────────────────

  /** Service providers to register. Override in subclass. */
  protected providers(): ProviderClass[] {
    return []
  }

  /** Config values. Override in subclass. */
  protected config(): Record<string, unknown> {
    return {}
  }

  // ── Bootstrap ───────────────────────────────────────────

  /** Create and bootstrap a test case instance. */
  static async create<T extends TestCase>(this: new () => T): Promise<T> {
    const instance = new this()
    await instance._bootstrap()
    return instance
  }

  private async _bootstrap(): Promise<void> {
    // Create application in testing mode
    this.app = Application.create({
      env: 'testing',
      debug: true,
      providers: this.providers(),
      config: this.config(),
    })

    // Boot the application (register + boot all providers)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (this.app as any).boot()

    // Try to get the fetch handler from the server adapter
    try {
      this._handler = this.app.make<(req: Request) => Promise<Response>>('fetchHandler')
    } catch {
      // No server adapter — request helpers won't work, but that's OK
      // for tests that only test services/models without HTTP
    }

    // Run trait setUp
    for (const TraitClass of this.use) {
      const trait = new TraitClass()
      await trait.setUp(this)
      this._traits.push(trait)
    }
  }

  // ── Teardown ────────────────────────────────────────────

  /** Clean up after test — runs trait teardowns and resets container. */
  async teardown(): Promise<void> {
    // Run trait teardowns in reverse order
    for (const trait of [...this._traits].reverse()) {
      await trait.tearDown(this)
    }
    this._traits = []
    this._actingAs = undefined
    this._pendingHeaders = {}
    this._pendingCookies = {}
    this.travelBack()
  }

  // ── Auth ────────────────────────────────────────────────

  /**
   * Set the authenticated user for subsequent requests. Serialized into the
   * `x-testing-user` header — picked up by `AuthMiddleware` in test mode so
   * `req.user`, `auth().user()`, `Auth.guard().check()`, and `RequireAuth`
   * all see the user (even one that doesn't exist in the database).
   */
  actingAs(user: Record<string, unknown>): this {
    this._actingAs = user
    return this
  }

  /**
   * Clear any acting-as user — subsequent requests run unauthenticated.
   * Useful when a single test toggles between authenticated and guest states.
   */
  actingAsGuest(): this {
    this._actingAs = undefined
    return this
  }

  /**
   * Assert that the test is acting as some user — i.e. `actingAs(user)` was
   * called and has not been cleared via `actingAsGuest()` / `teardown()`.
   *
   * This checks the test-side intent set via `actingAs`. To verify that a
   * specific request authenticated end-to-end (e.g. a login form), assert on
   * the response of a follow-up request to a route that requires auth.
   */
  assertAuthenticated(): this {
    assert.ok(
      this._actingAs !== undefined,
      'Expected a user to be authenticated via actingAs(), but none was set.',
    )
    return this
  }

  /**
   * Assert that the test is NOT acting as any user — `actingAs()` either was
   * never called, or was cleared via `actingAsGuest()` / `teardown()`.
   */
  assertGuest(): this {
    if (this._actingAs !== undefined) {
      const id = (this._actingAs as { id?: unknown }).id
      assert.fail(
        `Expected no actingAs() user, but one is set (id: ${String(id ?? '<no id>')}).`,
      )
    }
    return this
  }

  /**
   * Assert that the test is acting as the given user — matched by primary-key
   * `id` (coerced to string). Throws if no acting-as user is set OR the id
   * differs.
   */
  assertAuthenticatedAs(expected: { id: unknown }): this {
    this.assertAuthenticated()
    const actualId = String((this._actingAs as { id?: unknown }).id ?? '')
    const expectedId = String(expected.id ?? '')
    assert.equal(
      actualId,
      expectedId,
      `Expected acting-as user id ${expectedId}, got ${actualId}.`,
    )
    return this
  }

  // ── Request setup ───────────────────────────────────────

  /**
   * Set headers to be sent on every subsequent request, until cleared by
   * `flushHeaders()` or `teardown()`. Last-write-wins for duplicate keys.
   */
  withHeaders(headers: Record<string, string>): this {
    this._pendingHeaders = { ...this._pendingHeaders, ...headers }
    return this
  }

  /** Set a single header for every subsequent request. */
  withHeader(name: string, value: string): this {
    this._pendingHeaders[name] = value
    return this
  }

  /** Clear all accumulated headers from prior `withHeaders` / `withHeader` calls. */
  flushHeaders(): this {
    this._pendingHeaders = {}
    return this
  }

  /**
   * Set cookies to be sent on every subsequent request, until cleared by
   * `flushCookies()` or `teardown()`. Values are URI-encoded into a single
   * `Cookie` header.
   */
  withCookies(cookies: Record<string, string>): this {
    this._pendingCookies = { ...this._pendingCookies, ...cookies }
    return this
  }

  /** Set a single cookie for every subsequent request. */
  withCookie(name: string, value: string): this {
    this._pendingCookies[name] = value
    return this
  }

  /** Clear all accumulated cookies from prior `withCookies` / `withCookie` calls. */
  flushCookies(): this {
    this._pendingCookies = {}
    return this
  }

  // ── Time travel ─────────────────────────────────────────

  /**
   * Advance the mocked clock by `amount` of a chosen unit. Returns a builder
   * — pick a unit to actually advance:
   *
   * ```ts
   * t.travel(5).days()
   * t.travel(30).seconds()
   * ```
   *
   * Enables `mock.timers` on first call; `teardown()` (or an explicit
   * `travelBack()`) restores real time.
   */
  travel(amount: number): TravelBuilder {
    this._enableTimers()
    return new TravelBuilder(amount)
  }

  /**
   * Set the mocked clock to an absolute moment in time. Like `travel`, this
   * enables the mock; `teardown()` (or `travelBack()`) restores real time.
   */
  travelTo(date: Date | number): this {
    this._enableTimers()
    mock.timers.setTime(typeof date === 'number' ? date : +date)
    return this
  }

  /**
   * Restore the real clock. No-op when time was not mocked. Called automatically
   * from `teardown()`.
   */
  travelBack(): this {
    if (this._timersMocked) {
      mock.timers.reset()
      this._timersMocked = false
    }
    return this
  }

  /**
   * Freeze time at the current moment for the duration of `fn`. If time was
   * already mocked, leaves the existing mock in place; otherwise enables
   * `mock.timers` for the callback and restores afterward.
   *
   * The clock does NOT advance automatically inside `fn` — call `travel()` /
   * `travelTo()` to move it.
   */
  async freezeTime<T>(fn: () => T | Promise<T>): Promise<T> {
    const wasMocked = this._timersMocked
    this._enableTimers()
    try {
      return await fn()
    } finally {
      if (!wasMocked) this.travelBack()
    }
  }

  private _enableTimers(): void {
    if (this._timersMocked) return
    // Start the mock at the real wall-clock so `Date.now()` stays continuous
    // when the user goes in and out of time travel.
    //
    // setImmediate stays unmocked so `await new Promise(r => setImmediate(r))`
    // still yields the event loop — important for tests that travel time
    // between async steps.
    mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: Date.now() })
    this._timersMocked = true
  }

  // ── HTTP Request Helpers ────────────────────────────────

  async get(path: string, headers?: Record<string, string>): Promise<TestResponse> {
    return this._request('GET', path, undefined, headers)
  }

  async post(path: string, body?: unknown, headers?: Record<string, string>): Promise<TestResponse> {
    return this._request('POST', path, body, headers)
  }

  async put(path: string, body?: unknown, headers?: Record<string, string>): Promise<TestResponse> {
    return this._request('PUT', path, body, headers)
  }

  async patch(path: string, body?: unknown, headers?: Record<string, string>): Promise<TestResponse> {
    return this._request('PATCH', path, body, headers)
  }

  async delete(path: string, body?: unknown, headers?: Record<string, string>): Promise<TestResponse> {
    return this._request('DELETE', path, body, headers)
  }

  private async _request(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<TestResponse> {
    if (!this._handler) {
      throw new Error(
        '[RudderJS Testing] No fetch handler available. ' +
        'Ensure your TestCase registers a server adapter provider, ' +
        'or bind a "fetchHandler" in the container.',
      )
    }

    const url = `http://localhost${path.startsWith('/') ? path : '/' + path}`
    const reqHeaders: Record<string, string> = {
      'content-type': 'application/json',
      ...this._pendingHeaders,
      ...headers,
    }

    // Inject accumulated cookies — per-request `headers.cookie` (passed via the
    // helper's last arg) wins over the accumulated set.
    if (Object.keys(this._pendingCookies).length > 0 && !('cookie' in reqHeaders)) {
      reqHeaders['cookie'] = Object.entries(this._pendingCookies)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('; ')
    }

    // Inject authenticated user
    if (this._actingAs) {
      reqHeaders['x-testing-user'] = JSON.stringify(this._actingAs)
    }

    const init: RequestInit = { method, headers: reqHeaders }
    if (body !== undefined && method !== 'GET') {
      init.body = JSON.stringify(body)
    }

    const response = await this._handler(new Request(url, init))

    const text = await response.text()
    let parsed: unknown
    try { parsed = JSON.parse(text) } catch { parsed = text }

    const responseHeaders: Record<string, string> = {}
    response.headers.forEach((v: string, k: string) => { responseHeaders[k] = v })

    // Capture every Set-Cookie value separately — Headers.forEach collapses
    // duplicates, but a response can set many cookies in one go. Falls back
    // to splitting the joined header on Node runtimes that don't expose
    // getSetCookie() (unlikely on >=18.16, but safe).
    let setCookies: string[] = []
    const headersAny = response.headers as unknown as { getSetCookie?: () => string[] }
    if (typeof headersAny.getSetCookie === 'function') {
      setCookies = headersAny.getSetCookie()
    } else if (responseHeaders['set-cookie']) {
      setCookies = [responseHeaders['set-cookie']]
    }

    return new TestResponse(response.status, responseHeaders, parsed, text, setCookies)
  }

  // ─── Database Assertions ───────────────────────────────

  /** Assert that a record matching the given attributes exists in the table. */
  async assertDatabaseHas(table: string, attributes: Record<string, unknown>): Promise<void> {
    const record = await this._findRecord(table, attributes)
    assert.ok(record, `Expected a record in "${table}" matching ${JSON.stringify(attributes)}, but none was found.`)
  }

  /** Assert that no record matching the given attributes exists in the table. */
  async assertDatabaseMissing(table: string, attributes: Record<string, unknown>): Promise<void> {
    const record = await this._findRecord(table, attributes)
    assert.ok(!record, `Expected no record in "${table}" matching ${JSON.stringify(attributes)}, but one was found.`)
  }

  /** Assert the exact number of records in a table. */
  async assertDatabaseCount(table: string, count: number): Promise<void> {
    const records = await this._queryTable(table)
    assert.equal(records.length, count, `Expected ${count} records in "${table}", found ${records.length}.`)
  }

  /** Assert a table is empty. */
  async assertDatabaseEmpty(table: string): Promise<void> {
    await this.assertDatabaseCount(table, 0)
  }

  /**
   * Assert that the given model instance has a corresponding row in the database
   * (regardless of soft-delete state — finds soft-deleted rows too).
   */
  async assertModelExists(model: TestModelLike): Promise<void> {
    const { table, pk, pkValue, label } = this._modelMeta(model)
    const record = await this._findRecord(table, { [pk]: pkValue })
    assert.ok(record, `Expected ${label} to exist in the database.`)
  }

  /**
   * Assert that the given model instance has no corresponding row in the database.
   */
  async assertModelMissing(model: TestModelLike): Promise<void> {
    const { table, pk, pkValue, label } = this._modelMeta(model)
    const record = await this._findRecord(table, { [pk]: pkValue })
    assert.ok(!record, `Expected ${label} to be missing from the database, but it exists.`)
  }

  /**
   * Assert that the given model instance is soft-deleted — its row exists and
   * `deletedAt` is set. Requires `static softDeletes = true` on the model and
   * a `deletedAt` column.
   */
  async assertSoftDeleted(model: TestModelLike): Promise<void> {
    const { table, pk, pkValue, label } = this._modelMeta(model)
    const record = await this._findRecord(table, { [pk]: pkValue })
    assert.ok(record, `Expected ${label} to be soft-deleted, but no row exists.`)
    const deletedAt = (record as { deletedAt?: unknown }).deletedAt
    assert.ok(
      deletedAt != null,
      `Expected ${label} to be soft-deleted (deletedAt set), but deletedAt is null.`,
    )
  }

  /**
   * Assert that the given model instance is NOT soft-deleted — its row exists
   * and `deletedAt` is null.
   */
  async assertNotSoftDeleted(model: TestModelLike): Promise<void> {
    const { table, pk, pkValue, label } = this._modelMeta(model)
    const record = await this._findRecord(table, { [pk]: pkValue })
    assert.ok(record, `Expected ${label} to exist (not soft-deleted), but no row found.`)
    const deletedAt = (record as { deletedAt?: unknown }).deletedAt
    assert.ok(
      deletedAt == null,
      `Expected ${label} to NOT be soft-deleted, but deletedAt is ${String(deletedAt)}.`,
    )
  }

  private _modelMeta(model: TestModelLike): { table: string, pk: string, pkValue: unknown, label: string } {
    const ctor = model.constructor as { table?: string, primaryKey?: string, name?: string }
    const table = ctor.table
    if (!table) {
      throw new Error(
        '[RudderJS Testing] Model has no static `table` — pass a Model instance, ' +
        'or use assertDatabaseHas(table, …) for raw-table assertions.',
      )
    }
    const pk = ctor.primaryKey ?? 'id'
    const pkValue = (model as Record<string, unknown>)[pk]
    if (pkValue == null) {
      throw new Error(
        `[RudderJS Testing] Model has no value for primary key "${pk}" — has it been saved?`,
      )
    }
    const label = `${ctor.name ?? table}#${String(pkValue)}`
    return { table, pk, pkValue, label }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async _findRecord(table: string, attributes: Record<string, unknown>): Promise<any> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const orm = this.app.make<any>('orm')
      let q = orm.query(table)
      for (const [key, value] of Object.entries(attributes)) {
        q = q.where(key, value)
      }
      return await q.first()
    } catch (err) {
      throw new Error(
        `[RudderJS Testing] Cannot query table "${table}". Ensure an ORM adapter is registered.`,
        { cause: err },
      )
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async _queryTable(table: string): Promise<any[]> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const orm = this.app.make<any>('orm')
      return await orm.query(table).get()
    } catch (err) {
      throw new Error(
        `[RudderJS Testing] Cannot query table "${table}". Ensure an ORM adapter is registered.`,
        { cause: err },
      )
    }
  }
}
