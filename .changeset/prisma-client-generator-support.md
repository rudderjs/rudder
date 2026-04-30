---
"@rudderjs/orm-prisma": minor
---

Support Prisma 7's new `prisma-client` generator alongside the legacy `prisma-client-js` generator.

The new generator (`provider = "prisma-client"`) emits a self-contained ESM client at a custom `output` path — no engine binaries are downloaded from `binaries.prisma.sh` at install time, which makes it the only Prisma path that works inside browser-sandboxed runtimes like WebContainer / StackBlitz / Bolt.new.

**Usage** — point the adapter at the generated `PrismaClient` class via the `PrismaClient` config field, since the adapter can't `import('@prisma/client')` to find it:

```ts
// prisma/schema/base.prisma
generator client {
  provider     = "prisma-client"
  output       = "../generated/prisma"
  runtime      = "nodejs"
  moduleFormat = "esm"
}

// config/database.ts
import { PrismaClient } from '../prisma/generated/prisma/client.js'

export default {
  default: 'sqlite',
  PrismaClient,
  connections: { sqlite: { driver: 'sqlite', url: '...' } },
}
```

**Other changes:**

- `@prisma/client` peer dependency is now optional (`peerDependenciesMeta.optional: true`). Apps using only the new generator can drop the static `@prisma/client` import and the framework will skip the fallback resolution path.
- Improved error message when neither `client` nor `PrismaClient` config is supplied AND `@prisma/client` isn't installed — now points to the new-generator setup.
- `@libsql/client` optional peer bumped to `^0.17.0` to match `@prisma/adapter-libsql@^7.0.0`'s stricter peer range.

The legacy `prisma-client-js` path continues to work unchanged — `playground/` (the canonical demo) still uses it. The new path is what `playground-web/` and the `create-rudder-app --preset web` (planned) scaffold use to boot in StackBlitz.

Closes #127.
