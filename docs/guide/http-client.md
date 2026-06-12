# HTTP Client

`@rudderjs/http` is a fluent HTTP client wrapping native `fetch`. It adds retries, timeouts, connection pools, request/response interceptors, and a fake for testing — without an external dependency. Use it whenever your app calls another service.

## Setup

```bash
pnpm add @rudderjs/http
```

No config needed; the `Http` facade is available as soon as the package is installed. There's no provider to register — `@rudderjs/http` is a self-contained client.

## Basic requests

```ts
import { Http } from '@rudderjs/http'

const res = await Http.get('https://api.example.com/users')
const users = res.json<User[]>()

await Http.post('https://api.example.com/users', { name: 'Alice' })
await Http.put('https://api.example.com/users/1', { name: 'Bob' })
await Http.patch('https://api.example.com/users/1', { active: true })
await Http.delete('https://api.example.com/users/1')
await Http.head('https://api.example.com/health')
```

Each call returns an `HttpResponseData`:

```ts
interface HttpResponseData {
  status:  number
  headers: Record<string, string>
  body:    string
  json<T = unknown>(): T
  ok(): boolean
}
```

```ts
const res = await Http.get('/api/users')
res.status         // 200
res.ok()           // true (2xx)
res.json<User[]>() // parsed JSON
res.body           // raw response body
```

## Fluent configuration

Chain configuration before sending. Each call returns a `PendingRequest`:

```ts
const res = await Http
  .baseUrl('https://api.example.com')
  .withToken('my-api-token')
  .withHeaders({ 'X-Custom': 'value' })
  .withQueryParameters({ page: 1, limit: 20 })
  .timeout(5000)
  .retry(3, 200)
  .get('/users')
```

Reuse a configured builder by capturing it:

```ts
import { http } from '@rudderjs/http'

const api = http()
  .baseUrl('https://api.example.com')
  .withToken('my-api-token')
  .timeout(5000)

const users = await api.get('/users')
const posts = await api.get('/posts')
```

## Authentication

```ts
await Http.withToken('my-token').get('/api/protected')
await Http.withBasicAuth('user', 'pass').get('/api/protected')
```

## Bodies

```ts
await Http.post('/api/users', { name: 'Alice' })             // JSON (default)
await Http.withBody({ email, password }).asForm().post('/login')   // form-encoded
```

Call `asForm()` *after* setting the body, and don't pass the body to `post()` — both `withBody(data)` and `post(url, data)` set the encoding to JSON, so they would otherwise override `asForm()`.

## Retries and timeouts

```ts
await Http.retry(3, 200).get('/api/flaky-endpoint')   // up to 4 attempts (1 + 3 retries), 200/400/600 ms backoff
await Http.timeout(5000).get('/api/slow-endpoint')    // throws after 5s
```

Retries use linearly increasing delay — attempt 1 waits `delay` ms, attempt 2 waits `delay * 2`, and so on. Timeouts abort via `AbortController`.

## Interceptors

```ts
const res = await Http
  .withRequestMiddleware((req) => req.withHeaders({ 'X-Request-Id': crypto.randomUUID() }))
  .withResponseMiddleware((res) => {
    if (res.status === 401) refreshToken()
    return res
  })
  .get('/api/data')
```

Or globally:

```ts
Http.interceptRequest((req) => req.withHeaders({ 'X-Api-Version': '2' }))
Http.interceptResponse((res) => {
  if (res.status === 401) refreshToken()
  return res
})

Http.clearInterceptors()
```

Global interceptors apply to every request through the `Http` facade until cleared.

## Concurrent requests

Run a batch of requests with optional concurrency limit:

```ts
const results = await Http.pool((pool) => {
  pool.add((http) => http.get('https://api.example.com/users'))
  pool.add((http) => http.get('https://api.example.com/posts'))
  pool.add((http) => http.get('https://api.example.com/comments'))
}).concurrency(2).send()

// results[0] — users, results[1] — posts, results[2] — comments (submission order)
```

## Testing

`Http.fake()` returns a `FakeManager` that registers stub responses and records every request:

```ts
import { Http } from '@rudderjs/http'

const fake = Http.fake()

fake.register('example.com/api/users', {
  status: 200,
  body: [{ id: 1, name: 'Alice' }],
  headers: { 'content-type': 'application/json' },
})

const res = await fake.client().get('https://example.com/api/users')
res.json()   // [{ id: 1, name: 'Alice' }]

fake.assertSent((req) => req.method === 'POST' && req.url.includes('/users'))
fake.assertSentCount(3)
fake.preventStrayRequests()   // throw on requests to unstubbed URLs
```

Patterns can be substring strings or `RegExp`. Pass an array as the second argument for a sequence of responses (first request returns the first entry, second returns the second, etc.).

### Sequenced fakes

When a test needs each call to see a different response — retry chains, paginated cursors, back-off paths — use a `Sequence` instead of `register(pattern, [...])`. The key difference: a sequence **throws on exhaustion** so a hidden extra call surfaces immediately, where `register([...])` silently repeats the last response forever.

```ts
const fake = Http.fake()

fake.sequence('example.com')                     // returns a Sequence builder
  .push({ status: 503, body: 'retry me',     headers: {} })
  .push({ status: 200, body: { ok: true },   headers: {} })

const client = fake.client()
await client.get('https://example.com/data')     // → 503
await client.get('https://example.com/data')     // → 200
await client.get('https://example.com/data')     // throws — sequence empty
```

Set a fallback for every call past the queue with `.whenEmpty()`:

```ts
fake.sequence('example.com')
  .push({ status: 503, body: '', headers: {} })
  .whenEmpty({ status: 200, body: { ok: true }, headers: {} })
```

For the common "one fake, one sequence" shape, `Http.fakeSequence()` returns both as a tuple:

```ts
const [fake, seq] = Http.fakeSequence('example.com')
seq.push({ status: 503, body: '', headers: {} })
   .push({ status: 200, body: { ok: true }, headers: {} })

const client = fake.client()
```

`fake.sequence()` (no pattern) is a wildcard sequence — every URL gets the next queued response. Useful when a test only makes one host's calls.

## Pitfalls

- **Forgetting to call `.json()`.** `res.body` is the raw string. `res.json<T>()` parses and types it.
- **Reusing a builder for divergent requests.** `Http.baseUrl(...).withToken(...)` returns a new builder; the original is unchanged. Each builder is cloned per request, so chaining is safe.
- **Long retry chains during outages.** A 3-retry config means at least 4 calls before giving up. For circuit-breaking, wrap the call in your own logic — `@rudderjs/http` doesn't ship a breaker.
- **Mixing `Http.fake()` with global interceptors.** Faking replaces the underlying `fetch`; global interceptors still run against the fake. Clear interceptors in `beforeEach` if your tests register them.
