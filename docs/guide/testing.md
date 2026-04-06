# Testing

RudderJS ships a first-party testing package that provides a Laravel-style testing experience on top of Node's built-in `node:test` runner. It includes an application test case, HTTP helpers, database assertions, and fake drivers for queues, mail, notifications, events, and cache.

## Installation

```bash
pnpm add -D @rudderjs/testing
```

`@rudderjs/testing` works with `node:test` out of the box. No additional test runner is required.

---

## TestCase

`TestCase` is the base class for all application tests. It boots your RudderJS application, wires up providers, and exposes HTTP and database helpers.

### Creating a Test Case

Create a base test case for your project that other test files can extend:

```ts
// tests/TestCase.ts
import { TestCase } from '@rudderjs/testing'
import providers from '../bootstrap/providers.js'
import configs from '../config/index.js'

export class AppTestCase extends TestCase {
  providers() {
    return providers
  }

  config() {
    return configs
  }
}
```

### Lifecycle

Call `create()` before your tests and `teardown()` after:

```ts
import { describe, it, before, after } from 'node:test'
import { AppTestCase } from './TestCase.js'

describe('UserController', () => {
  const t = new AppTestCase()

  before(async () => {
    await t.create()
  })

  after(async () => {
    await t.teardown()
  })

  it('lists users', async () => {
    const res = await t.get('/api/users')
    res.assertOk()
  })
})
```

`create()` boots the application with your providers and config. `teardown()` cleans up resources (database connections, queue workers, etc.).

---

## HTTP Request Helpers

`TestCase` exposes methods that send HTTP requests to your application without starting a real server:

```ts
const res = await t.get('/api/users')
const res = await t.post('/api/users', { name: 'Suleiman', email: 'su@example.com' })
const res = await t.put('/api/users/1', { name: 'Updated' })
const res = await t.patch('/api/users/1', { name: 'Patched' })
const res = await t.delete('/api/users/1')
```

All methods return a `TestResponse` with assertion helpers (see below).

### Authenticated Requests

Use `actingAs()` to authenticate as a specific user for subsequent requests:

```ts
import { User } from '../app/Models/User.js'

const user = await User.query().first()

const res = await t.actingAs(user).get('/api/profile')
res.assertOk()
res.assertJsonPath('data.email', user.email)
```

---

## TestResponse Assertions

Every HTTP helper returns a `TestResponse` with fluent assertion methods.

### Status Assertions

```ts
res.assertOk()              // 200
res.assertCreated()         // 201
res.assertNotFound()        // 404
res.assertForbidden()       // 403
res.assertUnauthorized()    // 401
res.assertUnprocessable()   // 422
res.assertStatus(204)       // any status code
```

### JSON Assertions

```ts
// Assert the response contains the given key-value pairs (subset match)
res.assertJson({ name: 'Suleiman' })

// Assert a value at a dot-notation path
res.assertJsonPath('data.user.email', 'su@example.com')

// Assert the array at a path has the expected count
res.assertJsonCount(3, 'data.users')

// Assert the response JSON matches a structure (keys only, values ignored)
res.assertJsonStructure({
  data: {
    id: true,
    name: true,
    email: true,
  },
})

// Assert the response does NOT contain the given key-value pairs
res.assertJsonMissing({ password: 'secret' })
```

### Header Assertions

```ts
res.assertHeader('content-type', 'application/json')
res.assertHeaderMissing('x-debug')
```

### Redirect Assertions

```ts
res.assertRedirect()              // any 3xx status
res.assertRedirect('/dashboard')  // 3xx with specific Location header
```

---

## Database Assertions

`TestCase` provides database assertion methods for verifying records directly:

```ts
// Assert a row exists with the given attributes
await t.assertDatabaseHas('users', { email: 'su@example.com' })

// Assert no row exists with the given attributes
await t.assertDatabaseMissing('users', { email: 'deleted@example.com' })

// Assert the table has exactly n rows
await t.assertDatabaseCount('users', 3)

// Assert the table is empty
await t.assertDatabaseEmpty('users')
```

---

## Traits

Traits add reusable behavior to your test case. Apply them in your `TestCase` subclass.

### RefreshDatabase

Truncates all tables between tests to ensure a clean state:

```ts
import { TestCase, RefreshDatabase } from '@rudderjs/testing'

export class AppTestCase extends TestCase {
  traits() {
    return [RefreshDatabase]
  }

  providers() { return providers }
  config() { return configs }
}
```

Each test starts with an empty database. Tables are truncated (not dropped), so your schema remains intact.

### WithFaker

Adds a `faker` instance to the test case for generating fake data. Requires `@faker-js/faker` as a dev dependency:

```bash
pnpm add -D @faker-js/faker
```

```ts
import { TestCase, WithFaker } from '@rudderjs/testing'

export class AppTestCase extends TestCase {
  traits() {
    return [RefreshDatabase, WithFaker]
  }

  providers() { return providers }
  config() { return configs }
}
```

Then use `t.faker` in your tests:

```ts
it('creates a user', async () => {
  const res = await t.post('/api/users', {
    name: t.faker.person.fullName(),
    email: t.faker.internet.email(),
  })

  res.assertCreated()
})
```

---

## Fake Drivers

RudderJS packages expose `.fake()` methods that swap real drivers with in-memory fakes. Fakes capture all interactions and provide assertion methods. Always call `.restore()` when done to reinstate the original driver.

### Queue.fake()

```ts
import { Queue } from '@rudderjs/queue'
import { SendWelcomeEmail } from '../app/Jobs/SendWelcomeEmail.js'

it('dispatches a welcome email job', async () => {
  const fake = Queue.fake()

  await t.post('/api/users', { name: 'Suleiman', email: 'su@example.com' })

  fake.assertPushed(SendWelcomeEmail)
  fake.assertPushedTimes(SendWelcomeEmail, 1)
  fake.restore()
})
```

### Mail.fake()

```ts
import { Mail } from '@rudderjs/mail'
import { WelcomeMail } from '../app/Mail/WelcomeMail.js'

it('sends a welcome email', async () => {
  const fake = Mail.fake()

  await t.post('/api/users', { name: 'Suleiman', email: 'su@example.com' })

  fake.assertSent(WelcomeMail)
  fake.restore()
})
```

### Notification.fake()

```ts
import { Notification } from '@rudderjs/notification'
import { InvoicePaid } from '../app/Notifications/InvoicePaid.js'

it('notifies the user', async () => {
  const fake = Notification.fake()

  await t.post('/api/invoices/1/pay')

  fake.assertSentTo(user, InvoicePaid)
  fake.restore()
})
```

### Event.fake()

```ts
import { Event } from '@rudderjs/core'

it('dispatches a user.created event', async () => {
  const fake = Event.fake()

  await t.post('/api/users', { name: 'Suleiman', email: 'su@example.com' })

  fake.assertDispatched('user.created')
  fake.restore()
})
```

### Cache.fake()

```ts
import { Cache } from '@rudderjs/cache'

it('caches the response', async () => {
  const fake = Cache.fake()

  await t.get('/api/settings')

  fake.assertSet('app.settings')
  fake.assertGet('app.settings')
  fake.restore()
})
```

---

## Full Example

A complete test file using `node:test` with the test case, fakes, and assertions together:

```ts
// tests/feature/UserController.test.ts
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Queue } from '@rudderjs/queue'
import { Mail } from '@rudderjs/mail'
import { Event } from '@rudderjs/core'
import { User } from '../../app/Models/User.js'
import { SendWelcomeEmail } from '../../app/Jobs/SendWelcomeEmail.js'
import { WelcomeMail } from '../../app/Mail/WelcomeMail.js'
import { AppTestCase } from '../TestCase.js'

describe('UserController', () => {
  const t = new AppTestCase()

  before(async () => {
    await t.create()
  })

  after(async () => {
    await t.teardown()
  })

  it('lists all users', async () => {
    const res = await t.get('/api/users')

    res.assertOk()
    res.assertJsonStructure({
      data: true,
    })
  })

  it('creates a user and dispatches side effects', async () => {
    const queueFake = Queue.fake()
    const mailFake = Mail.fake()
    const eventFake = Event.fake()

    const res = await t.post('/api/users', {
      name: 'Suleiman',
      email: 'su@example.com',
      password: 'secret123',
    })

    res.assertCreated()
    res.assertJsonPath('data.email', 'su@example.com')

    await t.assertDatabaseHas('users', { email: 'su@example.com' })

    queueFake.assertPushed(SendWelcomeEmail)
    mailFake.assertSent(WelcomeMail)
    eventFake.assertDispatched('user.created')

    queueFake.restore()
    mailFake.restore()
    eventFake.restore()
  })

  it('returns 422 for invalid input', async () => {
    const res = await t.post('/api/users', {
      name: '',
      email: 'not-an-email',
    })

    res.assertUnprocessable()
    res.assertJsonPath('errors.email', true)
  })

  it('requires authentication for profile', async () => {
    const res = await t.get('/api/profile')
    res.assertUnauthorized()
  })

  it('returns profile for authenticated user', async () => {
    const user = await User.query().first()

    const res = await t.actingAs(user).get('/api/profile')

    res.assertOk()
    res.assertJson({ data: { id: user.id, email: user.email } })
  })

  it('deletes a user', async () => {
    const user = await User.query().first()

    const res = await t.actingAs(user).delete(`/api/users/${user.id}`)

    res.assertOk()
    await t.assertDatabaseMissing('users', { id: user.id })
  })
})
```

Run your tests with:

```bash
npx tsx --test tests/**/*.test.ts
```

Or add a script to `package.json`:

```json
{
  "scripts": {
    "test": "tsx --test tests/**/*.test.ts"
  }
}
```
