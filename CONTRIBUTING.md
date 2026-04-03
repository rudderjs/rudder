# Contributing to RudderJS

## Package Development Guide

This document covers the rules and patterns for developing packages in the RudderJS monorepo.

---

## Dependency Types

Every `package.json` in `packages/` can use four dependency fields. Choosing the wrong one causes either bloated installs or missing packages at runtime.

### `dependencies`

Packages that **must be present at runtime**. They are installed automatically when a user installs your package.

Use for:
- Packages your code `import`s unconditionally at the top of a file
- Packages required for the package to function at all

```json
{
  "dependencies": {
    "zod": "^4.0.0",
    "reflect-metadata": "^0.2.0"
  }
}
```

### `devDependencies`

Packages only needed to **build or test** the package. They are never installed when a user installs your package.

Use for:
- TypeScript (`typescript`)
- Type definitions (`@types/*`)
- Test runners (`node:test` is built-in, but test helpers belong here)
- Build tools

```json
{
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
```

### `peerDependencies`

Packages the user must install themselves. The package **requires** them but does not install them — the user's app owns the version.

Use for:
- Framework packages like `@rudderjs/core` (adapters declare it as a peer, not a dep)
- Packages where version alignment matters (two copies would break things)

```json
{
  "peerDependencies": {
    "@rudderjs/core": "workspace:*"
  }
}
```

> **Rule:** Never add `@rudderjs/core` to `dependencies` of adapter packages (`server-hono`, `router`, etc.). Use `peerDependencies` only. Two copies of core in the same app would create two separate DI containers and break everything.

### `optionalDependencies` vs lazy `import()`

For features that only activate when a specific driver/backend is chosen, use a **lazy dynamic import** inside the class that needs it — not `optionalDependencies`.

```ts
// Good — ioredis is only loaded when driver: 'redis' is configured
private async getClient() {
  if (!this.client) {
    const { Redis } = await import('ioredis') as any
    this.client = new Redis(...)
  }
  return this.client
}
```

This approach:
- Never fails at startup if the package is not installed
- Only throws at the moment the driver is actually used
- Works without any special `package.json` field — just document the requirement

The package that provides the optional feature should list it in `peerDependencies` with `optional: true`:

```json
{
  "peerDependencies": {
    "ioredis": "^5.0.0"
  },
  "peerDependenciesMeta": {
    "ioredis": { "optional": true }
  }
}
```

---

## Real Examples from the Codebase

### Pattern: Always-required dep

`@rudderjs/validation` always needs Zod. It imports it at the top level.

```json
// packages/validation/package.json
{
  "dependencies": {
    "zod": "^4.0.0"
  }
}
```

### Pattern: Adapter declares core as peer

`@rudderjs/server-hono` is an adapter for core. It needs core's types and `ServiceProvider`, but must not own a copy of core.

```json
// packages/server-hono/package.json
{
  "peerDependencies": {
    "@rudderjs/core": "workspace:*"
  }
}
```

### Pattern: Optional driver via lazy import

`@rudderjs/cache` supports both `memory` (zero deps) and `redis` (needs `ioredis`). The Redis adapter lazy-loads ioredis:

```ts
// packages/cache/src/index.ts
class RedisAdapter implements CacheAdapter {
  private async getClient() {
    if (!this.client) {
      const { Redis } = await import('ioredis') as any  // only loads if driver: 'redis'
      this.client = new Redis(...)
    }
    return this.client
  }
}
```

`ioredis` is listed as an optional peer — not in `dependencies`. If the user configures `driver: 'memory'`, ioredis is never touched.

Same pattern in `@rudderjs/storage` for `@aws-sdk/client-s3` (S3 driver).

---

## The Circular Dependency Rule

The dependency flow is strictly one-directional:

```
@rudderjs/contracts   (no deps — pure types)
        |
@rudderjs/support     (no rudderjs deps)
@rudderjs/middleware  (depends on contracts, cache)
@rudderjs/validation  (depends on zod)
        |
@rudderjs/router      @rudderjs/server-hono
        |
@rudderjs/core        (the orchestrator)
        |
@rudderjs/orm-prisma  @rudderjs/cache  @rudderjs/storage  @rudderjs/queue-*
```

**Never** create an upward dependency. Examples of what is forbidden:
- `@rudderjs/router` depending on `@rudderjs/core` (use `peerDependencies`)
- `@rudderjs/middleware` depending on `@rudderjs/core`
- `@rudderjs/contracts` importing anything at runtime

If two packages need to share a type, put the type in `@rudderjs/contracts`.
If a lower-level package needs a core feature at runtime, load it via `resolveOptionalPeer()` from `@rudderjs/support`.

---

## Package Merge Policy

Before merging two packages, all six criteria must pass:

| # | Criteria | Question to ask |
|---|---|---|
| 1 | Always co-deployed | Are they always installed together? |
| 2 | Shared lifecycle | Do they register/boot as one unit? |
| 3 | No adapter boundary | Is it NOT a plugin/driver extension point? |
| 4 | No portability boundary | Does it NOT have optional runtime deps? |
| 5 | Same release cadence | Do they nearly always change together? |
| 6 | Low blast radius | Does merging avoid widespread import churn? |

If any item fails, keep the packages separate.

**Examples of merges that passed all criteria:**
- `@rudderjs/di` → merged into `@rudderjs/core` (always together, no adapter boundary)
- `@rudderjs/events` → merged into `@rudderjs/core` (same lifecycle, zero external deps)
- `@rudderjs/validation` → merged into `@rudderjs/core` (always co-deployed, Zod is a hard dep)

**Examples of packages kept separate:**
- `@rudderjs/cache` — has an adapter boundary (`CacheAdapter` interface, user-extendable)
- `@rudderjs/storage` — has an adapter boundary + optional S3 dep
- `@rudderjs/server-hono` — portability boundary (different adapters for different HTTP servers)
- `@rudderjs/queue-bullmq` — optional dep on BullMQ + Redis

---

## Monorepo workspace references

When one package depends on another in the monorepo, always use `workspace:*`:

```json
{
  "dependencies": {
    "@rudderjs/contracts": "workspace:*"
  }
}
```

After adding a new local dependency, run `pnpm install` from the repo root.

---

## Testing packages

Every package uses `node:test` + `node:assert/strict`. No external test runner needed.

```bash
cd packages/<name>
pnpm test          # compiles to dist-test/, runs tests, cleans up
pnpm build         # compiles to dist/
pnpm typecheck     # tsc --noEmit (no emit, includes test files)
```

Each package has three tsconfig files:

| File | Purpose |
|---|---|
| `tsconfig.json` | Editor config — includes test files, `noEmit: true` |
| `tsconfig.build.json` | Production build — excludes `*.test.ts`, emits to `dist/` |
| `tsconfig.test.json` | Test build — includes all, emits to `dist-test/` |
