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

Requests go through `app.fetch` — no network, no listener:

```ts
await t.get('/api/users')
await t.post('/api/users', { name: 'Alice' })
await t.put('/api/users/1', { name: 'Alice' })
await t.patch('/api/users/1', { name: 'Alice' })
await t.delete('/api/users/1')

await t.getJson('/api/users')                    // asserts 200 + parses JSON
await t.postJson('/api/users', { name: 'Alice' }) // same for POST
```

### TestResponse assertions

```ts
response.assertStatus(201)
response.assertOk()              // 2xx
response.assertRedirect('/dashboard')
response.assertJson({ ok: true })
response.assertJsonPath('data.0.name', 'Alice')
response.assertJsonStructure(['data', 'meta.total'])
response.assertJsonValidationErrors(['email', 'password'])
response.assertHeader('Content-Type', 'application/json')
response.assertSee('Hello, Alice')           // HTML body contains
response.assertSeeText('Hello')
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
await t.actingAs(user, 'api').get('/api/me')  // specific guard
```

`actingAs` sets up the auth context without going through the login flow.

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
- **`actingAs` with mismatched guard.** If your config's default guard is `'web'` and the route uses `'api'`, `t.actingAs(user)` sets up `web` auth — the api guard won't see it. Pass the guard name: `t.actingAs(user, 'api')`.
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
