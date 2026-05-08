import assert from 'node:assert/strict'
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
  }

  // ── Auth ────────────────────────────────────────────────

  /** Set the authenticated user for subsequent requests. */
  actingAs(user: Record<string, unknown>): this {
    this._actingAs = user
    return this
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
      ...headers,
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

    return new TestResponse(response.status, responseHeaders, parsed, text)
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
