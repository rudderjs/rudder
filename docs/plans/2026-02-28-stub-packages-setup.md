# Stub Packages Setup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the three broken stub packages (`@boostkit/auth`, `@boostkit/orm-drizzle`, `@boostkit/queue-bullmq`) so they follow monorepo conventions (proper `package.json`, `tsconfig.json`, and `src/index.ts`), and implement a real BullMQ queue adapter.

**Architecture:** Each stub currently has an incorrect `package.json` (missing `@boostkit/` npm scope, `type: "module"`, `exports`, build scripts) and an empty `src/index.ts`. The fix follows the exact same pattern used by `@boostkit/server-express`, `@boostkit/server-fastify`, and `@boostkit/server-h3`. `@boostkit/queue-bullmq` gets a real implementation; `@boostkit/orm-drizzle` and `@boostkit/auth` get `notImplemented()` stubs.

**Tech Stack:** TypeScript (ESM/NodeNext), BullMQ, `@boostkit/queue`, `@boostkit/orm`, pnpm workspaces, Turborepo

---

### Task 1: Fix `@boostkit/queue-bullmq`

**Files:**
- Modify: `packages/queue-bullmq/package.json`
- Modify: `packages/queue-bullmq/tsconfig.json`
- Modify: `packages/queue-bullmq/src/index.ts`

**Step 1: Fix `package.json`**

Replace entire file with proper monorepo-compliant config:

```json
{
  "name": "@boostkit/queue-bullmq",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@boostkit/queue": "workspace:*",
    "bullmq": "^5.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0"
  }
}
```

**Step 2: Fix `tsconfig.json`**

Replace empty file with proper config:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

**Step 3: Implement `src/index.ts`**

Implement real BullMQ adapter following same pattern as `@boostkit/queue-inngest`:

```typescript
import { Queue, Worker, type ConnectionOptions } from 'bullmq'
import type {
  Job,
  QueueAdapter,
  QueueAdapterProvider,
  DispatchOptions,
} from '@boostkit/queue'

// ─── BullMQ Adapter ────────────────────────────────────────

class BullMQAdapter implements QueueAdapter {
  private queues = new Map<string, Queue>()
  private readonly connection: ConnectionOptions

  constructor(config: BullMQConfig) {
    this.connection = config.connection ?? { host: '127.0.0.1', port: 6379 }
  }

  private getQueue(name: string): Queue {
    if (!this.queues.has(name)) {
      this.queues.set(name, new Queue(name, { connection: this.connection }))
    }
    return this.queues.get(name)!
  }

  async dispatch(job: Job, options: DispatchOptions = {}): Promise<void> {
    const name  = job.constructor.name
    const queue = this.getQueue(options.queue ?? 'default')

    await queue.add(name, JSON.parse(JSON.stringify(job)), {
      delay:    options.delay,
      attempts: (job.constructor as typeof Job).retries,
    })
  }

  async work(queue = 'default'): Promise<void> {
    new Worker(queue, async () => {
      // Users must extend BullMQAdapter or register job handlers manually
    }, { connection: this.connection })
  }
}

// ─── Config ────────────────────────────────────────────────

export interface BullMQConfig {
  connection?: ConnectionOptions
}

// ─── Factory ───────────────────────────────────────────────

export function bullmq(config: BullMQConfig = {}): QueueAdapterProvider {
  return {
    create(): QueueAdapter {
      return new BullMQAdapter(config)
    },
  }
}
```

**Step 4: Check BullMQ for vulnerabilities**

Run the advisory database check before adding the dependency.

**Step 5: Run `pnpm install` from repo root to resolve workspace deps**

**Step 6: Build and verify**

```bash
cd packages/queue-bullmq && npx tsc --noEmit
```

**Step 7: Commit**

```bash
git add packages/queue-bullmq/
git commit -m "feat(queue-bullmq): implement BullMQ adapter with proper monorepo setup"
```

---

### Task 2: Fix `@boostkit/orm-drizzle`

**Files:**
- Modify: `packages/orm-drizzle/package.json`
- Create: `packages/orm-drizzle/tsconfig.json`
- Modify: `packages/orm-drizzle/src/index.ts`

**Step 1: Fix `package.json`**

```json
{
  "name": "@boostkit/orm-drizzle",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@boostkit/orm": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0"
  }
}
```

**Step 2: Create `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

**Step 3: Implement `src/index.ts`** (notImplemented stub)

```typescript
import type { OrmAdapterProvider, OrmAdapter } from '@boostkit/orm'

function notImplemented(): never {
  throw new Error(
    '[Forge] @boostkit/orm-drizzle is not yet implemented. ' +
    'Use @boostkit/orm-prisma instead.'
  )
}

export function drizzle(): OrmAdapterProvider {
  return {
    create(): OrmAdapter { notImplemented() },
  }
}
```

**Step 4: Build and verify**

```bash
cd packages/orm-drizzle && npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add packages/orm-drizzle/
git commit -m "feat(orm-drizzle): scaffold Drizzle adapter stub with proper monorepo setup"
```

---

### Task 3: Fix `@boostkit/auth`

**Files:**
- Modify: `packages/auth/package.json`
- Create: `packages/auth/tsconfig.json`
- Modify: `packages/auth/src/index.ts`

**Step 1: Fix `package.json`**

```json
{
  "name": "@boostkit/auth",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@boostkit/core": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0"
  }
}
```

**Step 2: Create `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

**Step 3: Implement `src/index.ts`** (contracts + stub)

```typescript
// ─── Auth Guard Contract ───────────────────────────────────

export interface AuthGuard {
  /** Check if the current request is authenticated */
  check(): boolean | Promise<boolean>

  /** Return the authenticated user, or null */
  user<T = unknown>(): T | null | Promise<T | null>

  /** Attempt to authenticate with credentials */
  attempt(credentials: Record<string, unknown>): boolean | Promise<boolean>

  /** Log the user out */
  logout(): void | Promise<void>
}

// ─── Auth Config ───────────────────────────────────────────

export interface AuthConfig {
  /** Default guard name */
  default?: string
  /** Guard configurations keyed by name */
  guards?: Record<string, GuardConfig>
}

export interface GuardConfig {
  driver: 'session' | 'jwt'
  secret?: string
  ttl?:    number
}

// ─── Not-yet-implemented notice ────────────────────────────

function notImplemented(): never {
  throw new Error(
    '[Forge] @boostkit/auth is not yet implemented. ' +
    'Sessions, JWT, and guard support are coming in a future release.'
  )
}

// ─── Factory ───────────────────────────────────────────────

export function auth(_config?: AuthConfig): never {
  notImplemented()
}
```

**Step 4: Build and verify**

```bash
cd packages/auth && npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add packages/auth/
git commit -m "feat(auth): scaffold auth module stub with contracts and monorepo setup"
```

---

### Task 4: Full build verification

**Step 1: Install dependencies from root**

```bash
pnpm install
```

**Step 2: Build all packages**

```bash
pnpm build
```

Expected: All packages build successfully, including the three fixed stubs.

**Step 3: Commit any remaining changes**

```bash
git add .
git commit -m "chore: verify all stub packages build correctly"
```

---

### Post-plan note (2026-03-02): Dev HMR behavior

Provider and route side-effect changes are now hot-applied in development:

- `playground/bootstrap/providers.ts`
- `playground/routes/*.ts`

You should not need to restart `pnpm dev` after reordering providers or editing route registration files.

If a workspace still appears stale after pulling changes, run once from repo root:

```bash
pnpm --filter @boostkit/di build && pnpm --filter @boostkit/router build && pnpm --filter @boostkit/core build
```
