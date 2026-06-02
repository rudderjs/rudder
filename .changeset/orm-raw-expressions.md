---
"@rudderjs/orm": minor
"@rudderjs/orm-drizzle": minor
"@rudderjs/orm-prisma": minor
"@rudderjs/contracts": minor
"@rudderjs/database": patch
---

feat(orm): raw-SQL expressions — `selectRaw` / `whereRaw` / `orWhereRaw` / `orderByRaw` + `DB.raw(...)` everywhere

Adds Laravel's raw-SQL escape hatch to the query builder for the clauses the
structured builder can't express:

```ts
// Bound `?` placeholders are rebound to the dialect's form ($n on Postgres).
const adults = await User.query().whereRaw('age > ?', [18]).get()

// Compose with structured wheres + OR raw fragments.
await User.query().where('active', true).orWhereRaw('age > ?', [65]).get()

// Raw ORDER BY + raw projection.
await User.query().orderByRaw('field(status, ?, ?)', ['urgent', 'high']).get()
await User.query().selectRaw('count(*) as total, max(created_at) as latest').get()

// DB.raw(...) splices verbatim as a where value or order column.
import { DB } from '@rudderjs/database'
await User.query().where('created_at', '>', DB.raw('NOW()')).orderBy(DB.raw('age asc')).get()
```

Threaded through the native engine's compiler (a `?`-placeholder rebinder shares
the one positional bindings accumulator, so `$n` indices stay correct across the
whole statement). The Drizzle adapter implements `whereRaw`/`orWhereRaw`/
`orderByRaw` via its `sql` template; `selectRaw` throws there (its typed select
can't map an arbitrary raw projection back to hydrated models). The Prisma
adapter throws on all four — its structured client can't splice raw SQL — and
points you at the `DB` facade (`DB.select(sql, bindings)`) for raw queries.

The `Expression` wrapper behind `DB.raw(...)` moved from `@rudderjs/database` to
`@rudderjs/contracts` (re-exported from `@rudderjs/database`, so `DB.raw()` and
`import { raw } from '@rudderjs/database'` are unchanged) — it now lives on a
client-safe path so the query builder's raw methods stay out of `@rudderjs/database`'s
node-only graph.
