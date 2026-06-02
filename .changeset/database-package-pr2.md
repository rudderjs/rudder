---
"@rudderjs/orm": minor
"@rudderjs/orm-prisma": minor
"@rudderjs/orm-drizzle": minor
---

feat(database): cross-adapter transaction() + DB.transaction() facade

Closes the top correctness gap (gap-analysis §8 #1): `transaction()` now works on
every adapter, not just the native engine, and is reachable from the new
`@rudderjs/database` `DB` facade. The strategy is "boundary now, fill
incrementally" — the `OrmAdapter.transaction?` contract was already in place
(PR1), so this PR is pure implementation, no contract-shape change.

- **@rudderjs/orm-prisma** — implement `transaction(fn)` over Prisma's interactive
  `$transaction`. The callback's adapter re-binds to Prisma's transaction client,
  so every `Model.*` / `DB.*` call inside the callback runs on that one
  connection. Nesting maps to a `SAVEPOINT` / `RELEASE SAVEPOINT` (or
  `ROLLBACK TO SAVEPOINT` on failure) bracket on the transaction connection,
  since Prisma's interactive client can't open a nested `$transaction`.
- **@rudderjs/orm-drizzle** — implement `transaction(fn)` over `db.transaction`.
  The scoped adapter re-binds to Drizzle's transaction `db`; because Drizzle's
  `tx` is itself a `db`, nested `transaction()` opens a real SAVEPOINT for free.
- **@rudderjs/orm** — `DB.transaction()` reuses the ORM's `AsyncLocalStorage`
  scoping: the `db-bridge` now also pushes the ORM `transaction()` free function
  in as the facade's transaction runner, so `Model.*` AND `DB.*` writes inside a
  `DB.transaction(fn)` callback join the *same* open transaction (one connection,
  not two). The native provider now registers the bridge too, so `DB.*` /
  `DB.transaction()` work in native-engine apps.

The `@rudderjs/database` `DB.transaction(fn)` surface ships in that package's
first publish (still 1.0.0 — same deferral as PR1; it is intentionally kept off
this changeset's version bumps so its initial npm release is exactly 1.0.0).
