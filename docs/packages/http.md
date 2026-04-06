# @rudderjs/http

Fluent HTTP client wrapping native `fetch`. Retries, timeouts, connection pools, interceptors, and a fake for testing. No external dependencies.

## Installation

```bash
pnpm add @rudderjs/http
```

## Usage

### Basic requests

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

### Fluent configuration

Chain configuration methods before sending. Each method returns a `PendingRequest`:

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

### Authentication

```ts
// Bearer token
await Http.withToken('my-token').get('/api/protected')

// Basic auth
await Http.withBasicAuth('user', 'pass').get('/api/protected')
```

### Request body

```ts
// JSON (default)
await Http.post('/api/users', { name: 'Alice' })

// Form-encoded
await Http.asForm().withBody({ email: 'a@b.com', password: 'secret' }).post('/login')
```

### Retries

Retry on failure with linearly increasing delay:

```ts
// Retry up to 3 times, 200ms between attempts (200, 400, 600ms)
await Http.retry(3, 200).get('/api/flaky-endpoint')
```

### Timeout

Abort the request after a specified duration:

```ts
await Http.timeout(5000).get('/api/slow-endpoint')
// Throws: "[RudderJS/Http] Request timed out after 5000ms"
```

## Http Facade Methods

| Method | Returns | Description |
|---|---|---|
| `Http.get(url, query?)` | `Promise<HttpResponseData>` | Send a GET request |
| `Http.post(url, data?)` | `Promise<HttpResponseData>` | Send a POST request |
| `Http.put(url, data?)` | `Promise<HttpResponseData>` | Send a PUT request |
| `Http.patch(url, data?)` | `Promise<HttpResponseData>` | Send a PATCH request |
| `Http.delete(url)` | `Promise<HttpResponseData>` | Send a DELETE request |
| `Http.head(url)` | `Promise<HttpResponseData>` | Send a HEAD request |
| `Http.baseUrl(url)` | `PendingRequest` | Set base URL for relative paths |
| `Http.withToken(token)` | `PendingRequest` | Set Bearer auth header |
| `Http.withBasicAuth(user, pass)` | `PendingRequest` | Set Basic auth header |
| `Http.withHeaders(headers)` | `PendingRequest` | Merge request headers |
| `Http.withQueryParameters(params)` | `PendingRequest` | Append query string parameters |
| `Http.withBody(data)` | `PendingRequest` | Set JSON request body |
| `Http.asForm()` | `PendingRequest` | Send body as form-encoded |
| `Http.retry(times, delay?)` | `PendingRequest` | Retry on failure (default delay: 100ms) |
| `Http.timeout(ms)` | `PendingRequest` | Abort after `ms` milliseconds |
| `Http.fake()` | `FakeManager` | Create a fake for testing |
| `Http.pool(fn)` | `Pool` | Create a request pool |
| `Http.interceptRequest(fn)` | `void` | Add a global request interceptor |
| `Http.interceptResponse(fn)` | `void` | Add a global response interceptor |
| `Http.clearInterceptors()` | `void` | Remove all global interceptors |

## PendingRequest Methods

| Method | Returns | Description |
|---|---|---|
| `.baseUrl(url)` | `this` | Set base URL |
| `.withHeaders(headers)` | `this` | Merge headers |
| `.withToken(token)` | `this` | Set Bearer token |
| `.withBasicAuth(user, pass)` | `this` | Set Basic auth |
| `.withQueryParameters(params)` | `this` | Append query parameters |
| `.withBody(data)` | `this` | Set JSON body |
| `.asForm()` | `this` | Send body as form-encoded |
| `.retry(times, delay?)` | `this` | Retry on failure |
| `.timeout(ms)` | `this` | Set request timeout |
| `.withRequestMiddleware(fn)` | `this` | Add request interceptor |
| `.withResponseMiddleware(fn)` | `this` | Add response interceptor |
| `.get(url, query?)` | `Promise<HttpResponseData>` | Send GET |
| `.post(url, data?)` | `Promise<HttpResponseData>` | Send POST |
| `.put(url, data?)` | `Promise<HttpResponseData>` | Send PUT |
| `.patch(url, data?)` | `Promise<HttpResponseData>` | Send PATCH |
| `.delete(url)` | `Promise<HttpResponseData>` | Send DELETE |
| `.head(url)` | `Promise<HttpResponseData>` | Send HEAD |

## HttpResponseData

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
res.status          // 200
res.ok()            // true
res.body            // raw response body string
res.json<User[]>()  // parsed JSON
res.headers         // { 'content-type': 'application/json', ... }
```

## Interceptors

### Per-request

```ts
const res = await Http
  .withRequestMiddleware((req) => {
    // Modify PendingRequest before sending
    return req.withHeaders({ 'X-Request-Id': crypto.randomUUID() })
  })
  .withResponseMiddleware((res) => {
    // Inspect or transform the response
    console.log(`Status: ${res.status}`)
    return res
  })
  .get('/api/data')
```

### Global

```ts
Http.interceptRequest((req) => {
  return req.withHeaders({ 'X-Api-Version': '2' })
})

Http.interceptResponse((res) => {
  if (res.status === 401) refreshToken()
  return res
})

Http.clearInterceptors()
```

## Pool

Execute concurrent requests with an optional concurrency limit:

```ts
const results = await Http.pool((pool) => {
  pool.add((http) => http.get('https://api.example.com/users'))
  pool.add((http) => http.get('https://api.example.com/posts'))
  pool.add((http) => http.get('https://api.example.com/comments'))
}).concurrency(2).send()

// results[0] — users response
// results[1] — posts response
// results[2] — comments response
```

### Pool Methods

| Method | Returns | Description |
|---|---|---|
| `.concurrency(n)` | `this` | Max concurrent requests (default: unlimited) |
| `.add(fn)` | `this` | Add a request to the pool |
| `.send()` | `Promise<HttpResponseData[]>` | Execute all requests, returns in submission order |

## Testing with `Http.fake()`

Use `FakeManager` to stub HTTP responses in tests:

```ts
import { Http } from '@rudderjs/http'

const fake = Http.fake()

fake.register('example.com/api/users', {
  status: 200,
  body: [{ id: 1, name: 'Alice' }],
  headers: { 'content-type': 'application/json' },
})

const client = fake.client()
const res = await client.get('https://example.com/api/users')
res.json()  // [{ id: 1, name: 'Alice' }]
```

### Regex patterns

```ts
fake.register(/\/api\/users\/\d+/, {
  status: 200,
  body: { id: 1, name: 'Alice' },
  headers: {},
})
```

### Response sequences

```ts
fake.register('example.com/api/token', [
  { status: 500, body: 'Server Error', headers: {} },
  { status: 200, body: { token: 'abc' }, headers: {} },
])
// First request returns 500, second returns 200, subsequent repeat the last response
```

### Prevent stray requests

```ts
fake.preventStrayRequests()
// Throws if a request is made to a URL with no registered fake
```

### Assertions

```ts
fake.assertSent((req) => req.method === 'POST' && req.url.includes('/users'))
fake.assertNotSent((req) => req.method === 'DELETE')
fake.assertSentCount(3)
fake.assertNothingSent()
fake.recorded()  // all recorded requests
```

### FakeManager Methods

| Method | Returns | Description |
|---|---|---|
| `.register(pattern, response)` | `this` | Register a fake response (string, RegExp, or array for sequences) |
| `.preventStrayRequests()` | `this` | Throw on unregistered URLs |
| `.client()` | `PendingRequest` | Get a request builder wired to this fake |
| `.recorded()` | `RecordedRequest[]` | All requests sent through this fake |
| `.assertSent(fn)` | `void` | Assert a matching request was sent |
| `.assertNotSent(fn)` | `void` | Assert no matching request was sent |
| `.assertSentCount(n)` | `void` | Assert exact request count |
| `.assertNothingSent()` | `void` | Assert zero requests |

## `http()` Factory

Create a pre-configured `PendingRequest` for reuse:

```ts
import { http } from '@rudderjs/http'

const api = http()
  .baseUrl('https://api.example.com')
  .withToken('my-token')
  .timeout(5000)

const users = await api.get('/users')
const posts = await api.get('/posts')
```

## Notes

- Uses native `fetch` under the hood — no external dependencies required.
- `Http.get()` accepts an optional `query` parameter for convenience: `Http.get('/users', { page: 1 })`.
- String patterns in `fake.register()` use substring matching (`url.includes(pattern)`).
- Retry delays increase linearly: attempt 1 waits `delay`, attempt 2 waits `delay * 2`, etc.
- Each `Http.*` verb method creates a fresh `PendingRequest` with global interceptors applied.
- Pool results are returned in submission order, regardless of completion order.
- `PendingRequest` is cloned before each send, so a single builder can be reused for multiple requests.
