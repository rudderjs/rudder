import { Env } from '@rudderjs/core'
import { PrismaClient } from '../prisma/generated/prisma/client.js'

// playground-web uses Prisma's libSQL driver adapter (via @prisma/adapter-libsql
// + @libsql/client) instead of better-sqlite3. The libSQL adapter is pure JS,
// so it boots in WebContainer where native bindings would fail.
//
// The schema uses Prisma 7's new `prisma-client` generator (output:
// ./prisma/generated/prisma) — a self-contained ESM client with no native
// engine binaries at install time or at runtime. We pass the generated
// PrismaClient class explicitly so @rudderjs/orm-prisma doesn't fall back to
// importing the legacy `@prisma/client` package (which isn't installed).
//
// Run `pnpm exec prisma generate` after schema changes to regenerate the
// client at the configured output path.

export default {
  default: Env.get('DB_CONNECTION', 'libsql'),

  PrismaClient,

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
