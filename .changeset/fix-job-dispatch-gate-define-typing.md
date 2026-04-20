---
'@rudderjs/queue': patch
'@rudderjs/auth':  patch
---

Fix type-system contravariance errors that rejected common subclass patterns.

**`@rudderjs/queue`** — `Job.dispatch`'s `this: new (...args: unknown[]) => T` constraint rejected every subclass with a typed constructor (`constructor(public name: string, public email: string)`). Parameter types are contravariant, so a narrower signature can't satisfy `unknown[]`. Relaxed to `new (...args: any[]) => T`; `ConstructorParameters<typeof this>` still enforces arg-level type safety at the call site.

**`@rudderjs/auth`** — `Gate.define(ability, callback)` accepted only `(user, ...args: unknown[])` callbacks. A typed callback like `(user, post: Post) => …` failed the same contravariance check. Made `Gate.define` generic on the args tuple so callers can narrow without casting:

```ts
Gate.define<[Post]>('edit-post', (user, post) => user.id === post.authorId)
```

The stored callback is widened to the internal `AbilityCallback` type; narrowing only matters at the call site.

Both fixes add regression tests covering the subclass-constructor / typed-arg patterns. No runtime behavior change — pure typing fix.
