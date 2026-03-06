# @boostkit/auth

## 0.1.0

### Minor Changes

- Rename `betterAuth()` to `auth()` (old name kept as deprecated alias). Simplify `BetterAuthConfig` — remove `database` and `databaseProvider` fields. The provider now auto-discovers the PrismaClient from the DI container (registered by `prismaProvider`) or creates its own from the optional `dbConfig` second argument. Add optional deps for Prisma adapters.

## 0.0.4

### Patch Changes

- Updated dependencies
  - @boostkit/core@0.0.6

## 0.0.3

### Patch Changes

- @boostkit/core@0.0.5

## 0.0.2

### Patch Changes

- Updated dependencies
  - @boostkit/contracts@0.0.2
  - @boostkit/core@0.0.4
  - @boostkit/router@0.0.3
