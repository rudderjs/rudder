import { Env } from '@rudderjs/core'

// This playground runs on the NATIVE engine (first-party, no external ORM) —
// its sibling `playground-prisma/` exercises the same app on the Prisma
// adapter. Migrations live in database/migrations/; `pnpm rudder migrate`
// applies them AND regenerates the typed model registry at
// app/Models/__schema/registry.d.ts (see Model.for<'table'>() in app/Models).
export default {
  default: Env.get('DB_CONNECTION', 'sqlite'),

  connections: {
    sqlite: {
      engine: 'native' as const,
      driver: 'sqlite' as const,
      url:    Env.get('DATABASE_URL', 'file:./dev.db'),
    },

    // The same app on a server database is a config change, not a rewrite:
    pg: {
      engine: 'native' as const,
      driver: 'pg' as const,
      url:    Env.get('DATABASE_URL', ''),
    },

    mysql: {
      engine: 'native' as const,
      driver: 'mysql' as const,
      url:    Env.get('DATABASE_URL', ''),
    },

    // ── Named connections + read/write split ──────────────────────────────
    // `connections` is a MENU: entries are lazy, so a named connection nobody
    // queries never opens a socket or even imports its driver. Uncomment to
    // try — see docs/guide/database/connections.md.
    //
    // A second database, opened on first use:
    //   DB.connection('reporting').select(...)  /  Model.on('reporting')  /
    //   class Stat extends Model { static connection = 'reporting' }
    //
    // reporting: {
    //   engine: 'native' as const,
    //   driver: 'pg' as const,
    //   url:    Env.get('REPORTING_DATABASE_URL', ''),
    // },
    //
    // Read/write split with sticky reads. Un-locked SELECTs round-robin the
    // replicas; writes, locked selects, and everything inside a transaction()
    // stay on the writer; sticky = read-your-writes per request.
    //
    // primary: {
    //   engine: 'native' as const,
    //   driver: 'pg' as const,
    //   url:    Env.get('DATABASE_URL', ''),     // write URL (alias: write: { url })
    //   read:   { url: [Env.get('DB_REPLICA_1', ''), Env.get('DB_REPLICA_2', '')] },
    //   sticky: true,
    // },
  },
}
