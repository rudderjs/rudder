---
"@rudderjs/hash": minor
---

Synchronous hashing surface. Adds `Hash.makeSync(value)` and `Hash.isHashed(value)` to the facade, plus optional `makeSync` / `isHashed` methods on the `HashDriver` contract. `BcryptDriver` implements `makeSync` via `bcryptjs.hashSync` (sync-resolved through `createRequire`); `Argon2Driver.makeSync` throws (argon2 has no synchronous API). Backs `@rudderjs/orm`'s new `hashed` cast, which runs in a synchronous write path that cannot await.
