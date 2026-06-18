# @rudderjs/testing

Integration testing utilities for Rudder applications — `TestCase` base class, fluent `TestResponse` assertions, and reusable traits.

## Installation

```bash
pnpm add -D @rudderjs/testing
```

## Setup

Extend `TestCase` and override `providers()` and `config()` to bootstrap your application for testing.

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

## HTTP Request Helpers

`TestCase` provides helpers that send requests through your application's fetch handler without a running server:

```ts
await t.get('/api/users')
await t.post('/api/users', { name: 'Alice' })
await t.put('/api/users/1', { name: 'Bob' })
await t.patch('/api/users/1', { active: true })
await t.delete('/api/users/1')
```

### Authenticated Requests

```ts
const response = await t
  .actingAs({ id: '1', email: 'admin@example.com' })
  .get('/api/admin/dashboard')

response.assertOk()
```

## TestResponse Assertions

| Method | Description |
|--------|-------------|
| `assertStatus(code)` | Exact status code match |
| `assertOk()` | Status 200 |
| `assertCreated()` | Status 201 |
| `assertNoContent()` | Status 204 |
| `assertNotFound()` | Status 404 |
| `assertForbidden()` | Status 403 |
| `assertUnauthorized()` | Status 401 |
| `assertUnprocessable()` | Status 422 |
| `assertSuccessful()` | Status 2xx |
| `assertServerError()` | Status 5xx |
| `assertJson({ key: value })` | Partial JSON body match |
| `assertJsonPath('data.0.name', 'Alice')` | Dot-path value match |
| `assertJsonCount(3, 'data')` | Array length at path |
| `assertJsonStructure(['id', 'name'])` | Keys present in body |
| `assertJsonMissing({ secret: '...' })` | Keys/values absent |
| `assertHeader('Content-Type', 'json')` | Header present (contains) |
| `assertHeaderMissing('X-Debug')` | Header absent |
| `assertRedirect('/login')` | 3xx with Location header |

## Database Assertions

```ts
await t.assertDatabaseHas('users', { email: 'alice@example.com' })
await t.assertDatabaseMissing('users', { email: 'deleted@example.com' })
await t.assertDatabaseCount('users', 5)
await t.assertDatabaseEmpty('sessions')
```

## Traits

### RefreshDatabase

Truncates all database tables before each test for isolation.

```ts
class MyTest extends TestCase {
  use = [RefreshDatabase]
}
```

### WithFaker

Injects a `@faker-js/faker` instance for generating test data. Requires `@faker-js/faker` as a peer dependency.

```ts
import { WithFaker } from '@rudderjs/testing'

class MyTest extends TestCase {
  use = [WithFaker]
}

const t = await MyTest.create()
const name = t.faker.person.fullName()
const email = t.faker.internet.email()
```

## Notes

- Uses Node.js native `assert/strict` under the hood — no external test framework dependency.
- `TestCase.create()` bootstraps the application in `testing` mode with `debug: true`.
- Database assertions require an ORM adapter registered via providers.
- HTTP helpers require a server adapter that binds a `fetchHandler` in the container.
