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
Http.retry(3, 200)                          // simple: 3 retries, 200ms backoff
Http.retry(3, 200, (attempt, error) => {    // conditional: decide per attempt
  if (error.status === 429) return true     // retry on rate-limit
  return attempt < 3 && error.status >= 500 // retry 5xx up to 3 times
})
```

Retries fire on network errors and on 5xx responses by default. Use the callback form to customize.

### Interceptors

```ts
Http.beforeSending((req) => {
  req.headers['X-Trace'] = traceId()
  return req
})

Http.onResponse((res) => {
  metrics.timing('http.response', res.duration)
  return res
})
```

Global interceptors apply to every `Http.*` call. Per-chain interceptors (via `.beforeSending()` on a chain) scope to that request.

### Testing

```ts
import { Http } from '@rudderjs/http'

Http.fake({
  'api.example.com/users': { status: 200, body: { users: [] } },
  'api.example.com/users/42': (req) => ({ status: req.method === 'DELETE' ? 204 : 200 }),
})

await Http.get('https://api.example.com/users')   // returns the fake

Http.assertSent(req => req.url.includes('/users'))
Http.assertSentCount(1)
Http.restore()
```

No real network calls under `Http.fake()`. Matching is by URL pattern (substring or RegExp).

## Common Pitfalls

- **`res.json()` on non-JSON responses.** Throws. Guard with `res.ok()` + Content-Type check, or catch explicitly.
- **Timeouts vs retries.** `.timeout(5000).retry(3)` = 5s per attempt × 3 retries + backoff = potentially 20+ seconds of wall time. Budget accordingly for request-path code.
- **Forgetting to `Http.restore()` in tests.** Fake state persists globally — subsequent tests hit the stubs instead of the real network (or other stubs). Always restore in `afterEach`.
- **Interceptors mutating in place.** Return the req/res object. Mutating without returning works by reference today but isn't contract — future versions may require returns.
- **`withQueryParameters` vs URL query strings.** Both work; if you mix them, values from `withQueryParameters` take precedence. Pick one style per call to avoid surprises.
- **Retry + idempotency.** Retries apply to POST too. If the server is sensitive (charges a card, sends an email), use an idempotency key or disable retries for that call.
- **Telescope records outgoing HTTP.** `@rudderjs/telescope`'s `http` collector auto-records every `Http.*` call when installed. No config needed on this side.

## Key Imports

```ts
import { Http } from '@rudderjs/http'

import type { HttpRequest, HttpResponse, HttpConfig } from '@rudderjs/http'
```
