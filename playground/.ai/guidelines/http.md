# @rudderjs/http

## Overview

Fluent outgoing HTTP client — retries, timeouts, interceptors, concurrent request pools, and `Http.fake()` for testing. Laravel's `Http` facade for Node. Built on the native `fetch` — no axios/got dep.

## Key Patterns

### Basic requests

```ts
import { Http } from '@rudderjs/http'

const res = await Http.get('https://api.example.com/users')
const users = res.json<User[]>()

await Http.post('/api/users', { name: 'Alice' })
await Http.put('/api/users/1', { name: 'Alice' })
await Http.patch('/api/users/1', { name: 'Alice' })
await Http.delete('/api/users/1')
```

### Response object

```ts
res.status         // 200
res.body           // raw string
res.headers        // Record<string, string>
res.ok()            // true for 2xx
res.json<T>()      // parsed JSON (throws on invalid JSON)
```

### Fluent configuration

Chain before sending:

```ts
await Http
  .baseUrl('https://api.example.com')
  .withToken('secret-token')              // Authorization: Bearer ...
  .withHeaders({ 'X-App': 'myapp' })
  .withQueryParameters({ page: 1, limit: 20 })
  .retry(3, 200)                           // 3 retries, 200ms base backoff
  .timeout(5000)                           // 5s per request
  .get('/users')
```

The fluent chain is **immutable per-call** — each `Http.*` call starts fresh. Use `Http.baseUrl(...)` only in the chain, not as a side-effect setter.

### Retries

```ts
Http.retry(3)            // 3 retries, default 100ms linear backoff
Http.retry(3, 200)       // 3 retries, 200ms linear backoff between attempts
```

Retries fire on network errors and non-2xx responses. The signature is `retry(times, delay = 100)` — there is no per-attempt predicate today; if you need conditional retry logic, branch in a response interceptor and re-issue the call.

### Interceptors

```ts
// Global — applies to every Http.* call
Http.interceptRequest((req) => {
  // req is a PendingRequest; mutate via its fluent setters
  return req.withHeaders({ 'X-Trace': traceId() })
})

Http.interceptResponse((res) => {
  // res is HttpResponseData: { status, headers, body, json(), ok() }
  metrics.timing('http.response.status', res.status)
  return res
})

Http.clearInterceptors()  // remove all global interceptors (typically in afterEach)

// Per-chain — only for this request
await Http
  .withRequestMiddleware((req) => req.withHeaders({ 'X-Once': '1' }))
  .get('/users')
```

### Testing

```ts
import { Http } from '@rudderjs/http'

const fake = Http.fake()
fake.register('api.example.com/users',     { status: 200, body: { users: [] }, headers: {} })
fake.register('api.example.com/users/42',  { status: 204, body: '',           headers: {} })
fake.register(/api\.example\.com\/.*/,     [                                                  // sequence
  { status: 503, body: '', headers: {} },
  { status: 200, body: { ok: true }, headers: {} },
])
fake.preventStrayRequests()  // throw on any unmatched URL

// Use fake.client() — it returns a PendingRequest wired to the fake
const client = fake.client()
const res = await client.get('https://api.example.com/users')

fake.assertSent(req => req.url.includes('/users'))
fake.assertSentCount(1)
fake.assertNotSent(req => req.method === 'DELETE')
fake.assertNothingSent()
```

Matching is by URL pattern (substring or RegExp). When you register an array, responses are returned in order and the last entry repeats. `Http.fake()` returns a fresh `FakeManager` each call — there is no global state to "restore."

## Common Pitfalls

- **`res.json()` on non-JSON responses.** Throws. Guard with `res.ok()` + Content-Type check, or catch explicitly.
- **Timeouts vs retries.** `.timeout(5000).retry(3)` = 5s per attempt × 3 retries + backoff = potentially 20+ seconds of wall time. Budget accordingly for request-path code.
- **Calling `Http.*` after `Http.fake()`.** `Http.fake()` returns a `FakeManager`; it does NOT replace the global `Http`. Use `fake.client()` to get a `PendingRequest` wired to the fake, or call `fake.preventStrayRequests()` to fail loudly when test code accidentally hits the real `Http` facade. Use `Http.clearInterceptors()` (not a non-existent `Http.restore()`) to drop global interceptors between tests.
- **Interceptors mutating in place.** Return the req/res object. Mutating without returning works by reference today but isn't contract — future versions may require returns.
- **`withQueryParameters` vs URL query strings.** Both work; if you mix them, values from `withQueryParameters` take precedence. Pick one style per call to avoid surprises.
- **Retry + idempotency.** Retries apply to POST too. If the server is sensitive (charges a card, sends an email), use an idempotency key or disable retries for that call.
- **Telescope records outgoing HTTP.** `@rudderjs/telescope`'s `http` collector auto-records every `Http.*` call when installed. No config needed on this side.

## Key Imports

```ts
import { Http, PendingRequest, FakeManager, Pool } from '@rudderjs/http'

import type {
  HttpMethod,
  HttpResponseData,
  RequestInterceptor,
  ResponseInterceptor,
} from '@rudderjs/http'
```
