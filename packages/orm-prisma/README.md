# @boostkit/orm-prisma

Prisma-backed `@boostkit/orm` adapter provider.

## Installation

```bash
pnpm add @boostkit/orm-prisma
```

## Usage

```ts
import { prisma } from '@boostkit/orm-prisma'
import { ModelRegistry } from '@boostkit/orm'

const adapter = await prisma({
  driver: 'sqlite',
  url: process.env.DATABASE_URL,
}).create()

await adapter.connect()
ModelRegistry.set(adapter)
```

## API Reference

- `PrismaConfig`
- `prisma(config?)` → `OrmAdapterProvider`

## Configuration

- `PrismaConfig`
  - `client?`
  - `driver?` (`'postgresql' | 'sqlite' | 'mysql'`)
  - `url?`

## Notes

- Depends on `@prisma/client`.
- Optional adapter dependencies are used for specific drivers (`better-sqlite3`, `pg`, `@libsql/client`).
