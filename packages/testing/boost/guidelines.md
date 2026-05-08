# @rudderjs/testing

## Overview

Integration testing utilities — `TestCase` base class that boots a fresh app per test, fluent `TestResponse` assertions, and reusable traits (`RefreshDatabase`, `WithFaker`, etc.). Works with `node:test` out of the box; tests run in-process through the app's fetch handler — no HTTP server spun up.

## Key Patterns

### Minimal test

```ts
import { describe, it, afterEach } from 'node:test'
import { TestCase, RefreshDatabase } from '@rudderjs/testing'
import { DatabaseProvider } from '@rudderjs/orm'
import { AuthProvider } from '@rudderjs/auth'

class AppTest extends TestCase {
  use = [RefreshDatabase]

  protected providers() {
    return [DatabaseProvider, AuthProvider]
  }

  protected config() {
    return { database: { url: 'file:./test.db' } }
  }
}

describe('Users API', () => {
  let t: AppTest
  afterEach(() => t.teardown())

  it('lists users', async () => {
    t = await AppTest.create()
    const response = await t.get('/api/users')
    response.assertOk()
    response.assertJsonStructure(['data'])
  })
})
```

### HTTP helpers

Requests go through the registered `fetchHandler` — no network, no listener. Every helper returns a `TestResponse`. All five take optional headers as the last arg.

```ts
await t.get('/api/users')
await t.post('/api/users', { name: 'Alice' })
await t.put('/api/users/1', { name: 'Alice' })
await t.patch('/api/users/1', { name: 'Alice' })
await t.delete('/api/users/1')
```

`Content-Type: application/json` is set automatically. Read JSON via `response.json()` (the body is already parsed) — there is no `getJson()` / `postJson()` helper, just call `.assertOk()` after `t.get(...)`.

### TestResponse assertions

```ts
// Status
response.assertStatus(201)
response.assertOk()              // 200
response.assertCreated()         // 201
response.assertNoContent()       // 204
response.assertNotFound()        // 404
response.assertForbidden()       // 403
response.assertUnauthorized()    // 401
response.assertUnprocessable()   // 422
response.assertSuccessful()      // any 2xx
response.assertServerError()     // any 5xx

// Redirects
response.assertRedirect('/dashboard')

// JSON (body is pre-parsed)
response.assertJson({ ok: true })                          // partial match — checks given keys
response.assertJsonPath('data.0.name', 'Alice')
response.assertJsonStructure(['data', 'meta'])             // top-level keys present
response.assertJsonCount(3, 'data.users')                  // array length at path
response.assertJsonMissing({ password: 'secret' })

// Headers
response.assertHeader('Content-Type', 'application/json')  // value substring match
response.assertHeaderMissing('X-Internal-Secret')

// Raw access
response.text()                  // raw response text
response.json()                  // pre-parsed body (same as response.body)
```

There is no `assertSee` / `assertSeeText` / `assertJsonValidationErrors` today — for HTML body checks use `response.text().includes(...)`; for validation errors, `assertJsonPath('errors.email', ...)`.

### Database assertions

```ts
await t.assertDatabaseHas('users',     { email: 'alice@example.com' })
await t.assertDatabaseMissing('users', { email: 'gone@example.com' })
await t.assertDatabaseCount('users', 3)
await t.assertDatabaseEmpty('audit_log')
```

### Traits

```ts
class AppTest extends TestCase {
  use = [RefreshDatabase, WithFaker]
}

// RefreshDatabase — truncates all tables between tests (requires Prisma/Drizzle)
// WithFaker — exposes this.faker for generating test data
```

### Authenticated requests

```ts
const user = await UserFactory.new().create()

await t.actingAs(user).get('/dashboard')
await t.actingAs(user).get('/api/me')
```

`actingAs(user)` takes a single user arg — there is no guard parameter today. The user object is JSON-serialized into an `x-testing-user` header that the auth provider reads. If you need guard-specific testing, either ensure the guard reads the same header, or stub the guard via DI in your `TestCase` subclass.

### Faking framework services

```ts
import { Mail } from '@rudderjs/mail'
import { Queue } from '@rudderjs/queue'
import { NotificationFake } from '@rudderjs/notification'
import { EventFake } from '@rudderjs/core'

const mailFake = Mail.fake()                  // record Mail.to(...).send() calls
const queueFake = Queue.fake()                // record job dispatches
const notificationFake = NotificationFake.fake() // record notify() calls
const eventFake = EventFake.fake()            // record dispatch() calls
```

Each fake exposes matching assertions on the returned instance: `assertSent`, `assertDispatched`, `assertNotified`, etc. Import the fake from its owning package — `@rudderjs/testing` does not re-export them.

### Running tests

```bash
# Node's built-in test runner (preferred for framework-internal code)
pnpm test

# Per-package
cd packages/core && pnpm test
```

The framework packages use `tsx --test`. Your app can use whatever — node:test, vitest, jest. `TestCase` is agnostic about the runner.

## Common Pitfalls

- **Forgetting `t.teardown()` between tests.** `TestCase.create()` boots a fresh app; `teardown()` disposes it. Without teardown, DI singletons, scheduled tasks, or WS connections leak across tests. Always call in `afterEach`.
- **Shared DB without `RefreshDatabase`.** Tests pollute each other. Always include the trait when running against a persistent driver — or point `database.url` at a memory-only SQLite.
- **Parallel tests writing the same SQLite file.** Node's `node:test --test-concurrency=N` runs files in parallel. Either serialize (`--test-concurrency=1`) or give each test a unique DB path.
- **Not restoring fakes.** `Mail.fake()` patches globally. Without `fake.restore()` in `afterEach`, subsequent tests still see the stub (or the wrong stub). Restore after each test — same applies to `Queue.fake()`, `NotificationFake.fake()`, `EventFake.fake()`.
- **`actingAs` and guards.** `actingAs(user)` injects the user into an `x-testing-user` header — guards have to read it for the test login to take effect. If your custom guard or a non-default guard ignores that header, it won't see the user; either wire the header into your guard, or stub the guard via DI in `providers()` for that TestCase.
- **Long-running tests spinning up providers.** Each `TestCase.create()` runs `register()` + `boot()` for every provider. For speed, provide only the minimal providers your test needs — not the full app's provider list.
- **Testing WebSocket flows.** Tests run through `app.fetch`, which handles HTTP only. For WS coverage, mock `broadcast()` via the observer registry rather than spinning up a real socket.

## Key Imports

```ts
import {
  TestCase,
  TestResponse,
  RefreshDatabase,
  WithFaker,
  withTestConfig,
} from '@rudderjs/testing'

import type { TestTrait, TestTraitClass } from '@rudderjs/testing'

// Fakes live in their owning packages
import { Mail, FakeMailAdapter } from '@rudderjs/mail'
import { Queue, FakeQueueAdapter } from '@rudderjs/queue'
import { NotificationFake } from '@rudderjs/notification'
import { EventFake } from '@rudderjs/core'
```
