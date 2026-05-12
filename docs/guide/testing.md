# Testing

`@rudderjs/testing` provides a small layer over Node's built-in `node:test` runner: an application test case that boots the framework, fluent HTTP request helpers with response assertions, database assertions, and a set of fakes for queues, mail, notifications, events, and cache.

## Setup

```bash
pnpm add -D @rudderjs/testing
```

Define a base test case for your project once. Other test files extend it:

```ts
// tests/TestCase.ts
import { TestCase } from '@rudderjs/testing'
import providers from '../bootstrap/providers.js'
import configs from '../config/index.js'

export class AppTestCase extends TestCase {
  providers() { return providers }
  config()    { return configs }
}
```

`create()` boots the application with your providers and config; `teardown()` releases resources.

```ts
import { describe, it, before, after } from 'node:test'
import { AppTestCase } from './TestCase.js'

describe('UserController', () => {
  const t = new AppTestCase()
  before(async () => await t.create())
  after (async () => await t.teardown())

  it('lists users', async () => {
    const res = await t.get('/api/users')
    res.assertOk()
  })
})
```

## HTTP requests

The case dispatches requests through the framework without starting a real server:

```ts
const res = await t.get('/api/users')
const res = await t.post('/api/users', { name: 'Suleiman', email: 'su@example.com' })
const res = await t.put('/api/users/1', { name: 'Updated' })
const res = await t.patch('/api/users/1', { name: 'Patched' })
const res = await t.delete('/api/users/1')
```

For authenticated requests:

```ts
const user = await User.query().first()
const res  = await t.actingAs(user).get('/api/profile')
```

## Response assertions

Every request returns a `TestResponse` with a fluent assertion API:

```ts
res.assertOk()              // 200
res.assertCreated()         // 201
res.assertNotFound()        // 404
res.assertForbidden()       // 403
res.assertUnauthorized()    // 401
res.assertUnprocessable()   // 422
res.assertStatus(204)

res.assertJson({ name: 'Suleiman' })                       // subset match
res.assertJsonPath('data.user.email', 'su@example.com')    // dot-path
res.assertJsonCount(3, 'data.users')                       // array length
res.assertJsonStructure(['data', 'meta'])                  // top-level keys present
res.assertJsonMissing({ password: 'secret' })

res.assertHeader('content-type', 'application/json')
res.assertHeaderMissing('x-debug')

res.assertRedirect()                  // any 3xx
res.assertRedirect('/dashboard')      // 3xx with Location
```

## Database assertions

```ts
await t.assertDatabaseHas('users',     { email: 'su@example.com' })
await t.assertDatabaseMissing('users', { email: 'deleted@example.com' })
await t.assertDatabaseCount('users',   3)
await t.assertDatabaseEmpty('users')
```

## Traits

Traits add reusable behavior. Apply them in your `TestCase` subclass.

`RefreshDatabase` truncates every table between tests so each starts empty:

```ts
import { TestCase, RefreshDatabase, WithFaker } from '@rudderjs/testing'

export class AppTestCase extends TestCase {
  traits()    { return [RefreshDatabase, WithFaker] }
  providers() { return providers }
  config()    { return configs }
}
```

`WithFaker` adds `t.faker` for fake data — install `@faker-js/faker` first:

```ts
const res = await t.post('/api/users', {
  name:  t.faker.person.fullName(),
  email: t.faker.internet.email(),
})
```

## Fakes

Every package that produces side effects (queues, mail, notifications, events, cache, storage, HTTP client) ships a `.fake()` that swaps the real driver with an in-memory test double. Always call `.restore()` when done.

```ts
import { Queue } from '@rudderjs/queue'
import { Mail }  from '@rudderjs/mail'

it('queues a welcome job and sends a welcome mail', async () => {
  const queue = Queue.fake()
  const mail  = Mail.fake()

  await t.post('/api/users', { name: 'Suleiman', email: 'su@example.com' })

  queue.assertPushed(SendWelcomeEmail)
  mail .assertSent(WelcomeMail)

  queue.restore()
  mail .restore()
})
```

Each fake exposes the assertions that match its API surface — see the per-feature pages: [Queues](/guide/queues), [Mail](/guide/mail), [Notifications](/guide/notifications), [Events](/guide/events), [Cache](/guide/cache), [File Storage](/guide/storage), [HTTP Client](/guide/http-client).

## Testing AI agents

For agent-level testing, `@rudderjs/ai/eval` ships a dedicated eval framework with built-in metrics (`exactMatch`, `regex`, `llmJudge`, `jsonShape`, `semanticMatch`, `tokenCost`), `compose(...)`, `--record` / `--replay` for fixture-driven runs (zero API calls), HTML report output, and the `pnpm rudder ai:eval` CLI. See [AI / Evals](/guide/ai#evals) for the full surface.

For lower-level mocking (no model calls, no eval runner), `AiFake.fake()` swaps in a deterministic adapter — same `.fake()` / `.restore()` shape as the other facades.

```ts
import { AiFake, AI } from '@rudderjs/ai'

const fake = AiFake.fake()
fake.respondWith('Mocked response')

const response = await AI.prompt('Hello')
assert.strictEqual(response.text, 'Mocked response')
fake.restore()
```

## Full example

```ts
import { describe, it, before, after } from 'node:test'
import { Queue } from '@rudderjs/queue'
import { Mail }  from '@rudderjs/mail'
import { User }  from '../../app/Models/User.js'
import { SendWelcomeEmail } from '../../app/Jobs/SendWelcomeEmail.js'
import { WelcomeMail }       from '../../app/Mail/WelcomeMail.js'
import { AppTestCase }       from '../TestCase.js'

describe('UserController', () => {
  const t = new AppTestCase()
  before(async () => await t.create())
  after (async () => await t.teardown())

  it('creates a user and dispatches side effects', async () => {
    const queue = Queue.fake()
    const mail  = Mail.fake()

    const res = await t.post('/api/users', {
      name: 'Suleiman', email: 'su@example.com', password: 'secret123',
    })

    res.assertCreated()
    res.assertJsonPath('data.email', 'su@example.com')
    await t.assertDatabaseHas('users', { email: 'su@example.com' })

    queue.assertPushed(SendWelcomeEmail)
    mail .assertSent(WelcomeMail)

    queue.restore()
    mail .restore()
  })

  it('requires authentication for profile', async () => {
    const res = await t.get('/api/profile')
    res.assertUnauthorized()
  })
})
```

Run with `npx tsx --test tests/**/*.test.ts`, or add a script:

```json
{ "scripts": { "test": "tsx --test tests/**/*.test.ts" } }
```

## Pitfalls

- **Forgetting `.restore()` on a fake.** The fake stays installed for subsequent tests in the same process, leaking expectations across files. Restore in an `afterEach` for safety.
- **`actingAs(user)` returning a chainable.** Each call returns a new request builder that's authenticated for the next request only. Don't share between tests.
- **Database assertions before `RefreshDatabase`.** Without the trait, rows from previous tests persist. Apply `RefreshDatabase` or use `t.assertDatabaseHas` carefully with seeded fixtures.
