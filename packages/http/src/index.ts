// ─── Types ─────────────────────────────────────────────────

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export interface HttpResponseData {
  status:  number
  headers: Record<string, string>
  body:    string
  json<T = unknown>(): T
  ok():    boolean
}

export type RequestInterceptor  = (req: PendingRequest) => PendingRequest | Promise<PendingRequest>
export type ResponseInterceptor = (res: HttpResponseData) => HttpResponseData | Promise<HttpResponseData>

// ─── Fake response entry ────────────────────────────────────

interface FakeEntry {
  pattern: string | RegExp
  responses: FakeResponse[]
  index: number
}

interface FakeResponse {
  status:  number
  body:    unknown
  headers: Record<string, string>
}

interface RecordedRequest {
  method:  string
  url:     string
  options: RequestInit & { timeout?: number }
}

// ─── HttpResponse ───────────────────────────────────────────

class HttpResponse implements HttpResponseData {
  readonly status:  number
  readonly headers: Record<string, string>
  readonly body:    string

  constructor(status: number, body: string, headers: Record<string, string> = {}) {
    this.status  = status
    this.body    = body
    this.headers = headers
  }

  json<T = unknown>(): T {
    return JSON.parse(this.body) as T
  }

  ok(): boolean {
    return this.status >= 200 && this.status < 300
  }
}

// ─── PendingRequest ─────────────────────────────────────────

export class PendingRequest {
  private _baseUrl      = ''
  private _headers:     Record<string, string> = {}
  private _query:       Record<string, string> = {}
  private _body:        unknown = undefined
  private _bodyType:    'json' | 'form' | 'raw' | 'none' = 'none'
  private _retries      = 0
  private _retryDelay   = 100
  private _timeout      = 0
  private _reqInterceptors: RequestInterceptor[]  = []
  private _resInterceptors: ResponseInterceptor[] = []
  private _fake:        FakeManager | null = null
  private _recorder:    RecordedRequest[] | null = null

  /** @internal */
  _clone(): PendingRequest {
    const c = new PendingRequest()
    c._baseUrl          = this._baseUrl
    c._headers          = { ...this._headers }
    c._query            = { ...this._query }
    c._retries          = this._retries
    c._retryDelay       = this._retryDelay
    c._timeout          = this._timeout
    c._reqInterceptors  = [...this._reqInterceptors]
    c._resInterceptors  = [...this._resInterceptors]
    c._fake             = this._fake
    c._recorder         = this._recorder
    return c
  }

  /** Set the base URL prepended to all requests. */
  baseUrl(url: string): this {
    this._baseUrl = url.replace(/\/$/, '')
    return this
  }

  /** Set or merge request headers. */
  withHeaders(headers: Record<string, string>): this {
    Object.assign(this._headers, headers)
    return this
  }

  /** Set the Authorization: Bearer <token> header. */
  withToken(token: string): this {
    return this.withHeaders({ Authorization: `Bearer ${token}` })
  }

  /** Set Basic auth header. */
  withBasicAuth(username: string, password: string): this {
    const encoded = Buffer.from(`${username}:${password}`).toString('base64')
    return this.withHeaders({ Authorization: `Basic ${encoded}` })
  }

  /** Append query string parameters. */
  withQueryParameters(params: Record<string, string | number | boolean>): this {
    for (const [k, v] of Object.entries(params)) {
      this._query[k] = String(v)
    }
    return this
  }

  /** Send body as JSON (sets Content-Type: application/json). */
  withBody(data: unknown): this {
    this._body     = data
    this._bodyType = 'json'
    return this
  }

  /** Send body as application/x-www-form-urlencoded. */
  asForm(): this {
    this._bodyType = 'form'
    return this
  }

  /** Retry on failure — delays between attempts grow linearly by `delay` ms. */
  retry(times: number, delay = 100): this {
    this._retries    = times
    this._retryDelay = delay
    return this
  }

  /** Abort the request after `ms` milliseconds (throws on timeout). */
  timeout(ms: number): this {
    this._timeout = ms
    return this
  }

  /** Add a request interceptor (runs in order before the request is sent). */
  withRequestMiddleware(fn: RequestInterceptor): this {
    this._reqInterceptors.push(fn)
    return this
  }

  /** Add a response interceptor (runs in order after the response is received). */
  withResponseMiddleware(fn: ResponseInterceptor): this {
    this._resInterceptors.push(fn)
    return this
  }

  /** @internal — wired by FakeManager */
  _attachFake(fake: FakeManager, recorder: RecordedRequest[]): this {
    this._fake     = fake
    this._recorder = recorder
    return this
  }

  // ── HTTP verb shorthands ──────────────────────────────────

  get(url: string, query?: Record<string, string | number | boolean>): Promise<HttpResponseData> {
    const req = this._clone()
    if (query) req.withQueryParameters(query)
    return req._send('GET', url)
  }

  post(url: string, data?: unknown): Promise<HttpResponseData> {
    const req = this._clone()
    if (data !== undefined) req.withBody(data)
    return req._send('POST', url)
  }

  put(url: string, data?: unknown): Promise<HttpResponseData> {
    const req = this._clone()
    if (data !== undefined) req.withBody(data)
    return req._send('PUT', url)
  }

  patch(url: string, data?: unknown): Promise<HttpResponseData> {
    const req = this._clone()
    if (data !== undefined) req.withBody(data)
    return req._send('PATCH', url)
  }

  delete(url: string): Promise<HttpResponseData> {
    return this._clone()._send('DELETE', url)
  }

  head(url: string): Promise<HttpResponseData> {
    return this._clone()._send('HEAD', url)
  }

  // ── Internal send ─────────────────────────────────────────

  async _send(method: HttpMethod, url: string): Promise<HttpResponseData> {
    // Apply request interceptors
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let pending: PendingRequest = this
    for (const interceptor of this._reqInterceptors) {
      pending = await interceptor(pending)
    }

    const fullUrl = pending._buildUrl(url)
    const init    = pending._buildInit(method)

    if (pending._recorder) {
      pending._recorder.push({ method, url: fullUrl, options: { ...init, timeout: pending._timeout } })
    }

    // Fake mode
    if (pending._fake) {
      const fakeRes = pending._fake._match(fullUrl)
      if (fakeRes) {
        let res: HttpResponseData = new HttpResponse(
          fakeRes.status,
          typeof fakeRes.body === 'string' ? fakeRes.body : JSON.stringify(fakeRes.body),
          fakeRes.headers,
        )
        for (const interceptor of pending._resInterceptors) {
          res = await interceptor(res)
        }
        return res
      }
      if (pending._fake._preventStray) {
        throw new Error(`[RudderJS/Http] No fake registered for ${method} ${fullUrl}`)
      }
    }

    // Real fetch with retries
    let attempt = 0
    const maxAttempts = pending._retries + 1

    while (true) {
      try {
        let res: HttpResponseData = await pending._fetch(fullUrl, init)
        for (const interceptor of pending._resInterceptors) {
          res = await interceptor(res)
        }
        return res
      } catch (err) {
        attempt++
        if (attempt >= maxAttempts) throw err
        await _sleep(pending._retryDelay * attempt)
      }
    }
  }

  private async _fetch(url: string, init: RequestInit): Promise<HttpResponseData> {
    let controller: AbortController | undefined
    let timer: ReturnType<typeof setTimeout> | undefined

    if (this._timeout > 0) {
      controller = new AbortController()
      timer = setTimeout(() => controller!.abort(), this._timeout)
    }

    try {
      const res = await fetch(url, {
        ...init,
        ...(controller ? { signal: controller.signal } : {}),
      })

      const body    = await res.text()
      const headers: Record<string, string> = {}
      res.headers.forEach((v, k) => { headers[k] = v })

      return new HttpResponse(res.status, body, headers)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`[RudderJS/Http] Request timed out after ${this._timeout}ms`, { cause: err })
      }
      throw err
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  private _buildUrl(url: string): string {
    const base   = url.startsWith('http') ? url : `${this._baseUrl}${url}`
    const params = new URLSearchParams(this._query)
    const qs     = params.toString()
    if (!qs) return base
    return base.includes('?') ? `${base}&${qs}` : `${base}?${qs}`
  }

  private _buildInit(method: HttpMethod): RequestInit {
    const headers: Record<string, string> = { ...this._headers }
    let body: BodyInit | null = null

    if (this._body !== undefined) {
      if (this._bodyType === 'form') {
        headers['Content-Type'] = 'application/x-www-form-urlencoded'
        body = new URLSearchParams(this._body as Record<string, string>).toString()
      } else {
        headers['Content-Type'] = 'application/json'
        body = JSON.stringify(this._body)
      }
    }

    return { method, headers, body }
  }
}

// ─── Pool ───────────────────────────────────────────────────

export class Pool {
  private _concurrency = Infinity
  private _tasks: (() => Promise<HttpResponseData>)[] = []

  constructor(private readonly _builder: PendingRequest) {}

  /** Limit the number of concurrent requests. */
  concurrency(n: number): this {
    this._concurrency = n
    return this
  }

  /** Add a request to the pool. */
  add(fn: (http: PendingRequest) => Promise<HttpResponseData>): this {
    this._tasks.push(() => fn(this._builder._clone()))
    return this
  }

  /** Execute all requests and return responses in submission order. */
  async send(): Promise<HttpResponseData[]> {
    const results: HttpResponseData[] = new Array(this._tasks.length)
    let index = 0
    let active = 0

    await new Promise<void>((resolve, reject) => {
      const next = () => {
        if (index >= this._tasks.length && active === 0) {
          resolve()
          return
        }

        while (active < this._concurrency && index < this._tasks.length) {
          const i = index++
          active++
          this._tasks[i]!()
            .then(res => {
              results[i] = res
              active--
              next()
            })
            .catch(err => {
              reject(err as Error)
            })
        }
      }
      next()
    })

    return results
  }
}

// ─── FakeManager ────────────────────────────────────────────

export class FakeManager {
  private _entries: FakeEntry[] = []
  private _recorded: RecordedRequest[] = []
  _preventStray = false

  /** Register a fake response for a URL pattern. */
  register(
    pattern: string | RegExp,
    responseOrSequence: FakeResponse | FakeResponse[],
  ): this {
    const responses = Array.isArray(responseOrSequence)
      ? responseOrSequence
      : [responseOrSequence]
    this._entries.push({ pattern, responses, index: 0 })
    return this
  }

  /** Throw if a request is made to an unregistered URL. */
  preventStrayRequests(): this {
    this._preventStray = true
    return this
  }

  /** @internal */
  _match(url: string): FakeResponse | null {
    for (const entry of this._entries) {
      const matched =
        typeof entry.pattern === 'string'
          ? url.includes(entry.pattern)
          : entry.pattern.test(url)

      if (matched) {
        const res = entry.responses[entry.index] ?? entry.responses[entry.responses.length - 1]
        if (entry.index < entry.responses.length - 1) entry.index++
        return res!
      }
    }
    return null
  }

  /** All requests sent through the faked client. */
  recorded(): RecordedRequest[] {
    return [...this._recorded]
  }

  /** Assert that a request matching the predicate was sent. */
  assertSent(fn: (req: RecordedRequest) => boolean): void {
    if (!this._recorded.some(fn)) {
      throw new Error('[RudderJS/Http] Expected request was not sent.')
    }
  }

  /** Assert that no request matching the predicate was sent. */
  assertNotSent(fn: (req: RecordedRequest) => boolean): void {
    if (this._recorded.some(fn)) {
      throw new Error('[RudderJS/Http] Unexpected request was sent.')
    }
  }

  /** Assert the total number of requests sent. */
  assertSentCount(count: number): void {
    if (this._recorded.length !== count) {
      throw new Error(
        `[RudderJS/Http] Expected ${count} request(s), got ${this._recorded.length}.`,
      )
    }
  }

  /** Assert no requests were sent. */
  assertNothingSent(): void {
    this.assertSentCount(0)
  }

  /** Build a PendingRequest wired to this fake. */
  client(): PendingRequest {
    const req = new PendingRequest()
    req._attachFake(this, this._recorded)
    return req
  }
}

// ─── Http facade ────────────────────────────────────────────

/**
 * Global HTTP client facade.
 *
 * @example
 * const res = await Http.get('https://api.example.com/users')
 * const users = res.json<User[]>()
 *
 * // With options
 * await Http.withToken(token).post('/api/users', { name: 'Alice' })
 *
 * // Retries + timeout
 * await Http.retry(3, 200).timeout(5000).get('/api/data')
 *
 * // Pool
 * const results = await Http.pool(pool => {
 *   pool.add(http => http.get('/api/a'))
 *   pool.add(http => http.get('/api/b'))
 * }).concurrency(2).send()
 *
 * // Fake
 * const fake = Http.fake()
 * fake.register('example.com', { status: 200, body: { ok: true }, headers: {} })
 * const client = fake.client()
 * const res = await client.get('https://example.com/test')
 */
export class Http {
  private static _globalReqInterceptors: RequestInterceptor[]  = []
  private static _globalResInterceptors: ResponseInterceptor[] = []

  /** Add a global request interceptor (runs on all requests). */
  static interceptRequest(fn: RequestInterceptor): void {
    Http._globalReqInterceptors.push(fn)
  }

  /** Add a global response interceptor (runs on all responses). */
  static interceptResponse(fn: ResponseInterceptor): void {
    Http._globalResInterceptors.push(fn)
  }

  /** Clear all global interceptors. */
  static clearInterceptors(): void {
    Http._globalReqInterceptors = []
    Http._globalResInterceptors = []
  }

  private static _make(): PendingRequest {
    const req = new PendingRequest()
    for (const fn of Http._globalReqInterceptors) req.withRequestMiddleware(fn)
    for (const fn of Http._globalResInterceptors) req.withResponseMiddleware(fn)
    return req
  }

  /** Create a new `FakeManager` for testing. */
  static fake(): FakeManager {
    return new FakeManager()
  }

  /** Create a request pool. */
  static pool(configure: (pool: Pool) => void): Pool {
    const p = new Pool(Http._make())
    configure(p)
    return p
  }

  // ── Fluent configuration ──────────────────────────────────

  static baseUrl(url: string): PendingRequest           { return Http._make().baseUrl(url) }
  static withHeaders(h: Record<string, string>): PendingRequest { return Http._make().withHeaders(h) }
  static withToken(token: string): PendingRequest       { return Http._make().withToken(token) }
  static withBasicAuth(u: string, p: string): PendingRequest { return Http._make().withBasicAuth(u, p) }
  static withBody(data: unknown): PendingRequest        { return Http._make().withBody(data) }
  static asForm(): PendingRequest                       { return Http._make().asForm() }
  static retry(times: number, delay?: number): PendingRequest { return Http._make().retry(times, delay) }
  static timeout(ms: number): PendingRequest            { return Http._make().timeout(ms) }
  static withQueryParameters(q: Record<string, string | number | boolean>): PendingRequest {
    return Http._make().withQueryParameters(q)
  }

  // ── Verb shorthands ───────────────────────────────────────

  static get(url: string, query?: Record<string, string | number | boolean>): Promise<HttpResponseData> {
    return Http._make().get(url, query)
  }

  static post(url: string, data?: unknown): Promise<HttpResponseData> {
    return Http._make().post(url, data)
  }

  static put(url: string, data?: unknown): Promise<HttpResponseData> {
    return Http._make().put(url, data)
  }

  static patch(url: string, data?: unknown): Promise<HttpResponseData> {
    return Http._make().patch(url, data)
  }

  static delete(url: string): Promise<HttpResponseData> {
    return Http._make().delete(url)
  }

  static head(url: string): Promise<HttpResponseData> {
    return Http._make().head(url)
  }
}

// ─── Helpers ────────────────────────────────────────────────

function _sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ─── Convenience factory ─────────────────────────────────────

/** Create a pre-configured PendingRequest (e.g. with base URL + auth). */
export function http(): PendingRequest {
  return new PendingRequest()
}
