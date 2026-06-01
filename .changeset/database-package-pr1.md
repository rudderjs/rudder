---
"@rudderjs/contracts": minor
"@rudderjs/orm": minor
"@rudderjs/orm-prisma": minor
"@rudderjs/orm-drizzle": minor
---

feat(database): scaffold @rudderjs/database + the DB facade skeleton

Establishes the data-layer extraction boundary (Phase 2, PR1) — a new
`@rudderjs/database` package (1.0.0) owning the public `DB` facade
(`DB.select/insert/update/delete/statement/raw`), with the `@rudderjs/orm →
@rudderjs/database` dependency direction. The native engine internals are not
relocated yet (a later step).

- **@rudderjs/contracts** — promote the model-independent execution types
  (`Row`, `Executor`, `Transaction`, `Connection`) into the zero-dep foundation
  beside `OrmAdapter`, and add two optional raw-exec seam methods to `OrmAdapter`:
  `selectRaw(sql, bindings)` and `affectingStatement(sql, bindings)`. Single
  import point for every adapter — no flag-day.
- **@rudderjs/orm** — depends on `@rudderjs/database`; native adapter implements
  the raw-exec seam; new node-only `@rudderjs/orm/db-bridge` subpath pushes the
  `ModelRegistry` adapter accessor into the facade (kept off the client bundle).
- **@rudderjs/orm-prisma / @rudderjs/orm-drizzle** — implement `selectRaw` /
  `affectingStatement` over `$queryRawUnsafe`/`$executeRawUnsafe` and
  `db.execute(...)` respectively; both register the db-bridge on provider load.

The new `@rudderjs/database` package publishes at 1.0.0 (new-package policy) and
is intentionally omitted from this changeset's version bumps so its first release
is exactly 1.0.0 rather than a bumped 1.1.0.
