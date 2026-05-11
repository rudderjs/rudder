# Model Factories

## Basic shape

```ts
import { ModelFactory, sequence } from '@rudderjs/orm'
import { User } from '../app/Models/User.js'

class UserFactory extends ModelFactory<{ name: string; email: string; role: string }> {
  protected modelClass = User

  definition() {
    return {
      name:  'Alice',
      email: sequence(i => `user${i}@example.com`),
      role:  'user',
    }
  }

  protected states() {
    return {
      admin: () => ({ role: 'admin' }),
    }
  }
}
```

## Usage

```ts
const one     = await UserFactory.new().create()                       // 1 row, persisted
const five    = await UserFactory.new().create(5)                      // 5 rows
const dtos    = await UserFactory.new().make(3)                        // 3 in-memory only
const admin   = await UserFactory.new().state('admin').create()
const custom  = await UserFactory.new().with(() => ({ name: 'Bob' })).create()
```

`.make()` does not write to the DB — useful for testing serialization, validation, or non-persisting code paths.
`.create()` writes via `Model.create()`, so observers / mutators / mass assignment all apply.

## sequence()

```ts
email: sequence(i => `user${i}@example.com`)
```

Inside `definition()`, return the call directly — the factory resolves callables for you. Each generated row gets the next index.

## Pitfalls

❌ **Don't** call `sequence(...)` outside `definition()`:

```ts
const s = sequence(i => i)
class UserFactory extends ModelFactory<{ n: number }> {
  definition() { return { n: s() } }   // shared sequence across factory instances
}
```

✅ **Do** return the sequence callable from `definition()`:

```ts
definition() { return { n: sequence(i => i) } }   // fresh per factory instance
```

❌ **Don't** assume `.make()` ran mutators:

```ts
const draft = await UserFactory.new().make()
// password mutator did NOT run because there's no save() — but accessors DID run on serialization
```

✅ **Do** call `.create()` when you need mutator side effects (password hashing, slug generation, etc.).
