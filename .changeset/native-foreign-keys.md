---
"@rudderjs/orm": minor
---

feat(orm): native schema builder — foreign keys (`constrained()` / `foreign()` / `onDelete`)

The native engine's `Schema.create` migrations can now declare foreign keys, Laravel-style:

```ts
Schema.create('posts', (t) => {
  t.id()
  t.foreignId('user_id').constrained()                 // → REFERENCES users(id)
  t.foreignId('author_id').constrained('users')        // explicit table
  t.foreignId('editor_id').references('id').on('users').onDelete('cascade')
})

// composite / explicit:
Schema.create('memberships', (t) => {
  t.foreign(['org_id', 'user_id']).references(['org_id', 'user_id']).on('org_users')
})
```

- **`constrained(table?, column = 'id')`** infers the referenced table from the column name (`user_id` → `users`, `authorId` → `authors`) or takes it explicitly.
- **`references(cols).on(table)`** builds the FK explicitly; **`foreign(cols)`** records a table-level (composite) FK.
- **`onDelete` / `onUpdate`** accept `cascade` | `restrict` | `set null` | `no action` (plus `setNull` / `noAction` aliases); anything else throws — arbitrary text never reaches the SQL.
- FKs compile to `CONSTRAINT "{table}_{col}_foreign" FOREIGN KEY (...) REFERENCES "tbl" (...) [ON DELETE ...] [ON UPDATE ...]` table constraints, with every identifier validated + quoted.

**SQLite notes:** FK enforcement requires `PRAGMA foreign_keys = ON` (better-sqlite3 leaves it off by default; this release does not change that). SQLite can't ADD or DROP a foreign key in place, so `Schema.table(...)` adding an FK column or `dropForeign(...)` throws a clear error pointing at creating the table with the FK or a column `change()`/rebuild.
