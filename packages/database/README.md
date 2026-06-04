# @rudderjs/database

The SQL data-layer foundation for RudderJS — the `DB` facade, raw expressions, and the **built-in native SQL engine** (query compiler, schema builder, migrations, and drivers for SQLite / PostgreSQL / MySQL). `@rudderjs/orm` (the Eloquent-style `Model` layer) is built on top of this package and installs it automatically — most apps never add it by hand.

```bash
pnpm add @rudderjs/orm        # pulls in @rudderjs/database
```

Node-only: never import this package from client-bundle-reachable code.

## `DB` facade

Laravel-style raw-SQL entry point. Resolves the **same** active adapter your Models use (native, Prisma, or Drizzle) — one connection, never a second:

```ts
import { DB, raw } from '@rudderjs/database'

const rows  = await DB.select('SELECT * FROM users WHERE active = ?', [true])
const count = await DB.update('UPDATE posts SET draft = ? WHERE author_id = ?', [false, 7])

await DB.transaction(async () => {
  // Model.* AND DB.* calls in here join the same transaction
})

DB.listen((e) => console.log(e.sql, e.duration))      // query events
const reporting = DB.connection('reporting')           // named connections
```

## Native engine

The first-party SQL engine behind `engine: 'native'` connections — no external ORM. Headline API on the main entry:

```ts
// database/migrations/2026_06_02_120000_create_posts_table.ts
import { Migration, Schema } from '@rudderjs/database'

export default class extends Migration {
  async up()   { await Schema.create('posts', (t) => { t.id(); t.string('title'); t.timestamps() }) }
  async down() { await Schema.dropIfExists('posts') }
}
```

Standalone (no framework — any Node app):

```ts
import { NativeAdapter, BetterSqlite3Driver } from '@rudderjs/database'
```

The full engine surface (compiler, dialects, `NativeQueryBuilder`, introspection, the schema→TS type generator) lives on the `./native` subpath. Drivers are optional peers — install the one you use: `better-sqlite3`, `postgres`, or `mysql2`.

> Historical note: the engine originally shipped inside `@rudderjs/orm` at `@rudderjs/orm/native`. That subpath remains as a permanent re-export of this package, so existing migration files and imports keep working unchanged.

## Sticky-read scope (`./sticky`)

For read/write-split connections with `sticky: true`, reads after a write inside a request route to the writer. Outside a request scope (queue jobs, commands) wrap the work yourself:

```ts
import { runWithDatabaseContext } from '@rudderjs/database/sticky'

await runWithDatabaseContext(async () => {
  await Order.create({ ... })
  await Order.query().latest().first()   // routed to the writer
})
```

## Docs

- Database guide: https://rudderjs.com/guide/database
- Native engine: https://rudderjs.com/guide/database/native
- Connections, read/write split: https://rudderjs.com/guide/database/connections
