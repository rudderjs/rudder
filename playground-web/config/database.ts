import { Env } from '@rudderjs/core'

// playground-web uses Prisma's libSQL driver adapter (via @prisma/adapter-libsql
// + @libsql/client) instead of better-sqlite3. The libSQL adapter is pure JS,
// so it boots in WebContainer where native bindings would fail. The
// @rudderjs/orm-prisma adapter wires this when `driver: 'libsql'` is set.
//
// Schema defaults to ./prisma/dev.db. Phase 0 spike confirmed `engineType =
// "client"` + `previewFeatures = ["driverAdapters", "queryCompiler"]` in
// prisma/schema/base.prisma is required to bypass the Rust query engine.

export default {
  default: Env.get('DB_CONNECTION', 'libsql'),

  connections: {
    libsql: {
      driver: 'libsql' as const,
      url:    Env.get('DATABASE_URL', 'file:./prisma/dev.db'),
    },

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
  },
}
