import { Env } from '@rudderjs/core'

export default {
  default: Env.get('DB_CONNECTION', 'sqlite'),

  connections: {
    sqlite: {
      driver: 'sqlite' as const,
      url:    Env.get('DATABASE_URL', 'file:./dev.db'),
    },

    postgresql: {
      driver: 'postgresql' as const,
      url:    Env.get('DATABASE_URL', ''),
    },

    mysql: {
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
    // Read/write split with sticky reads (native + drizzle; prisma throws at
    // boot → use @prisma/extension-read-replicas there). Un-locked SELECTs
    // round-robin the replicas; writes, locked selects, and everything inside
    // a transaction() stay on the writer; sticky = read-your-writes per request.
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
