---
'@rudderjs/testing': minor
---

Laravel-parity `AssertableJson` fluent DSL — the canonical JSON-response assertion in Laravel 12 — exposed via a new overload on `TestResponse.assertJson(callback)`:

```ts
res.assertJson(json =>
  json
    .has('user')
    .where('user.name', 'Suleiman')
    .whereType('user.email', 'string')
    .has('items', 3, item => item.where('id', 1).etc())
    .missing('user.password')
    .etc()
)
```

**Strict-by-default** is the headline — at the end of any scope (root or scoped callback), the DSL asserts that every key on the object was touched. Unchecked keys throw. So an extra field accidentally added to a response surfaces in the test instead of leaking through.

Public surface:

- `AssertableJson` — exported class for direct use, also driven by the callback overload on `TestResponse.assertJson`.
- Methods: `has(key, n?, fn?)`, `missing(key)`, `missingAll(keys)`, `where(key, value)`, `whereNot(key, value)`, `whereType(key, type)`, `whereContains(key, value)`, `count(key, n)`, `first(fn)`, `each(fn)`, `etc()`.
- Dot-notation paths (`user.profile.name`, `items.0.id`).
- Existing subset-match form (`res.assertJson({ name: 'Alice' })`) is unchanged — the overload only triggers on a function argument.

Found by the Phase 3 testing-ergonomics audit (cluster 8).
