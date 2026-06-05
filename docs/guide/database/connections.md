# Connections

One app, more than one database — a reporting replica, a legacy MySQL box, a read pool behind the primary. `config/database.ts` lists every connection; models and the `DB` facade pick one by name; the default stays exactly as fast and simple as a single-connection app.

```ts
// config/database.ts
import { Env } from '@rudderjs/core'

export default {
  default: Env.get('DB_CONNECTION', 'sqlite'),

  connections: {
    // Default — boots eagerly with the app
    sqlite: { engine: 'native' as const, driver: 'sqlite' as const, url: Env.get('DATABASE_URL', 'file:./dev.db') },

    // Named connection — opened lazily on first use
    reporting: {
      engine: 'native' as const,
      driver: 'pg' as const,
      url:    Env.get('REPORTING_DATABASE_URL', ''),
    },
  },
}
```

## The connections list is a menu

Entries in `connections` are **lazy**. Declaring a connection registers a factory — no I/O, no socket, not even an `import()` of its database driver. A `mysql` entry in a SQLite app never touches `mysql2` until something actually queries it, so you can list every environment's alternates side by side without installing every driver.

Two consequences worth knowing:

- **The default connection boots eagerly** with the app (it backs every plain `Model` query). Named connections open on their first query and are then memoized — `DB.connection('reporting')`, `Model.on('reporting')`, and a model with `static connection = 'reporting'` all resolve to the **same** adapter and pool.
- **Config mistakes on a named connection surface at first use**, not at boot — a typo'd driver or unreachable URL throws when the first query opens it.

## `DB.connection(name)`

The [`DB` facade](/guide/database#transactions) from `@rudderjs/database` scopes to a named connection with `connection()` — same raw-SQL surface, different database:

```ts
import { DB } from '@rudderjs/database'

const stats = await DB.connection('reporting').select('SELECT * FROM daily_stats WHERE day = ?', [day])
await DB.connection('reporting').insert('INSERT INTO exports (path) VALUES (?)', [path])

await DB.connection('reporting').transaction(async () => {
  // raw statements AND Model queries bound to 'reporting' join this transaction
})
```

`DB.connection(name).select(...)` inside an open named transaction **joins that transaction** — the scoped facade checks the transaction context before resolving the pooled adapter. One divergence from the default facade: `DB.connection(name).listen(...)` is `async` (attaching the listener may first open the connection).

## Per-model connections

Bind a model to a connection permanently with `static connection`, or for a single query chain with `Model.on()`:

```ts
class DailyStat extends Model {
  static override table = 'daily_stats'
  static override connection = 'reporting'   // every query routes to 'reporting'
}

// One-off — any model, one chain
const rows = await User.on('reporting').where('active', true).get()
```

::: warning `Model.on()` is overloaded by arity
Two arguments is still the **lifecycle listener** — `User.on('creating', fn)` registers an observer hook, unchanged. One argument is the connection-scoped query entry point. Don't let an editor autocomplete swallow the second argument.
:::

The first query on a lazily-opened connection records its chain and replays it once the connection opens; every query after that takes the same direct path as the default connection. You never await an "open" step.

## Transactions on a named connection

`transaction()` takes a `connection` option (and `DB.connection(name).transaction(fn)` is the facade spelling of the same thing):

```ts
import { transaction } from '@rudderjs/orm'

await transaction(async () => {
  await DailyStat.create({ day, views })        // joins — bound to 'reporting'
  await User.create({ name })                   // does NOT join — default connection, autocommits
}, { connection: 'reporting' })
```

Transactions are **isolated per connection**: a transaction on `reporting` never captures default-connection queries, and vice versa — each connection's work commits or rolls back on its own (Laravel parity). Nesting a transaction on the same connection maps to a **savepoint**, exactly like the [single-connection behavior](/guide/database#transactions).

## Read/write splitting

A connection can route reads to one or more replicas while writes go to the primary:

```ts
// config/database.ts
connections: {
  primary: {
    engine: 'native' as const,
    driver: 'pg' as const,
    url:    Env.get('DATABASE_URL', ''),        // the write URL (alias: write: { url })
    read:   { url: [Env.get('DB_REPLICA_1', ''), Env.get('DB_REPLICA_2', '')] },
    sticky: true,
  },
},
```

- `read.url` — one URL or an array; multiple replicas round-robin per query.
- `read.picker` — optional replica-selection strategy (below).
- `write.url` — optional; defaults to the top-level `url`.
- `sticky` — read-your-writes within a request (below).

Routing is automatic and conservative:

| Goes to the **read pool** | Goes to the **writer** |
|---|---|
| Un-locked SELECT terminals (`get`/`first`/`find`/`count`/`paginate`/…) | All writes (`create`/`update`/`delete`/`upsert`/…) and DDL |
| `DB.select(...)` / `selectRaw` | Locked selects (`lockForUpdate()` / `sharedLock()`) |
| | **Every statement inside a `transaction()`** — reads included |

Anything that must see or hold the latest committed state stays on the writer; only plain reads ever touch a replica.

### Picking a replica

By default reads cycle through the replicas in order (round-robin). `read.picker` changes the strategy:

```ts
read: { url: [BIG_REPLICA, SMALL_REPLICA], picker: [3, 1] },   // weighted random — ~75% / ~25%
read: { url: replicas, picker: 'random' },                     // uniform random per query
read: { url: replicas, picker: (count) => myIndexFor(count) }, // custom — return the replica index
```

- `'round-robin'` (default) — cycle in `read.url` order.
- `'random'` — uniform random per query.
- `number[]` — weighted random: one non-negative weight per replica, in `read.url` order. Size weights to replica capacity. A malformed list (wrong length, negative entries, all zeros) fails fast when the connection opens, not per query.
- `(count) => index` — full control (the equivalent of Drizzle's `getReplica`): called once per read query with the replica count; return the index to serve it. An out-of-range return rejects that query with a clear error.

The picker runs **after** the sticky check — a sticky-routed read goes to the writer without consuming a pick. Works identically on the native engine and the Drizzle adapter.

### Sticky reads

With `sticky: true`, once a request writes to a split connection, **subsequent reads in that same request use the writer** — so a `create()` followed by a redirect-and-read doesn't race replication lag. The request scope is installed automatically: when any sticky split connection is configured, the provider adds a database-context middleware to both the `web` and `api` groups.

**Outside a request scope — queue jobs, `rudder` commands, the scheduler — sticky is a no-op** and reads go to the replicas. (Laravel resets the flag per request; a long-lived Node process without a scope boundary would otherwise go sticky-forever after its first write.) A job that needs read-your-writes opens its own scope:

```ts
import { runWithDatabaseContext } from '@rudderjs/database/sticky'

await runWithDatabaseContext(async () => {
  await Order.create({ ... })
  const fresh = await Order.query().latest().first()   // routed to the writer
})
```

`@rudderjs/database/sticky` is a node-only subpath — don't import it from client-reachable code. (The pre-relocation `@rudderjs/orm/sticky` path re-exports the same module and shares the same request scope.)

## Observing routing — query events

[`DB.listen()`](/guide/database#transactions) events carry the **connection name**, and on split connections a `target` tag:

```ts
DB.listen((e) => {
  console.log(e.connection, e.target, e.duration, e.sql)
  // 'primary' 'read'  1.2 'SELECT * FROM users WHERE ...'
  // 'primary' 'write' 3.4 'INSERT INTO orders ...'
})
```

`target` is `'read' | 'write'` and present **only** on read/write-split connections — single-URL connections carry no target.

## Adapter support

| | Native engine | Drizzle | Prisma |
|---|---|---|---|
| Named connections (`DB.connection`, `Model.on`, `static connection`) | ✅ | ✅ | ✅ |
| Read/write split (`read:` / `write:`) | ✅ | ✅ | ❌ throws at boot |
| Sticky reads | ✅ | ✅ | — |
| Per-connection transactions | ✅ | ✅ | ✅ |

The Prisma client owns a single URL, so `read:` / `write:` on a Prisma connection **throws at boot** (a silent ignore would silently serve every read from the writer). Use [`@prisma/extension-read-replicas`](https://github.com/prisma/extension-read-replicas) on your `PrismaClient`, or give that connection `engine: 'native'`. Named Prisma connections share the one generated client schema — point them only at schema-compatible databases.

## Not yet

Migrations are **default-connection only** for now — `Schema.connection(name)` and `migrate --connection` are deferred by design. Run migrations against each database by pointing the default connection at it (e.g. a separate config/env per target).
