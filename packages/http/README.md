# @rudderjs/http

Fluent HTTP client for Rudder — retries, timeouts, request/response interceptors, concurrent pools, and `Http.fake()` for testing.

## Installation

```bash
pnpm add @rudderjs/http
```

---

## Basic requests

```ts
import { Http } from '@rudderjs/http'

// Simple GET
const res = await Http.get('https://api.example.com/users')
const users = res.json<User[]>()

// POST with JSON body
const res = await Http.post('https://api.example.com/users', { name: 'Alice' })

// PUT, PATCH, DELETE
await Http.put('/api/users/1', { name: 'Alice' })
await Http.patch('/api/users/1', { name: 'Alice' })
await Http.delete('/api/users/1')
await Http.head('/api/health')
```

---

## Response

```ts
res.status        // → 200
res.body          // → raw response string
res.headers       // → Record<string, string>
res.ok()          // → true if 2xx
res.json<T>()     // → parsed JSON (throws on invalid JSON)
```

---

## Fluent configuration

Methods can be chained before sending:

```ts
await Http
  .baseUrl('https://api.example.com')
  .withToken('secret-token')
  .withHeaders({ 'X-App': 'myapp' })
  .withQueryParameters({ page: 1, limit: 20 })
  .retry(3, 200)
  .timeout(5000)
  .get('/users')
```

### Authentication

```ts
Http.withToken('bearer-token').get('/api/me')
Http.withBasicAuth('user', 'pass').get('/api/data')
```

### Request body

```ts
// JSON (default when using .withBody() or verb shorthand with data)
Http.post('/api/users', { name: 'Alice' })

// Form-encoded
Http.asForm().withBody({ email: 'a@b.com', password: 'secret' }).post('/auth/login')
```

### Query parameters

```ts
Http.withQueryParameters({ q: 'hello', page: 2 }).get('/search')
// → GET /search?q=hello&page=2
```

---

## Retries

```ts
// Retry up to 3 times with 200ms delay between attempts (grows linearly)
await Http.retry(3, 200).get('/api/data')
```

---

## Timeout

```ts
// Abort after 5 seconds
await Http.timeout(5000).get('/api/slow')
// Throws: [Rudder/Http] Request timed out after 5000ms
```

---

## Concurrent pools

Run multiple requests in parallel with an optional concurrency limit:

```ts
import { Http } from '@rudderjs/http'

const results = await Http.pool(pool => {
  pool.add(http => http.get('/api/users'))
  pool.add(http => http.get('/api/posts'))
  pool.add(http => http.post('/api/events', { type: 'view' }))
})
  .concurrency(2)
  .send()

const [users, posts, _event] = results
```

Results are returned in submission order.

---

## Interceptors

Intercept and transform requests or responses globally:

```ts
// Global request interceptor (e.g. add auth header to all requests)
Http.interceptRequest(req => {
  return req.withHeaders({ 'X-Request-Id': crypto.randomUUID() })
})

// Global response interceptor (e.g. log all responses)
Http.interceptResponse(res => {
  console.log(`[http] ${res.status}`)
  return res
})

// Clear all interceptors
Http.clearInterceptors()
```

Per-request interceptors:

```ts
Http
  .withRequestMiddleware(req => req.withHeaders({ 'X-Custom': 'value' }))
  .withResponseMiddleware(async res => {
    if (!res.ok()) throw new Error(`HTTP ${res.status}`)
    return res
  })
  .get('/api/data')
```

---

## Testing with `Http.fake()`

```ts
import { Http } from '@rudderjs/http'

// Create a fake
const fake = Http.fake()

// Register responses
fake.register('api.example.com/users', {
  status:  200,
  body:    [{ id: 1, name: 'Alice' }],
  headers: {},
})

// Sequence — responses cycle through in order, last one repeats
fake.register('api.example.com/flaky', [
  { status: 503, body: '', headers: {} },
  { status: 200, body: { ok: true }, headers: {} },
])

// Prevent unmocked requests from hitting the network
fake.preventStrayRequests()

// Use the faked client in tests
const client = fake.client()
const res = await client.get('https://api.example.com/users')
res.json() // → [{ id: 1, name: 'Alice' }]

// Assertions
fake.assertSent(req => req.url.includes('/users'))
fake.assertNotSent(req => req.method === 'DELETE')
fake.assertSentCount(1)
fake.assertNothingSent()  // would fail — 1 request was sent

// Inspect all recorded requests
fake.recorded()  // → RecordedRequest[]
```

URL patterns can be strings (substring match) or regular expressions:

```ts
fake.register(/\/users\/\d+/, { status: 200, body: { id: 1 }, headers: {} })
```

---

## `http()` factory

For creating pre-configured client instances (e.g. per-service API clients):

```ts
import { http } from '@rudderjs/http'

const githubClient = http()
  .baseUrl('https://api.github.com')
  .withToken(process.env['GITHUB_TOKEN']!)
  .withHeaders({ Accept: 'application/vnd.github.v3+json' })

const res = await githubClient.get('/repos/rudderjs/rudder')
```

---

## API Reference

### `Http` (static facade)

| Method | Description |
|--------|-------------|
| `Http.get(url, query?)` | GET request |
| `Http.post(url, data?)` | POST request |
| `Http.put(url, data?)` | PUT request |
| `Http.patch(url, data?)` | PATCH request |
| `Http.delete(url)` | DELETE request |
| `Http.head(url)` | HEAD request |
| `Http.baseUrl(url)` | Set base URL |
| `Http.withHeaders(h)` | Set headers |
| `Http.withToken(token)` | Bearer auth |
| `Http.withBasicAuth(u, p)` | Basic auth |
| `Http.withBody(data)` | Set JSON body |
| `Http.asForm()` | Form-encoded body |
| `Http.withQueryParameters(q)` | Append query params |
| `Http.retry(times, delay?)` | Configure retries |
| `Http.timeout(ms)` | Configure timeout |
| `Http.interceptRequest(fn)` | Add global request interceptor |
| `Http.interceptResponse(fn)` | Add global response interceptor |
| `Http.clearInterceptors()` | Remove all global interceptors |
| `Http.pool(configure)` | Create a concurrent request pool |
| `Http.fake()` | Create a `FakeManager` for testing |

### `FakeManager`

| Method | Description |
|--------|-------------|
| `.register(pattern, response\|responses[])` | Register fake response(s) |
| `.preventStrayRequests()` | Throw on unregistered URLs |
| `.client()` | Get a `PendingRequest` wired to this fake |
| `.recorded()` | All recorded requests |
| `.assertSent(fn)` | Assert a matching request was sent |
| `.assertNotSent(fn)` | Assert no matching request was sent |
| `.assertSentCount(n)` | Assert exactly `n` requests were sent |
| `.assertNothingSent()` | Assert no requests were sent |
