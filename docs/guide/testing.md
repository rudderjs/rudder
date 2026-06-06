# Testing

`@rudderjs/testing` provides a small layer over Node's built-in `node:test` runner: an application test case that boots the framework, fluent HTTP request helpers with response assertions, database assertions, model factories, and a set of fakes for queues, mail, notifications, events, cache, file storage, the HTTP client, and AI.

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

`AppTestCase.create()` is a static factory that boots the application with your providers and config and returns the bootstrapped instance; `teardown()` releases resources.

```ts
import { describe, it, before, after } from 'node:test'
import { AppTestCase } from './TestCase.js'

describe('UserController', () => {
  let t: AppTestCase
  before(async () => { t = await AppTestCase.create() })
  after (async () => { await t.teardown() })

  it('lists users', async () => {
    const res = await t.get('/api/users')
    res.assertOk()
  })
})
```

### Scaffolding tests with `make:test`

`rudder make:test <Name>` writes the test file for you so you don't have to remember the boilerplate:

```bash
pnpm rudder make:test User             # tests/User.test.ts — feature test (boots the app)
pnpm rudder make:test Math --unit      # tests/Math.test.ts — bare node:test, no app boot
```

The filename uses the `.test.ts` suffix to match the documented `tsx --test tests/**/*.test.ts` glob. The default feature stub assumes `tests/TestCase.ts` exists (the snippet above); when it doesn't, the command prints a hint pointing back here.

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

`actingAs(user)` serializes the user into an `x-testing-user` header. In test mode (`APP_ENV=testing`), `AuthMiddleware` honors it and populates `req.user`, `auth().user()`, `Auth.guard().check()`, and `RequireAuth` — all four resolve to the synthetic user, even one that doesn't exist in the database. Call `actingAsGuest()` to clear and run subsequent requests unauthenticated.

```ts
t.actingAs(user)
t.assertAuthenticated()                 // passes after actingAs
t.assertAuthenticatedAs({ id: 42 })     // matched by string-coerced id
t.actingAsGuest()
t.assertGuest()                         // passes after actingAsGuest / teardown
```

The auth assertions check the test-side intent set via `actingAs` — they don't verify that a specific request (e.g. a login form) authenticated end-to-end. For that, assert against the response of a follow-up request to a route that requires auth.

### Time travel

For testing time-sensitive code (expirations, scheduled jobs, rate-limit windows) the case ships a Laravel-style time-travel API built on Node's `mock.timers`:

```ts
t.travel(5).seconds()                          // advance the clock 5 seconds
t.travel(2).hours()                            // … or 2 hours
t.travel(7).days()                             // … or 7 days
                                               // also: milliseconds / minutes / weeks / years

t.travelTo(new Date('2030-01-01T00:00:00Z'))   // set the clock to an absolute moment

t.travelBack()                                 // restore real time (also auto on teardown)

await t.freezeTime(async () => {               // pin Date.now() inside the callback
  // ... code that depends on a stable "now"
})
```

The mock starts at the real wall-clock time so `Date.now()` stays continuous when you enter and exit time travel. `setImmediate` stays unmocked, so async yields still work between travels.

### Request setup

Use the fluent `with*` chain to attach headers or cookies to every subsequent request until `teardown()` (or an explicit `flush*` call):

```ts
t.withHeader('x-trace', 'abc')
 .withHeaders({ 'accept-language': 'en', 'x-feature-flag': 'beta' })
 .withCookies({ session: 'abc123', csrf: 'def456' })

await t.get('/api/users')      // sends all of the above
await t.get('/api/users/1')    // same — they persist
```

The per-request `headers` argument (e.g. `t.get('/api/users', { 'x-app': 'local' })`) wins over the accumulated set, so individual tests can override without disturbing the test-wide defaults. Call `flushHeaders()` / `flushCookies()` to clear mid-test.

## Response assertions

Every request returns a `TestResponse` with a fluent assertion API. Every `assert*` method returns the response, so chains compose without re-binding:

```ts
res.assertOk()              // 200
res.assertCreated()         // 201
res.assertAccepted()        // 202
res.assertNoContent()       // 204
res.assertBadRequest()      // 400
res.assertUnauthorized()    // 401
res.assertForbidden()       // 403
res.assertNotFound()        // 404
res.assertConflict()        // 409
res.assertGone()            // 410
res.assertUnprocessable()   // 422
res.assertTooManyRequests() // 429
res.assertSuccessful()      // any 2xx
res.assertServerError()     // any 5xx
res.assertStatus(204)

res.assertJson({ name: 'Suleiman' })                       // subset match
res.assertJsonPath('data.user.email', 'su@example.com')    // dot-path
res.assertJsonCount(3, 'data.users')                       // array length
res.assertJsonStructure(['data', 'meta'])                  // top-level keys present
res.assertJsonMissing({ password: 'secret' })
res.assertJsonFragment({ id: 2, tag: 'admin' })            // somewhere in the tree
res.assertExactJson({ name: 'Suleiman', email: 'su@example.com' })   // exact match
res.assertJsonMissingExact({ name: 'Bob' })

res.assertContent('OK')                                    // raw body equals
res.assertSee('Welcome, Suleiman')                         // body contains (raw HTML)
res.assertDontSee('admin-only')
res.assertSeeText('Welcome Suleiman')                      // strips HTML first
res.assertDontSeeText('error')
res.assertSeeInOrder(['Step 1', 'Step 2', 'Step 3'])       // ordered substrings

res.assertHeader('content-type', 'application/json')
res.assertHeaderMissing('x-debug')

res.assertCookie('session')                                // Set-Cookie present
res.assertCookie('session', 'abc')                         // value substring
res.assertCookieMissing('csrf')

res.assertRedirect()                  // any 3xx
res.assertRedirect('/dashboard')      // 3xx with Location
```

### Fluent JSON assertions (`AssertableJson`)

For larger response bodies, `assertJson` also accepts a callback exposing the Laravel-parity `AssertableJson` DSL. It's **strict-by-default** — any key you don't touch with `has` / `where` / `missing` fails the assertion (a regression-catcher for accidental field leaks). Opt out per-scope with `etc()`:

```ts
res.assertJson(json =>
  json
    .has('user')
    .where('user.name', 'Suleiman')
    .whereType('user.email', 'string')
    .has('items', 3, item =>
      item.where('id', 1).where('name', 'first').etc()
    )
    .missing('user.password')
    .etc()                       // ignore any extra top-level keys
)
```

| Method | Purpose |
|---|---|
| `has(key)` | Key exists. |
| `has(key, n)` | Key is an array of length `n`. |
| `has(key, fn)` | Open a scoped check on the value. |
| `has(key, n, fn)` | Array of length `n`; `fn` runs on the FIRST item. |
| `missing(key)` / `missingAll(keys)` | Assert absent. |
| `where(key, value)` / `whereNot(key, value)` | Deep-equal check. |
| `whereType(key, type)` | `'string'`, `'number'`, `'boolean'`, `'array'`, `'object'`, `'null'`, `'undefined'`. |
| `whereContains(key, value)` | Array contains value OR string contains substring. |
| `count(key, n)` | Array length without opening a scope. |
| `first(fn)` / `each(fn)` | Iterate when the current scope IS an array. |
| `etc()` | Opt this scope out of the strict-key check. |

Paths use dot-notation (`user.profile.name`, `items.0.id`).

Chained form:

```ts
res
  .assertCreated()
  .assertJsonPath('data.email', 'su@example.com')
  .assertHeader('content-type', 'application/json')
```

### Session assertions

For routes on the `web` group, the test response carries the resolved session payload — `assertSessionHas`, `assertSessionMissing`, and `assertSessionHasErrors` assert on it the same way Laravel does. The payload comes from the `@rudderjs/server-hono` test-mode side channel; it's automatic on `web` routes (session middleware is auto-installed on the group) and unavailable on stateless `api` routes.

```ts
res.assertSessionHas('user_id')            // key present in session data
res.assertSessionHas('user_id', 42)        // and deep-equals 42
res.assertSessionMissing('cart')           // key NOT present

// validation errors flashed via withErrors() on redirect
res.assertSessionHasErrors(['email', 'password'])
```

### View assertions

When a controller returns `view('id', props)` (from `@rudderjs/view`), `assertViewIs` / `assertViewHas` assert on the rendered view id and the props that the view component received:

```ts
res.assertViewIs('dashboard')                                  // matches the id
res.assertViewHas('user')                                      // prop present
res.assertViewHas('user', { id: 1, name: 'Suleiman' })         // prop deep-equals
```

If the route returned JSON or a raw `Response`, view assertions surface a clear error pointing that out.

### Validation assertions

`assertValid` / `assertInvalid` cover both the JSON path (form requests returning `{ errors: { ... } }` with status 422) and the web/redirect path (validation errors flashed to the session). `assertJsonValidationErrors` is the JSON-only variant when you want to be explicit:

```ts
res.assertValid()                                  // no JSON errors, no flash errors
res.assertInvalid()                                // any errors present
res.assertInvalid(['email', 'password'])           // each listed key present
res.assertJsonValidationErrors(['email'])          // strictly the JSON body's errors map
```

Status code is not implied — pair with `assertOk()` / `assertUnprocessable()` / `assertRedirect()` for the full check.

## Database assertions

```ts
await t.assertDatabaseHas('users',     { email: 'su@example.com' })
await t.assertDatabaseMissing('users', { email: 'deleted@example.com' })
await t.assertDatabaseCount('users',   3)
await t.assertDatabaseEmpty('users')
```

These resolve through the ORM service (`app.make('orm')`), so an ORM adapter (`@rudderjs/orm-prisma` or `@rudderjs/orm-drizzle`) must be registered via the provider list returned from `providers()`. The first argument is the database table name as the adapter sees it — for Prisma, that is the delegate name (e.g. `oAuthClient`), not the SQL table (`oauth_clients`).

### Model-instance assertions

When you already have a Model instance, the model-aware helpers read `static table` / `static primaryKey` directly — no string table lookup required:

```ts
await t.assertModelExists(user)        // row with user.id exists (any state)
await t.assertModelMissing(user)       // no row with user.id

await t.assertSoftDeleted(user)        // row exists AND deletedAt is set
await t.assertNotSoftDeleted(user)     // row exists AND deletedAt is null
```

The soft-delete assertions require `static softDeletes = true` on the model (and a `deletedAt` column). They query the raw table — soft-deleted rows are visible even though the model's default scope would normally hide them.

## Traits

Traits add reusable behavior. Set the `use` field on your `TestCase` subclass to the list of trait classes you want applied — each runs `setUp` after the application boots and `tearDown` in reverse order.

`RefreshDatabase` truncates every table between tests so each starts empty:

```ts
import { TestCase, RefreshDatabase, WithFaker } from '@rudderjs/testing'

export class AppTestCase extends TestCase {
  use = [RefreshDatabase, WithFaker]
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

## Factories

`@rudderjs/orm` ships a Laravel-style model factory for generating test data. Subclass `ModelFactory` once per model and use the chainable verbs (`.state()`, `.with()`, `.make()`, `.create()`) wherever you need fixtures.

```ts
// app/Factories/UserFactory.ts
import { ModelFactory, sequence } from '@rudderjs/orm'
import { User } from '../Models/User.js'

export class UserFactory extends ModelFactory<{ name: string; email: string; role: string }> {
  protected modelClass = User

  definition() {
    return {
      name:  'Alice',
      email: sequence(i => `alice${i}@example.com`)(),
      role:  'user',
    }
  }

  protected states() {
    return {
      admin:     ()      => ({ role: 'admin' }),
      withEmail: (email) => ({ email }),
    }
  }
}
```

Use it inside a test:

```ts
// One persisted user
const user  = await UserFactory.new().create()

// One transient (not persisted) — for unit tests that don't touch the DB
const draft = await UserFactory.new().make()

// Three persisted users
const users = await UserFactory.new().create(3)

// Apply a named state
const admin = await UserFactory.new().state('admin').create()

// Override attributes inline via .with()
const named = await UserFactory.new().with(() => ({ name: 'Bob' })).create()
```

`sequence(values)` cycles through a list or takes a function of the row index — useful when a column has a `UNIQUE` constraint:

```ts
definition() {
  return {
    email: sequence(i => `user${i}@example.com`)(),
    role:  sequence(['user', 'admin', 'editor']),
  }
}
```

Generate a factory file with `pnpm rudder make:factory User`.

### `Model.factory()` entry point

Link the factory to its model with `static factoryClass` and call `Model.factory()` — the Laravel-style entry point, equivalent to `UserFactory.new()` and chaining the same verbs:

```ts
import { Model } from '@rudderjs/orm'
import { UserFactory } from '../Factories/UserFactory.js'

class User extends Model {
  static factoryClass = UserFactory
}

await User.factory().create()
await User.factory().state('admin').create()
await User.factory().make(5)
```

Left unset, `User.factory()` throws a clear error telling you to add `static factoryClass`.

### Building relationships

Factories can persist related rows in one call. The foreign keys are resolved from the model's `static relations` (or inferred when a single relation of the right kind points at the other model).

```ts
// hasMany / hasOne — create children with the parent FK set
await User.factory().has(Post.factory(), 3).create()          // user + 3 posts (userId set)
await User.factory().has(Phone.factory(), 1, 'phone').create() // explicit relation name

// belongsTo — create the parent first, then set this row's FK
await Post.factory().for(User.factory()).create()             // post.userId → new user

// belongsToMany — create related rows and attach through the pivot
await User.factory().hasAttached(Role.factory(), 2, { active: true }).create()
```

Relationship builders run at `create()` time only (they persist). Polymorphic relations (`morph*`) are not yet supported — set the morph columns via `.with()` instead.

### Mass assignment

Factory `create()` bypasses mass-assignment (`fillable` / `guarded`) — matching Laravel — so a guarded model still receives every factory attribute. Observer events (`creating` / `created` / `saving` / `saved`) still fire. `make()` builds attributes without persisting and is unaffected.

## Fakes

Every package that produces side effects (queues, mail, notifications, events, cache, storage, HTTP client, AI) ships a `.fake()` that swaps the real driver with an in-memory test double. Always call `.restore()` when done.

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

`Storage.fake()` follows a slightly different shape because file storage is per-disk. Pass a disk name to swap a specific one, and call the class-level `Storage.restoreFakes()` to reverse every swap:

```ts
import { Storage } from '@rudderjs/storage'

const disk = Storage.fake()              // swap the default disk
const s3   = Storage.fake('s3')          // swap a named disk

// ...run the code under test...

disk.assertExists('avatars/user-1.jpg')
s3  .assertCount('uploads/', 3)

Storage.restoreFakes()                   // afterEach — reverse every swap
```

## Testing AI agents

For agent-level testing, `@rudderjs/ai/eval` ships a dedicated eval framework with built-in metrics (`exactMatch`, `regex`, `llmJudge`, `jsonShape`, `semanticMatch`, `tokenCost`), `compose(...)`, `--record` / `--replay` for fixture-driven runs (zero API calls), HTML report output, and the `pnpm rudder ai:eval` CLI. See [AI / Evals](/guide/ai#evals-against-real-models) for the full surface.

For lower-level mocking (no model calls, no eval runner), `AiFake.fake()` swaps in a deterministic adapter — same `.fake()` / `.restore()` shape as the other facades.

```ts
import { AiFake, AI } from '@rudderjs/ai'

const fake = AiFake.fake()
fake.respondWith('Mocked response')

const response = await AI.prompt('Hello')
assert.strictEqual(response.text, 'Mocked response')

fake.assertPrompted(input => input.includes('Hello'))
fake.restore()
```

For multi-step agent runs (tool-call loops, retries), script the provider response sequence so step `N` returns `steps[N]`:

```ts
const fake = AiFake.fake()
fake.respondWithSequence([
  { toolCalls: [{ id: 't1', name: 'lookup', arguments: { q: 'rudderjs' } }] },
  { text: 'Found it.' },
])
```

`AiFake` also covers image / TTS / STT / embedding / rerank / file-upload paths:

```ts
fake.respondWithImage('iVBORw0KGgo…')         // base64
fake.respondWithAudio(Buffer.from('…'))       // TTS bytes
fake.respondWithTranscription('hello world')  // STT text
fake.respondWithEmbedding([[0.1, 0.2, 0.3]])
fake.respondWithRanking([{ index: 0, score: 0.99 }])

fake.assertImageGenerated()
fake.assertAudioGenerated()
fake.assertTranscribed()
```

To force a failure mid-sequence (test `onError` middleware, retry policies) use `failOnStep`:

```ts
fake.failOnStep(0, new Error('Rate limited'))   // first provider call throws
```

For strict tests that must script every prompt, opt into stray-prompt rejection:

```ts
const fake = AiFake.fake().preventStrayPrompts()
fake.respondWithSequence([{ text: 'expected reply' }])
// any unscripted prompt now throws instead of falling back to the ambient default
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
  let t: AppTestCase
  before(async () => { t = await AppTestCase.create() })
  after (async () => { await t.teardown() })

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

### Running the tests

The simplest path is the bundled wrapper:

```bash
pnpm rudder test                           # run every test under tests/
pnpm rudder test User                      # filter by name pattern (matches describe/it labels)
pnpm rudder test tests/UserController.test.ts   # run one specific file
pnpm rudder test --watch                   # re-run on changes
pnpm rudder test --coverage                # collect coverage via Node's --experimental-test-coverage
pnpm rudder test --bail                    # stop on first failure
pnpm rudder test --reporter=spec           # spec / dot / tap / junit
```

Under the hood it spawns `tsx --test` against your `tests/` directory. If you prefer to invoke it directly:

```bash
npx tsx --test tests/**/*.test.ts
```

Or add a script:

```json
{ "scripts": { "test": "tsx --test tests/**/*.test.ts" } }
```

## Pitfalls

- **Forgetting `.restore()` on a fake.** The fake stays installed for subsequent tests in the same process, leaking expectations across files. Restore in an `afterEach` for safety.
- **`actingAs(user)` sticks until teardown.** It sets the authenticated user on the test case itself, so every subsequent request in the same test uses it. `teardown()` clears it; call `actingAs(otherUser)` to switch, or skip the helper to test as a guest.
- **Database assertions before `RefreshDatabase`.** Without the trait, rows from previous tests persist. Add `RefreshDatabase` to your `use` array or use `assertDatabaseHas` carefully with seeded fixtures.
- **`assertDatabaseHas('users', …)` throws "Cannot query table".** The first argument is the name the ORM adapter binds, not the SQL table — for Prisma, that's the delegate name (`oAuthClient`), not `@@map`'d SQL (`oauth_clients`). The error is the framework's; check `static table` on the corresponding Model.
